-- ============================================================
-- BookBarcode :: schema with auth + per-user RLS + Aladin meta
-- ============================================================

drop function if exists public.record_scan(text)             cascade;
drop function if exists public.update_books_on_scan()        cascade;
drop table    if exists public.scans                         cascade;
drop table    if exists public.books                         cascade;

-- 1) books : (user_id, isbn) 당 1 row + 카운터 + Aladin 메타 캐시
create table public.books (
  id               bigserial   primary key,
  user_id          uuid        not null references auth.users(id) on delete cascade,
  isbn             text        not null,
  scan_count       int         not null default 1,
  first_scanned_at timestamptz not null default now(),
  last_scanned_at  timestamptz not null default now(),
  -- Aladin meta (스캔 후 한 번만 채워짐, meta_fetched_at != null 이면 fetched)
  title            text,
  author           text,
  translator       text,
  publisher        text,
  cover_url        text,
  price_standard   int,
  price_sales      int,
  used_price       int,
  used_min_price   int,
  used_count       int,
  meta_fetched_at  timestamptz,
  unique (user_id, isbn)
);
create index books_user_last_idx on public.books (user_id, last_scanned_at desc);

-- 2) scans : 매 스캔 이벤트 이력
create table public.scans (
  id         bigserial   primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  isbn       text        not null,
  scanned_at timestamptz not null default now()
);
create index scans_user_time_idx on public.scans (user_id, scanned_at desc);
create index scans_user_isbn_idx on public.scans (user_id, isbn);

-- 3) record_scan(p_isbn) : auth.uid() 의 데이터로 기록 (트랜잭션)
create or replace function public.record_scan(p_isbn text)
returns public.books
language plpgsql
security invoker
as $$
declare
  v_now  timestamptz := now();
  v_uid  uuid        := auth.uid();
  v_book public.books;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  insert into public.books (user_id, isbn, scan_count, first_scanned_at, last_scanned_at)
  values (v_uid, p_isbn, 1, v_now, v_now)
  on conflict (user_id, isbn) do update
    set scan_count      = public.books.scan_count + 1,
        last_scanned_at = v_now
  returning * into v_book;

  insert into public.scans (user_id, isbn, scanned_at)
  values (v_uid, p_isbn, v_now);

  return v_book;
end;
$$;

-- 4) RLS
alter table public.books enable row level security;
alter table public.scans enable row level security;

create policy books_own_select on public.books
  for select using (auth.uid() = user_id);
create policy books_own_insert on public.books
  for insert with check (auth.uid() = user_id);
create policy books_own_update on public.books
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy books_own_delete on public.books
  for delete using (auth.uid() = user_id);

create policy scans_own_select on public.scans
  for select using (auth.uid() = user_id);
create policy scans_own_insert on public.scans
  for insert with check (auth.uid() = user_id);
create policy scans_own_delete on public.scans
  for delete using (auth.uid() = user_id);

-- 5) 권한 + schema cache reload
grant execute on function public.record_scan(text) to authenticated;
notify pgrst, 'reload schema';
