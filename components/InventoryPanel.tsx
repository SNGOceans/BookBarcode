'use client';

/**
 * 재고 화면.
 *
 * 수량은 두 가지 방법으로 바꾼다.
 *   ± 버튼   — 한 권씩. 선반 앞에서 세면서 누르는 동작이다.
 *   직접 입력 — 실사 후 「3권」처럼 절대값으로 맞출 때.
 *
 * 둘 다 서버에서 이동 원장에 남는다. 「왜 3권이 되었나」를 나중에 되짚을 수 있어야 한다.
 */

import { useCallback, useEffect, useState } from 'react';
import Icon from '@/components/Icon';
import { logError, logInfo } from '@/lib/logbus';

export type InventoryItem = {
  id: number;
  quantity: number;
  location: string | null;
  condition: string | null;
  memo: string | null;
  updated_at: string;
  isbn: string;
  title: string | null;
  author: string | null;
  publisher: string | null;
  price_standard: number | null;
  used_price: number | null;
};

type Props = {
  /** 도서 탭에서 「재고 잡기」로 넘어온 ISBN. 그 행을 펼친 상태로 연다. */
  focusIsbn?: string | null;
  onConsumedFocus?: () => void;
};

const won = (n: number) => n.toLocaleString('ko-KR');

export default function InventoryPanel({ focusIsbn, onConsumedFocus }: Props) {
  const [items, setItems]   = useState<InventoryItem[]>([]);
  const [busy, setBusy]     = useState(false);
  const [note, setNote]     = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft]   = useState<{ quantity: string; location: string; condition: string; memo: string }>(
    { quantity: '', location: '', condition: '', memo: '' },
  );

  const load = useCallback(async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/inventory');
      const json = await res.json();
      if (!res.ok) {
        const raw = String(json.error ?? '');
        // 표가 아직 없는 경우. 원문(PostgREST 오류)을 그대로 보여 주면 무슨 말인지 알 수 없다.
        setNote(
          /relation .* does not exist|schema cache|PGRST205/i.test(raw)
            ? '재고 기능이 아직 준비되지 않았습니다. 데이터베이스 마이그레이션(0003) 적용이 필요합니다.'
            : (raw || `조회 실패 (${res.status})`),
        );
        return;
      }
      setItems(json.items ?? []);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // 도서 탭에서 넘어왔으면 그 책을 편집 상태로 연다.
  useEffect(() => {
    if (!focusIsbn) return;
    const found = items.find((i) => i.isbn === focusIsbn);
    openEdit(focusIsbn, found);
    onConsumedFocus?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIsbn, items.length]);

  function openEdit(isbn: string, item?: InventoryItem) {
    setEditing(isbn);
    setDraft({
      quantity:  String(item?.quantity ?? 1),
      location:  item?.location  ?? '',
      condition: item?.condition ?? '',
      memo:      item?.memo      ?? '',
    });
  }

  /** ± 버튼. 화면을 먼저 바꾸지 않고 서버 응답으로 갱신한다 —
   *  0 아래로 못 내려가는 규칙이 서버에 있어서, 미리 바꾸면 화면만 틀려진다. */
  const adjust = useCallback(async (isbn: string, delta: number) => {
    setBusy(true);
    try {
      const res = await fetch('/api/inventory', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isbn, delta }),
      });
      const json = await res.json();
      if (!res.ok) { setNote(json.error ?? `변경 실패 (${res.status})`); return; }
      logInfo('inventory.adjust', isbn, { delta });
      await load();
    } catch (e) {
      logError('inventory.adjust.error', e instanceof Error ? e.message : String(e), { isbn });
      setNote('네트워크 오류');
    } finally {
      setBusy(false);
    }
  }, [load]);

  const save = useCallback(async (isbn: string) => {
    const qty = Number(draft.quantity);
    if (!Number.isInteger(qty) || qty < 0) { setNote('수량은 0 이상의 정수여야 합니다'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isbn,
          quantity:  qty,
          location:  draft.location  || null,
          condition: draft.condition || null,
          memo:      draft.memo      || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setNote(json.error ?? `저장 실패 (${res.status})`); return; }
      logInfo('inventory.set', isbn, { quantity: qty });
      setEditing(null);
      await load();
    } catch (e) {
      logError('inventory.set.error', e instanceof Error ? e.message : String(e), { isbn });
      setNote('네트워크 오류');
    } finally {
      setBusy(false);
    }
  }, [draft, load]);

  const remove = useCallback(async (isbn: string, title: string | null) => {
    if (!confirm(`${title ?? isbn} 의 재고 기록을 지울까요?\n변경 이력은 남습니다.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/inventory?isbn=${encodeURIComponent(isbn)}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) { setNote(json.error ?? `삭제 실패 (${res.status})`); return; }
      logInfo('inventory.remove', isbn);
      await load();
    } finally {
      setBusy(false);
    }
  }, [load]);

  const totalQty  = items.reduce((a, i) => a + i.quantity, 0);
  const totalVal  = items.reduce((a, i) => a + (i.price_standard ?? 0) * i.quantity, 0);
  const valuedCnt = items.filter((i) => i.price_standard != null).length;

  return (
    <div className="inv">
      <div className="inv-summary">
        <div>
          <span className="inv-sum-label">품목</span>
          <strong>{items.length}</strong>
        </div>
        <div>
          <span className="inv-sum-label">총 수량</span>
          <strong>{totalQty}</strong>
        </div>
        <div title={`정가가 있는 ${valuedCnt}품목만 합산`}>
          <span className="inv-sum-label">정가 합</span>
          <strong>{won(totalVal)}</strong>
        </div>
      </div>

      <div className="inv-actions">
        <a className="inv-export" href="/api/export/xlsx">
          <Icon name="download" size={15} /> 엑셀로 내보내기
        </a>
        <button type="button" className="icon-btn" onClick={() => void load()} disabled={busy} aria-label="새로고침">
          <Icon name="refresh" size={15} />
        </button>
      </div>

      {note && <div className="inv-note">{note}</div>}

      {!items.length ? (
        <div className="empty">
          <Icon name="list" size={22} />
          <p>잡아 둔 재고가 없습니다.<br />도서 목록에서 「재고 잡기」를 눌러 시작하세요.</p>
        </div>
      ) : (
        <ul className="inv-list">
          {items.map((i) => {
            const open = editing === i.isbn;
            return (
              <li key={i.id} className={'inv-row' + (open ? ' open' : '')}>
                <div className="inv-head">
                  <div className="inv-main">
                    <span className="inv-title">{i.title ?? i.isbn}</span>
                    <span className="inv-sub">
                      {i.location && <span className="inv-tag">{i.location}</span>}
                      {i.condition && <span className="inv-tag">{i.condition}</span>}
                      {!i.location && !i.condition && <span className="dim">{i.isbn}</span>}
                    </span>
                  </div>

                  <div className="stepper">
                    <button type="button" onClick={() => void adjust(i.isbn, -1)} disabled={busy || i.quantity === 0} aria-label="한 권 줄이기">−</button>
                    <span className="stepper-value">{i.quantity}</span>
                    <button type="button" onClick={() => void adjust(i.isbn, +1)} disabled={busy} aria-label="한 권 늘리기">+</button>
                  </div>

                  <button
                    type="button"
                    className="icon-btn inv-edit"
                    onClick={() => (open ? setEditing(null) : openEdit(i.isbn, i))}
                    aria-label={open ? '편집 닫기' : '편집'}
                    aria-expanded={open}
                  >
                    <Icon name="chevron-right" size={15} />
                  </button>
                </div>

                {open && (
                  <div className="inv-edit-form">
                    <label>
                      <span>수량</span>
                      <input
                        type="number" min={0} inputMode="numeric"
                        value={draft.quantity}
                        onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
                      />
                    </label>
                    <label>
                      <span>위치</span>
                      <input
                        value={draft.location} placeholder="예: A-3 선반"
                        onChange={(e) => setDraft((d) => ({ ...d, location: e.target.value }))}
                      />
                    </label>
                    <label>
                      <span>상태</span>
                      <input
                        value={draft.condition} placeholder="예: 중고 상"
                        onChange={(e) => setDraft((d) => ({ ...d, condition: e.target.value }))}
                      />
                    </label>
                    <label className="wide">
                      <span>메모</span>
                      <input
                        value={draft.memo} placeholder="선택"
                        onChange={(e) => setDraft((d) => ({ ...d, memo: e.target.value }))}
                      />
                    </label>
                    <div className="inv-edit-actions">
                      <button type="button" className="save" onClick={() => void save(i.isbn)} disabled={busy}>
                        <Icon name="check" size={15} /> 저장
                      </button>
                      <button type="button" className="del" onClick={() => void remove(i.isbn, i.title)} disabled={busy}>
                        <Icon name="trash" size={15} /> 재고 삭제
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
