'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import AuthForm from '@/components/AuthForm';

const Scanner = dynamic(() => import('@/components/Scanner'), { ssr: false });

type Book = {
  id: number;
  isbn: string;
  scan_count: number;
  first_scanned_at: string;
  last_scanned_at: string;
};

type Auth = {
  token: string;
  refresh: string;
  user: { id: string; email: string };
};

const STORE_KEY = 'bb:auth:v1';

function loadAuth(): Auth | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
function saveAuth(a: Auth | null) {
  if (typeof window === 'undefined') return;
  if (a) localStorage.setItem(STORE_KEY, JSON.stringify(a));
  else   localStorage.removeItem(STORE_KEY);
}

export default function HomePage() {
  const [auth, setAuth]           = useState<Auth | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [books, setBooks]         = useState<Book[]>([]);
  const [active, setActive]       = useState(false);
  const [toast, setToast]         = useState<string | null>(null);
  const inflightRef               = useRef<Set<string>>(new Set());

  // 페이지 진입 시 localStorage 에서 세션 복원
  useEffect(() => {
    setAuth(loadAuth());
    setAuthReady(true);
  }, []);

  // 인증 상태가 바뀌면 books 다시 로드
  useEffect(() => {
    if (!auth) { setBooks([]); return; }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.user.id]);

  async function authedFetch(input: string, init?: RequestInit) {
    const token = auth?.token;
    const res = await fetch(input, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (res.status === 401) {
      // 토큰 만료/무효 → 자동 로그아웃
      saveAuth(null);
      setAuth(null);
    }
    return res;
  }

  async function load() {
    try {
      const res = await authedFetch('/api/books');
      const json = await res.json();
      if (!res.ok) { setBooks([]); return; }
      setBooks(json.books ?? []);
    } catch { /* network */ }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 1600);
  }

  function feedback(ok: boolean) {
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(ok ? 60 : [40, 60, 40]);
    }
    try {
      const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = ok ? 880 : 400;
      o.type = 'sine';
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.01);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.1);
      o.start(); o.stop(ctx.currentTime + 0.12);
    } catch { /* ignore */ }
  }

  const handleDetect = useCallback(async (isbn: string) => {
    if (inflightRef.current.has(isbn)) return;
    inflightRef.current.add(isbn);
    try {
      const res = await authedFetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbn }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(`실패: ${json.error ?? res.status}`);
        feedback(false);
        return;
      }
      const book: Book = json.book;
      setBooks((prev) => {
        const next = prev.filter((b) => b.id !== book.id);
        return [book, ...next].slice(0, 1000);
      });
      showToast(`✔ ${book.isbn}${book.scan_count > 1 ? ` ×${book.scan_count}` : ''}`);
      feedback(true);
    } catch {
      showToast('네트워크 오류');
      feedback(false);
    } finally {
      inflightRef.current.delete(isbn);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.token]);

  async function remove(id: number) {
    if (!confirm('삭제할까요? (스캔 이력도 함께 삭제됩니다)')) return;
    const res = await authedFetch(`/api/books/${id}`, { method: 'DELETE' });
    if (res.ok) setBooks((prev) => prev.filter((b) => b.id !== id));
  }

  function exportCsv() {
    if (!books.length) return;
    const rows = [['no', 'isbn', 'scan_count', 'first_scanned_at', 'last_scanned_at']];
    [...books].reverse().forEach((b, i) =>
      rows.push([
        String(i + 1),
        b.isbn,
        String(b.scan_count),
        b.first_scanned_at,
        b.last_scanned_at,
      ]),
    );
    const csv = '﻿' + rows.map((r) => r.join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url; a.download = `barcodes-${stamp}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function logout() {
    setActive(false);
    saveAuth(null);
    setAuth(null);
  }

  function onAuthed(token: string, refresh: string, user: { id: string; email: string }) {
    const a: Auth = { token, refresh, user };
    saveAuth(a);
    setAuth(a);
  }

  const totalScans = books.reduce((acc, b) => acc + b.scan_count, 0);

  if (!authReady) {
    return <main className="page"><div className="loading">…</div></main>;
  }

  if (!auth) {
    return (
      <main className="page auth-page">
        <header className="header">
          <h1>📚 Book Barcode <small>Quagga2 · Supabase</small></h1>
        </header>
        <AuthForm onAuthed={onAuthed} />
      </main>
    );
  }

  return (
    <main className="page">
      <header className="header">
        <h1>📚 Book Barcode <small>{auth.user.email}</small></h1>
        <div className="header-right">
          <span className="badge">{books.length}</span>
          <button className="logout" onClick={logout}>로그아웃</button>
        </div>
      </header>

      <Scanner active={active} onDetect={handleDetect} />

      <div className="controls">
        <button
          className={'primary ' + (active ? 'stop' : '')}
          onClick={() => setActive((v) => !v)}
        >
          {active ? '■ 스캔 정지' : '▶ 스캔 시작'}
        </button>
      </div>

      <div className="toolbar">
        <button onClick={exportCsv}>⬇ CSV</button>
        <button onClick={() => void load()}>↻ 새로고침</button>
      </div>

      <section className="list">
        <div className="list-header">
          <span>스캔된 도서 <strong>{books.length}</strong></span>
          <span>총 스캔 <strong>{totalScans}</strong>회</span>
        </div>
        {!books.length && <div className="empty">아직 스캔된 바코드가 없습니다.</div>}
        <ul>
          {books.map((b) => (
            <li key={b.id}>
              <div className="info">
                <span className="isbn">
                  {b.isbn}
                  {b.scan_count > 1 && <span className="count">×{b.scan_count}</span>}
                </span>
                <span className="time">
                  {new Date(b.last_scanned_at).toLocaleString('ko-KR')}
                </span>
              </div>
              <button className="del" onClick={() => void remove(b.id)} aria-label="삭제">✕</button>
            </li>
          ))}
        </ul>
      </section>

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
