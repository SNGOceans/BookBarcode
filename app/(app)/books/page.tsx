'use client';

/**
 * 담긴 도서.
 *
 * 서브탭으로 전체 / 확인됨 / 확인안됨을 갈라 본다.
 * 두 무리는 할 일이 다르다 — 앞은 그대로 쓰면 되고, 뒤는 손이 가야 한다.
 *
 * 분류는 `lib/book-meta` 의 함수를 쓴다. 엑셀 탭도 같은 함수를 쓰므로
 * 화면과 파일이 서로 다른 말을 하지 않는다.
 *
 * 마크업은 **한 벌**이다. 넓은 화면에서는 표, 좁은 화면에서는 카드로 보인다 —
 * CSS 가 가른다. 두 벌로 두면 한쪽만 고쳐지는 순간부터 조용히 갈라진다.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from '@/components/Icon';
import { useApp, type Book } from '@/components/AppShell';
import { isFound, lookupState } from '@/lib/book-meta';
import { formatDateTime } from '@/lib/datetime';

/** 값이 없으면 줄표를 흐리게 둔다. 값과 같은 색이면 「0원」처럼 읽힌다. */
function Won({ n }: { n: number | null | undefined }) {
  if (n == null) return <span className="none">—</span>;
  return <>{n.toLocaleString('ko-KR')}</>;
}

type Filter = 'all' | 'found' | 'missing';

export default function BooksPage() {
  const { books, reloadBooks, dropBook, authedFetch } = useApp();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');

  const { found, missing } = useMemo(() => ({
    found:   books.filter(isFound),
    missing: books.filter((b) => !isFound(b)),
  }), [books]);

  const rows = filter === 'found' ? found : filter === 'missing' ? missing : books;

  async function remove(b: Book) {
    if (!confirm(`${b.title ?? b.isbn}를 목록에서 지울까요?\n스캔 이력도 함께 삭제됩니다.`)) return;
    const res = await authedFetch(`/api/books/${b.id}`, { method: 'DELETE' });
    if (res.ok) dropBook(b.id);
  }

  const TABS: { key: Filter; label: string; n: number; tone?: 'warn' }[] = [
    { key: 'all',     label: '전체',      n: books.length },
    { key: 'found',   label: '확인됨',    n: found.length },
    { key: 'missing', label: '확인 안 됨', n: missing.length, tone: 'warn' },
  ];

  return (
    <div className="pane">
      <div className="subtabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={filter === t.key}
            className={'subtab' + (filter === t.key ? ' on' : '')}
            onClick={() => setFilter(t.key)}
          >
            {t.label}
            <span className={'subtab-count' + (t.tone === 'warn' && t.n > 0 ? ' warn' : '')}>{t.n}</span>
          </button>
        ))}
      </div>

      <div className="pane-actions">
        <a className="btn-line grow" href="/api/export/xlsx">
          <Icon name="download" size={16} /> 엑셀로 내보내기
        </a>
        <button type="button" className="btn-line" onClick={() => void reloadBooks()} aria-label="새로고침">
          <Icon name="refresh" size={16} />
        </button>
      </div>

      {filter === 'missing' && missing.length > 0 && (
        <p className="tbl-note">
          「못 찾음」은 알라딘에 자료가 없는 경우고, 「미조회」는 아직 물어보지 않은 경우입니다.
        </p>
      )}

      {!rows.length ? (
        <div className="empty">
          <Icon name="search" size={22} />
          <p>
            {books.length === 0
              ? <>아직 담긴 책이 없습니다.<br />스캔 화면에서 바코드를 비추면 여기에 쌓입니다.</>
              : '이 조건에 해당하는 책이 없습니다.'}
          </p>
        </div>
      ) : (
        <div className="pane-scroll">
          <table className="dtable">
            <thead>
              <tr>
                <th className="c-title">제목</th>
                <th className="c-state">상태</th>
                <th>저자 · 출판사</th>
                <th className="num">정가</th>
                <th className="num">중고가</th>
                <th className="num">스캔</th>
                <th className="c-when">최근</th>
                <th className="c-act" aria-label="동작" />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const state = lookupState(b);
                const ok = state === '찾음';
                return (
                  <tr key={b.id} className={ok ? '' : 'row-untitled'}>
                    <td className="c-title" data-label="제목">
                      <span className="cell-title">{b.title ?? '제목 미확인'}</span>
                      <span className="cell-isbn mono">{b.isbn}</span>
                    </td>
                    <td className="c-state" data-label="상태">
                      <span className={'state ' + (ok ? 'ok' : state === '못 찾음' ? 'bad' : 'wait')}>
                        {ok ? '확인됨' : state}
                      </span>
                    </td>
                    <td className="dim" data-label="저자 · 출판사">
                      {[b.author, b.publisher].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="num" data-label="정가"><Won n={b.price_standard} /></td>
                    <td className="num used" data-label="중고가"><Won n={b.used_price ?? b.used_min_price} /></td>
                    <td className="num" data-label="스캔">{b.scan_count}</td>
                    <td className="c-when dim" data-label="최근">{formatDateTime(b.last_scanned_at)}</td>
                    <td className="c-act">
                      <div className="row-actions">
                        <button
                          type="button" className="book-stock" aria-label="재고 잡기"
                          onClick={() => router.push(`/inventory?isbn=${encodeURIComponent(b.isbn)}`)}
                        >
                          <Icon name="book" size={15} />
                        </button>
                        <button
                          type="button" className="book-del" aria-label="목록에서 지우기"
                          onClick={() => void remove(b)}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
