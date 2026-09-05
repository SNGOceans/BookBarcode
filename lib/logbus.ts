/**
 * 클라이언트 로그 버스.
 *
 * 화면에서 일어난 일(카메라 시작, 엔진 선택, 인식, 중복 억제, 오류)을 모아
 * ① 개발자 로그 화면에 즉시 보여주고 ② 묶어서 서버로 보내 DB 에 남긴다.
 *
 * 왜 필요한가 — 「안 읽힌다」는 신고를 받았을 때 그 기기에서 어떤 엔진이
 * 어떤 전략으로 몇 ms 를 쓰고 실패했는지가 없으면 추측만 하게 된다.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogEntry = {
  /** 화면 표시용 로컬 id */
  id: number;
  level: LogLevel;
  /** 짧은 이벤트 이름 — 'camera.start', 'scan.hit' 처럼 점으로 구분 */
  event: string;
  message?: string;
  meta?: Record<string, unknown>;
  at: number;
};

/** 화면에 들고 있는 최대 줄 수. 넘으면 오래된 것부터 버린다. */
const MAX_ENTRIES = 400;

/** 서버로 묶어 보내는 간격(ms)과 한 묶음 최대 건수 */
const FLUSH_MS = 4000;
const FLUSH_MAX = 40;

let seq = 0;
let entries: LogEntry[] = [];
const listeners = new Set<(list: LogEntry[]) => void>();

let pending: LogEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let shipping = false;
/** 서버 적재를 켤지. 로그인 전에는 보낼 곳이 없으므로 꺼 둔다. */
let shipEnabled = false;

function emit() {
  const snapshot = entries;
  for (const fn of listeners) fn(snapshot);
}

/** 로그 한 줄을 남긴다. */
export function log(
  level: LogLevel,
  event: string,
  message?: string,
  meta?: Record<string, unknown>,
): void {
  const entry: LogEntry = { id: ++seq, level, event, message, meta, at: Date.now() };
  entries = [entry, ...entries].slice(0, MAX_ENTRIES);
  emit();

  if (shipEnabled) {
    pending.push(entry);
    scheduleFlush();
  }
}

export const logDebug = (e: string, m?: string, x?: Record<string, unknown>) => log('debug', e, m, x);
export const logInfo  = (e: string, m?: string, x?: Record<string, unknown>) => log('info',  e, m, x);
export const logWarn  = (e: string, m?: string, x?: Record<string, unknown>) => log('warn',  e, m, x);
export const logError = (e: string, m?: string, x?: Record<string, unknown>) => log('error', e, m, x);

export function getEntries(): LogEntry[] {
  return entries;
}

export function subscribe(fn: (list: LogEntry[]) => void): () => void {
  listeners.add(fn);
  fn(entries);
  return () => { listeners.delete(fn); };
}

export function clearEntries(): void {
  entries = [];
  emit();
}

/** 로그인 상태가 되면 켠다. 끄면 쌓인 대기분도 버린다(보낼 주인이 없다). */
export function setShipping(on: boolean): void {
  shipEnabled = on;
  if (!on) {
    pending = [];
    if (timer) { clearTimeout(timer); timer = null; }
  }
}

function scheduleFlush() {
  if (timer || shipping) return;
  timer = setTimeout(() => { timer = null; void flush(); }, FLUSH_MS);
}

/** 대기 중인 로그를 서버로 보낸다. 실패하면 다음 묶음에 다시 실어 보낸다. */
export async function flush(): Promise<void> {
  if (shipping || !pending.length || !shipEnabled) return;
  shipping = true;
  const batch = pending.slice(0, FLUSH_MAX);
  pending = pending.slice(batch.length);
  try {
    const res = await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entries: batch.map((e) => ({
          level: e.level,
          event: e.event,
          message: e.message ?? null,
          meta: e.meta ?? null,
          logged_at: new Date(e.at).toISOString(),
        })),
      }),
    });
    if (!res.ok) {
      // 재시도해도 달라지지 않는 실패(인증 끊김, 적재 테이블 부재 등)에서는
      // 적재를 끈다. 계속 두면 매 묶음마다 실패 요청을 쏘게 된다.
      // 화면 로그는 그대로 남으므로 진단 능력은 잃지 않는다.
      if (res.status !== 429 && res.status < 500) {
        setShipping(false);
        log('warn', 'log.ship.off', `서버 적재를 중단합니다 (HTTP ${res.status})`);
      } else {
        pending = [...batch, ...pending].slice(0, MAX_ENTRIES);
      }
    }
  } catch {
    pending = [...batch, ...pending].slice(0, MAX_ENTRIES);
  } finally {
    shipping = false;
    if (pending.length) scheduleFlush();
  }
}

/** 사람이 읽을 수 있는 한 줄로 만든다(복사용). */
export function formatEntry(e: LogEntry): string {
  const t = new Date(e.at).toISOString();
  const meta = e.meta && Object.keys(e.meta).length ? ` ${JSON.stringify(e.meta)}` : '';
  return `${t} [${e.level}] ${e.event}${e.message ? ` — ${e.message}` : ''}${meta}`;
}
