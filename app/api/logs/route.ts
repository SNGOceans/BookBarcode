import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LOG_COLS = 'id, source, level, event, message, meta, logged_at';

const LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const SOURCES = new Set(['client', 'server', 'vercel', 'supabase']);

/** 한 번에 받아 줄 최대 건수 — 클라이언트가 폭주해도 DB 를 지키는 상한 */
const MAX_BATCH = 100;
/** 한 화면에 내려 줄 최대 건수 */
const MAX_PAGE = 300;

/** 로그 조회. source·level·검색어로 좁힐 수 있다. */
export async function GET(req: NextRequest) {
  const ctx = await requireUser(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { supabase } = ctx;

  const sp = req.nextUrl.searchParams;
  const source = sp.get('source') ?? '';
  const level  = sp.get('level')  ?? '';
  const q      = (sp.get('q') ?? '').trim();
  const limit  = Math.min(MAX_PAGE, Math.max(1, Number(sp.get('limit') ?? 200) || 200));

  let query = supabase
    .from('app_logs')
    .select(LOG_COLS)
    .order('logged_at', { ascending: false })
    .limit(limit);

  if (source && SOURCES.has(source)) query = query.eq('source', source);
  if (level  && LEVELS.has(level))   query = query.eq('level', level);
  if (q) query = query.or(`event.ilike.%${q}%,message.ilike.%${q}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ logs: data ?? [] });
}

/** 클라이언트에서 모아 보낸 로그를 적재한다. */
export async function POST(req: NextRequest) {
  const ctx = await requireUser(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { supabase, user } = ctx;

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const raw = (body as { entries?: unknown })?.entries;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: 'entries 배열이 필요합니다.' }, { status: 400 });
  }

  const rows = raw.slice(0, MAX_BATCH).map((e) => {
    const item = e as Record<string, unknown>;
    const level = String(item.level ?? 'info');
    return {
      user_id:   user.id,
      source:    'client',
      level:     LEVELS.has(level) ? level : 'info',
      event:     String(item.event ?? 'unknown').slice(0, 120),
      message:   item.message == null ? null : String(item.message).slice(0, 2000),
      meta:      item.meta ?? null,
      logged_at: typeof item.logged_at === 'string' ? item.logged_at : new Date().toISOString(),
    };
  });

  if (!rows.length) return NextResponse.json({ inserted: 0 });

  const { error } = await supabase.from('app_logs').insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ inserted: rows.length });
}

/** 로그 비우기. 지우는 대상은 자기 행뿐이다(RLS). */
export async function DELETE(req: NextRequest) {
  const ctx = await requireUser(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { supabase, user } = ctx;

  const sp = req.nextUrl.searchParams;
  const source = sp.get('source') ?? '';

  let query = supabase.from('app_logs').delete().eq('user_id', user.id);
  if (source && SOURCES.has(source)) query = query.eq('source', source);

  const { error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
