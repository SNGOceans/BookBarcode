'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import AuthForm from '@/components/AuthForm';
import LogPanel from '@/components/LogPanel';
import InventoryPanel from '@/components/InventoryPanel';
import Icon from '@/components/Icon';
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

const won = (n: number) => n.toLocaleString('ko-KR');

export default function HomePage() {
  const [me, setMe]               = useState<Me | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [books, setBooks]         = useState<Book[]>([]);
  const [active, setActive]       = useState(false);
  const [toast, setToast]         = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [tab, setTab]             = useState<'books' | 'inventory' | 'logs'>('books');
  const [focusIsbn, setFocusIsbn] = useState<string | null>(null);
  const inflightRef               = useRef<Set<string>>(new Set());

  // 로그인 상태에서만 로그를 서버로 보낸다. 보낼 주인이 없으면 쌓아 둘 이유가 없다.
  useEffect(() => {
    setShipping(!!me);
    if (!me) return;
    logInfo('session.start', '로그인 세션 시작', { email: me.email });
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
      showToast(`${book.title ?? book.isbn}${book.scan_count > 1 ? ` ×${book.scan_count}` : ''}`);
      logInfo('book.record', book.title ?? book.isbn, { isbn, scanCount: book.scan_count });
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
    if (!confirm('목록에서 지울까요? 스캔 이력도 함께 삭제됩니다.')) return;
    const res = await authedFetch(`/api/books/${id}`, { method: 'DELETE' });
    if (res.ok) setBooks((prev) => prev.filter((b) => b.id !== id));
  }

  function exportXlsx() {
    if (!books.length) return;
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

  // 스캔을 시작하면 패널을 접는다.
  // 찍는 동안에는 카메라가 화면을 다 써야 하고, 목록은 그때 볼 것이 아니다.
  useEffect(() => {
    if (active) setPanelOpen(false);
  }, [active]);

  const totalScans = books.reduce((acc, b) => acc + b.scan_count, 0);
  const latest = books[0];

  if (!authReady) return <main className="boot"><span /></main>;

  if (!me) {
    return (
      <main className="page auth-page">
        <AuthForm onAuthed={(u) => setMe(u)} />
      </main>
    );
  }

  return (
    <main className="page">
      <header className="topbar">
        <button
          type="button"
          className="icon-btn topbar-toggle"
          onClick={() => setPanelOpen((v) => !v)}
          aria-label={panelOpen ? '목록 접기' : '목록 펼치기'}
          aria-expanded={panelOpen}
        >
          <Icon name="list" />
        </button>

        <div className="brand">
          <Icon name="book" size={18} />
          <span className="brand-name">Book Barcode</span>
        </div>

        <div className="topbar-right">
          <span className="stat" title="담긴 도서">
            <strong>{books.length}</strong><span className="stat-unit">권</span>
          </span>
          <span className="stat dim" title="총 스캔 횟수">
            <strong>{totalScans}</strong><span className="stat-unit">회</span>
          </span>
          <button type="button" className="icon-btn" onClick={() => void logout()} aria-label="로그아웃">
            <Icon name="logout" />
          </button>
        </div>
      </header>

      <div className={'workspace' + (panelOpen ? ' panel-open' : '')}>
        {/* 왼쪽 패널 — 접으면 아이콘 레일, 펼치면 목록 */}
        <aside className="panel" aria-label="담긴 도서와 로그">
          <nav className="panel-tabs">
            <button
              type="button"
              className={'panel-tab' + (tab === 'books' ? ' on' : '')}
              onClick={() => { setTab('books'); setPanelOpen(true); }}
              aria-label="담긴 도서"
            >
              <Icon name="list" />
              <span className="panel-tab-text">담긴 도서</span>
              <span className="panel-tab-count">{books.length}</span>
            </button>
            <button
              type="button"
              className={'panel-tab' + (tab === 'inventory' ? ' on' : '')}
              onClick={() => { setTab('inventory'); setPanelOpen(true); }}
              aria-label="재고"
            >
              <Icon name="book" />
              <span className="panel-tab-text">재고</span>
            </button>
            <button
              type="button"
              className={'panel-tab' + (tab === 'logs' ? ' on' : '')}
              onClick={() => { setTab('logs'); setPanelOpen(true); }}
              aria-label="로그"
            >
              <Icon name="terminal" />
              <span className="panel-tab-text">로그</span>
            </button>
            <button
              type="button"
              className="icon-btn panel-collapse"
              onClick={() => setPanelOpen(false)}
              aria-label="패널 접기"
            >
              <Icon name="close" />
            </button>
          </nav>

          <div className="panel-body">
            {tab === 'books' ? (
              <>
                <div className="panel-actions">
                  <button type="button" onClick={exportXlsx} disabled={!books.length}>
                    <Icon name="download" size={16} /> 엑셀로 내보내기
                  </button>
                  <button type="button" className="icon-btn" onClick={() => void load()} aria-label="새로고침">
                    <Icon name="refresh" size={16} />
                  </button>
                </div>

                {!books.length ? (
                  <div className="empty">
                    <Icon name="search" size={22} />
                    <p>아직 담긴 책이 없습니다.<br />바코드를 비추면 여기에 쌓입니다.</p>
                  </div>
                ) : (
                  <ul className="booklist">
                    {books.map((b) => (
                      <BookRow
                        key={b.id}
                        b={b}
                        onRemove={() => void remove(b.id)}
                        onStock={() => { setFocusIsbn(b.isbn); setTab('inventory'); }}
                      />
                    ))}
                  </ul>
                )}
              </>
            ) : tab === 'inventory' ? (
              <InventoryPanel focusIsbn={focusIsbn} onConsumedFocus={() => setFocusIsbn(null)} />
            ) : (
              <LogPanel />
            )}
          </div>

          {/* 메뉴 — 자주 쓰지 않지만 어딘가엔 있어야 하는 것들 */}
          <div className="panel-menu">
            <a className="menu-item" href="/scan-lab">
              <Icon name="alert" size={16} />
              <span className="menu-text">스캔 진단</span>
            </a>
            <button type="button" className="menu-item" onClick={() => void load()}>
              <Icon name="sync" size={16} />
              <span className="menu-text">목록 다시 불러오기</span>
            </button>
            <div className="menu-account">
              <span className="menu-email" title={me.email}>{me.email}</span>
              <button type="button" className="icon-btn" onClick={() => void logout()} aria-label="로그아웃">
                <Icon name="logout" size={16} />
              </button>
            </div>
          </div>
        </aside>

        {panelOpen && (
          <button
            type="button"
            className="panel-scrim"
            aria-label="패널 닫기"
            onClick={() => setPanelOpen(false)}
          />
        )}

        <section className="stage">
          <Scanner active={active} onDetect={handleDetect} />

          {/* 카메라 아래 빈 곳에 방금 담긴 책을 둔다. 찍자마자 무엇이 들어갔는지 보인다. */}
          <div className="recent">
            {latest ? (
              <button type="button" className="recent-row" onClick={() => { setTab('books'); setPanelOpen(true); }}>
                <span className="recent-label">방금 담김</span>
                <span className="recent-title">{latest.title ?? latest.isbn}</span>
                {latest.scan_count > 1 && <span className="count-pill">×{latest.scan_count}</span>}
                <Icon name="chevron-right" size={16} />
              </button>
            ) : (
              <p className="recent-hint">바코드를 붉은 선에 맞춰 주세요.</p>
            )}
          </div>

          <div className="actionbar">
            <button
              type="button"
              className={'primary' + (active ? ' stop' : '')}
              onClick={() => setActive((v) => !v)}
            >
              <Icon name={active ? 'stop' : 'play'} size={16} />
              {active ? '스캔 정지' : '스캔 시작'}
            </button>
          </div>
        </section>
      </div>

      {toast && (
        <div className="toast" role="status">
          <Icon name="check" size={16} />
          <span>{toast}</span>
        </div>
      )}
    </main>
  );
}

/**
 * 목록 한 줄.
 *
 * 카드가 아니라 행이다 — 한 화면에 많이 보이는 것이 이 화면의 목적이다.
 * 표지가 없으면 ISBN 끝자리를 자리표시로 쓴다. 빈 사각형보다 구분이 쉽다.
 */
function BookRow({ b, onRemove, onStock }: { b: Book; onRemove: () => void; onStock: () => void }) {
  const price = b.price_standard;
  const used  = b.used_price ?? b.used_min_price;
  const untitled = !b.title;

  return (
    <li className={'book-row' + (untitled ? ' untitled' : '')}>
      <div className="book-thumb" aria-hidden="true">
        {b.cover_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={b.cover_url} alt="" loading="lazy" referrerPolicy="no-referrer" />
          : <span>{b.isbn.slice(-3)}</span>}
      </div>

      <div className="book-main">
        <div className="book-line">
          <span className="book-title">{b.title ?? '제목 미확인'}</span>
          {b.scan_count > 1 && <span className="count-pill">×{b.scan_count}</span>}
        </div>
        <div className="book-sub">
          {b.author ? <span>{b.author}</span> : <span className="dim">{b.isbn}</span>}
          {b.publisher && <span className="dim">{b.publisher}</span>}
        </div>
        {(price != null || used != null) && (
          <div className="book-price">
            {price != null && <span>정가 <b>{won(price)}</b></span>}
            {used != null && <span className="used">중고 <b>{won(used)}</b></span>}
            {b.used_count != null && <span className="dim">{b.used_count}건</span>}
          </div>
        )}
      </div>

      <div className="book-actions">
        <button type="button" className="book-stock" onClick={onStock} aria-label="재고 잡기">
          <Icon name="book" size={15} />
        </button>
        <button type="button" className="book-del" onClick={onRemove} aria-label="목록에서 지우기">
          <Icon name="trash" size={15} />
        </button>
      </div>
    </li>
  );
}
