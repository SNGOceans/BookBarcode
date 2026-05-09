import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  }
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('books').delete().eq('id', numId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
