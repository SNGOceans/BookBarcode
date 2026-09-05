import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';
import { getAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 관리자 전체 현황.
 *
 * 이 앱은 모든 표가 사용자별 RLS 로 갈려 있다. 그래서 「전체」를 보려면
 * 관리자 키가 필요하다 — 다만 **관리자인지 먼저 확인한 뒤에만** 그 키를 쓴다.
 *
 * 확인 순서를 뒤집으면 안 된다. 관리자 키로 먼저 조회하고 나중에 걸러내면,
 * 그 사이에 실수 하나로 남의 데이터가 나간다.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireUser(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  // ① 호출자가 관리자인가 — 사용자 권한으로 묻는다.
  const { data: isAdmin, error: adminErr } = await ctx.supabase.rpc('is_admin');
  if (adminErr) return NextResponse.json({ error: adminErr.message }, { status: 500 });
  if (isAdmin !== true) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // ② 확인된 뒤에만 관리자 키를 쓴다.
  let admin;
  try { admin = getAdminClient(); } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }

  const countOf = async (table: string) => {
    const { count, error } = await admin.from(table).select('id', { count: 'exact', head: true });
    return error ? null : (count ?? 0);
  };

  const [books, scans, inventory, sales, logs] = await Promise.all([
    countOf('books'), countOf('scans'), countOf('inventory'), countOf('sales'), countOf('app_logs'),
  ]);

  // 사용자 수는 auth 스키마라 별도 경로로 센다.
  let users: number | null = null;
  try {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    users = error ? null : (data?.total ?? null);
  } catch { users = null; }

  // 매출 합계 — 취소된 건은 뺀다.
  const { data: paidSales } = await admin
    .from('sales').select('total, status').neq('status', 'void').limit(5000);
  const revenue = (paidSales ?? []).reduce((a: number, s: { total: number }) => a + (s.total ?? 0), 0);

  const { data: invRows } = await admin.from('inventory').select('quantity').limit(5000);
  const stockQty = (invRows ?? []).reduce((a: number, r: { quantity: number }) => a + (r.quantity ?? 0), 0);

  return NextResponse.json({
    // null 은 「못 셌다」는 뜻이다. 0 과 구분해서 화면에 그대로 전한다.
    counts: { users, books, scans, inventory, sales, logs },
    revenue,
    stockQty,
    at: new Date().toISOString(),
  });
}
