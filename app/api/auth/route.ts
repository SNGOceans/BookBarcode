import { NextRequest, NextResponse } from 'next/server';
import {
  getAnonClient,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  COOKIE_OPTS,
} from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 로그인 / 회원가입 통합 엔드포인트.
 * 성공 시 access_token / refresh_token 을 httpOnly cookie 로 응답에 심는다.
 *   body: { mode: 'signin' | 'signup', email, password }
 *   resp: { user: { id, email } }
 *   가입했지만 이메일 확인 필요: { needs_confirmation: true }
 */
export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const { mode, email, password } = body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
    return NextResponse.json({ error: 'email / password required' }, { status: 400 });
  }
  if (mode !== 'signin' && mode !== 'signup') {
    return NextResponse.json({ error: 'invalid mode' }, { status: 400 });
  }

  const supabase = getAnonClient();

  if (mode === 'signin') {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return NextResponse.json({ error: error.message }, { status: 401 });
    return setSessionCookies(
      NextResponse.json({ user: { id: data.user?.id, email: data.user?.email } }),
      data.session?.access_token,
      data.session?.refresh_token,
      data.session?.expires_in,
    );
  }

  // signup
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (!data.session) {
    return NextResponse.json({
      needs_confirmation: true,
      user: data.user ? { id: data.user.id, email: data.user.email } : null,
    });
  }

  return setSessionCookies(
    NextResponse.json({ user: { id: data.user?.id, email: data.user?.email } }),
    data.session.access_token,
    data.session.refresh_token,
    data.session.expires_in,
  );
}

function setSessionCookies(
  res: NextResponse,
  accessToken?: string,
  refreshToken?: string,
  accessExpiresIn?: number,
) {
  if (accessToken) {
    res.cookies.set(ACCESS_COOKIE, accessToken, {
      ...COOKIE_OPTS,
      maxAge: accessExpiresIn ?? 3600,
    });
  }
  if (refreshToken) {
    res.cookies.set(REFRESH_COOKIE, refreshToken, {
      ...COOKIE_OPTS,
      maxAge: 60 * 60 * 24 * 30,
    });
  }
  return res;
}
