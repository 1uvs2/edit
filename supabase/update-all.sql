-- =========================================================
-- 에딧 커미션 · 통합 업데이트 (3~7차 전부)
-- 이 파일 하나만 SQL Editor 에 붙여넣고 Run 하세요. 여러 번 실행해도 안전해요.
-- =========================================================

-- ---------- update-3-messages.sql ----------
-- =========================================================
-- 에딧 커미션 · 3차 업데이트: 메시지 보낸 사람 구분, 알림 보완
-- SQL Editor 에 전체를 붙여넣고 Run 하세요. 여러 번 실행해도 안전해요.
-- =========================================================

-- 에디터로서 보낸 메시지인지 기록 (에디터와 의뢰인이 같은 계정이어도 구분)
alter table public.messages add column if not exists from_editor boolean not null default false;

create or replace function public.messages_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.sender_id := auth.uid();
  new.from_editor := coalesce(new.from_editor, false) and public.is_editor();  -- 에디터만 에디터로 보낼 수 있음
  new.created_at := now();
  return new;
end $$;

drop trigger if exists messages_before_insert on public.messages;
create trigger messages_before_insert before insert on public.messages
  for each row execute function public.messages_before_insert();

-- 에디터 알림: 본인 행동이어도 받도록 (혼자 테스트할 때도 확인 가능)
create or replace function public.notify_editors(rid uuid, k text, t text, b text, l text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, request_id, kind, title, body, link)
  select e.user_id, rid, k, t, b, l from public.editors e;
$$;

-- 메시지 알림: 보낸 쪽 반대편에게
create or replace function public.messages_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r public.requests;
begin
  select * into r from public.requests where id = new.request_id;
  if new.from_editor then
    perform public.notify_user(r.user_id, r.id, 'message', '에디터가 메시지를 보냈어요',
      left(new.body, 80), '#/chat/' || r.id);
  else
    perform public.notify_editors(r.id, 'message', '의뢰인이 메시지를 보냈어요',
      public.request_title(r) || ' · ' || left(new.body, 80), '#/editor/chat/' || r.id);
  end if;
  return new;
end $$;


-- ---------- update-4-delivery.sql ----------
-- =========================================================
-- 에딧 커미션 · 4차 업데이트: 납품 (구글 드라이브 링크 전달)
-- SQL Editor 에 전체를 붙여넣고 Run 하세요. 여러 번 실행해도 안전해요.
-- =========================================================

alter table public.requests add column if not exists delivery_url text;
alter table public.requests add column if not exists delivery_note text;
alter table public.requests add column if not exists delivered_at timestamptz;
alter table public.requests add column if not exists received_at timestamptz;

-- 새 요청서에는 납품 정보가 비어 있도록
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
  new.delivery_url := null;
  new.delivery_note := null;
  new.delivered_at := null;
  new.received_at := null;
  new.total := public.compute_total(new.edit_type, new.extra_sec, new.opt_private, new.opt_fast, new.opt_commercial);
  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;

