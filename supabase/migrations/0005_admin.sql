-- ============================================================
-- BookBarcode :: 관리자 권한
--
-- 덧붙이기 전용 마이그레이션이다. 기존 표를 건드리지 않는다.
-- ============================================================

-- app_admins : 관리자 명단.
--
-- 왜 표로 두는가 —
--   환경변수로 두면 관리자를 바꿀 때마다 재배포해야 하고, 「누가 관리자인가」의
--   답이 코드와 DB 두 곳으로 갈린다. 규칙은 한 곳에만 둔다.
--
-- 처음에는 **비어 있다** — 아무도 관리자가 아니다.
-- 첫 관리자는 사람이 SQL 편집기에서 한 번 지정한다(README 참조).
-- 코드가 스스로 첫 관리자를 만들지 않는 이유는, 그렇게 두면 그 경로가
-- 곧 권한 상승 통로가 되기 때문이다.
create table if not exists public.app_admins (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

-- 지금 호출자가 관리자인가.
--
-- security definer 인 이유 — 일반 사용자는 app_admins 를 읽을 수 없다(아래 RLS).
-- 그런데 「내가 관리자인가」는 본인도 물을 수 있어야 화면을 그릴 수 있다.
-- 이 함수는 **참·거짓만** 돌려주므로 명단이 새지 않는다.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;

alter table public.app_admins enable row level security;

-- 명단 자체는 관리자만 본다. 누가 관리자인지가 아무에게나 보일 이유가 없다.
create policy app_admins_admin_select on public.app_admins
  for select using (public.is_admin());
create policy app_admins_admin_insert on public.app_admins
  for insert with check (public.is_admin());
create policy app_admins_admin_delete on public.app_admins
  for delete using (public.is_admin());

grant execute on function public.is_admin() to authenticated;

notify pgrst, 'reload schema';
