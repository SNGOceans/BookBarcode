import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { isValidEAN13 } from '@/lib/isbn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('books')
      .select('id, isbn, scanned_at')
      .order('scanned_at', { ascending: false })
      .limit(1000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ books: data ?? [] });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const isbn = String(body?.isbn ?? '').trim();
  if (!isValidEAN13(isbn)) {
    return NextResponse.json({ error: 'invalid barcode (EAN-13 checksum)' }, { status: 400 });
  }

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('books')
      .upsert(
        { isbn, scanned_at: new Date().toISOString() },
        { onConflict: 'isbn' },
      )
      .select('id, isbn, scanned_at')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ book: data });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
