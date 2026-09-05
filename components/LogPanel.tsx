'use client';

/**
 * 개발자 로그 화면.
 *
 * 두 가지를 본다.
 *   이 세션 — 브라우저에서 방금 일어난 일. 네트워크 없이 즉시 보인다.
 *   저장됨  — DB 에 쌓인 것. 클라이언트 로그와 플랫폼(Vercel·Supabase) 로그가 함께 있다.
 *
 * 「안 읽힌다」는 신고를 받았을 때 어떤 엔진이 어떤 전략으로 실패했는지를
 * 바로 확인하고, 그대로 복사해 넘길 수 있게 하는 것이 목적이다.
 */

import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import { formatTime } from '@/lib/datetime';
import {
  clearEntries,
  formatEntry,
  flush,
  subscribe,
  type LogEntry,
  type LogLevel,
} from '@/lib/logbus';

type StoredLog = {
  id: number;
  source: string;
  level: LogLevel;
  event: string;
  message: string | null;
  meta: Record<string, unknown> | null;
  logged_at: string;
};

type SyncResult = {
  source: string;
  ok: boolean;
  configured: boolean;
  fetched: number;
  inserted: number;
  reason?: string;
};

const LEVELS: (LogLevel | '')[] = ['', 'debug', 'info', 'warn', 'error'];
const SOURCES = ['', 'client', 'server', 'vercel', 'supabase'];

export default function LogPanel() {
  const [mode, setMode]       = useState<'live' | 'stored'>('live');
  const [live, setLive]       = useState<LogEntry[]>([]);
  const [stored, setStored]   = useState<StoredLog[]>([]);
  const [level, setLevel]     = useState<LogLevel | ''>('');
  const [source, setSource]   = useState('');
  const [busy, setBusy]       = useState(false);
  const [note, setNote]       = useState<string | null>(null);

  useEffect(() => subscribe(setLive), []);

  const loadStored = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const sp = new URLSearchParams();
      if (level)  sp.set('level', level);
      if (source) sp.set('source', source);
      const res = await fetch(`/api/logs?${sp.toString()}`);
      const json = await res.json();
      if (!res.ok) { setNote(json.error ?? `조회 실패 (${res.status})`); return; }
      setStored(json.logs ?? []);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [level, source]);

  useEffect(() => {
    if (mode === 'stored') void loadStored();
  }, [mode, loadStored]);

  /** 플랫폼 로그를 당겨온다. 미설정 소스는 분명히 알려 준다. */
  const syncPlatform = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      await flush();
      const res = await fetch('/api/logs/sync?minutes=60', { method: 'POST' });
      const json = await res.json();
      if (!res.ok) { setNote(json.error ?? `수집 실패 (${res.status})`); return; }

      const results = (json.results ?? []) as SyncResult[];
      const lines = results.map((r) => {
        if (!r.configured) return `${r.source}: 미설정 — ${r.reason ?? ''}`;
        if (!r.ok)         return `${r.source}: 실패 — ${r.reason ?? ''}`;
        return `${r.source}: ${r.fetched}건 조회 · ${r.inserted}건 신규`;
      });
      setNote(lines.join(' / '));
      await loadStored();
      setMode('stored');
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [loadStored]);

  const copyAll = useCallback(async () => {
    const text = mode === 'live'
      ? live.map(formatEntry).join('\n')
      : stored.map((s) => {
          const meta = s.meta && Object.keys(s.meta).length ? ` ${JSON.stringify(s.meta)}` : '';
          return `${s.logged_at} [${s.level}] (${s.source}) ${s.event}${s.message ? ` — ${s.message}` : ''}${meta}`;
        }).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setNote(`${mode === 'live' ? live.length : stored.length}줄 복사했습니다.`);
    } catch {
      setNote('복사할 수 없습니다. 길게 눌러 직접 선택해 주세요.');
    }
  }, [mode, live, stored]);

  const wipe = useCallback(async () => {
    if (mode === 'live') { clearEntries(); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/logs', { method: 'DELETE' });
      if (!res.ok) { setNote(`비우기 실패 (${res.status})`); return; }
      setStored([]);
    } finally {
      setBusy(false);
    }
  }, [mode]);

  const shown = mode === 'live'
    ? live.filter((e) => (!level || e.level === level))
    : stored;

  return (
    <div className="logs">
      <div className="log-modes">
        <button
          className={'log-mode' + (mode === 'live' ? ' on' : '')}
          onClick={() => setMode('live')}
        >
          이 세션
        </button>
        <button
          className={'log-mode' + (mode === 'stored' ? ' on' : '')}
          onClick={() => setMode('stored')}
        >
          저장됨
        </button>
      </div>

      <div className="log-filters">
        <select value={level} onChange={(e) => setLevel(e.target.value as LogLevel | '')}>
          {LEVELS.map((l) => <option key={l} value={l}>{l || '등급 전체'}</option>)}
        </select>
        {mode === 'stored' && (
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {SOURCES.map((s) => <option key={s} value={s}>{s || '출처 전체'}</option>)}
          </select>
        )}
      </div>

      <div className="log-actions">
        {mode === 'stored' && (
          <button onClick={() => void loadStored()} disabled={busy}>
            <Icon name="refresh" size={13} /> 새로고침
          </button>
        )}
        <button onClick={() => void syncPlatform()} disabled={busy}>
          <Icon name="download" size={13} /> 플랫폼 로그
        </button>
        <button onClick={() => void copyAll()}>
          <Icon name="copy" size={13} /> 복사
        </button>
        <button onClick={() => void wipe()} disabled={busy}>비우기</button>
      </div>

      {note && <div className="log-note">{note}</div>}

      {!shown.length && (
        <div className="empty">
          {mode === 'live' ? '아직 기록된 이벤트가 없습니다.' : '저장된 로그가 없습니다.'}
        </div>
      )}

      <ul className="log-list">
        {mode === 'live'
          ? (shown as LogEntry[]).map((e) => (
              <li key={e.id} className={`log-row ${e.level}`}>
                <span className="log-time">{formatTime(e.at)}</span>
                <span className="log-event">{e.event}</span>
                {e.message && <span className="log-msg">{e.message}</span>}
                {e.meta && <span className="log-meta">{JSON.stringify(e.meta)}</span>}
              </li>
            ))
          : (shown as StoredLog[]).map((s) => (
              <li key={s.id} className={`log-row ${s.level}`}>
                <span className="log-time">{formatTime(s.logged_at)}</span>
                <span className="log-src">{s.source}</span>
                <span className="log-event">{s.event}</span>
                {s.message && <span className="log-msg">{s.message}</span>}
                {s.meta && <span className="log-meta">{JSON.stringify(s.meta)}</span>}
              </li>
            ))}
      </ul>
    </div>
  );
}
