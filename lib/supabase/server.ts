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
 * httpOnly cookie 의 access_token 을 PostgREST 에 그대로 전달해
 * RLS(auth.uid()) 가 자동 적용되는 클라이언트.
 */
export function getRequestClient(req: NextRequest): SupabaseClient {
  checkEnv();
  const access = req.cookies.get(ACCESS_COOKIE)?.value;
  const header = access
    ? `Bearer ${access}`
    : (req.headers.get('authorization') ?? '');
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: header ? { headers: { Authorization: header } } : undefined,
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
