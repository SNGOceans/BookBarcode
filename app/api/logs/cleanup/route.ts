import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 플랫폼 로그 일일 초기화 (크론).
 *
 * 하루에 한 번 Vercel·Supabase 에서 끌어온 로그를 비운다.
 * 그 둘은 원본이 각 플랫폼에 남아 있어 언제든 다시 당겨올 수 있다 —
 * 우리 DB 에 무한히 쌓아 둘 이유가 없다.
 *
 * 🚨 **클라이언트·서버 로그는 지우지 않는다.**
 *    그쪽은 우리 DB 가 유일한 사본이라 지우면 되돌릴 수 없다.
 *    지우는 대상을 넓히려면 사용자와 합의한 뒤에 한다.
 *
 * 언제 도나 — `vercel.json` 의 `0 18 * * *`.
 * ⚠️ Vercel 크론은 **UTC 기준**이다. 저 값은 한국 시각 새벽 3시다.
 *    한국 시각으로 적으면 9시간 어긋난 때에 돈다.
 *
 * 부르는 쪽 — Vercel 이 `Authorization: Bearer $CRON_SECRET` 을 붙여 GET 으로 부른다.
 *    CRON_SECRET 이 없으면 이 경로는 아무 일도 하지 않고 401 을 준다.
 *    비밀값 없이 지우게 두면 주소를 아는 누구나 로그를 비울 수 있다.
 */

/** 지우는 대상. 이 목록 밖은 건드리지 않는다. */
const PLATFORM_SOURCES = ['vercel', 'supabase'];

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET ?? '';
  // 비밀값이 없으면 아무나 부를 수 있다. 그 상태로 지우게 두지 않는다.
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  return header === `Bearer ${secret}`;
}

async function run(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json(
      { error: 'unauthorized', hint: 'CRON_SECRET 미설정이거나 Authorization 헤더가 다릅니다' },
      { status: 401 },
    );
  }

  let supabase;
  try {
    supabase = getAdminClient();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  // 지우기 전 건수를 센다. 「0건 지움」과 「아무것도 못 봄」을 구분하기 위해서다.
  const { count: before, error: countError } = await supabase
    .from('app_logs')
    .select('id', { count: 'exact', head: true })
    .in('source', PLATFORM_SOURCES);
  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }

  const { error, count: deleted } = await supabase
    .from('app_logs')
    .delete({ count: 'exact' })
    .in('source', PLATFORM_SOURCES);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    sources: PLATFORM_SOURCES,
    before: before ?? 0,
    deleted: deleted ?? 0,
    at: new Date().toISOString(),
  });
}

// Vercel 크론은 GET 으로 부른다. 손으로 돌려 볼 수 있게 POST 도 같이 받는다.
export const GET = run;
export const POST = run;
