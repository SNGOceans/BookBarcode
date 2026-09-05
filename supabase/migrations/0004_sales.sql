-- ============================================================
-- BookBarcode :: 판매(POS)
--
-- 덧붙이기 전용 마이그레이션이다. 기존 표를 건드리지 않는다.
-- 설계 근거 = docs/개발문서/BookBarcode_도서_개발설계_판매시스템_Rev1_260905.md
-- ============================================================

-- ------------------------------------------------------------
-- 재고에 판매가를 붙인다.
--
-- 왜 books 가 아니라 inventory 인가 —
--   중고 서적은 같은 책이라도 상태에 따라 값이 다르다. 정가·중고 시세는
--   책의 속성이지만 **얼마에 팔지는 내가 가진 그 책의 속성**이다.
-- ------------------------------------------------------------
alter table public.inventory
  add column if not exists sale_price int check (sale_price is null or sale_price >= 0);

-- ------------------------------------------------------------
-- 판매 1건
-- ------------------------------------------------------------
create table if not exists public.sales (
  id         bigserial   primary key,
  user_id    uuid        not null references auth.users(id) on delete cascade,
  -- 사람이 부르는 번호. DB 가 만든다 — 클라이언트가 만들면 같은 번호가 두 번 나온다.
  sale_no    text        not null,
  status     text        not null default 'paid'
             check (status in ('paid', 'void', 'refunded', 'partial_refunded')),
  -- 금액은 확정 시점의 값이다. 나중에 정가가 바뀌어도 영수 내역은 안 바뀐다.
  subtotal   int         not null,
  discount   int         not null default 0 check (discount >= 0),
  total      int         not null check (total >= 0),
  pay_method text        not null check (pay_method in ('cash', 'card', 'transfer', 'other')),
  memo       text,
  -- 확정 버튼이 두 번 눌리거나 네트워크가 끊겨 재시도돼도 판매가 두 건 생기면 안 된다.
  idem_key   text,
  sold_at    timestamptz not null default now(),
  voided_at  timestamptz,
  unique (user_id, sale_no)
);
create index if not exists sales_user_time_idx on public.sales (user_id, sold_at desc);
create unique index if not exists sales_idem_idx
  on public.sales (user_id, idem_key) where idem_key is not null;

-- ------------------------------------------------------------
-- 판매 품목
-- ------------------------------------------------------------
create table if not exists public.sale_items (
  id           bigserial primary key,
  user_id      uuid      not null references auth.users(id) on delete cascade,
  sale_id      bigint    not null references public.sales(id) on delete cascade,
  -- restrict 인 이유 — 판매 기록이 있는 도서를 지우면 매출이 사라진다.
  book_id      bigint    not null references public.books(id) on delete restrict,
  -- 확정 시점 복사본. 원본이 바뀌어도 영수 내역은 그대로여야 한다.
  isbn         text      not null,
  title        text,
  unit_price   int       not null check (unit_price >= 0),
  quantity     int       not null check (quantity > 0),
  discount     int       not null default 0 check (discount >= 0),
  line_total   int       not null check (line_total >= 0),
  -- 부분 반품을 위해 품목 단위로 센다.
  refunded_qty int       not null default 0 check (refunded_qty >= 0),
  check (refunded_qty <= quantity)
);
create index if not exists sale_items_sale_idx on public.sale_items (sale_id);
create index if not exists sale_items_user_book_idx on public.sale_items (user_id, book_id);

-- 재고 이동이 어느 판매 때문인지 되짚을 수 있게 한다.
-- set null 인 이유 — 판매가 지워져도 **재고가 움직였다는 사실은 남아야** 한다.
alter table public.inventory_moves
  add column if not exists sale_id bigint references public.sales(id) on delete set null;

-- ------------------------------------------------------------
-- 판매번호 채번 — 날짜별 일련번호 (20260905-001)
-- ------------------------------------------------------------
create or replace function public.next_sale_no(p_uid uuid)
returns text
language plpgsql
security invoker
as $$
declare
  v_day text := to_char(timezone('Asia/Seoul', now()), 'YYYYMMDD');
  v_n   int;
begin
  -- 그날 이미 발급된 번호 중 가장 큰 뒷자리를 찾아 하나 올린다.
  select coalesce(max(split_part(sale_no, '-', 2)::int), 0) + 1
    into v_n
    from public.sales
   where user_id = p_uid and sale_no like v_day || '-%';
  return v_day || '-' || lpad(v_n::text, 3, '0');
end;
$$;

