import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 외부 플랫폼 로그를 끌어와 app_logs 에 쌓는다.
 *
 *   Vercel   : GET /v1/projects/{projectId}/deployments/{deploymentId}/runtime-logs
 *              (최근 배포를 먼저 찾은 뒤 그 배포의 런타임 로그를 읽는다)
 *   Supabase : GET /v1/projects/{ref}/analytics/endpoints/logs.all
 *
 * 두 곳 다 **개인 액세스 토큰**이 있어야 한다. 없는 곳은 조용히 건너뛰지 않고
 * 「미설정」으로 분명히 보고한다 — 0건과 미설정을 같은 화면으로 두면
 * 「로그가 없구나」로 잘못 읽는다.
 */

/** 한 번에 가져올 최대 줄 수(플랫폼별) */
const MAX_ROWS = 200;
/** 외부 API 응답을 기다리는 한도 */
const FETCH_TIMEOUT_MS = 12_000;
/** 기본 조회 구간 */
const DEFAULT_WINDOW_MIN = 60;

type SourceResult = {
  source: 'vercel' | 'supabase';
  ok: boolean;
  configured: boolean;
  fetched: number;
  inserted: number;
  reason?: string;
};

function timeoutSignal(ms: number): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms).unref?.();
  return c.signal;
}

/** Vercel 로그 레벨을 우리 등급으로 옮긴다. */
function mapVercelLevel(level: unknown): 'debug' | 'info' | 'warn' | 'error' {
  const v = String(level ?? '').toLowerCase();
  if (v === 'error' || v === 'fatal') return 'error';
  if (v === 'warning' || v === 'warn') return 'warn';
  if (v === 'debug' || v === 'trace') return 'debug';
  return 'info';
}

async function pullVercel(userId: string): Promise<{ result: SourceResult; rows: Record<string, unknown>[] }> {
  const token     = process.env.VERCEL_API_TOKEN ?? '';
  const projectId = process.env.VERCEL_PROJECT_ID ?? '';
  const teamId    = process.env.VERCEL_TEAM_ID ?? '';

  const base: SourceResult = { source: 'vercel', ok: false, configured: false, fetched: 0, inserted: 0 };
  if (!token || !projectId) {
    return {
      result: { ...base, reason: 'VERCEL_API_TOKEN · VERCEL_PROJECT_ID 미설정' },
      rows: [],
    };
  }

  const team = teamId ? `&teamId=${encodeURIComponent(teamId)}` : '';
  const headers = { Authorization: `Bearer ${token}` };

  try {
    // 1) 최근 배포 하나를 찾는다. 런타임 로그는 배포 단위로만 조회된다.
    const depRes = await fetch(
      `https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=1&state=READY${team}`,
      { headers, signal: timeoutSignal(FETCH_TIMEOUT_MS), cache: 'no-store' },
    );
    if (!depRes.ok) {
      return { result: { ...base, configured: true, reason: `배포 목록 조회 실패 (${depRes.status})` }, rows: [] };
    }
    const depJson = await depRes.json() as { deployments?: { uid?: string; url?: string }[] };
    const deployment = depJson.deployments?.[0];
    if (!deployment?.uid) {
      return { result: { ...base, configured: true, ok: true, reason: 'READY 상태 배포가 없습니다.' }, rows: [] };
    }

    // 2) 그 배포의 런타임 로그. 스트림(NDJSON)으로 오므로 줄 단위로 끊어 읽는다.
    const logRes = await fetch(
      `https://api.vercel.com/v1/projects/${encodeURIComponent(projectId)}`
      + `/deployments/${encodeURIComponent(deployment.uid)}/runtime-logs?${team.slice(1)}`,
      { headers, signal: timeoutSignal(FETCH_TIMEOUT_MS), cache: 'no-store' },
    );
    if (!logRes.ok) {
      return { result: { ...base, configured: true, reason: `런타임 로그 조회 실패 (${logRes.status})` }, rows: [] };
    }

    const text = await logRes.text();
    const rows: Record<string, unknown>[] = [];
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      let entry: Record<string, unknown>;
      try { entry = JSON.parse(t); } catch { continue; }
      // 구분자 행은 로그가 아니다.
      if (entry.source === 'delimiter') continue;

      const ts = Number(entry.timestampInMs ?? 0);
      rows.push({
        user_id:     userId,
        source:      'vercel',
        level:       mapVercelLevel(entry.level),
        event:       String(entry.source ?? 'runtime').slice(0, 120),
        message:     String(entry.message ?? '').slice(0, 2000),
        meta: {
          requestPath:        entry.requestPath ?? null,
          requestMethod:      entry.requestMethod ?? null,
          responseStatusCode: entry.responseStatusCode ?? null,
          domain:             entry.domain ?? null,
          deploymentId:       deployment.uid,
        },
        logged_at:   new Date(ts > 0 ? ts : Date.now()).toISOString(),
        external_id: String(entry.rowId ?? `${deployment.uid}:${ts}:${rows.length}`).slice(0, 200),
      });
      if (rows.length >= MAX_ROWS) break;
    }

    return { result: { ...base, configured: true, ok: true, fetched: rows.length }, rows };
  } catch (e) {
    const reason = e instanceof Error && e.name === 'AbortError'
      ? '응답 시간 초과'
      : e instanceof Error ? e.message : String(e);
    return { result: { ...base, configured: true, reason }, rows: [] };
  }
}