-- 의뢰인 "잘 받았어요"
create or replace function public.confirm_received(rid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.requests set received_at = now()
   where id = rid and user_id = auth.uid() and delivery_url is not null and received_at is null;
end $$;
grant execute on function public.confirm_received(uuid) to authenticated;

-- 알림 (납품 포함)
create or replace function public.requests_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ttl text := public.request_title(new);
  client_link text := '#/request/' || new.id;
  editor_link text := '#/editor/' || new.id;
  delivered_now boolean;
begin
  if tg_op = 'INSERT' then
    perform public.notify_editors(new.id, 'new_request', '새 요청서가 들어왔어요',
      ttl || ' · ' || to_char(new.total, 'FM999,999,999') || '원 · 입금자 ' || coalesce(new.depositor, '-'), editor_link);
    return new;
  end if;

  delivered_now := new.delivery_url is not null and new.delivery_url is distinct from old.delivery_url;

  -- 의뢰인에게
  if delivered_now then
    perform public.notify_user(new.user_id, new.id, 'delivered', '완성된 영상이 도착했어요',
      ttl || ' · 진행판에서 영상을 받아 주세요', client_link);
  end if;
  if old.status <> 'confirmed' and new.status = 'confirmed' then
    perform public.notify_user(new.user_id, new.id, 'confirmed', '입금이 확인됐어요',
      ttl || ' 작업을 시작할게요', client_link);
  elsif new.stage is distinct from old.stage and new.stage > 0 and not (delivered_now and new.stage = 5) then
    perform public.notify_user(new.user_id, new.id, 'stage',
      case when new.stage = 5 then '에딧이 납품됐어요' else '진행 상황이 바뀌었어요' end,
      ttl || ' · ' || public.stage_name(new.stage) || case when new.stage = 5 then ' 완료' else ' 단계 진행 중' end, client_link);
  end if;
  if new.preview_url is not null and new.preview_url is distinct from old.preview_url then
    perform public.notify_user(new.user_id, new.id, 'preview', '새 미리보기가 도착했어요',
      coalesce(new.preview_label, ttl), client_link);
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    perform public.notify_user(new.user_id, new.id, 'cancelled', '의뢰가 취소되었어요', ttl, client_link);
  end if;

  -- 에디터에게
  if coalesce(new.revision_count, 0) > coalesce(old.revision_count, 0) then
    perform public.notify_editors(new.id, 'revision', '수정 요청이 왔어요',
      ttl || ' · ' || left(coalesce(new.client_note, ''), 80), editor_link);
  end if;
  if coalesce(new.client_approved_stage, 0) > coalesce(old.client_approved_stage, 0) then
    perform public.notify_editors(new.id, 'approved', '의뢰인이 "이대로 좋아요"를 눌렀어요',
      ttl || ' · ' || public.stage_name(new.client_approved_stage), editor_link);
  end if;
  if new.received_at is not null and old.received_at is null then
    perform public.notify_editors(new.id, 'received', '의뢰인이 영상을 받았어요', ttl, editor_link);
  end if;
  return new;
end $$;


-- ---------- update-5-avatar.sql ----------
-- =========================================================
-- 에딧 커미션 · 5차 업데이트: 프로필 사진 저장소
-- SQL Editor 에 전체를 붙여넣고 Run 하세요. 여러 번 실행해도 안전해요.
-- =========================================================

-- 프로필 사진 보관함 (공개 읽기)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- 본인 폴더(내 계정 ID)에만 올리고 지울 수 있어요
drop policy if exists "avatars read" on storage.objects;
create policy "avatars read" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars insert own" on storage.objects;
create policy "avatars insert own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars update own" on storage.objects;
create policy "avatars update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars delete own" on storage.objects;
create policy "avatars delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- 닉네임 길이 제한
alter table public.profiles drop constraint if exists profiles_nickname_len;
alter table public.profiles add constraint profiles_nickname_len check (nickname is null or char_length(nickname) between 1 and 20) not valid;

-- ---------- update-6-notices.sql ----------
-- =========================================================
-- 에딧 커미션 · 6차 업데이트: 공지사항
-- SQL Editor 에 전체를 붙여넣고 Run 하세요. 여러 번 실행해도 안전해요.
-- =========================================================

create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 100),
  body text not null default '' check (char_length(body) <= 5000),
  pinned boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.notices enable row level security;

-- 로그인한 사람은 누구나 읽기, 쓰기·수정·삭제는 에디터만
drop policy if exists "notices read" on public.notices;
create policy "notices read" on public.notices
  for select using (auth.uid() is not null);
drop policy if exists "notices write" on public.notices;
create policy "notices write" on public.notices
  for all using (public.is_editor()) with check (public.is_editor());

create or replace function public.notices_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists notices_touch on public.notices;
create trigger notices_touch before update on public.notices
  for each row execute function public.notices_touch();

