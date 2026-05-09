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
  title:          string | null;
  author:         string | null;
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

export default function HomePage() {
  const [me, setMe]               = useState<Me | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [books, setBooks]         = useState<Book[]>([]);
  const [active, setActive]       = useState(false);
  const [toast, setToast]         = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const inflightRef               = useRef<Set<string>>(new Set());

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
      feedback(true);
    } catch {
      showToast('네트워크 오류');
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

  async function exportXlsx() {
    if (!books.length || exporting) return;
    setExporting(true);
    try {
      // dynamic import 로 메인 번들에서 떼어내기 (첫 클릭 시에만 로드)
      const writeXlsxFile = (await import('write-excel-file')).default;

      const rows = books.slice().reverse().map((b, i) => ({
        no:               i + 1,
        isbn:             b.isbn,
        title:            b.title          ?? '',
        author:           b.author         ?? '',
        publisher:        b.publisher      ?? '',
        price_standard:   b.price_standard ?? null,
        price_sales:      b.price_sales    ?? null,
        used_price:       b.used_price     ?? null,
        used_min_price:   b.used_min_price ?? null,
        used_count:       b.used_count     ?? null,
        scan_count:       b.scan_count,
        first_scanned_at: b.first_scanned_at ? new Date(b.first_scanned_at) : null,
        last_scanned_at:  b.last_scanned_at  ? new Date(b.last_scanned_at)  : null,
      }));

      type Row = typeof rows[number];
      const schema: any[] = [
        { column: 'No',         type: Number, value: (r: Row) => r.no,             width:  5,  align: 'right' },
        { column: 'ISBN',       type: String, value: (r: Row) => r.isbn,           width: 16 },
        { column: '도서명',      type: String, value: (r: Row) => r.title,          width: 36 },
        { column: '저자',        type: String, value: (r: Row) => r.author,         width: 22 },
        { column: '출판사',      type: String, value: (r: Row) => r.publisher,      width: 14 },
        { column: '정가',        type: Number, value: (r: Row) => r.price_standard, width: 10, format: '#,##0' },
        { column: '판매가',      type: Number, value: (r: Row) => r.price_sales,    width: 10, format: '#,##0' },
        { column: '중고가',      type: Number, value: (r: Row) => r.used_price,     width: 10, format: '#,##0' },
        { column: '중고최저가',  type: Number, value: (r: Row) => r.used_min_price, width: 12, format: '#,##0' },
        { column: '중고수량',    type: Number, value: (r: Row) => r.used_count,     width: 10, format: '#,##0' },
        { column: '스캔횟수',    type: Number, value: (r: Row) => r.scan_count,     width: 10, format: '#,##0' },
        { column: '최초스캔',    type: Date,   value: (r: Row) => r.first_scanned_at, width: 22, format: 'yyyy-mm-dd hh:mm:ss' },
        { column: '최근스캔',    type: Date,   value: (r: Row) => r.last_scanned_at,  width: 22, format: 'yyyy-mm-dd hh:mm:ss' },
      ];

      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      await writeXlsxFile(rows, {
        schema,
        fileName: `books-${stamp}.xlsx`,
        sheet: '도서 목록',
      });
    } catch (e: any) {
      showToast(`내보내기 실패: ${e?.message ?? e}`);
    } finally {
      setExporting(false);
    }
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
          <span className="badge">{books.length}</span>
          <button className="logout" onClick={() => void logout()}>로그아웃</button>
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
        <button onClick={() => void exportXlsx()} disabled={exporting || !books.length}>
          {exporting ? '내보내는 중…' : '⬇ XLSX'}
        </button>
        <button onClick={() => void load()}>↻ 새로고침</button>
      </div>

      <section className="list">
        <div className="list-header">
          <span>스캔된 도서 <strong>{books.length}</strong></span>
          <span>총 스캔 <strong>{totalScans}</strong>회</span>
        </div>
        {!books.length && <div className="empty">아직 스캔된 바코드가 없습니다.</div>}
        <ul>
          {books.map((b) => <BookCard key={b.id} b={b} onRemove={() => void remove(b.id)} />)}
        </ul>
      </section>

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
        {(b.author || b.publisher) && (
          <div className="meta">
            {b.author && <span>{b.author}</span>}
            {b.publisher && <span>· {b.publisher}</span>}
          </div>
        )}
        <div className="prices">
          {b.price_standard != null && <Price label="정가"      value={wonFmt(b.price_standard)} />}
          {b.price_sales    != null && <Price label="판매가"    value={wonFmt(b.price_sales)} />}
          {b.used_price     != null && <Price label="중고가"    value={wonFmt(b.used_price)}     used />}
          {b.used_min_price != null && <Price label="중고최저"  value={wonFmt(b.used_min_price)} used />}
          {b.used_count     != null && <Price label="중고수량"  value={`${b.used_count.toLocaleString('ko-KR')}권`} used />}
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
