'use client';

/**
 * 판매(POS).
 *
 * 두 가지를 한 화면에서 한다 — 지금 파는 것(장바구니)과 지나간 것(내역).
 *
 * ⚠️ 스캔 규칙이 도서 담기와 **반대**다.
 *    도서 담기는 「보이는 동안 1회」지만, 판매는 **찍는 만큼 수량이 오른다.**
 *    세면서 찍는 동작이라 그래야 자연스럽다. 화면에 그 사실을 적어 둔다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Icon from '@/components/Icon';
import { useApp } from '@/components/AppShell';
import { formatDateTime } from '@/lib/datetime';
import { logError, logInfo } from '@/lib/logbus';

const Scanner = dynamic(() => import('@/components/Scanner'), { ssr: false });

const won = (n: number) => n.toLocaleString('ko-KR');

type CartLine = {
  isbn: string;
  title: string | null;
  unitPrice: number;
  quantity: number;
  discount: number;
  stock: number | null;   // 참고용. 서버가 최종 판단한다.
};

type SaleItem = {
  id: number; isbn: string; title: string | null;
  unit_price: number; quantity: number; discount: number;
  line_total: number; refunded_qty: number;
};
type Sale = {
  id: number; sale_no: string; status: string;
  subtotal: number; discount: number; total: number;
  pay_method: string; memo: string | null;
  sold_at: string; voided_at: string | null;
  sale_items: SaleItem[];
};

type InvItem = { isbn: string; title: string | null; quantity: number; sale_price: number | null; price_standard: number | null; used_price: number | null };

const PAY: { key: string; label: string }[] = [
  { key: 'cash',     label: '현금' },
  { key: 'card',     label: '카드' },
  { key: 'transfer', label: '이체' },
  { key: 'other',    label: '기타' },
];

const STATUS_LABEL: Record<string, string> = {
  paid: '판매', void: '취소', refunded: '전체 반품', partial_refunded: '부분 반품',
};

export default function SalesPage() {
  const { books, toast } = useApp();
  const [tab, setTab] = useState<'sell' | 'history'>('sell');

  return (
    <div className="pane">
      <div className="subtabs" role="tablist">
        <button role="tab" type="button" aria-selected={tab === 'sell'}
          className={'subtab' + (tab === 'sell' ? ' on' : '')} onClick={() => setTab('sell')}>
          판매
        </button>
        <button role="tab" type="button" aria-selected={tab === 'history'}
          className={'subtab' + (tab === 'history' ? ' on' : '')} onClick={() => setTab('history')}>
          내역
        </button>
      </div>
      {tab === 'sell' ? <SellTab books={books} toast={toast} /> : <HistoryTab toast={toast} />}
    </div>
  );
}

/* ------------------------------------------------------------------ 판매 */

