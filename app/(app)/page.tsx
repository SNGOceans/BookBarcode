'use client';

/** 스캔 화면 — 이 앱의 첫 화면. 카메라가 자리를 다 쓴다. */

import { useCallback, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import Icon from '@/components/Icon';
import { useApp, type Book } from '@/components/AppShell';
import { logError, logInfo, logWarn } from '@/lib/logbus';

const Scanner = dynamic(() => import('@/components/Scanner'), { ssr: false });

export default function ScanPage() {
  const { books, upsertBook, authedFetch, toast } = useApp();
  const [active, setActive] = useState(false);
  const inflight = useRef<Set<string>>(new Set());

  const latest = books[0];

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
    if (inflight.current.has(isbn)) return;
    inflight.current.add(isbn);
    try {
      const res = await authedFetch('/api/books', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbn }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast(`실패: ${json.error ?? res.status}`);
        logWarn('book.record.fail', String(json.error ?? res.status), { isbn });
        feedback(false);
        return;
      }
      const book: Book = json.book;
      upsertBook(book);
      toast(`${book.title ?? book.isbn}${book.scan_count > 1 ? ` ×${book.scan_count}` : ''}`);
      logInfo('book.record', book.title ?? book.isbn, { isbn, scanCount: book.scan_count });
      feedback(true);
    } catch (e) {
      toast('네트워크 오류');
      logError('book.record.error', e instanceof Error ? e.message : String(e), { isbn });
      feedback(false);
    } finally {
      inflight.current.delete(isbn);
    }
  }, [authedFetch, upsertBook, toast]);

  return (
    <div className="stage">
      <Scanner active={active} onDetect={handleDetect} />

      {/* 카메라 아래 빈 곳에 방금 담긴 책을 둔다. 찍자마자 무엇이 들어갔는지 보인다.
          표지까지 보여야 「맞게 찍혔나」를 제목을 읽지 않고도 안다. */}
      <div className="recent">
        {latest ? (
          <Link href="/books" className="recent-row">
            <span className="thumb" aria-hidden="true">
              {latest.cover_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={latest.cover_url} alt="" referrerPolicy="no-referrer" />
                : <span>{latest.isbn.slice(-3)}</span>}
            </span>
            <span className="recent-main">
              <span className="recent-head">
                <span className="recent-label">방금 담김</span>
                <span className="recent-title">{latest.title ?? latest.isbn}</span>
                {latest.scan_count > 1 && <span className="count-pill">×{latest.scan_count}</span>}
              </span>
              <span className="recent-sub">
                {[latest.author, latest.publisher].filter(Boolean).join(' · ') || latest.isbn}
              </span>
              <span className="recent-money">
                <b>정가</b> {latest.price_standard?.toLocaleString('ko-KR') ?? '—'}
                <b>중고</b> {(latest.used_price ?? latest.used_min_price)?.toLocaleString('ko-KR') ?? '—'}
              </span>
            </span>
            <Icon name="chevron-right" size={16} />
          </Link>
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
    </div>
  );
}
