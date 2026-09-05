import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 현재 cookie 세션의 사용자 정보. 미인증이면 user: null.
 *
 * 관리자 여부도 함께 준다 — 화면이 메뉴를 그릴 때 필요하다.
 * 이것은 **표시용**이고, 실제 권한은 관리자 API 가 매번 서버에서 다시 확인한다.
 * 화면 값만 믿으면 클라이언트를 고친 사람이 그대로 들어온다.
 */
export async function GET(req: NextRequest) {
  const ctx = await requireUser(req);
  if (!ctx) return NextResponse.json({ user: null });

  let isAdmin = false;
  try {
    const { data } = await ctx.supabase.rpc('is_admin');
    isAdmin = data === true;
  } catch { /* 함수가 아직 없으면 관리자 아님으로 둔다 */ }

  return NextResponse.json({
    user: { id: ctx.user.id, email: ctx.user.email, isAdmin },
  });
}
