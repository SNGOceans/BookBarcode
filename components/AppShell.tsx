'use client';

/**
 * 앱 껍데기 — 톱바 + 왼쪽 내비게이션.
 *
 * 사이드바는 탭 전환이 아니라 **실제 경로 이동**이다.
 * 뒤로가기가 동작하고, 주소를 공유할 수 있고, 각 화면이 자기 데이터만 불러온다.
 *
 * 로그인 여부도 여기서 한 번만 판단한다. 화면마다 따로 확인하면
 * 화면 수만큼 깜빡임이 늘고 규칙이 갈린다.
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AuthForm from '@/components/AuthForm';
import Icon, { type IconName } from '@/components/Icon';
import { flush, logInfo, setShipping } from '@/lib/logbus';

export type Me = { id: string; email: string; isAdmin: boolean };

export type Book = {
  id: number;
  isbn: string;
  scan_count: number;
  first_scanned_at: string;
  last_scanned_at: string;
  title: string | null;
  author: string | null;
  translator: string | null;
  publisher: string | null;
  cover_url: string | null;
  price_standard: number | null;
  price_sales: number | null;
  used_price: number | null;
  used_min_price: number | null;
  used_count: number | null;
  meta_fetched_at: string | null;
};

type AppState = {
  me: Me;
  books: Book[];
  reloadBooks: () => Promise<void>;
  upsertBook: (b: Book) => void;
  dropBook: (id: number) => void;
  authedFetch: (input: string, init?: RequestInit) => Promise<Response>;
  toast: (msg: string) => void;
};

const Ctx = createContext<AppState | null>(null);

/** 화면 어디서나 로그인 사용자와 도서 목록을 꺼내 쓴다. */
export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppShell 안에서만 쓸 수 있습니다');
  return v;
}

type NavItem = { href: string; label: string; icon: IconName; adminOnly?: boolean };

const NAV: NavItem[] = [
  { href: '/',          label: '스캔',      icon: 'search' },
  { href: '/books',     label: '담긴 도서', icon: 'list' },
  { href: '/inventory', label: '재고',      icon: 'book' },
  { href: '/sales',     label: '판매',      icon: 'cart' },
  { href: '/logs',      label: '로그',      icon: 'terminal' },
  { href: '/admin',     label: '관리자',    icon: 'shield', adminOnly: true },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [books, setBooks] = useState<Book[]>([]);
  const [navOpen, setNavOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((j) => setMe(j.user ?? null))
      .catch(() => setMe(null))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    setShipping(!!me);
    if (!me) return;
    logInfo('session.start', '로그인 세션 시작', { email: me.email, admin: me.isAdmin });
    const onHide = () => { void flush(); };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      void flush();
    };
  }, [me]);

  const authedFetch = useCallback(async (input: string, init?: RequestInit) => {
    const res = await fetch(input, init);
    if (res.status === 401) setMe(null);
    return res;
  }, []);

  const reloadBooks = useCallback(async () => {
    try {
      const res = await authedFetch('/api/books');
      const json = await res.json();
      setBooks(res.ok ? (json.books ?? []) : []);
    } catch { /* 화면은 이전 목록을 그대로 둔다 */ }
  }, [authedFetch]);

  useEffect(() => {
    if (!me) { setBooks([]); return; }
    void reloadBooks();
  }, [me, reloadBooks]);

  // 경로가 바뀌면 좁은 화면의 내비게이션은 닫는다. 열린 채로 남으면 화면을 가린다.
  useEffect(() => { setNavOpen(false); }, [pathname]);

  const toast = useCallback((m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 1600);
  }, []);

  const upsertBook = useCallback((b: Book) => {
    setBooks((prev) => [b, ...prev.filter((x) => x.id !== b.id)].slice(0, 1000));
  }, []);
  const dropBook = useCallback((id: number) => {
    setBooks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  async function logout() {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch {}
    setMe(null);
  }

  if (!ready) return <main className="boot"><span /></main>;
  if (!me) return <main className="page auth-page"><AuthForm onAuthed={(u) => setMe({ ...u, isAdmin: false })} /></main>;

  const nav = NAV.filter((n) => !n.adminOnly || me.isAdmin);
  const current = nav.find((n) => n.href === pathname);
  const totalScans = books.reduce((a, b) => a + b.scan_count, 0);

  return (
    <div className="page">
      <header className="topbar">
        {/* 아이콘이 「지금 누르면 어떻게 되는지」를 말해야 한다.
            방향이 고정이면 접힌 건지 펼친 건지 알 수 없다. */}
        <button
          type="button"
          className="icon-btn topbar-toggle"
          onClick={() => setNavOpen((v) => !v)}
          aria-label={navOpen ? '메뉴 접기' : '메뉴 펼치기'}
          aria-expanded={navOpen}
        >
          <Icon name={navOpen ? 'panel-close' : 'panel-open'} />
        </button>

        <div className="brand">
          <Icon name="book" size={18} />
          <span className="brand-name">{current?.label ?? 'Book Barcode'}</span>
        </div>

        <div className="topbar-right">
          <span className="stat" title="담긴 도서"><strong>{books.length}</strong><span className="stat-unit">권</span></span>
          <span className="stat dim" title="총 스캔"><strong>{totalScans}</strong><span className="stat-unit">회</span></span>
          <button type="button" className="icon-btn" onClick={() => void logout()} aria-label="로그아웃">
            <Icon name="logout" />
          </button>
        </div>
      </header>

      <div className={'workspace' + (navOpen ? ' nav-open' : '')}>
        <nav className="sidenav" aria-label="주요 메뉴">
          <ul>
            {nav.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  className={'navlink' + (pathname === n.href ? ' on' : '')}
                  aria-current={pathname === n.href ? 'page' : undefined}
                >
                  <Icon name={n.icon} />
                  <span className="navlink-text">{n.label}</span>
                  {n.href === '/books' && books.length > 0 && (
                    <span className="navlink-count">{books.length}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>

          <div className="sidenav-foot">
            <Link href="/scan-lab" className="navlink small">
              <Icon name="alert" size={16} />
              <span className="navlink-text">스캔 진단</span>
            </Link>
            <div className="sidenav-account">
              <span className="sidenav-email" title={me.email}>{me.email}</span>
              {me.isAdmin && <span className="badge-admin">관리자</span>}
            </div>
          </div>
        </nav>

        {navOpen && (
          <button type="button" className="nav-scrim" aria-label="메뉴 닫기" onClick={() => setNavOpen(false)} />
        )}

        <main className="content">
          <Ctx.Provider value={{ me, books, reloadBooks, upsertBook, dropBook, authedFetch, toast }}>
            {children}
          </Ctx.Provider>
        </main>
      </div>

      {msg && (
        <div className="toast" role="status">
          <Icon name="check" size={16} />
          <span>{msg}</span>
        </div>
      )}
    </div>
  );
}
