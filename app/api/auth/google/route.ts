import { NextRequest, NextResponse } from 'next/server';
import { getOAuthClient, findVerifier } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 구글 로그인 시작.
 *
 * 이 앱은 세션을 **서버가 httpOnly 쿠키로** 들고 있다(브라우저 SDK 세션이 아니다).
 * 그래서 구글 로그인도 브라우저에서 직접 열지 않고 여기서 주소를 만들어 보낸다.
 * 돌아오는 곳은 /api/auth/callback 이고, 거기서 코드를 세션으로 바꿔 쿠키에 심는다.
 *
 * ⚠️ 이 경로가 동작하려면 Supabase 대시보드에서 Google 공급자를 켜고
 *    아래 콜백 주소를 Redirect URL 목록에 넣어야 한다. 코드만으로는 안 된다.
 */

/** PKCE 검증값을 콜백까지 나르는 쿠키. 짧게 살고 콜백에서 지운다. */
export const VERIFIER_COOKIE = 'bb_pkce';
/** 저장소 키 이름도 함께 날라야 콜백에서 같은 자리에 되채울 수 있다. */
export const VERIFIER_KEY_COOKIE = 'bb_pkce_k';

/** 콜백 주소. 프록시 뒤에서도 맞게 잡히도록 요청 헤더를 먼저 본다. */
export function callbackUrl(req: NextRequest): string {
  const envBase = (process.env.APP_BASE_URL ?? '').trim();
  if (envBase) return `${envBase.replace(/\/+$/, '')}/api/auth/callback`;

  const host  = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  const proto = req.headers.get('x-forwarded-proto')
    ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}/api/auth/callback`;
}

export async function GET(req: NextRequest) {
  const { supabase, store } = getOAuthClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: callbackUrl(req),
      // 주소만 받아 우리가 직접 보낸다.
      skipBrowserRedirect: true,
      queryParams: { prompt: 'select_account' },
    },
  });

  if (error || !data?.url) {
    // 구글 공급자가 꺼져 있으면 여기서 걸린다. 사유를 들고 로그인 화면으로 돌아간다.
    const reason = error?.message ?? '구글 로그인 주소를 받지 못했습니다';
    return NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(reason)}`, req.url));
  }

  const verifier = findVerifier(store);
  if (!verifier) {
    return NextResponse.redirect(
      new URL('/?auth_error=' + encodeURIComponent('로그인 준비에 실패했습니다 (PKCE)'), req.url),
    );
  }

  const secure = process.env.NODE_ENV === 'production';
  const opts = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/', maxAge: 600 };

  const res = NextResponse.redirect(data.url);
  res.cookies.set(VERIFIER_COOKIE, verifier.value, opts);
  res.cookies.set(VERIFIER_KEY_COOKIE, verifier.key, opts);
  return res;
}
