-- ============================================================
-- BookBarcode :: 재고 관리
--
-- 덧붙이기 전용 마이그레이션이다. 기존 표를 건드리지 않는다.
-- ============================================================

-- inventory : 도서별 현재 재고. (user_id, book_id) 당 1행.
--
-- 수량을 여기에만 두지 않는 이유 —
--   「지금 3권」만 남기면 **왜 3권이 되었는지**가 사라진다.
--   잘못 눌렀는지, 판매되어 줄었는지, 입고였는지 구분이 안 된다.
--   그래서 아래 inventory_moves 를 원장으로 두고 이 표는 그 결과를 들고 있는다.
--   둘은 항상 같은 트랜잭션에서 함께 바뀐다(RPC).
create table if not exists public.inventory (
  id         bigserial   primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  book_id    bigint      not null references public.books(id) on delete cascade,
  quantity   int         not null default 0 check (quantity >= 0),
  -- 어디에 두었나(선반·박스 번호 등). 자유 입력이다.
  location   text,
  -- 상태. 값을 코드로 고정하지 않는다 — 취급 기준이 사람마다 다르다.
  condition  text,
  memo       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, book_id)
);
create index if not exists inventory_user_idx     on public.inventory (user_id, updated_at desc);
create index if not exists inventory_user_qty_idx on public.inventory (user_id, quantity);

-- inventory_moves : 수량이 움직인 기록(원장).
--
-- inventory 가 아니라 book_id 를 가리킨다. 재고 행을 지워도 이력은 남아야 한다.
create table if not exists public.inventory_moves (
  id             bigserial   primary key,
  user_id        uuid        not null references auth.users(id) on delete cascade,
  book_id        bigint      not null references public.books(id) on delete cascade,
  -- 이번에 얼마나 움직였나. 늘면 양수, 줄면 음수.
  delta          int         not null,
  -- 움직인 뒤 남은 수량. 나중에 되짚을 때 원장만 보고도 흐름을 읽을 수 있다.
  quantity_after int         not null,
  -- 'scan' 스캔으로 입고 · 'set' 수량 직접 지정 · 'adjust' 버튼으로 증감 · 'remove' 재고 삭제
  reason         text        not null,
  memo           text,
  moved_at       timestamptz not null default now()
);
create index if not exists inventory_moves_user_time_idx on public.inventory_moves (user_id, moved_at desc);
create index if not exists inventory_moves_book_idx      on public.inventory_moves (user_id, book_id, moved_at desc);

-- ------------------------------------------------------------
-- 수량 지정 — 절대값으로 맞춘다(예: 실사 후 「3권」).
-- 차이를 계산해 원장에 남긴다.
-- ------------------------------------------------------------
create or replace function public.set_inventory(
  p_isbn      text,
  p_quantity  int,
  p_location  text default null,
  p_condition text default null,
  p_memo      text default null
)
returns public.inventory
language plpgsql
security invoker
as $$
declare
  v_uid   uuid := auth.uid();
  v_book  public.books;
  v_inv   public.inventory;
  v_prev  int := 0;
  v_delta int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_quantity is null or p_quantity < 0 then
    raise exception '수량은 0 이상이어야 합니다' using errcode = '22023';
  end if;

  select * into v_book from public.books
   where user_id = v_uid and isbn = p_isbn;
  if not found then
    raise exception '먼저 바코드로 담은 도서만 재고를 잡을 수 있습니다' using errcode = 'P0002';
  end if;

  select quantity into v_prev from public.inventory
   where user_id = v_uid and book_id = v_book.id;
  v_prev  := coalesce(v_prev, 0);
  v_delta := p_quantity - v_prev;

  insert into public.inventory (user_id, book_id, quantity, location, condition, memo)
  values (v_uid, v_book.id, p_quantity, p_location, p_condition, p_memo)
  on conflict (user_id, book_id) do update
    set quantity   = excluded.quantity,
        -- 값을 안 준 항목은 기존 값을 지우지 않는다.
        location   = coalesce(excluded.location,  public.inventory.location),
        condition  = coalesce(excluded.condition, public.inventory.condition),
        memo       = coalesce(excluded.memo,      public.inventory.memo),
        updated_at = now()
  returning * into v_inv;

  -- 수량이 그대로면 원장에 남기지 않는다. 위치·메모만 고친 경우다.
  if v_delta <> 0 then
    insert into public.inventory_moves (user_id, book_id, delta, quantity_after, reason, memo)
    values (v_uid, v_book.id, v_delta, p_quantity, 'set', p_memo);
  end if;

  return v_inv;
