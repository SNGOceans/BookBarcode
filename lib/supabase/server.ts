import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

const url     = process.env.SUPABASE_URL ?? '';
const anonKey = process.env.SUPABASE_ANON_KEY ?? '';

export const ACCESS_COOKIE  = 'bb_at';
export const REFRESH_COOKIE = 'bb_rt';

export const COOKIE_OPTS = {
  httpOnly: true,
  secure  : process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path    : '/',
};

function checkEnv() {
  if (!url || !anonKey) {
    throw new Error('SUPABASE_URL / SUPABASE_ANON_KEY 가 설정되지 않았습니다.');
  }
}

/**
 * 익명 클라이언트 (회원가입/로그인 호출용).
 */
export function getAnonClient(): SupabaseClient {
  checkEnv();
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * cookie 또는 Authorization 헤더에서 사용자 access_token 을 추출하고,
 * 그 토큰을 PostgREST 호출에 강제로 실어 RLS(auth.uid()) 가 적용되는 클라이언트.
 *
 * 주의: supabase-js v2 의 `global.headers.Authorization` 만으로는 라이브러리
 * 내부에서 anon key 로 덮어쓰는 경우가 있어 from().select() 호출 때
 * RLS 가 익명으로 평가되는 버그가 발생함. 이를 막기 위해 `global.fetch` 자체를
 * 래핑해 매 요청에 apikey + Authorization 을 강제한다.
 */
export function getRequestClient(req: NextRequest): SupabaseClient {
  checkEnv();
  const cookieToken = req.cookies.get(ACCESS_COOKIE)?.value;
  const headerToken = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const userToken   = cookieToken || headerToken || '';

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init = {}) => {
        const headers = new Headers(init.headers ?? {});
        headers.set('apikey', anonKey);
        if (userToken) headers.set('Authorization', `Bearer ${userToken}`);
        return fetch(input as any, { ...init, headers });
      },
    },
  });
}

export async function requireUser(
  req: NextRequest,
): Promise<{ supabase: SupabaseClient; user: User } | null> {
  const supabase = getRequestClient(req);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return { supabase, user: data.user };
}
