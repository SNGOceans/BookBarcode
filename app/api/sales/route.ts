import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';
import { isValidEAN13 } from '@/lib/isbn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 판매 목록 / 판매 확정.
 *
 * 확정은 DB 함수(checkout)가 한 트랜잭션으로 처리한다.
 * 여기서 재고를 따로 건드리면 중간에 끊겼을 때 장부가 맞지 않는다.
 */

const PAY_METHODS = new Set(['cash', 'card', 'transfer', 'other']);

type ItemIn = { isbn?: unknown; quantity?: unknown; unit_price?: unknown; discount?: unknown };

export async function GET(req: NextRequest) {
  const ctx = await requireUser(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { supabase } = ctx;

  const sp = req.nextUrl.searchParams;
  const limit = Math.min(500, Math.max(1, Number(sp.get('limit') ?? 100) || 100));
  const day   = (sp.get('day') ?? '').trim();   // YYYY-MM-DD (한국 날짜)

  let query = supabase
    .from('sales')
    .select('id, sale_no, status, subtotal, discount, total, pay_method, memo, sold_at, voided_at, ' +
            'sale_items(id, isbn, title, unit_price, quantity, discount, line_total, refunded_qty)')
    .order('sold_at', { ascending: false })
    .limit(limit);

  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    // 한국 날짜 기준으로 하루를 잘라낸다. UTC 로 자르면 새벽 판매가 전날로 넘어간다.
    query = query
      .gte('sold_at', `${day}T00:00:00+09:00`)
      .lt('sold_at', `${day}T23:59:59.999+09:00`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sales: data ?? [] });
}

/** 판매 확정. */
export async function POST(req: NextRequest) {
  const ctx = await requireUser(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { supabase } = ctx;

  let body: {
    items?: unknown; pay_method?: unknown; discount?: unknown;
    memo?: unknown; idem_key?: unknown; allow_shortage?: unknown;
  };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const rawItems = Array.isArray(body.items) ? (body.items as ItemIn[]) : [];
  if (!rawItems.length) {
    return NextResponse.json({ error: '담긴 품목이 없습니다' }, { status: 400 });
  }

  const items: { isbn: string; quantity: number; unit_price: number; discount: number }[] = [];
  for (const it of rawItems) {
    const isbn = String(it?.isbn ?? '').trim();
    if (!isValidEAN13(isbn)) {
      return NextResponse.json({ error: `올바른 ISBN 이 아닙니다: ${isbn}` }, { status: 400 });
    }
    const quantity = Number(it?.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return NextResponse.json({ error: '수량은 1 이상의 정수여야 합니다' }, { status: 400 });
    }
    const unit_price = Number(it?.unit_price);
    if (!Number.isInteger(unit_price) || unit_price < 0) {
      return NextResponse.json({ error: '단가는 0 이상의 정수여야 합니다' }, { status: 400 });
    }
    const discount = Number(it?.discount ?? 0);
    if (!Number.isInteger(discount) || discount < 0) {
      return NextResponse.json({ error: '할인은 0 이상의 정수여야 합니다' }, { status: 400 });
    }
    items.push({ isbn, quantity, unit_price, discount });
  }

  const payMethod = String(body.pay_method ?? '');
  if (!PAY_METHODS.has(payMethod)) {
    return NextResponse.json({ error: '결제 수단을 골라 주세요' }, { status: 400 });
  }

  const discount = Number(body.discount ?? 0);
  if (!Number.isInteger(discount) || discount < 0) {
    return NextResponse.json({ error: '할인은 0 이상의 정수여야 합니다' }, { status: 400 });
  }

  const { data, error } = await supabase.rpc('checkout', {
    p_items:          items,
    p_pay_method:     payMethod,
    p_discount:       discount,
    p_memo:           body.memo == null ? null : String(body.memo).slice(0, 500),
    // 두 번 눌리거나 재시도돼도 판매가 두 건 생기지 않게 하는 열쇠.
    p_idem_key:       body.idem_key == null ? null : String(body.idem_key).slice(0, 80),
    p_allow_shortage: body.allow_shortage === true,
  });
  if (error) {
    // 재고 부족은 사용자가 고칠 수 있는 상황이라 409 로 구분해 돌려준다.
    const shortage = /재고가 모자랍니다/.test(error.message);
    return NextResponse.json(
      { error: error.message, shortage },
      { status: shortage ? 409 : 400 },
    );
  }
  return NextResponse.json({ sale: data });
}
