create table if not exists public.books (
  id          bigserial primary key,
  isbn        text not null unique,
  scanned_at  timestamptz not null default now()
);

create index if not exists books_scanned_at_idx on public.books (scanned_at desc);

-- 단일 사용자 / 서버 service-role 키로만 접근 → RLS 비활성
alter table public.books disable row level security;
