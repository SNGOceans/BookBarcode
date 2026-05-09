/**
 * /api/books 와 동일 client 패턴/select 옵션 4가지 조합으로 books 를 select 해
 * 어떤 조합에서 0행이 나오는지 격리한다. 진단 끝나면 삭제.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ACCESS_COOKIE, REFRESH_COOKIE, getRequestClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FULL_COLS =
  'id, isbn, scan_count, first_scanned_at, last_scanned_at, ' +
  'title, author, translator, publisher, cover_url, ' +
  'price_standard, price_sales, used_price, used_min_price, used_count, ' +
  'meta_fetched_at';

export async function GET(req: NextRequest) {
  const url     = process.env.SUPABASE_URL     ?? '';
  const anonKey = process.env.SUPABASE_ANON_KEY ?? '';
  const access  = req.cookies.get(ACCESS_COOKIE )?.value ?? '';
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value ?? '';

  // 1) direct createClient + setSession + simple select
  const c1 = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await c1.auth.setSession({ access_token: access, refresh_token: refresh });
  const r1 = await c1.from('books').select('id,isbn,title').limit(5);

  // 2) direct + setSession + FULL_COLS + order + limit 1000 (== /api/books)
  const c2 = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  await c2.auth.setSession({ access_token: access, refresh_token: refresh });
  const r2 = await c2.from('books').select(FULL_COLS).order('last_scanned_at', { ascending: false }).limit(1000);

  // 3) via getRequestClient (== /api/books 가 쓰는 헬퍼) + simple select
  const c3 = await getRequestClient(req);
  const r3 = await c3.from('books').select('id,isbn,title').limit(5);

  // 4) via getRequestClient + FULL_COLS + order + limit 1000
  const c4 = await getRequestClient(req);
  const r4 = await c4.from('books').select(FULL_COLS).order('last_scanned_at', { ascending: false }).limit(1000);

  return NextResponse.json({
    case_1_direct_simple    : { count: r1.data?.length ?? null, err: r1.error?.message ?? null },
    case_2_direct_full      : { count: r2.data?.length ?? null, err: r2.error?.message ?? null },
    case_3_helper_simple    : { count: r3.data?.length ?? null, err: r3.error?.message ?? null },
    case_4_helper_full      : { count: r4.data?.length ?? null, err: r4.error?.message ?? null },
  });
}
