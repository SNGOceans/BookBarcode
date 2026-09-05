import { NextRequest, NextResponse } from 'next/server';
import {
  getOAuthClient,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  COOKIE_OPTS,
} from '@/lib/supabase/server';
import { VERIFIER_COOKIE, VERIFIER_KEY_COOKIE } from '../google/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 구글 로그인 콜백.
 *
 * 받은 코드를 세션으로 바꿔 이 앱의 httpOnly 쿠키에 심는다.
 * 화면에는 토큰이 한 번도 노출되지 않는다 — 비밀번호 로그인과 같은 방식이다.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const home = new URL('/', req.url);

  // 구글이 거절했거나 사용자가 취소한 경우
  const oauthError = url.searchParams.get('error_description') ?? url.searchParams.get('error');
  if (oauthError) {
    return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(oauthError)}`, req.url));
  }

  const code = url.searchParams.get('code');
  if (!code) {
    return NextResponse.redirect(
      new URL('/?auth_error=' + encodeURIComponent('인증 코드가 없습니다'), req.url),
    );
  }

  const verifier = req.cookies.get(VERIFIER_COOKIE)?.value;
  const verifierKey = req.cookies.get(VERIFIER_KEY_COOKIE)?.value;
  if (!verifier || !verifierKey) {
    // 쿠키가 만료됐거나 다른 브라우저에서 돌아온 경우. 처음부터 다시 하는 편이 안전하다.
    return NextResponse.redirect(
      new URL('/?auth_error=' + encodeURIComponent('로그인 시간이 지났습니다. 다시 시도해 주세요'), req.url),
    );
  }

  // 시작할 때 만든 검증값을 같은 자리에 되채워 넣는다.
  const { supabase } = getOAuthClient({ [verifierKey]: verifier });

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data?.session) {
    const reason = error?.message ?? '세션 교환에 실패했습니다';
    return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(reason)}`, req.url));
  }

  const res = NextResponse.redirect(home);
  const { access_token, refresh_token, expires_in } = data.session;
  res.cookies.set(ACCESS_COOKIE, access_token, {
    ...COOKIE_OPTS,
    maxAge: typeof expires_in === 'number' ? expires_in : 3600,
  });
  if (refresh_token) {
    res.cookies.set(REFRESH_COOKIE, refresh_token, { ...COOKIE_OPTS, maxAge: 60 * 60 * 24 * 30 });
  }
  // 쓰임을 다한 검증값은 지운다.
  res.cookies.set(VERIFIER_COOKIE, '', { ...COOKIE_OPTS, maxAge: 0 });
  res.cookies.set(VERIFIER_KEY_COOKIE, '', { ...COOKIE_OPTS, maxAge: 0 });
  return res;
}
