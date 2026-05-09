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
 * 호출자의 cookie 에 들어 있는 access_token / refresh_token 을 supabase-js
 * 클라이언트의 내부 세션에 주입한다.
 *
 * persistSession: false 인 상태에서는 라이브러리에 세션이 비어 있어
 * from()/rpc() 호출 시 anon key 가 Authorization 으로 들어가고 RLS 가
 * 익명으로 평가된다. setSession 으로 사용자 JWT 를 세션에 등록해 놓으면
 * 라이브러리가 표준대로 그 토큰을 싣고 PostgREST 를 호출한다.
 *
 * autoRefreshToken: false 라 setSession 안에서 자동 갱신은 일어나지 않는다.
 */
export async function getRequestClient(req: NextRequest): Promise<SupabaseClient> {
  checkEnv();
  const access  = req.cookies.get(ACCESS_COOKIE)?.value  ?? '';
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value ?? '';

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (access) {
    await client.auth.setSession({
      access_token : access,
      refresh_token: refresh,
    });
  }
  return client;
}

export async function requireUser(
  req: NextRequest,
): Promise<{ supabase: SupabaseClient; user: User } | null> {
  const supabase = await getRequestClient(req);
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return { supabase, user: data.user };
}