async function pullSupabase(userId: string, windowMin: number): Promise<{ result: SourceResult; rows: Record<string, unknown>[] }> {
  const token = process.env.SUPABASE_MANAGEMENT_TOKEN ?? '';
  const ref   = process.env.SUPABASE_PROJECT_REF ?? '';

  const base: SourceResult = { source: 'supabase', ok: false, configured: false, fetched: 0, inserted: 0 };
  if (!token || !ref) {
    return {
      result: { ...base, reason: 'SUPABASE_MANAGEMENT_TOKEN · SUPABASE_PROJECT_REF 미설정' },
      rows: [],
    };
  }

  // 구간은 24시간을 넘길 수 없다(플랫폼 제약).
  const end = new Date();
  const start = new Date(end.getTime() - Math.min(24 * 60, windowMin) * 60_000);

  try {
    const url =
      `https://api.supabase.com/v1/projects/${encodeURIComponent(ref)}/analytics/endpoints/logs.all`
      + `?iso_timestamp_start=${encodeURIComponent(start.toISOString())}`
      + `&iso_timestamp_end=${encodeURIComponent(end.toISOString())}`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: timeoutSignal(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) {
      return { result: { ...base, configured: true, reason: `로그 조회 실패 (${res.status})` }, rows: [] };
    }

    const json = await res.json() as { result?: Record<string, unknown>[] };
    const list = Array.isArray(json.result) ? json.result : [];

    const rows = list.slice(0, MAX_ROWS).map((entry, i) => {
      // timestamp 는 마이크로초 단위로 오는 경우가 있다.
      const rawTs = Number(entry.timestamp ?? 0);
      const ms = rawTs > 1e14 ? Math.floor(rawTs / 1000) : rawTs > 0 ? rawTs : Date.now();
      const msg = String(entry.event_message ?? '');
      return {
        user_id:     userId,
        source:      'supabase',
        // 플랫폼이 등급을 따로 주지 않아 메시지에서 판단한다.
        level:       /error|exception|fatal/i.test(msg) ? 'error' : /warn/i.test(msg) ? 'warn' : 'info',
        event:       'edge_log',
        message:     msg.slice(0, 2000),
        meta:        { id: entry.id ?? null },
        logged_at:   new Date(ms).toISOString(),
        external_id: String(entry.id ?? `${ms}:${i}`).slice(0, 200),
      };
    });

    return { result: { ...base, configured: true, ok: true, fetched: rows.length }, rows };
  } catch (e) {
    const reason = e instanceof Error && e.name === 'AbortError'
      ? '응답 시간 초과'
      : e instanceof Error ? e.message : String(e);
    return { result: { ...base, configured: true, reason }, rows: [] };
  }
}

/** 이미 있는 external_id 는 건너뛰고 넣는다(같은 구간을 다시 당겨도 안전). */
async function insertDedup(
  supabase: SupabaseClient,
  rows: Record<string, unknown>[],
): Promise<{ inserted: number; error?: string }> {
  if (!rows.length) return { inserted: 0 };
  const { data, error } = await supabase
    .from('app_logs')
    .upsert(rows, { onConflict: 'user_id,source,external_id', ignoreDuplicates: true })
    .select('id');
  if (error) return { inserted: 0, error: error.message };
  return { inserted: data?.length ?? 0 };
}

export async function POST(req: NextRequest) {
  const ctx = await requireUser(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { supabase, user } = ctx;

  const windowMin = Math.min(
    24 * 60,
    Math.max(1, Number(req.nextUrl.searchParams.get('minutes') ?? DEFAULT_WINDOW_MIN) || DEFAULT_WINDOW_MIN),
  );

  const [vercel, supa] = await Promise.all([
    pullVercel(user.id),
    pullSupabase(user.id, windowMin),
  ]);

  const results: SourceResult[] = [];
  for (const part of [vercel, supa]) {
    const r = { ...part.result };
    if (r.ok && part.rows.length) {
      const ins = await insertDedup(supabase, part.rows);
      r.inserted = ins.inserted;
      if (ins.error) { r.ok = false; r.reason = ins.error; }
    }
    results.push(r);
  }

  const configured = results.filter((r) => r.configured).length;
  return NextResponse.json({
    results,
    // 설정된 소스가 하나도 없으면 「로그 0건」이 아니라 「아직 연결 안 됨」이다.
    configuredSources: configured,
    windowMinutes: windowMin,
  });
}
