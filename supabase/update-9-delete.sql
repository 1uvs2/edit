-- =========================================================
-- 에딧 커미션 · 9차 업데이트: 에디터가 요청서 삭제
-- 여러 번 실행해도 안전해요.
-- =========================================================

-- 에디터만 요청서를 지울 수 있어요 (메시지·알림은 함께 지워짐)
drop policy if exists "requests delete by editor" on public.requests;
create policy "requests delete by editor" on public.requests
  for delete using (public.is_editor());

notify pgrst, 'reload schema';
