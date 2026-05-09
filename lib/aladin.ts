/**
 * Aladin TTB API 클라이언트 (서버 전용).
 *
 * ItemLookUp + OptResult=usedList 호출로 도서 메타 + 가격 + 중고 정보를 한 번에 받는다.
 * Reference 의 lookup_aladin_used / score_item 로직을 그대로 포팅.
 */

const KEY = process.env.ALADIN_TTB_KEY ?? '';

export type AladinMeta = {
  title:           string | null;
  author:          string | null;
  publisher:       string | null;
  cover_url:       string | null;
  price_standard:  number | null;  // 정가
  price_sales:     number | null;  // 판매가
  used_price:      number | null;  // 중고가 (알라딘중고 → 개인중고 → 매장중고 순 첫 채널 minPrice)
  used_min_price:  number | null;  // 모든 채널 중 최저
  used_count:      number | null;  // 모든 채널 itemCount 합
};

const EMPTY: AladinMeta = {
  title: null, author: null, publisher: null, cover_url: null,
  price_standard: null, price_sales: null,
  used_price: null, used_min_price: null, used_count: null,
};

/**
 * Aladin 응답이 가끔 trailing `;` 또는 BOM 이 붙어 들어와서 JSON.parse 가 실패함.
 * 이를 정리한 뒤 파싱한다.
 */
function safeParseAladin(text: string): any | null {
  let t = text.replace(/^﻿/, '').trim();
  while (t.endsWith(';')) t = t.slice(0, -1).trimEnd();
  try { return JSON.parse(t); } catch { return null; }
}

export async function lookupAladin(isbn: string): Promise<AladinMeta | null> {
  if (!KEY) return null;
  if (!/^\d{13}$/.test(isbn)) return null;

  const url =
    'https://www.aladin.co.kr/ttb/api/ItemLookUp.aspx'
    + `?ttbkey=${encodeURIComponent(KEY)}`
    + '&itemIdType=ISBN13'
    + `&ItemId=${encodeURIComponent(isbn)}`
    + '&output=JS&Version=20131101&OptResult=usedList';

  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store' });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const text = await res.text();
  const data = safeParseAladin(text);
  const item = data?.item?.[0];
  if (!item) return EMPTY;

  // 중고 정보: 알라딘중고 / 개인중고 / 매장중고 채널을 순회
  const usedList = (item?.subInfo?.usedList ?? {}) as Record<string, { itemCount?: number; minPrice?: number }>;
  const channels = ['aladinUsed', 'userUsed', 'spaceUsed'] as const;
  let used_price = 0;
  let total_count = 0;
  const all_min: number[] = [];
  for (const ch of channels) {
    const c = usedList[ch] ?? {};
    const cnt = Number(c.itemCount ?? 0);
    const mp  = Number(c.minPrice  ?? 0);
    total_count += cnt;
    if (mp > 0) {
      all_min.push(mp);
      // 첫 번째로 발견한 채널 가격 사용 (우선순위: 알라딘중고 → 개인중고 → 매장중고)
      if (used_price === 0) used_price = mp;
    }
  }

  const num = (v: unknown): number | null => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const str = (v: unknown): string | null => {
    const s = String(v ?? '').trim();
    return s ? s : null;
  };

  return {
    title:          str(item.title),
    author:         str(item.author),
    publisher:      str(item.publisher),
    cover_url:      str(item.cover),
    price_standard: num(item.priceStandard),
    price_sales:    num(item.priceSales),
    used_price:     used_price > 0 ? used_price : null,
    used_min_price: all_min.length ? Math.min(...all_min) : null,
    used_count:     total_count > 0 ? total_count : null,
  };
}