end;
$$;

-- ------------------------------------------------------------
-- 수량 증감 — 버튼으로 ±1, 스캔 입고 등.
-- 0 아래로는 내려가지 않는다.
-- ------------------------------------------------------------
create or replace function public.adjust_inventory(
  p_isbn   text,
  p_delta  int,
  p_reason text default 'adjust'
)
returns public.inventory
language plpgsql
security invoker
as $$
declare
  v_uid  uuid := auth.uid();
  v_book public.books;
  v_inv  public.inventory;
  v_prev int := 0;
  v_next int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_delta is null or p_delta = 0 then
    raise exception '변화량이 0 입니다' using errcode = '22023';
  end if;

  select * into v_book from public.books
   where user_id = v_uid and isbn = p_isbn;
  if not found then
    raise exception '먼저 바코드로 담은 도서만 재고를 잡을 수 있습니다' using errcode = 'P0002';
  end if;

  select quantity into v_prev from public.inventory
   where user_id = v_uid and book_id = v_book.id;
  v_prev := coalesce(v_prev, 0);
  v_next := greatest(0, v_prev + p_delta);

  insert into public.inventory (user_id, book_id, quantity)
  values (v_uid, v_book.id, v_next)
  on conflict (user_id, book_id) do update
    set quantity = v_next, updated_at = now()
  returning * into v_inv;

  -- 0 에서 더 빼려 한 경우처럼 실제로 안 움직였으면 원장에 남기지 않는다.
  if v_next <> v_prev then
    insert into public.inventory_moves (user_id, book_id, delta, quantity_after, reason)
    values (v_uid, v_book.id, v_next - v_prev, v_next, p_reason);
  end if;

  return v_inv;
end;
$$;

-- ------------------------------------------------------------
-- 재고 삭제 — 행은 지우되 이력은 남긴다.
-- ------------------------------------------------------------
create or replace function public.remove_inventory(p_isbn text)
returns boolean
language plpgsql
security invoker
as $$
declare
  v_uid  uuid := auth.uid();
  v_book public.books;
  v_prev int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_book from public.books
   where user_id = v_uid and isbn = p_isbn;
  if not found then return false; end if;

  select quantity into v_prev from public.inventory
   where user_id = v_uid and book_id = v_book.id;
  if v_prev is null then return false; end if;

  delete from public.inventory where user_id = v_uid and book_id = v_book.id;

  insert into public.inventory_moves (user_id, book_id, delta, quantity_after, reason)
  values (v_uid, v_book.id, -v_prev, 0, 'remove');

  return true;
end;
$$;

-- ------------------------------------------------------------
-- RLS — 자기 행만
-- ------------------------------------------------------------
alter table public.inventory       enable row level security;
alter table public.inventory_moves enable row level security;

create policy inventory_own_select on public.inventory
  for select using (auth.uid() = user_id);
create policy inventory_own_insert on public.inventory
  for insert with check (auth.uid() = user_id);
create policy inventory_own_update on public.inventory
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy inventory_own_delete on public.inventory
  for delete using (auth.uid() = user_id);

create policy inventory_moves_own_select on public.inventory_moves
  for select using (auth.uid() = user_id);
create policy inventory_moves_own_insert on public.inventory_moves
  for insert with check (auth.uid() = user_id);

grant execute on function public.set_inventory(text, int, text, text, text) to authenticated;
grant execute on function public.adjust_inventory(text, int, text)          to authenticated;
grant execute on function public.remove_inventory(text)                     to authenticated;

notify pgrst, 'reload schema';