-- 모든 회원에게 공지 알림 보내기 (에디터만 실행 가능)
create or replace function public.broadcast_notice(nid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  n public.notices;
begin
  if not public.is_editor() then
    raise exception '에디터만 보낼 수 있어요';
  end if;
  select * into n from public.notices where id = nid;
  if n.id is null then return; end if;
  insert into public.notifications (user_id, kind, title, body, link)
  select p.id, 'notice', '새 공지사항이 있어요', n.title, '#/notices/' || n.id
  from public.profiles p;
end $$;
grant execute on function public.broadcast_notice(uuid) to authenticated;


-- ---------- update-7-approval-members.sql ----------
-- =========================================================
-- 에딧 커미션 · 7차 업데이트: 승인 후 계좌 공개, 회원 관리
-- (3~6차를 아직 안 했다면 update-all.sql 을 실행하세요. 그 안에 이 내용도 들어 있어요)
-- =========================================================

-- 1) 승인 대기 상태 추가
alter table public.requests drop constraint if exists requests_status_check;
alter table public.requests add constraint requests_status_check
  check (status in ('pending_review', 'awaiting_payment', 'confirmed', 'cancelled'));
alter table public.requests alter column status set default 'pending_review';
alter table public.requests add column if not exists approved_at timestamptz;
alter table public.requests add column if not exists cancel_reason text;

create or replace function public.requests_before_insert()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.profiles where id = auth.uid() and blocked) then
    raise exception '이용이 제한된 계정이에요. 에디터에게 문의해 주세요.';
  end if;
  new.user_id := auth.uid();
  new.status := 'pending_review';
  new.stage := 0;
  new.stage_dates := '{}'::jsonb;
  new.revision_count := 0;
  new.client_approved_stage := 0;
  new.preview_url := null;
  new.preview_label := null;
  new.editor_memo := null;
  new.delivery_url := null;
  new.delivery_note := null;
  new.delivered_at := null;
  new.received_at := null;
  new.approved_at := null;
  new.cancel_reason := null;
  new.total := public.compute_total(new.edit_type, new.extra_sec, new.opt_private, new.opt_fast, new.opt_commercial);
  new.created_at := now();
  new.updated_at := now();
  return new;
end $$;

-- 2) 입금 계좌를 데이터베이스에 보관 (사이트 코드에는 없음)
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "settings editor" on public.app_settings;
create policy "settings editor" on public.app_settings
  for all using (public.is_editor()) with check (public.is_editor());

insert into public.app_settings (key, value)
values ('bank', '{"name": "국민은행", "number": "852501-04-191795", "holder": "배서은"}')
on conflict (key) do nothing;

-- 승인된 본인 요청서(또는 에디터)일 때만 계좌를 돌려줌
create or replace function public.get_bank_account(rid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  ok boolean;
begin
  select public.is_editor() or exists (
    select 1 from public.requests r
    where r.id = rid and r.user_id = auth.uid() and r.status in ('awaiting_payment', 'confirmed')
  ) into ok;
  if not ok then return null; end if;
  return (select value from public.app_settings where key = 'bank');
end $$;
grant execute on function public.get_bank_account(uuid) to authenticated;

-- 3) 회원 관리: 이용 제한, 에디터 메모
alter table public.profiles add column if not exists blocked boolean not null default false;
alter table public.profiles add column if not exists editor_note text;

drop policy if exists "profiles update by editor" on public.profiles;
create policy "profiles update by editor" on public.profiles
  for update using (public.is_editor()) with check (public.is_editor());

-- 의뢰인이 스스로 제한을 풀거나 메모를 바꾸지 못하게
create or replace function public.profiles_protect()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_editor() then
    new.blocked := old.blocked;
    new.editor_note := old.editor_note;
  end if;
  return new;
end $$;
drop trigger if exists profiles_protect on public.profiles;
create trigger profiles_protect before update on public.profiles
  for each row execute function public.profiles_protect();

