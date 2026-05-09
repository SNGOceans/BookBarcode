import { NextRequest, NextResponse } from 'next/server';
import { getAnonClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 로그인 / 회원가입 통합 엔드포인트.
 * 클라이언트에서는 Supabase JS 를 직접 쓰지 않고 이 API 만 호출한다.
 *   body: { mode: 'signin' | 'signup', email, password }
 *   resp: { access_token, refresh_token, user: { id, email } }
 *         또는 (signup 인데 이메일 확인 필요): { needs_confirmation: true }
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
    return NextResponse.json({
      access_token : data.session?.access_token,
      refresh_token: data.session?.refresh_token,
      user         : { id: data.user?.id, email: data.user?.email },
    });
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

  return NextResponse.json({
    access_token : data.session.access_token,
    refresh_token: data.session.refresh_token,
    user         : { id: data.user?.id, email: data.user?.email },
  });
}
