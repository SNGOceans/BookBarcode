'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import AuthForm from '@/components/AuthForm';
import LogPanel from '@/components/LogPanel';
import { flush, logError, logInfo, logWarn, setShipping } from '@/lib/logbus';

const Scanner = dynamic(() => import('@/components/Scanner'), { ssr: false });

type Book = {
  id: number;
  isbn: string;
  scan_count: number;
  first_scanned_at: string;
  last_scanned_at: string;
  title:          string | null;
  author:         string | null;
  translator:     string | null;
  publisher:      string | null;
  cover_url:      string | null;
  price_standard: number | null;
  price_sales:    number | null;
  used_price:     number | null;
  used_min_price: number | null;
  used_count:     number | null;
  meta_fetched_at: string | null;
};

type Me = { id: string; email: string };

const wonFmt = (n: number) => `${n.toLocaleString('ko-KR')}원`;

function pad2(n: number) { return String(n).padStart(2, '0'); }
function stampNow(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

export default function HomePage() {
  const [me, setMe]               = useState<Me | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [books, setBooks]         = useState<Book[]>([]);
  const [active, setActive]       = useState(false);
  const [toast, setToast]         = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tab, setTab]             = useState<'books' | 'logs'>('books');
  const inflightRef               = useRef<Set<string>>(new Set());

  // 로그인 상태에서만 로그를 서버로 보낸다. 보낼 주인이 없으면 쌓아 둘 이유가 없다.
  useEffect(() => {
    setShipping(!!me);
    if (!me) return;
    logInfo('session.start', '로그인 세션 시작', { email: me.email });
    // 화면을 벗어날 때 대기분을 마저 보낸다.
    const onHide = () => { void flush(); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      void flush();
    };
  }, [me]);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((j) => setMe(j.user ?? null))
      .catch(() => setMe(null))
      .finally(() => setAuthReady(true));
  }, []);

  useEffect(() => {
    if (!me) { setBooks([]); return; }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  async function authedFetch(input: string, init?: RequestInit) {
    const res = await fetch(input, init);
    if (res.status === 401) setMe(null);
    return res;
  }

  async function load() {
    try {
      const res = await authedFetch('/api/books');
      const json = await res.json();
      if (!res.ok) { setBooks([]); return; }
      setBooks(json.books ?? []);
    } catch {}
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
    } catch {}
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
        logWarn('book.record.fail', String(json.error ?? res.status), { isbn });
        feedback(false);
        return;
      }
      const book: Book = json.book;
      setBooks((prev) => {
        const next = prev.filter((b) => b.id !== book.id);
        return [book, ...next].slice(0, 1000);
      });
      const label = book.title ?? book.isbn;
      showToast(`✔ ${label}${book.scan_count > 1 ? ` ×${book.scan_count}` : ''}`);
      logInfo('book.record', label, { isbn, scanCount: book.scan_count, hasMeta: !!book.title });
      feedback(true);
    } catch (e) {
      showToast('네트워크 오류');
      logError('book.record.error', e instanceof Error ? e.message : String(e), { isbn });
      feedback(false);
    } finally {
      inflightRef.current.delete(isbn);
    }
  }, []);

  async function remove(id: number) {
    if (!confirm('삭제할까요? (스캔 이력도 함께 삭제됩니다)')) return;
    const res = await authedFetch(`/api/books/${id}`, { method: 'DELETE' });
    if (res.ok) setBooks((prev) => prev.filter((b) => b.id !== id));
  }

  function exportXlsx() {
    if (!books.length) return;
    // 서버가 Content-Disposition: attachment 로 응답하므로
    // 단순 a.click() 만으로 모바일/데스크톱 모두 표준 다운로드 동작에 맡길 수 있다.
    const a = document.createElement('a');
    a.href = '/api/export/xlsx';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 0);
  }

  async function logout() {
    setActive(false);
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    setMe(null);
  }

  function onAuthed(user: Me) { setMe(user); }

  const totalScans = books.reduce((acc, b) => acc + b.scan_count, 0);

  if (!authReady) {
    return <main className="page"><div className="loading">…</div></main>;
  }

  if (!me) {
    return (
      <main className="page auth-page">
        <header className="header">
          <h1>📚 Book Barcode <small>zbar-wasm · Supabase · Aladin</small></h1>
        </header>
        <AuthForm onAuthed={onAuthed} />
      </main>
    );
  }

  return (
    <main className="page">
      <header className="header">
        <h1>📚 Book Barcode <small>{me.email}</small></h1>
        <div className="header-right">
          <button
            className="badge-btn"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-expanded={sidebarOpen}
          >
            📚 <strong>{books.length}</strong>
          </button>
          <button className="logout" onClick={() => void logout()}>로그아웃</button>
        </div>
      </header>

      <div className="workspace">
        <section className="stage">
          <Scanner active={active} onDetect={handleDetect} />

          <div className="controls">
            <button
              className={'primary ' + (active ? 'stop' : '')}
              onClick={() => setActive((v) => !v)}
            >
              {active ? '■ 스캔 정지' : '▶ 스캔 시작'}
            </button>
          </div>
        </section>

        {/* 목록은 한 벌만 둔다. 데스크톱에서는 오른쪽 고정 열,
            좁은 화면에서는 위로 덮는 패널 — 화면 크기만 CSS 로 가른다. */}
        <aside className={'sidebar' + (sidebarOpen ? ' open' : '')}>
          <div className="sidebar-head">
            <div className="sidebar-tabs">
              <button
                className={'sidebar-tab' + (tab === 'books' ? ' on' : '')}
                onClick={() => setTab('books')}
              >
                📚 도서 <strong>{books.length}</strong>
              </button>
              <button
                className={'sidebar-tab' + (tab === 'logs' ? ' on' : '')}
                onClick={() => setTab('logs')}
              >
                🛠 로그
              </button>
            </div>
            <button
              className="sidebar-close"
              onClick={() => setSidebarOpen(false)}
              aria-label="패널 닫기"
            >
              ✕
            </button>
          </div>

          {tab === 'books' ? (
            <>
              <div className="sidebar-sub">
                <span>담긴 도서 <strong>{books.length}</strong></span>
                <span className="muted">총 스캔 <strong>{totalScans}</strong>회</span>
              </div>
              <div className="toolbar">
                <button onClick={exportXlsx} disabled={!books.length}>⬇ XLSX</button>
                <button onClick={() => void load()}>↻ 새로고침</button>
              </div>
              {!books.length && (
                <div className="empty">아직 담긴 책이 없습니다.<br />바코드를 비추면 여기에 쌓입니다.</div>
              )}
              <ul className="cards">
                {books.map((b) => <BookCard key={b.id} b={b} onRemove={() => void remove(b.id)} />)}
              </ul>
            </>
          ) : (
            <LogPanel />
          )}
        </aside>
      </div>

      {sidebarOpen && (
        <button className="sidebar-scrim" aria-label="목록 닫기" onClick={() => setSidebarOpen(false)} />
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function BookCard({ b, onRemove }: { b: Book; onRemove: () => void }) {
  const hasCover = !!b.cover_url;
  return (
    <li className={'book-card' + (hasCover ? '' : ' no-cover')}>
      {hasCover && (
        <div className="cover">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={b.cover_url!} alt="" loading="lazy" referrerPolicy="no-referrer" />
        </div>
      )}
      <div className="body">
        <div className="title-row">
          <h3 className="title">{b.title ?? '(메타 없음)'}</h3>
          {b.scan_count > 1 && <span className="scan-count">×{b.scan_count}</span>}
          <button className="del" onClick={onRemove} aria-label="삭제">✕</button>
        </div>
        {(b.author || b.translator || b.publisher) && (
          <div className="meta">
            {b.author && <span>{b.author}</span>}
            {b.translator && <span>· {b.translator} 옮김</span>}
            {b.publisher && <span>· {b.publisher}</span>}
          </div>
        )}
        {/* 순서는 엑셀 열 순서와 맞춘다 — 두 곳이 다르면 대조할 때마다 헷갈린다. */}
        <div className="prices">
          {b.price_standard != null && <Price label="정가"      value={wonFmt(b.price_standard)} />}
          {b.used_price     != null && <Price label="중고가"    value={wonFmt(b.used_price)}     used />}
          {b.used_min_price != null && <Price label="중고최저"  value={wonFmt(b.used_min_price)} used />}
          {b.used_count     != null && <Price label="중고수량"  value={`${b.used_count.toLocaleString('ko-KR')}권`} used />}
          {b.price_sales    != null && <Price label="판매가"    value={wonFmt(b.price_sales)} />}
        </div>
        <div className="card-footer">
          <span className="isbn">{b.isbn}</span>
          <span className="time">{new Date(b.last_scanned_at).toLocaleString('ko-KR')}</span>
        </div>
      </div>
    </li>
  );
}

function Price({ label, value, used }: { label: string; value: string; used?: boolean }) {
  return (
    <span className={'price' + (used ? ' used' : '')}>
      <span className="price-label">{label}</span>
      <span className="price-value">{value}</span>
    </span>
  );
}
