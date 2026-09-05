import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';
import { isValidEAN13 } from '@/lib/isbn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 재고 CRUD.
 *
 *   GET    목록
 *   POST   수량 지정(절대값) + 위치·상태·메모
 *   PATCH  수량 증감(±)
 *   DELETE 재고 행 삭제 (이력은 남는다)
 *
 * 수량 변경은 전부 DB 함수를 거친다. 재고 행과 이동 원장이 **같은 트랜잭션**에서
 * 함께 바뀌어야 하는데, 여기서 두 번 호출하면 중간에 끊길 수 있다.
 */

const INVENTORY_SELECT =
  'id, quantity, location, condition, memo, created_at, updated_at, ' +
  'books!inner(id, isbn, title, author, publisher, price_standard, used_price)';

type Body = {
  isbn?: unknown;
  quantity?: unknown;
  delta?: unknown;
  location?: unknown;
  condition?: unknown;
  memo?: unknown;
  reason?: unknown;
};

function readIsbn(body: Body): string | null {
  const isbn = String(body?.isbn ?? '').trim();
  return isValidEAN13(isbn) ? isbn : null;
}

function text(v: unknown, max = 200): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

export async function GET(req: NextRequest) {
  const ctx = await requireUser(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { supabase } = ctx;

  const { data, error } = await supabase
    .from('inventory')
    .select(INVENTORY_SELECT)
    .order('updated_at', { ascending: false })
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 화면이 쓰기 좋은 평평한 모양으로 편다.
  const items = (data ?? []).map((row: any) => ({
    id:        row.id,
    quantity:  row.quantity,
    location:  row.location,
    condition: row.condition,
    memo:      row.memo,
    updated_at: row.updated_at,
    isbn:      row.books?.isbn ?? '',
    title:     row.books?.title ?? null,
    author:    row.books?.author ?? null,
    publisher: row.books?.publisher ?? null,
    price_standard: row.books?.price_standard ?? null,
    used_price:     row.books?.used_price ?? null,
  }));
  return NextResponse.json({ items });
}

/** 수량을 절대값으로 맞춘다. 실사 후 「3권」처럼 쓴다. */
export async function POST(req: NextRequest) {
  const ctx = await requireUser(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { supabase } = ctx;

  let body: Body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const isbn = readIsbn(body);
  if (!isbn) return NextResponse.json({ error: '올바른 ISBN 이 아닙니다' }, { status: 400 });

  const qty = Number(body.quantity);
  if (!Number.isInteger(qty) || qty < 0) {
    return NextResponse.json({ error: '수량은 0 이상의 정수여야 합니다' }, { status: 400 });
  }

  const { data, error } = await supabase.rpc('set_inventory', {
    p_isbn:      isbn,
    p_quantity:  qty,
    p_location:  text(body.location, 120),
    p_condition: text(body.condition, 40),
    p_memo:      text(body.memo, 500),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ item: data });
}

/** 수량을 ±만큼 움직인다. 버튼으로 하나씩 올리고 내릴 때 쓴다. */
export async function PATCH(req: NextRequest) {
  const ctx = await requireUser(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { supabase } = ctx;

  let body: Body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const isbn = readIsbn(body);
  if (!isbn) return NextResponse.json({ error: '올바른 ISBN 이 아닙니다' }, { status: 400 });

  const delta = Number(body.delta);
  if (!Number.isInteger(delta) || delta === 0) {
    return NextResponse.json({ error: '변화량은 0 이 아닌 정수여야 합니다' }, { status: 400 });
  }

  const { data, error } = await supabase.rpc('adjust_inventory', {
    p_isbn:   isbn,
    p_delta:  delta,
    p_reason: text(body.reason, 20) ?? 'adjust',
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ item: data });
}

/** 재고 행을 지운다. 이동 이력은 남는다. */
export async function DELETE(req: NextRequest) {
  const ctx = await requireUser(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { supabase } = ctx;

  const isbn = String(req.nextUrl.searchParams.get('isbn') ?? '').trim();
  if (!isValidEAN13(isbn)) {
    return NextResponse.json({ error: '올바른 ISBN 이 아닙니다' }, { status: 400 });
  }

  const { data, error } = await supabase.rpc('remove_inventory', { p_isbn: isbn });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  // 함수는 「지울 것이 있었나」를 돌려준다. 없었으면 그대로 알린다.
  return NextResponse.json({ removed: data === true });
}
