import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

const url     = process.env.SUPABASE_URL ?? '';
const anonKey = process.env.SUPABASE_ANON_KEY ?? '';

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
 * Authorization: Bearer <jwt> 를 그대로 PostgREST 에 전달해
 * RLS(auth.uid()) 가 자동 적용되는 클라이언트.
 */
export function getRequestClient(req: NextRequest): SupabaseClient {
  checkEnv();
  const auth = req.headers.get('authorization') ?? '';
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: auth ? { headers: { Authorization: auth } } : undefined,
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
