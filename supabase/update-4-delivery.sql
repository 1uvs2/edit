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

notify pgrst, 'reload schema';