-- 회원 목록 (에디터만)
create or replace function public.list_members()
returns table (
  id uuid, nickname text, avatar_url text, created_at timestamptz, last_sign_in_at timestamptz,
  blocked boolean, editor_note text, is_editor boolean, request_count bigint, total_paid bigint
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_editor() then raise exception '에디터만 볼 수 있어요'; end if;
  return query
  select p.id, p.nickname, p.avatar_url, p.created_at, u.last_sign_in_at,
         p.blocked, p.editor_note, exists (select 1 from public.editors e where e.user_id = p.id),
         (select count(*) from public.requests r where r.user_id = p.id),
         (select coalesce(sum(r.total), 0) from public.requests r where r.user_id = p.id and r.status = 'confirmed')
  from public.profiles p left join auth.users u on u.id = p.id
  order by p.created_at desc;
end $$;
grant execute on function public.list_members() to authenticated;

-- 4) 알림: 승인·반려 포함
create or replace function public.requests_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ttl text := public.request_title(new);
  client_link text := '#/request/' || new.id;
  editor_link text := '#/editor/' || new.id;
  delivered_now boolean;
begin
  if tg_op = 'INSERT' then
    perform public.notify_editors(new.id, 'new_request', '새 요청서가 들어왔어요',
      ttl || ' · ' || to_char(new.total, 'FM999,999,999') || '원 · 확인 후 승인해 주세요', editor_link);
    return new;
  end if;

  delivered_now := new.delivery_url is not null and new.delivery_url is distinct from old.delivery_url;

  if old.status = 'pending_review' and new.status = 'awaiting_payment' then
    perform public.notify_user(new.user_id, new.id, 'approved_request', '요청서가 승인됐어요',
      ttl || ' · 진행판에서 입금 계좌를 확인해 주세요', client_link);
  end if;
  if delivered_now then
    perform public.notify_user(new.user_id, new.id, 'delivered', '완성된 영상이 도착했어요',
      ttl || ' · 진행판에서 영상을 받아 주세요', client_link);
  end if;
  if old.status <> 'confirmed' and new.status = 'confirmed' then
    perform public.notify_user(new.user_id, new.id, 'confirmed', '입금이 확인됐어요',
      ttl || ' 작업을 시작할게요', client_link);
  elsif new.stage is distinct from old.stage and new.stage > 0 and not (delivered_now and new.stage = 5) then
    perform public.notify_user(new.user_id, new.id, 'stage',
      case when new.stage = 5 then '에딧이 납품됐어요' else '진행 상황이 바뀌었어요' end,
      ttl || ' · ' || public.stage_name(new.stage) || case when new.stage = 5 then ' 완료' else ' 단계 진행 중' end, client_link);
  end if;
  if new.preview_url is not null and new.preview_url is distinct from old.preview_url then
    perform public.notify_user(new.user_id, new.id, 'preview', '새 미리보기가 도착했어요',
      coalesce(new.preview_label, ttl), client_link);
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    perform public.notify_user(new.user_id, new.id, 'cancelled',
      case when old.status = 'pending_review' then '요청서가 반려되었어요' else '의뢰가 취소되었어요' end,
      ttl || coalesce(' · ' || new.cancel_reason, ''), client_link);
  end if;

  if coalesce(new.revision_count, 0) > coalesce(old.revision_count, 0) then
    perform public.notify_editors(new.id, 'revision', '수정 요청이 왔어요',
      ttl || ' · ' || left(coalesce(new.client_note, ''), 80), editor_link);
  end if;
  if coalesce(new.client_approved_stage, 0) > coalesce(old.client_approved_stage, 0) then
    perform public.notify_editors(new.id, 'approved', '의뢰인이 "이대로 좋아요"를 눌렀어요',
      ttl || ' · ' || public.stage_name(new.client_approved_stage), editor_link);
  end if;
  if new.received_at is not null and old.received_at is null then
    perform public.notify_editors(new.id, 'received', '의뢰인이 영상을 받았어요', ttl, editor_link);
  end if;
  return new;
end $$;


notify pgrst, 'reload schema';
