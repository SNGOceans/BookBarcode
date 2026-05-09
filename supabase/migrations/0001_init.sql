-- ============================================================
-- BookBarcode :: initial schema
-- 안전 재실행을 위해 기존 객체를 먼저 제거 (테스트 단계 전제)
-- ============================================================

drop function if exists public.record_scan(text)             cascade;
drop function if exists public.update_books_on_scan()        cascade;
drop table    if exists public.scans                         cascade;
drop table    if exists public.books                         cascade;

-- ------------------------------------------------------------
-- 1) books : ISBN당 1 row (집계 뷰)
-- ------------------------------------------------------------
create table public.books (
  id               bigserial   primary key,
  isbn             text        not null unique,
  scan_count       int         not null default 1,
  first_scanned_at timestamptz not null default now(),
  last_scanned_at  timestamptz not null default now()
);
create index books_last_scanned_at_idx on public.books (last_scanned_at desc);

-- ------------------------------------------------------------
-- 2) scans : 매 스캔 이벤트 이력 (raw)
--    books.isbn 에 FK + on delete cascade
-- ------------------------------------------------------------
create table public.scans (
  id         bigserial   primary key,
  isbn       text        not null references public.books(isbn) on delete cascade,
  scanned_at timestamptz not null default now()
);
create index scans_scanned_at_idx on public.scans (scanned_at desc);
create index scans_isbn_idx       on public.scans (isbn);

-- ------------------------------------------------------------
-- 3) record_scan(p_isbn) :
--    books upsert(scan_count++) → scans insert 를 한 트랜잭션에 처리
--    반환: 갱신된 books row
-- ------------------------------------------------------------
create or replace function public.record_scan(p_isbn text)
returns public.books
language plpgsql
as $$
declare
  v_now  timestamptz := now();
  v_book public.books;
begin
  insert into public.books (isbn, scan_count, first_scanned_at, last_scanned_at)
  values (p_isbn, 1, v_now, v_now)
  on conflict (isbn) do update
    set scan_count      = public.books.scan_count + 1,
        last_scanned_at = v_now
  returning * into v_book;

  insert into public.scans (isbn, scanned_at) values (p_isbn, v_now);

  return v_book;
end;
$$;

-- ------------------------------------------------------------
-- 4) RLS : 서버 service-role 키로만 접근 → 비활성
-- ------------------------------------------------------------
alter table public.books disable row level security;
alter table public.scans disable row level security;
