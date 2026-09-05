'use client';

/**
 * 도서 상세 시트.
 *
 * 목록은 훑는 곳이라 한 줄에 담을 수 있는 것만 담는다. 나머지는 여기서 본다 —
 * 큰 표지, 부제까지 나온 제목, 값 전부, 스캔 이력.
 *
 * 페이지가 아니라 덮개로 둔 이유 — 목록의 스크롤 위치와 서브탭 선택을 잃지 않기 위해서다.
 * 대신 **뒤로 가기로 닫히게** 히스토리에 한 칸을 넣는다. 안드로이드에서 덮개가
 * 뒤로 가기를 안 먹으면 목록째로 화면을 빠져나간다.
 */

import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import type { Book } from '@/components/AppShell';
import { lookupState } from '@/lib/book-meta';
import { formatDateTime } from '@/lib/datetime';

type Props = {
  book: Book;
  onClose: () => void;
  onStock: (b: Book) => void;
  onRemove: (b: Book) => void;
};

/**
 * 알라딘 표지 주소는 크기별 마디를 가진다(coversum · cover150 · cover200 …).
 * 큰 것을 먼저 받아 보고, 없으면 원래 주소로 돌아간다 —
 * 남의 주소 규칙이라 **맞는다고 가정하지 않는다**.
 */
function bigCover(url: string): string | null {
  const big = url.replace(/\/cover(?:sum|\d+)\//, '/cover500/');
  return big === url ? null : big;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="sheet-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Won({ n }: { n: number | null }) {
  if (n == null) return <span className="none">—</span>;
  return <>{n.toLocaleString('ko-KR')}<small>원</small></>;
}

export default function BookSheet({ book, onClose, onStock, onRemove }: Props) {
  const [zoom, setZoom]   = useState(false);
  const [src, setSrc]     = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // 큰 표지를 먼저 시도한다. 실패하면 onError 가 원래 주소로 되돌린다.
  useEffect(() => {
    setSrc(book.cover_url ? (bigCover(book.cover_url) ?? book.cover_url) : null);
  }, [book.cover_url]);

  // 확대가 열려 있으면 확대만 닫는다. 한 번에 둘 다 닫히면 되돌아갈 곳이 사라진다.
  const back = useCallback(() => {
    if (zoom) setZoom(false); else onClose();
  }, [zoom, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') back(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [back]);

  // 뒤로 가기용 한 칸. 우리가 닫을 때는 그 칸을 되감아 히스토리에 찌꺼기를 남기지 않는다.
  useEffect(() => {
    history.pushState({ sheet: true }, '');
    const onPop = () => onClose();
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (history.state?.sheet) history.back();
    };
  }, [onClose]);

  // 시트가 떠 있는 동안 뒤 목록이 같이 굴러다니면 어디를 만지는지 알 수 없다.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const state = lookupState(book);
  const ok = state === '찾음';

  async function copyIsbn() {
    try {
      await navigator.clipboard.writeText(book.isbn);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* 권한이 없으면 조용히 넘어간다 — 값은 화면에 그대로 보인다 */ }
  }

  return (
    <div className="sheet-scrim" onClick={back} role="presentation">
      <div
        className="sheet"
        role="dialog" aria-modal="true" aria-label={book.title ?? book.isbn}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <button type="button" className="sheet-close" onClick={onClose} aria-label="닫기">
          <Icon name="close" size={18} />
        </button>

        <div className="sheet-head">
          <button
            type="button" className="sheet-cover"
            onClick={() => src && setZoom(true)}
            aria-label={src ? '표지 크게 보기' : '표지 없음'}
            disabled={!src}
          >
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src} alt="" referrerPolicy="no-referrer"
                onError={() => setSrc(book.cover_url)}
              />
            ) : (
              <span className="sheet-cover-none">표지 없음</span>
            )}
            {src && <span className="sheet-zoom"><Icon name="zoom" size={14} /></span>}
          </button>

          <div className="sheet-title">
            <span className={'state ' + (ok ? 'ok' : state === '못 찾음' ? 'bad' : 'wait')}>
              {ok ? '확인됨' : state}
            </span>
            <h2>{book.title ?? '제목 미확인'}</h2>
            {book.author && <p className="sheet-by">{book.author}</p>}
            {book.translator && <p className="sheet-by">{book.translator} 옮김</p>}
            {book.publisher && <p className="sheet-pub">{book.publisher}</p>}
          </div>
        </div>

        <dl className="sheet-list">
          <Row label="ISBN">
            <button type="button" className="isbn-copy mono" onClick={() => void copyIsbn()}>
              {book.isbn}
              <Icon name={copied ? 'check' : 'copy'} size={13} />
            </button>
          </Row>
          <Row label="정가"><Won n={book.price_standard} /></Row>
          <Row label="판매가"><Won n={book.price_sales} /></Row>
          <Row label="중고가"><span className="used"><Won n={book.used_price} /></span></Row>
          <Row label="중고 최저가"><span className="used"><Won n={book.used_min_price} /></span></Row>
          <Row label="중고 매물">
            {book.used_count == null ? <span className="none">—</span> : `${book.used_count}건`}
          </Row>
          <Row label="스캔 횟수">{book.scan_count}회</Row>
          <Row label="처음 스캔">{formatDateTime(book.first_scanned_at)}</Row>
          <Row label="최근 스캔">{formatDateTime(book.last_scanned_at)}</Row>
          <Row label="정보 조회">
            {book.meta_fetched_at
              ? formatDateTime(book.meta_fetched_at)
              : <span className="none">조회한 적 없음</span>}
          </Row>
        </dl>

        <div className="sheet-actions">
          <button type="button" className="btn-line grow" onClick={() => onStock(book)}>
            <Icon name="book" size={16} /> 재고 잡기
          </button>
          <button type="button" className="btn-line danger" onClick={() => onRemove(book)}>
            <Icon name="trash" size={16} /> 목록에서 지우기
          </button>
        </div>
      </div>

      {zoom && src && (
        <div className="lightbox" onClick={(e) => { e.stopPropagation(); setZoom(false); }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={book.title ?? book.isbn} referrerPolicy="no-referrer" />
          <p>화면을 누르면 닫힙니다.</p>
        </div>
      )}
    </div>
  );
}
