/**
 * Aladin TTB API 클라이언트 (서버 전용).
 *
 * ItemLookUp + OptResult=usedList 호출로 도서 메타 + 가격 + 중고 정보를 한 번에 받는다.
 * `author` 필드는 "X (지은이), Y (옮긴이)" 형태이므로 저자/역자를 분리해 둔다.
 */

const KEY = process.env.ALADIN_TTB_KEY ?? '';

export type AladinMeta = {
  title:           string | null;
  author:          string | null;  // (지은이)·(글)·(엮은이) 등을 합친 결과
  translator:      string | null;  // (옮긴이)만 따로
  publisher:       string | null;
  cover_url:       string | null;
  price_standard:  number | null;  // 정가
  price_sales:     number | null;  // 판매가
  used_price:      number | null;  // 채널 우선순위(아라딘 → 개인 → 매장) 첫 채널 minPrice
  used_min_price:  number | null;  // 모든 채널 중 최저
  used_count:      number | null;  // 모든 채널 itemCount 합
};

const EMPTY: AladinMeta = {
  title: null, author: null, translator: null, publisher: null, cover_url: null,
  price_standard: null, price_sales: null,
  used_price: null, used_min_price: null, used_count: null,
};

/**
 * Aladin 응답이 가끔 trailing `;` 또는 BOM 이 붙어서 JSON.parse 가 실패함. 정리 후 파싱.
 */
function safeParseAladin(text: string): any | null {
  let t = text.replace(/^﻿/, '').trim();
  while (t.endsWith(';')) t = t.slice(0, -1).trimEnd();
  try { return JSON.parse(t); } catch { return null; }
}

/**
 * 알라딘 author 필드 분리:
 *   "헤르만 헤세 (지은이), 김남식 (옮긴이)"
 *   → { author: "헤르만 헤세", translator: "김남식" }
 *
 * (옮긴이) 만 translator 로 분리하고, (지은이)·(글)·(엮은이)·(편저자)·(기획)·(그림)
 * 등 나머지는 author 로 합친다. 라벨이 전혀 없는 단순 문자열은 그대로 author.
 */
export function splitAladinAuthor(raw: string | null): { author: string | null; translator: string | null } {
  if (!raw) return { author: null, translator: null };
  const text = String(raw).trim();
  if (!text) return { author: null, translator: null };

  // 라벨이 없으면 전체를 저자로
  if (!/\((?:지은이|옮긴이|엮은이|편저자|기획|글|그림|사진)\)/.test(text)) {
    return { author: text, translator: null };
  }

  const writers: string[]     = [];
  const translators: string[] = [];
  const re = /(.+?)\s*\((지은이|옮긴이|엮은이|편저자|기획|글|그림|사진)\)\s*(?:,\s*|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const names = m[1].trim();
    const label = m[2];
    if (!names) continue;
    if (label === '옮긴이') translators.push(names);
    else                    writers.push(names);
  }

  return {
    author:     writers.length     ? writers.join(', ')     : null,
    translator: translators.length ? translators.join(', ') : null,
  };
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

  // 중고 채널: 우선순위 알라딘중고 → 개인중고 → 매장중고 첫 minPrice 사용
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

  const { author, translator } = splitAladinAuthor(str(item.author));

  return {
    title:          str(item.title),
    author,
    translator,
    publisher:      str(item.publisher),
    cover_url:      str(item.cover),
    price_standard: num(item.priceStandard),
    price_sales:    num(item.priceSales),
    used_price:     used_price > 0 ? used_price : null,
    used_min_price: all_min.length ? Math.min(...all_min) : null,
    used_count:     total_count > 0 ? total_count : null,
  };
}
