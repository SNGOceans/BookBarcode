import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, REFRESH_COOKIE, COOKIE_OPTS } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_COOKIE,  '', { ...COOKIE_OPTS, maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, '', { ...COOKIE_OPTS, maxAge: 0 });
  return res;
}
