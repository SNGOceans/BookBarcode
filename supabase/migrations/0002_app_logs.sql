-- ============================================================
-- BookBarcode :: 운영 로그 적재 (개발자용 로그 화면 + 외부 로그 수집)
--
-- 덧붙이기 전용 마이그레이션이다. 기존 표를 건드리지 않는다.
-- ============================================================

-- app_logs : 클라이언트 이벤트 + 서버 이벤트 + 외부 플랫폼(Vercel·Supabase) 로그
--
-- user_id 를 반드시 채우는 이유 —
--   이 앱은 사용자별 RLS 로 데이터를 가른다. 플랫폼 로그만 주인 없는 행으로 두면
--   그 행을 누구에게 보여줄지 정하려고 RLS 에 예외를 파야 하고, 그 예외가
--   결국 남의 로그를 보여주는 통로가 된다. 그래서 외부 로그도
--   **수집을 실행한 운영자**의 행으로 적재하고 규칙을 하나로 유지한다.
create table if not exists public.app_logs (
  id          bigserial   primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  -- client : 브라우저에서 일어난 일 / server : 이 앱의 서버 라우트
  -- vercel : 배포 런타임 로그    / supabase : DB·API 로그
  source      text        not null check (source in ('client', 'server', 'vercel', 'supabase')),
  level       text        not null check (level in ('debug', 'info', 'warn', 'error')),
  event       text        not null,
  message     text,
  meta        jsonb,
  -- 그 일이 실제로 일어난 시각(외부 로그는 원본 시각)
  logged_at   timestamptz not null default now(),
  -- 우리 DB 에 들어온 시각
  ingested_at timestamptz not null default now(),
  -- 외부 로그 원본 식별자. 같은 구간을 다시 수집해도 중복이 쌓이지 않게 한다.
  external_id text
);

create index if not exists app_logs_user_time_idx  on public.app_logs (user_id, logged_at desc);
create index if not exists app_logs_user_src_idx   on public.app_logs (user_id, source, logged_at desc);
create index if not exists app_logs_user_level_idx on public.app_logs (user_id, level, logged_at desc);

-- 외부 로그 중복 방지. external_id 가 있는 행에만 건다.
create unique index if not exists app_logs_dedup_idx
  on public.app_logs (user_id, source, external_id)
  where external_id is not null;

alter table public.app_logs enable row level security;

create policy app_logs_own_select on public.app_logs
  for select using (auth.uid() = user_id);
create policy app_logs_own_insert on public.app_logs
  for insert with check (auth.uid() = user_id);
create policy app_logs_own_delete on public.app_logs
  for delete using (auth.uid() = user_id);

notify pgrst, 'reload schema';
