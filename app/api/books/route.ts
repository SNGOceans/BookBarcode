import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';
import { isValidEAN13 } from '@/lib/isbn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await requireUser(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { supabase } = ctx;

  const { data, error } = await supabase
    .from('books')
    .select('id, isbn, scan_count, first_scanned_at, last_scanned_at')
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

  // record_scan: scans insert + books upsert(scan_count++) 를 한 트랜잭션에 처리.
  // RLS + auth.uid() 로 본인 row 만 기록됨.
  const { data, error } = await supabase.rpc('record_scan', { p_isbn: isbn });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const book = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ book });
}
