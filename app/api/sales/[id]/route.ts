import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 판매 한 건 — 상세 / 취소 / 부분 반품.
 *
 * 취소와 반품은 원본을 고치지 않는다. 재고 원장에 **되돌리는 행을 새로 쌓는다.**
 * 그래야 「팔았다가 되돌렸다」가 그대로 남는다.
 */

type Ctx = { params: Promise<{ id: string }> };

function saleId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(req: NextRequest, ctxParams: Ctx) {
  const ctx = await requireUser(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { supabase } = ctx;

  const id = saleId((await ctxParams.params).id);
  if (!id) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const { data, error } = await supabase
    .from('sales')
    .select('id, sale_no, status, subtotal, discount, total, pay_method, memo, sold_at, voided_at, ' +
            'sale_items(id, isbn, title, unit_price, quantity, discount, line_total, refunded_qty)')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data)  return NextResponse.json({ error: '판매를 찾을 수 없습니다' }, { status: 404 });
  return NextResponse.json({ sale: data });
}

/** 부분 반품. { item_id, quantity } */
export async function PATCH(req: NextRequest, ctxParams: Ctx) {
  const ctx = await requireUser(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { supabase } = ctx;

  if (!saleId((await ctxParams.params).id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }

  let body: { item_id?: unknown; quantity?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const itemId = Number(body.item_id);
  const qty    = Number(body.quantity);
  if (!Number.isInteger(itemId) || itemId <= 0) {
    return NextResponse.json({ error: '반품할 품목을 골라 주세요' }, { status: 400 });
  }
  if (!Number.isInteger(qty) || qty <= 0) {
    return NextResponse.json({ error: '반품 수량은 1 이상이어야 합니다' }, { status: 400 });
  }

  const { data, error } = await supabase.rpc('refund_sale_item', {
    p_item_id: itemId,
    p_qty:     qty,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ sale: data });
}

/** 판매 취소(무효). 행을 지우지 않는다 — 매출 기록은 남아야 한다. */
export async function DELETE(req: NextRequest, ctxParams: Ctx) {
  const ctx = await requireUser(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { supabase } = ctx;

  const id = saleId((await ctxParams.params).id);
  if (!id) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const { data, error } = await supabase.rpc('void_sale', { p_sale_id: id });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ sale: data });
}
