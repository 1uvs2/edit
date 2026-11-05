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

notify pgrst, 'reload schema';
