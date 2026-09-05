'use client';

/**
 * 관리자 모드.
 *
 * 평소 화면은 전부 「내 데이터」만 본다(RLS). 여기만 전체를 본다.
 * 그래서 서버가 관리자인지 먼저 확인한 뒤에야 관리자 키를 쓴다.
 */

import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import { useApp } from '@/components/AppShell';
import { formatDateTime } from '@/lib/datetime';

type Overview = {
  counts: {
    users: number | null; books: number | null; scans: number | null;
    inventory: number | null; sales: number | null; logs: number | null;
  };
  revenue: number;
  stockQty: number;
  at: string;
};

const won = (n: number) => n.toLocaleString('ko-KR');
/** 「못 셌다」와 「0건」은 다르다. 화면에서도 구분한다. */
const shown = (n: number | null) => (n == null ? '판정 불가' : n.toLocaleString('ko-KR'));

export default function AdminPage() {
  const { me } = useApp();
  const [data, setData] = useState<Overview | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/admin/overview');
      const json = await res.json();
      if (!res.ok) {
        setNote(res.status === 403 ? '관리자만 볼 수 있는 화면입니다.' : (json.error ?? `조회 실패 (${res.status})`));
        return;
      }
      setData(json);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (!me.isAdmin) {
    return (
      <div className="pane">
        <div className="empty">
          <Icon name="shield" size={22} />
          <p>관리자만 볼 수 있는 화면입니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pane">
      <div className="pane-actions">
        <span className="pane-title">
          <Icon name="shield" size={16} /> 전체 현황
        </span>
        <button type="button" className="btn-line" onClick={() => void load()} disabled={busy} aria-label="새로고침">
          <Icon name="refresh" size={16} />
        </button>
      </div>

      {note && <p className="warn-note bad">{note}</p>}

      <div className="pane-scroll">
        {data && (
          <>
            <div className="stat-grid">
              <Stat label="사용자"   value={shown(data.counts.users)} />
              <Stat label="담긴 도서" value={shown(data.counts.books)} />
              <Stat label="스캔"     value={shown(data.counts.scans)} />
              <Stat label="재고 품목" value={shown(data.counts.inventory)} />
              <Stat label="재고 수량" value={won(data.stockQty)} />
              <Stat label="판매"     value={shown(data.counts.sales)} />
              <Stat label="매출"     value={`${won(data.revenue)}원`} note="취소 건 제외" />
              <Stat label="로그"     value={shown(data.counts.logs)} />
            </div>

            <p className="tbl-note">
              기준 시각 {formatDateTime(data.at)} · 「판정 불가」는 0 건이 아니라 세지 못했다는 뜻입니다.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat-card">
      <span className="stat-card-label">{label}</span>
      <strong className="stat-card-value">{value}</strong>
      {note && <span className="stat-card-note">{note}</span>}
    </div>
  );
}
