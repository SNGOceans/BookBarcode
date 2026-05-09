/**
 * 임시 진단용. setSession / getUser / getSession / from('books') 가 각각
 * 어디서 끊어지는지 노출한다. 진단 끝나면 삭제할 것.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url     = process.env.SUPABASE_URL     ?? '';
  const anonKey = process.env.SUPABASE_ANON_KEY ?? '';
  const access  = req.cookies.get(ACCESS_COOKIE )?.value ?? '';
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value ?? '';

  const c = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let setSessionResult: any = { skipped: !access };
  if (access) {
    const r = await c.auth.setSession({ access_token: access, refresh_token: refresh });
    setSessionResult = {
      error: r.error ? { message: r.error.message, status: (r.error as any).status } : null,
      user_id: r.data?.user?.id ?? null,
      has_session: !!r.data?.session,
    };
  }

  const getUserRes    = await c.auth.getUser();
  const getSessionRes = await c.auth.getSession();
  const fromRes       = await c.from('books').select('id,isbn,title').limit(5);

  return NextResponse.json({
    has_access_cookie : !!access,
    access_first40    : access ? access.slice(0, 40) : null,
    has_refresh_cookie: !!refresh,
    setSession        : setSessionResult,
    getUser           : { user_id: getUserRes.data?.user?.id ?? null, error: getUserRes.error?.message ?? null },
    getSession        : { has_session: !!getSessionRes.data?.session, expires_at: getSessionRes.data?.session?.expires_at ?? null },
    from_books_count  : fromRes.data?.length ?? null,
    from_books_error  : fromRes.error ? { message: fromRes.error.message, code: (fromRes.error as any).code, hint: (fromRes.error as any).hint } : null,
    from_books        : fromRes.data ?? null,
  });
}
