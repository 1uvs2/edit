-- =========================================================
-- 에딧 커미션 · 8차 업데이트: 수정 요청 기록 남기기
-- (update-all.sql 을 먼저 실행한 뒤에 실행하세요. 여러 번 실행해도 안전해요)
-- =========================================================

alter table public.requests add column if not exists revision_history jsonb not null default '[]'::jsonb;

-- 기존에 열려 있던 수정 요청을 기록으로 옮기기
update public.requests
   set revision_history = jsonb_build_array(jsonb_build_object(
         'n', revision_count, 'note', client_note,
         'at', coalesce(revision_requested_at, now()), 'resolved_at', null))
 where client_note is not null and revision_history = '[]'::jsonb;

-- 수정 요청 보낼 때 기록에 추가
create or replace function public.request_revision(rid uuid, note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.requests
     set revision_count = revision_count + 1,
         client_note = left(note, 2000),
         revision_requested_at = now(),
         revision_history = coalesce(revision_history, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
           'n', revision_count + 1, 'note', left(note, 2000), 'at', now(), 'resolved_at', null))
   where id = rid and user_id = auth.uid() and status = 'confirmed';
end $$;

-- 새 요청서는 기록이 비어 있도록
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
  new.revision_history := '[]'::jsonb;
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

notify pgrst, 'reload schema';
