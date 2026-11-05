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

notify pgrst, 'reload schema';