-- ------------------------------------------------------------
-- 판매 확정
--
-- p_items: [{ "isbn": "...", "quantity": 2, "unit_price": 9500, "discount": 0 }, ...]
--
-- ⚠️ 재고를 **전부 먼저 확인한 뒤** 차감한다. 하나씩 빼면서 진행하면
--    중간에 실패했을 때 앞의 것만 빠져 장부가 맞지 않는다.
-- ------------------------------------------------------------
create or replace function public.checkout(
  p_items          jsonb,
  p_pay_method     text,
  p_discount       int  default 0,
  p_memo           text default null,
  p_idem_key       text default null,
  p_allow_shortage boolean default false
)
returns public.sales
language plpgsql
security invoker
as $$
declare
  v_uid      uuid := auth.uid();
  v_sale     public.sales;
  v_item     jsonb;
  v_book     public.books;
  v_qty      int;
  v_price    int;
  v_disc     int;
  v_line     int;
  v_subtotal int := 0;
  v_total    int;
  v_have     int;
  v_take     int;
  v_next     int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception '담긴 품목이 없습니다' using errcode = '22023';
  end if;

  -- 같은 확정을 두 번 받으면 앞의 결과를 그대로 돌려준다(새로 만들지 않는다).
  if p_idem_key is not null then
    select * into v_sale from public.sales
     where user_id = v_uid and idem_key = p_idem_key;
    if found then return v_sale; end if;
  end if;

  -- 1단계 — 검사만. 여기서 걸리면 아무것도 바꾸지 않고 끝난다.
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item->>'quantity')::int, 0);
    if v_qty <= 0 then
      raise exception '수량은 1 이상이어야 합니다' using errcode = '22023';
    end if;

    select * into v_book from public.books
     where user_id = v_uid and isbn = v_item->>'isbn';
    if not found then
      raise exception '담기지 않은 도서입니다: %', v_item->>'isbn' using errcode = 'P0002';
    end if;

    if not p_allow_shortage then
      select coalesce(quantity, 0) into v_have from public.inventory
       where user_id = v_uid and book_id = v_book.id;
      if coalesce(v_have, 0) < v_qty then
        raise exception '재고가 모자랍니다: % (보유 %, 필요 %)',
          coalesce(v_book.title, v_book.isbn), coalesce(v_have, 0), v_qty
          using errcode = 'P0001';
      end if;
    end if;
  end loop;

  -- 2단계 — 판매 머리행
  insert into public.sales (user_id, sale_no, subtotal, discount, total, pay_method, memo, idem_key)
  values (v_uid, public.next_sale_no(v_uid), 0, greatest(0, coalesce(p_discount, 0)), 0,
          p_pay_method, p_memo, p_idem_key)
  returning * into v_sale;

  -- 3단계 — 품목 + 재고 차감 + 원장
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_book from public.books
     where user_id = v_uid and isbn = v_item->>'isbn';

    v_qty   := (v_item->>'quantity')::int;
    v_price := greatest(0, coalesce((v_item->>'unit_price')::int, 0));
    v_disc  := greatest(0, coalesce((v_item->>'discount')::int, 0));
    v_line  := greatest(0, v_price * v_qty - v_disc);
    v_subtotal := v_subtotal + v_line;

    insert into public.sale_items
      (user_id, sale_id, book_id, isbn, title, unit_price, quantity, discount, line_total)
    values
      (v_uid, v_sale.id, v_book.id, v_book.isbn, v_book.title, v_price, v_qty, v_disc, v_line);

    -- 재고는 0 아래로 내리지 않는다. 음수 재고는 아무도 믿지 않게 된다.
    select coalesce(quantity, 0) into v_have from public.inventory
     where user_id = v_uid and book_id = v_book.id;
    v_have := coalesce(v_have, 0);
    v_take := least(v_have, v_qty);
    v_next := v_have - v_take;

    if v_take > 0 then
      update public.inventory
         set quantity = v_next, updated_at = now()
       where user_id = v_uid and book_id = v_book.id;

      insert into public.inventory_moves
        (user_id, book_id, delta, quantity_after, reason, sale_id, memo)
      values
        (v_uid, v_book.id, -v_take, v_next, 'sale', v_sale.id,
         case when v_take < v_qty then '재고 부족 상태로 판매' else null end);
    elsif v_qty > 0 then
      -- 재고가 아예 없는데 판 경우. 움직임은 0이지만 사실은 남긴다.
      insert into public.inventory_moves
        (user_id, book_id, delta, quantity_after, reason, sale_id, memo)
      values (v_uid, v_book.id, 0, 0, 'sale', v_sale.id, '재고 없이 판매');
    end if;
  end loop;

  v_total := greatest(0, v_subtotal - v_sale.discount);
  update public.sales
     set subtotal = v_subtotal, total = v_total
   where id = v_sale.id
  returning * into v_sale;

  return v_sale;
end;
$$;

