-- =========================================================
-- 에딧 커미션 · 2차 업데이트: 알림함, 메시지, 임시저장
-- SQL Editor 에 전체를 붙여넣고 Run 하세요. 여러 번 실행해도 안전해요.
-- =========================================================

-- 1) 임시저장한 요청서 (계정에 저장 → 다른 기기에서도 이어 쓰기)
alter table public.profiles add column if not exists draft jsonb;
alter table public.profiles add column if not exists draft_saved_at timestamptz;

-- 2) 알림
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  request_id uuid references public.requests on delete cascade,
  kind text,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- 3) 메시지 (요청서마다 의뢰인 ↔ 에디터 대화)
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests on delete cascade,
  sender_id uuid not null references auth.users on delete cascade default auth.uid(),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz default now()
);
create index if not exists messages_request_idx on public.messages (request_id, created_at);

-- ---------------------------------------------------------
-- 알림 만드는 도움 함수
-- ---------------------------------------------------------
create or replace function public.stage_name(s int)
returns text language sql immutable as $$
  select case s when 1 then '요청 확인' when 2 then '컷 편집' when 3 then '효과 추가'
                when 4 then '후반 작업' when 5 then '납품' else '시작 전' end;
$$;

create or replace function public.request_title(r public.requests)
returns text language sql stable as $$
  select trim(regexp_replace(coalesce(r.member, '[멤버]') || ' ' || coalesce(r.occasion, '') || ' 에딧', '\s+', ' ', 'g'));
$$;

create or replace function public.notify_user(uid uuid, rid uuid, k text, t text, b text, l text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, request_id, kind, title, body, link)
  values (uid, rid, k, t, b, l);
$$;

create or replace function public.notify_editors(rid uuid, k text, t text, b text, l text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, request_id, kind, title, body, link)
  select e.user_id, rid, k, t, b, l from public.editors e
  where e.user_id is distinct from auth.uid();
$$;

-- ---------------------------------------------------------
-- 요청서가 바뀌면 자동으로 알림
-- ---------------------------------------------------------
create or replace function public.requests_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  ttl text := public.request_title(new);
  client_link text := '#/request/' || new.id;
  editor_link text := '#/editor/' || new.id;
begin
  if tg_op = 'INSERT' then
    perform public.notify_editors(new.id, 'new_request', '새 요청서가 들어왔어요',
      ttl || ' · ' || to_char(new.total, 'FM999,999,999') || '원 · 입금자 ' || coalesce(new.depositor, '-'), editor_link);
    return new;
  end if;

  -- 의뢰인에게
  if old.status <> 'confirmed' and new.status = 'confirmed' then
    perform public.notify_user(new.user_id, new.id, 'confirmed', '입금이 확인됐어요',
      ttl || ' 작업을 시작할게요', client_link);
  elsif new.stage is distinct from old.stage and new.stage > 0 then
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
  return new;
end $$;

drop trigger if exists requests_notify_ins on public.requests;
create trigger requests_notify_ins after insert on public.requests
  for each row execute function public.requests_notify();
drop trigger if exists requests_notify_upd on public.requests;
create trigger requests_notify_upd after update on public.requests
  for each row execute function public.requests_notify();

-- 메시지가 오면 상대방에게 알림
create or replace function public.messages_notify()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r public.requests;
begin
  select * into r from public.requests where id = new.request_id;
  if new.sender_id = r.user_id then
    perform public.notify_editors(r.id, 'message', '새 메시지가 왔어요',
      public.request_title(r) || ' · ' || left(new.body, 80), '#/editor/' || r.id);
  else
    perform public.notify_user(r.user_id, r.id, 'message', '에디터가 메시지를 보냈어요',
      left(new.body, 80), '#/chat/' || r.id);
  end if;
  return new;
end $$;

drop trigger if exists messages_notify on public.messages;
create trigger messages_notify after insert on public.messages
  for each row execute function public.messages_notify();

-- ---------------------------------------------------------
-- 보안 규칙
-- ---------------------------------------------------------
alter table public.notifications enable row level security;
alter table public.messages enable row level security;

drop policy if exists "notifications select" on public.notifications;
create policy "notifications select" on public.notifications
  for select using (user_id = auth.uid());
drop policy if exists "notifications update" on public.notifications;
create policy "notifications update" on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "notifications delete" on public.notifications;
create policy "notifications delete" on public.notifications
  for delete using (user_id = auth.uid());

drop policy if exists "messages select" on public.messages;
create policy "messages select" on public.messages
  for select using (
    public.is_editor()
    or exists (select 1 from public.requests r where r.id = request_id and r.user_id = auth.uid())
  );
drop policy if exists "messages insert" on public.messages;
create policy "messages insert" on public.messages
  for insert with check (
    sender_id = auth.uid() and (
      public.is_editor()
      or exists (select 1 from public.requests r where r.id = request_id and r.user_id = auth.uid())
    )
  );

-- ---------------------------------------------------------
-- 실시간(사이트를 열어 두면 바로 뜨게)
-- ---------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

notify pgrst, 'reload schema';
