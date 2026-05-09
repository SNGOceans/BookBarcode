import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 현재 cookie 세션의 사용자 정보. 미인증이면 user: null.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireUser(req);
  if (!ctx) return NextResponse.json({ user: null });
  return NextResponse.json({ user: { id: ctx.user.id, email: ctx.user.email } });
}