-- ------------------------------------------------------------
-- 판매 취소 — 전체 무효. 재고를 되돌린다.
-- 원본을 고치지 않고 **되돌리는 행을 새로 쌓는다.**
-- ------------------------------------------------------------
create or replace function public.void_sale(p_sale_id bigint)
returns public.sales
language plpgsql
security invoker
as $$
declare
  v_uid  uuid := auth.uid();
  v_sale public.sales;
  v_it   public.sale_items;
  v_have int;
  v_back int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_sale from public.sales where id = p_sale_id and user_id = v_uid;
  if not found then
    raise exception '판매를 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if v_sale.status = 'void' then
    return v_sale;  -- 이미 취소됨. 두 번 눌러도 같은 결과.
  end if;

  for v_it in select * from public.sale_items where sale_id = v_sale.id loop
    -- 이미 반품된 수량은 빼고 되돌린다. 두 번 돌려주면 재고가 부풀어 오른다.
    v_back := v_it.quantity - v_it.refunded_qty;
    if v_back <= 0 then continue; end if;

    select coalesce(quantity, 0) into v_have from public.inventory
     where user_id = v_uid and book_id = v_it.book_id;

    if v_have is null then
      insert into public.inventory (user_id, book_id, quantity)
      values (v_uid, v_it.book_id, v_back);
      v_have := 0;
    else
      update public.inventory
         set quantity = v_have + v_back, updated_at = now()
       where user_id = v_uid and book_id = v_it.book_id;
    end if;

    insert into public.inventory_moves
      (user_id, book_id, delta, quantity_after, reason, sale_id)
    values (v_uid, v_it.book_id, v_back, coalesce(v_have, 0) + v_back, 'sale_void', v_sale.id);
  end loop;

  update public.sales
     set status = 'void', voided_at = now()
   where id = v_sale.id
  returning * into v_sale;

  return v_sale;
end;
$$;

-- ------------------------------------------------------------
-- 부분 반품 — 품목·수량 단위
-- ------------------------------------------------------------
create or replace function public.refund_sale_item(p_item_id bigint, p_qty int)
returns public.sales
language plpgsql
security invoker
as $$
declare
  v_uid   uuid := auth.uid();
  v_it    public.sale_items;
  v_sale  public.sales;
  v_have  int;
  v_left  int;
  v_all   boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception '반품 수량은 1 이상이어야 합니다' using errcode = '22023';
  end if;

  select * into v_it from public.sale_items where id = p_item_id and user_id = v_uid;
  if not found then
    raise exception '판매 품목을 찾을 수 없습니다' using errcode = 'P0002';
  end if;
  if v_it.refunded_qty + p_qty > v_it.quantity then
    raise exception '판매한 수량보다 많이 반품할 수 없습니다 (판매 %, 이미 반품 %)',
      v_it.quantity, v_it.refunded_qty using errcode = '22023';
  end if;

  update public.sale_items
     set refunded_qty = refunded_qty + p_qty
   where id = v_it.id;

  select coalesce(quantity, 0) into v_have from public.inventory
   where user_id = v_uid and book_id = v_it.book_id;

  if v_have is null then
    insert into public.inventory (user_id, book_id, quantity)
    values (v_uid, v_it.book_id, p_qty);
    v_have := 0;
  else
    update public.inventory
       set quantity = v_have + p_qty, updated_at = now()
     where user_id = v_uid and book_id = v_it.book_id;
  end if;

  insert into public.inventory_moves
    (user_id, book_id, delta, quantity_after, reason, sale_id)
  values (v_uid, v_it.book_id, p_qty, coalesce(v_have, 0) + p_qty, 'sale_refund', v_it.sale_id);

  -- 전부 반품됐는지 보고 상태를 옮긴다. 막다른 상태를 만들지 않는다.
  select bool_and(refunded_qty >= quantity) into v_all
    from public.sale_items where sale_id = v_it.sale_id;

  update public.sales
     set status = case when v_all then 'refunded' else 'partial_refunded' end
   where id = v_it.sale_id and status <> 'void'
  returning * into v_sale;

  if v_sale.id is null then
    select * into v_sale from public.sales where id = v_it.sale_id;
  end if;
  return v_sale;
end;
$$;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table public.sales      enable row level security;
alter table public.sale_items enable row level security;

create policy sales_own_select on public.sales
  for select using (auth.uid() = user_id);
create policy sales_own_insert on public.sales
  for insert with check (auth.uid() = user_id);
create policy sales_own_update on public.sales
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy sale_items_own_select on public.sale_items
  for select using (auth.uid() = user_id);
create policy sale_items_own_insert on public.sale_items
  for insert with check (auth.uid() = user_id);
create policy sale_items_own_update on public.sale_items
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant execute on function public.next_sale_no(uuid)                                  to authenticated;
grant execute on function public.checkout(jsonb, text, int, text, text, boolean)     to authenticated;
grant execute on function public.void_sale(bigint)                                   to authenticated;
grant execute on function public.refund_sale_item(bigint, int)                       to authenticated;

notify pgrst, 'reload schema';
