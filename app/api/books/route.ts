import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';
import { isValidEAN13 } from '@/lib/isbn';
import { lookupAladin } from '@/lib/aladin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BOOK_COLS =
  'id, isbn, scan_count, first_scanned_at, last_scanned_at, ' +
  'title, author, publisher, cover_url, ' +
  'price_standard, price_sales, used_price, used_min_price, used_count, ' +
  'meta_fetched_at';

export async function GET(req: NextRequest) {
  const ctx = await requireUser(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { supabase } = ctx;

  const { data, error } = await supabase
    .from('books')
    .select(BOOK_COLS)
    .order('last_scanned_at', { ascending: false })
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ books: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await requireUser(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { supabase } = ctx;

  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const isbn = String(body?.isbn ?? '').trim();
  if (!isValidEAN13(isbn)) {
    return NextResponse.json({ error: 'invalid barcode (EAN-13 checksum)' }, { status: 400 });
  }

  // 1) record_scan: scans insert + books upsert(scan_count++) 한 트랜잭션
  const { data: scanData, error: scanErr } = await supabase.rpc('record_scan', { p_isbn: isbn });
  if (scanErr) return NextResponse.json({ error: scanErr.message }, { status: 500 });
  let book: any = Array.isArray(scanData) ? scanData[0] : scanData;
  if (!book) return NextResponse.json({ error: 'no book row' }, { status: 500 });

  // 2) 메타 캐시 미스면 Aladin 호출 + 1행 update
  if (!book.meta_fetched_at) {
    try {
      const meta = await lookupAladin(isbn);
      const patch: Record<string, any> = {
        meta_fetched_at: new Date().toISOString(),
      };
      if (meta) {
        patch.title          = meta.title;
        patch.author         = meta.author;
        patch.publisher      = meta.publisher;
        patch.cover_url      = meta.cover_url;
        patch.price_standard = meta.price_standard;
        patch.price_sales    = meta.price_sales;
        patch.used_price     = meta.used_price;
        patch.used_min_price = meta.used_min_price;
        patch.used_count     = meta.used_count;
      }
      const { data: updated, error: updErr } = await supabase
        .from('books')
        .update(patch)
        .eq('id', book.id)
        .select(BOOK_COLS)
        .single();
      if (!updErr && updated) book = updated;
    } catch { /* 메타 실패는 치명적 아니므로 무시 */ }
  }

  return NextResponse.json({ book });
}
