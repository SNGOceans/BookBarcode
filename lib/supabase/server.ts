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
 * OAuth(PKCE) 전용 클라이언트.
 *
 * PKCE 는 로그인을 시작할 때 만든 code_verifier 를 콜백에서 다시 써야 한다.
 * supabase-js 는 그것을 「저장소」에 넣는데 서버에는 브라우저 저장소가 없다.
 * 그래서 **우리가 저장소를 직접 넘긴다** — 라이브러리 내부를 뒤지지 않고
 * 공개된 확장 지점만 쓰므로 업그레이드에도 견딘다.
 *
 * 돌려주는 map 에서 code_verifier 를 꺼내 쿠키에 담고, 콜백에서 다시 채워 넣는다.
 */
export function getOAuthClient(seed?: Record<string, string>): {
  supabase: SupabaseClient;
  store: Map<string, string>;
} {
  checkEnv();
  const store = new Map<string, string>(Object.entries(seed ?? {}));
  const supabase = createClient(url, anonKey, {
    auth: {
      persistSession: true,        // 저장소를 쓰려면 켜야 한다
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'pkce',
      storage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
        removeItem: (key: string) => { store.delete(key); },
      },
    },
  });
  return { supabase, store };
}

/** 저장소에서 code_verifier 를 찾는다. 키 이름에 프로젝트 ref 가 섞여 들어간다. */
export function findVerifier(store: Map<string, string>): { key: string; value: string } | null {
  for (const [key, value] of store) {
    if (key.includes('code-verifier') && value) return { key, value };
  }
  return null;
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
