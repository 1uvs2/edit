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
