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
      // dynamic import 로 메인 번들에서 떼어내기
      const ExcelJS = (await import('exceljs')).default;

      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('도서 목록', {
        views: [{ state: 'frozen', ySplit: 1 }],
      });

      // reference xlsx 컬럼 순서를 따르되, 권수/부권수는 빼고 ISBN 을 No 다음으로
      ws.columns = [
        { header: '번호',         key: 'no',               width:  6 },
        { header: 'ISBN',         key: 'isbn',             width: 18 },
        { header: '도서 제목',     key: 'title',            width: 40 },
        { header: '저자',          key: 'author',           width: 20 },
        { header: '평역자/옮김',   key: 'translator',       width: 20 },
        { header: '출판사',        key: 'publisher',        width: 18 },
        { header: '정가',          key: 'price_standard',   width: 12 },
        { header: '판매가',        key: 'price_sales',      width: 12 },
        { header: '중고가',        key: 'used_price',       width: 12 },
        { header: '중고최저가',    key: 'used_min_price',   width: 12 },
        { header: '중고수량',      key: 'used_count',       width: 10 },
        { header: '스캔횟수',      key: 'scan_count',       width: 10 },
        { header: '최초스캔',      key: 'first_scanned_at', width: 22 },
        { header: '최근스캔',      key: 'last_scanned_at',  width: 22 },
      ];

      // 헤더 스타일 (reference 모방: 보라 배경, 흰 글자, 굵게, 가운데)
      const header = ws.getRow(1);
      header.height = 30;
      header.font   = { name: '맑은 고딕', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      header.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
      header.alignment = { horizontal: 'center', vertical: 'center' };

      // 데이터 (오래된 것부터 위)
      const ordered = books.slice().reverse();
      ordered.forEach((b, i) => {
        const row = ws.addRow({
          no:               i + 1,
          isbn:             b.isbn,
          title:            b.title          ?? '',
          author:           b.author         ?? '',
          translator:       b.translator     ?? '',
          publisher:        b.publisher      ?? '',
          price_standard:   b.price_standard,
          price_sales:      b.price_sales,
          used_price:       b.used_price,
          used_min_price:   b.used_min_price,
          used_count:       b.used_count,
          scan_count:       b.scan_count,
          first_scanned_at: b.first_scanned_at ? new Date(b.first_scanned_at) : null,
          last_scanned_at:  b.last_scanned_at  ? new Date(b.last_scanned_at)  : null,
        });
        row.height    = 25;
        row.font      = { name: '맑은 고딕', size: 10 };
        row.alignment = { vertical: 'center', wrapText: true };
        row.getCell('no').alignment = { horizontal: 'center', vertical: 'center' };

        // 가격 천단위 콤마
        for (const k of ['price_standard', 'price_sales', 'used_price', 'used_min_price', 'used_count', 'scan_count']) {
          const cell = row.getCell(k);
          if (typeof cell.value === 'number') cell.numFmt = '#,##0';
        }
        // 시각 포맷
        for (const k of ['first_scanned_at', 'last_scanned_at']) {
          const cell = row.getCell(k);
          if (cell.value instanceof Date) cell.numFmt = 'yyyy-mm-dd hh:mm:ss';
        }

        // 가격 누락이면 핑크, 그 외 짝수 행은 옅은 보라
        const hasPrice = b.price_standard != null || b.price_sales != null;
        const fillArgb = !hasPrice ? 'FFFFB6C1' : ((i + 1) % 2 === 0 ? 'FFF3F0FF' : null);
        if (fillArgb) {
          row.eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
          });
        }
      });

      // 모든 셀 thin border
      const lastCol = ws.columnCount;
      const lastRow = ws.rowCount;
      for (let r = 1; r <= lastRow; r++) {
        const row = ws.getRow(r);
        for (let c = 1; c <= lastCol; c++) {
          row.getCell(c).border = {
            top:    { style: 'thin', color: { argb: 'FFD0D0D0' } },
            left:   { style: 'thin', color: { argb: 'FFD0D0D0' } },
            bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
            right:  { style: 'thin', color: { argb: 'FFD0D0D0' } },
          };
        }
      }
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: lastRow, column: lastCol } };

      // 다운로드
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const filename = `도서목록_${stampNow()}.xlsx`;
      const file = new File([blob], filename, { type: blob.type });

      // iOS Safari 같은 모바일 환경에서는 a[download] 만으로 다운로드가
      // 막히는 경우가 있어, Web Share API 가 가능하면 OS 공유/저장 시트로 우회.
      const nav: any = typeof navigator !== 'undefined' ? navigator : null;
      if (nav?.canShare && nav.canShare({ files: [file] })) {
        try {
          await nav.share({ files: [file], title: filename });
          return;
        } catch (e: any) {
          if (e?.name === 'AbortError') return;
          // 그 외 share 실패 → 아래 a.download 폴백으로
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 0);
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
        {(b.author || b.translator || b.publisher) && (
          <div className="meta">
            {b.author && <span>{b.author}</span>}
            {b.translator && <span>· {b.translator} 옮김</span>}
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