function SellTab({ books, toast }: { books: { isbn: string; title: string | null; price_standard: number | null; used_price: number | null }[]; toast: (m: string) => void }) {
  const [cart, setCart]       = useState<CartLine[]>([]);
  const [inv, setInv]         = useState<Record<string, InvItem>>({});
  const [scanOn, setScanOn]   = useState(false);
  const [pay, setPay]         = useState('cash');
  const [discount, setDiscount] = useState('0');
  const [busy, setBusy]       = useState(false);
  const [note, setNote]       = useState<string | null>(null);
  // 확정 한 번에 하나의 열쇠. 두 번 눌리거나 재시도돼도 판매가 두 건 생기지 않는다.
  const idemRef = useRef<string>(crypto.randomUUID());

  const loadInv = useCallback(async () => {
    try {
      const res = await fetch('/api/inventory');
      const json = await res.json();
      if (!res.ok) return;
      const map: Record<string, InvItem> = {};
      for (const i of json.items ?? []) map[i.isbn] = i;
      setInv(map);
    } catch { /* 재고를 못 읽어도 판매는 막지 않는다. 서버가 최종 확인한다. */ }
  }, []);
  useEffect(() => { void loadInv(); }, [loadInv]);

  /** 기본 단가 — 재고에 정한 판매가가 우선, 없으면 중고가, 그것도 없으면 정가. */
  const defaultPrice = useCallback((isbn: string) => {
    const i = inv[isbn];
    if (i?.sale_price != null) return i.sale_price;
    const b = books.find((x) => x.isbn === isbn);
    return i?.used_price ?? b?.used_price ?? b?.price_standard ?? 0;
  }, [inv, books]);

  const addToCart = useCallback((isbn: string) => {
    const b = books.find((x) => x.isbn === isbn);
    setCart((prev) => {
      const at = prev.findIndex((l) => l.isbn === isbn);
      if (at >= 0) {
        // 판매는 찍는 만큼 센다 — 도서 담기와 반대다.
        const next = [...prev];
        next[at] = { ...next[at], quantity: next[at].quantity + 1 };
        return next;
      }
      return [...prev, {
        isbn,
        title: b?.title ?? null,
        unitPrice: defaultPrice(isbn),
        quantity: 1,
        discount: 0,
        stock: inv[isbn]?.quantity ?? null,
      }];
    });
    logInfo('sale.cart.add', isbn);
  }, [books, defaultPrice, inv]);

  const subtotal = useMemo(
    () => cart.reduce((a, l) => a + Math.max(0, l.unitPrice * l.quantity - l.discount), 0),
    [cart],
  );
  const disc  = Math.max(0, Number(discount) || 0);
  const total = Math.max(0, subtotal - disc);
  const shortage = cart.some((l) => l.stock != null && l.stock < l.quantity);

  const checkout = useCallback(async (allowShortage: boolean) => {
    if (!cart.length) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map((l) => ({
            isbn: l.isbn, quantity: l.quantity,
            unit_price: l.unitPrice, discount: l.discount,
          })),
          pay_method: pay,
          discount: disc,
          idem_key: idemRef.current,
          allow_shortage: allowShortage,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setNote(json.error ?? `확정 실패 (${res.status})`);
        return;
      }
      toast(`${json.sale.sale_no} 판매 확정 · ${won(json.sale.total)}원`);
      logInfo('sale.checkout', json.sale.sale_no, { total: json.sale.total, items: cart.length });
      setCart([]);
      setDiscount('0');
      idemRef.current = crypto.randomUUID();   // 다음 판매는 새 열쇠로
      await loadInv();
    } catch (e) {
      logError('sale.checkout.error', e instanceof Error ? e.message : String(e));
      setNote('네트워크 오류');
    } finally {
      setBusy(false);
    }
  }, [cart, pay, disc, toast, loadInv]);

  return (
    <div className="pane-scroll sell">
      <div className="sell-scan">
        <button
          type="button"
          className={'btn-line grow' + (scanOn ? ' on' : '')}
          onClick={() => setScanOn((v) => !v)}
        >
          <Icon name={scanOn ? 'stop' : 'play'} size={16} />
          {scanOn ? '스캔 끄기' : '바코드로 담기'}
        </button>
        {scanOn && <p className="sell-hint">찍을 때마다 수량이 1씩 올라갑니다.</p>}
      </div>

      {scanOn && (
        <div className="sell-camera">
          <Scanner active onDetect={addToCart} />
        </div>
      )}

      {!cart.length ? (
        <div className="empty">
          <Icon name="cart" size={22} />
          <p>장바구니가 비었습니다.<br />바코드를 찍거나 아래에서 골라 담으세요.</p>
        </div>
      ) : (
        <table className="dtable cart">
          <thead>
            <tr>
              <th className="c-title">품목</th>
              <th className="num">단가</th>
              <th className="c-qty">수량</th>
              <th className="num">금액</th>
              <th className="c-act" aria-label="동작" />
            </tr>
          </thead>
          <tbody>
            {cart.map((l, idx) => (
              <tr key={l.isbn} className={l.stock != null && l.stock < l.quantity ? 'row-short' : ''}>
                <td className="c-title" data-label="품목">
                  <span className="cell-title">{l.title ?? l.isbn}</span>
                  <span className="cell-isbn mono">
                    {l.isbn}
                    {l.stock != null && <> · 재고 {l.stock}</>}
                  </span>
                </td>
                <td className="num" data-label="단가">
                  <input
                    className="cell-input" type="number" min={0} inputMode="numeric"
                    value={l.unitPrice}
                    onChange={(e) => setCart((p) => p.map((x, i) =>
                      i === idx ? { ...x, unitPrice: Math.max(0, Number(e.target.value) || 0) } : x))}
                  />
                </td>
                <td className="c-qty" data-label="수량">
                  <div className="stepper sm">
                    <button type="button" aria-label="수량 줄이기"
                      onClick={() => setCart((p) => p.flatMap((x, i) =>
                        i === idx ? (x.quantity <= 1 ? [] : [{ ...x, quantity: x.quantity - 1 }]) : [x]))}>
                      <Icon name="minus" size={14} />
                    </button>
                    <span className="stepper-value">{l.quantity}</span>
                    <button type="button" aria-label="수량 늘리기"
                      onClick={() => setCart((p) => p.map((x, i) =>
                        i === idx ? { ...x, quantity: x.quantity + 1 } : x))}>
                      <Icon name="plus" size={14} />
                    </button>
                  </div>
                </td>
                <td className="num strong" data-label="금액">
                  {won(Math.max(0, l.unitPrice * l.quantity - l.discount))}
                </td>
                <td className="c-act">
                  <button type="button" className="book-del" aria-label="빼기"
                    onClick={() => setCart((p) => p.filter((_, i) => i !== idx))}>
                    <Icon name="trash" size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {cart.length > 0 && (
        <div className="checkout">
          <div className="sum-row"><span>소계</span><b>{won(subtotal)}</b></div>
          <div className="sum-row">
            <span>할인</span>
            <input
              className="cell-input wide" type="number" min={0} inputMode="numeric"
              value={discount} onChange={(e) => setDiscount(e.target.value)}
            />
          </div>
          <div className="sum-row total"><span>받을 금액</span><b>{won(total)}</b></div>

          <div className="pay-methods">
            {PAY.map((p) => (
              <button
                key={p.key} type="button"
                className={'pay' + (pay === p.key ? ' on' : '')}
                onClick={() => setPay(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>

          {shortage && (
            <p className="warn-note">
              재고보다 많이 담긴 품목이 있습니다. 그대로 팔면 재고는 0 까지만 내려가고
              기록에 「재고 부족 판매」로 남습니다.
            </p>
          )}
          {note && <p className="warn-note bad">{note}</p>}

          <button
            type="button" className="primary big"
            disabled={busy}
            onClick={() => void checkout(shortage)}
          >
            <Icon name="check" size={16} />
            {busy ? '확정 중…' : `판매 확정 · ${won(total)}원`}
          </button>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ 내역 */

function HistoryTab({ toast }: { toast: (m: string) => void }) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [open, setOpen]   = useState<number | null>(null);
  const [busy, setBusy]   = useState(false);
  const [note, setNote]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/sales?limit=100');
      const json = await res.json();
      if (!res.ok) { setNote(json.error ?? `조회 실패 (${res.status})`); return; }
      setSales(json.sales ?? []);
      setNote(null);
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function voidSale(s: Sale) {
    if (!confirm(`${s.sale_no} 판매를 취소할까요?\n재고가 되돌아가고 기록은 「취소」로 남습니다.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sales/${s.id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) { setNote(json.error ?? '취소 실패'); return; }
      toast(`${s.sale_no} 취소됨`);
      await load();
    } finally { setBusy(false); }
  }

  async function refund(saleId: number, item: SaleItem) {
    const left = item.quantity - item.refunded_qty;
    if (left <= 0) return;
    const raw = prompt(`반품 수량 (최대 ${left})`, String(left));
    if (raw == null) return;
    const qty = Number(raw);
    if (!Number.isInteger(qty) || qty <= 0 || qty > left) { setNote('반품 수량이 올바르지 않습니다'); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/sales/${saleId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: item.id, quantity: qty }),
      });
      const json = await res.json();
      if (!res.ok) { setNote(json.error ?? '반품 실패'); return; }
      toast('반품 처리됨');
      await load();
    } finally { setBusy(false); }
  }

  const dayTotal = sales
    .filter((s) => s.status !== 'void')
    .reduce((a, s) => a + s.total, 0);

  return (
    <div className="pane-scroll">
      <div className="inv-summary">
        <div><span className="inv-sum-label">건수</span><strong>{sales.length}</strong></div>
        <div><span className="inv-sum-label">매출(취소 제외)</span><strong>{won(dayTotal)}</strong></div>
      </div>

      <div className="pane-actions">
        <a className="btn-line grow" href="/api/export/xlsx">
          <Icon name="download" size={16} /> 엑셀로 내보내기
        </a>
        <button type="button" className="btn-line" onClick={() => void load()} disabled={busy} aria-label="새로고침">
          <Icon name="refresh" size={16} />
        </button>
      </div>

      {note && <p className="warn-note bad">{note}</p>}

      {!sales.length ? (
        <div className="empty">
          <Icon name="cart" size={22} />
          <p>판매 기록이 없습니다.</p>
        </div>
      ) : (
        <ul className="sale-list">
          {sales.map((s) => {
            const isOpen = open === s.id;
            return (
              <li key={s.id} className={'sale-row' + (isOpen ? ' open' : '') + (s.status === 'void' ? ' voided' : '')}>
                <button type="button" className="sale-head" onClick={() => setOpen(isOpen ? null : s.id)} aria-expanded={isOpen}>
                  <span className="sale-no mono">{s.sale_no}</span>
                  <span className={'state ' + (s.status === 'void' ? 'bad' : s.status === 'paid' ? 'ok' : 'wait')}>
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                  <span className="sale-when dim">{formatDateTime(s.sold_at)}</span>
                  <span className="sale-total">{won(s.total)}</span>
                  <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} />
                </button>

                {isOpen && (
                  <div className="sale-detail">
                    <table className="dtable">
                      <thead>
                        <tr>
                          <th className="c-title">품목</th>
                          <th className="num">단가</th>
                          <th className="num">수량</th>
                          <th className="num">금액</th>
                          <th className="c-act" aria-label="동작" />
                        </tr>
                      </thead>
                      <tbody>
                        {s.sale_items.map((it) => (
                          <tr key={it.id}>
                            <td className="c-title" data-label="품목">
                              <span className="cell-title">{it.title ?? it.isbn}</span>
                              <span className="cell-isbn mono">{it.isbn}</span>
                            </td>
                            <td className="num" data-label="단가">{won(it.unit_price)}</td>
                            <td className="num" data-label="수량">
                              {it.quantity}
                              {it.refunded_qty > 0 && <span className="refunded"> (반품 {it.refunded_qty})</span>}
                            </td>
                            <td className="num strong" data-label="금액">{won(it.line_total)}</td>
                            <td className="c-act">
                              {s.status !== 'void' && it.refunded_qty < it.quantity && (
                                <button type="button" className="btn-line tiny" disabled={busy}
                                  onClick={() => void refund(s.id, it)}>
                                  반품
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="sale-foot">
                      <span className="dim">결제 {PAY.find((p) => p.key === s.pay_method)?.label ?? s.pay_method}</span>
                      {s.discount > 0 && <span className="dim">할인 {won(s.discount)}</span>}
                      {s.status !== 'void' && (
                        <button type="button" className="btn-line danger" disabled={busy}
                          onClick={() => void voidSale(s)}>
                          <Icon name="trash" size={14} /> 판매 취소
                        </button>
                      )}
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
