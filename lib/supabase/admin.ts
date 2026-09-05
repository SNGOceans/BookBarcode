import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * 관리자 클라이언트 (service role).
 *
 * ⚠️ 이 키는 RLS 를 통과한다. **사용자 요청을 처리하는 경로에서는 절대 쓰지 않는다.**
 *    쓰는 곳은 사람 없이 도는 작업(크론)뿐이고, 거기서도 대상을 좁혀서 쓴다.
 *
 * 왜 필요한가 — 크론은 로그인한 사용자가 없다. 세션 기반 클라이언트로는
 * 어느 행도 볼 수 없어서 정리 작업이 조용히 0건으로 끝난다.
 */
export function getAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.');
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
