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
