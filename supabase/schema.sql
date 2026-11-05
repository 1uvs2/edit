-- =========================================================
-- 에딧 커미션 · Supabase 데이터베이스 설정
-- Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
-- 여러 번 실행해도 안전하게 작성되어 있어요.
-- =========================================================

-- 1) 프로필: 카카오 로그인한 사람마다 한 줄씩 자동 생성
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  nickname text,
  avatar_url text,
  default_bias text,                 -- 최애 ([그룹] [멤버])
  default_ratio text default '4:3',  -- 파일 규격
  default_credit text,               -- 크레딧 표기
  created_at timestamptz default now()
);

-- 2) 에디터 목록: 여기에 등록된 사람만 모든 요청서를 볼 수 있어요
create table if not exists public.editors (
  user_id uuid primary key references auth.users on delete cascade
);

create or replace function public.is_editor()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.editors where user_id = auth.uid());
$$;

-- 3) 가격 계산 (화면의 가격표와 같아야 해요. 가격을 바꾸면 config.js 도 같이 바꾸세요)
create or replace function public.compute_total(
  t text, sec int, p boolean, f boolean, c boolean
) returns int language sql immutable as $$
  select (
    (case t when 'short' then 30000 when 'A' then 40000 when 'B' then 65000 else 0 end)
    + (greatest(coalesce(sec, 0), 0) / 5) * 5000          -- 분량: 5초당 5,000원
    + (case when p then 30000 else 0 end)                   -- 포트폴리오 비공개
    + (case when f then 30000 else 0 end)                   -- 빠른 마감
  ) * (case when c then 2 else 1 end);                      -- 상업적 사용: 총액 2배
$$;

-- 4) 요청서
create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  -- 요청서 내용
  occasion text,          -- 기념일 이름 (예: 생일)
  member text,            -- 그룹명 · 멤버 이름
  song text,              -- 곡 · 구간
  sources jsonb default '[]'::jsonb,     -- 영상 소스 [{time, url}]
  refs jsonb default '[]'::jsonb,        -- 레퍼런스 [url]
  notes text,             -- 요청사항
  credit text,            -- 크레딧 표기
  ratio text,             -- 파일 규격
  deadline date,          -- 마감일
  upload_date date,       -- 예정 업로드일

  -- 가격 선택
  edit_type text check (edit_type in ('short', 'A', 'B')),
  extra_sec int default 0 check (extra_sec >= 0 and extra_sec <= 600 and extra_sec % 5 = 0),
  opt_private boolean default false,
  opt_fast boolean default false,
  opt_commercial boolean default false,
  total int not null default 0,

  -- 결제 (계좌이체)
  depositor text,         -- 입금자명
  status text default 'awaiting_payment'
    check (status in ('awaiting_payment', 'confirmed', 'cancelled')),

  -- 진행판: 0 시작 전, 1 요청 확인, 2 컷 편집, 3 효과 추가, 4 후반 작업, 5 납품
  stage int default 0 check (stage between 0 and 5),
  stage_dates jsonb default '{}'::jsonb,  -- {"1": {"plan": "2026-07-01", "done": "2026-07-01"}, ...}
  preview_url text,
  preview_label text,
  client_approved_stage int default 0,
  revision_count int default 0,
  client_note text,
  revision_requested_at timestamptz,
  editor_memo text
);

-- 5) 다가오는 기념일
create table if not exists public.anniversaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade default auth.uid(),
  title text not null,
  date date not null,
  notify boolean default true,
  created_at timestamptz default now()
);

-- =========================================================
-- 자동 처리 (트리거)
-- =========================================================

-- 카카오로 처음 로그인하면 프로필 자동 생성
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nickname, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'nickname',
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'preferred_username',
      '의뢰인'
    ),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 요청서 저장 시: 금액은 서버에서 다시 계산하고, 상태는 처음 값으로 고정
create or replace function public.requests_before_insert()
returns trigger language plpgsql as $$
begin
  new.user_id := auth.uid();
  new.status := 'awaiting_payment';
  new.stage := 0;
  new.stage_dates := '{}'::jsonb;
  new.revision_count := 0;
  new.client_approved_stage := 0;
  new.preview_url := null;
  new.preview_label := null;
  new.editor_memo := null;
  new.total := public.compute_total(new.edit_type, new.extra_sec, new.opt_private, new.opt_fast, new.opt_commercial);
  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists requests_before_insert on public.requests;
create trigger requests_before_insert
  before insert on public.requests
  for each row execute function public.requests_before_insert();

create or replace function public.requests_before_update()
returns trigger language plpgsql as $$
begin
  new.total := public.compute_total(new.edit_type, new.extra_sec, new.opt_private, new.opt_fast, new.opt_commercial);
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists requests_before_update on public.requests;
create trigger requests_before_update
  before update on public.requests
  for each row execute function public.requests_before_update();

-- =========================================================
-- 의뢰인이 할 수 있는 동작 (본인 요청서만)
-- =========================================================

-- 미리보기 "이대로 좋아요"
create or replace function public.approve_preview(rid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.requests
     set client_approved_stage = stage, client_note = null
   where id = rid and user_id = auth.uid();
end $$;

-- 미리보기 "수정 요청"
create or replace function public.request_revision(rid uuid, note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.requests
     set revision_count = revision_count + 1,
         client_note = left(note, 2000),
         revision_requested_at = now()
   where id = rid and user_id = auth.uid() and status = 'confirmed';
end $$;

-- =========================================================
-- 보안 규칙 (Row Level Security)
-- =========================================================
alter table public.profiles enable row level security;
alter table public.editors enable row level security;
alter table public.requests enable row level security;
alter table public.anniversaries enable row level security;

-- 프로필: 본인 것만 보고 수정. 에디터는 의뢰인 이름 확인을 위해 모두 볼 수 있음
drop policy if exists "profiles select" on public.profiles;
create policy "profiles select" on public.profiles
  for select using (id = auth.uid() or public.is_editor());
drop policy if exists "profiles update" on public.profiles;
create policy "profiles update" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists "profiles insert" on public.profiles;
create policy "profiles insert" on public.profiles
  for insert with check (id = auth.uid());

-- 에디터 목록: 본인이 에디터인지 확인만 가능 (추가는 SQL Editor 에서)
drop policy if exists "editors select" on public.editors;
create policy "editors select" on public.editors
  for select using (user_id = auth.uid());

-- 요청서: 의뢰인은 본인 것만 보고 새로 작성. 에디터는 전부 보고 수정
drop policy if exists "requests select" on public.requests;
create policy "requests select" on public.requests
  for select using (user_id = auth.uid() or public.is_editor());
drop policy if exists "requests insert" on public.requests;
create policy "requests insert" on public.requests
  for insert with check (auth.uid() is not null);
drop policy if exists "requests update by editor" on public.requests;
create policy "requests update by editor" on public.requests
  for update using (public.is_editor()) with check (public.is_editor());

-- 기념일: 본인 것만
drop policy if exists "anniversaries all" on public.anniversaries;
create policy "anniversaries all" on public.anniversaries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

grant execute on function public.is_editor() to authenticated;
grant execute on function public.approve_preview(uuid) to authenticated;
grant execute on function public.request_revision(uuid, text) to authenticated;

-- =========================================================
-- 나를 에디터로 등록하기
-- 사이트에서 카카오로 한 번 로그인한 뒤, 아래 한 줄의 주석(--)을 지우고 실행하세요.
-- 가장 먼저 가입한 계정(= 나)을 에디터로 등록해요.
-- =========================================================
-- insert into public.editors (user_id) select id from auth.users order by created_at limit 1 on conflict do nothing;
