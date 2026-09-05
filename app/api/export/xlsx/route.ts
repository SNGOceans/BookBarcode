import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';
import { isFound, lookupState } from '@/lib/book-meta';
import { toExcelKst } from '@/lib/datetime';
import ExcelJS from 'exceljs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BOOK_COLS =
  'id, isbn, scan_count, first_scanned_at, last_scanned_at, ' +
  'title, author, translator, publisher, ' +
  'price_standard, price_sales, used_price, used_min_price, used_count, meta_fetched_at';

type BookRow = {
  isbn: string;
  scan_count: number;
  first_scanned_at: string | null;
  last_scanned_at: string | null;
  title: string | null;
  author: string | null;
  translator: string | null;
  publisher: string | null;
  price_standard: number | null;
  price_sales: number | null;
  used_price: number | null;
  used_min_price: number | null;
  used_count: number | null;
  meta_fetched_at: string | null;
};

function pad2(n: number) { return String(n).padStart(2, '0'); }
function stampNow(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
       + `_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}

const INK   = 'FF1F2937';   // 본문 글자
const MUTED = 'FF6B7280';   // 머리글 글자
const RULE  = 'FFE5E7EB';   // 가로 구분선

const NUMERIC = [
  'price_standard', 'used_price', 'used_min_price',
  'used_count', 'price_sales', 'scan_count',
];
const DATES = ['first_scanned_at', 'last_scanned_at'];

/** 도서 목록 시트 하나를 만든다. 두 탭이 같은 서식을 쓰도록 한 곳에 둔다. */
function addBookSheet(
  wb: ExcelJS.Workbook,
  name: string,
  rows: BookRow[],
  opts: { withState?: boolean } = {},
) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });

  // 열 순서 = 실제로 보는 순서. 제목과 값(가격·수량)을 앞에 둔다.
  const columns: Partial<ExcelJS.Column>[] = [
    { header: '도서 제목',   key: 'title',            width: 42 },
    { header: 'ISBN',        key: 'isbn',             width: 17 },
    { header: '정가',        key: 'price_standard',   width: 11 },
    { header: '중고가',      key: 'used_price',       width: 11 },
    { header: '중고최저가',  key: 'used_min_price',   width: 12 },
    { header: '중고수량',    key: 'used_count',       width: 10 },
    { header: '판매가',      key: 'price_sales',      width: 11 },
    { header: '저자',        key: 'author',           width: 20 },
    { header: '옮긴이',      key: 'translator',       width: 16 },
    { header: '출판사',      key: 'publisher',        width: 18 },
    { header: '스캔횟수',    key: 'scan_count',       width: 10 },
    { header: '최초스캔',    key: 'first_scanned_at', width: 19 },
    { header: '최근스캔',    key: 'last_scanned_at',  width: 19 },
  ];
  // 못 찾은 탭에서는 「왜 비었나」를 함께 보여준다.
  if (opts.withState) {
    columns.splice(2, 0, { header: '조회 상태', key: 'state', width: 11 });
  }
  ws.columns = columns;

  const header = ws.getRow(1);
  header.height    = 22;
  header.font      = { name: '맑은 고딕', size: 10, bold: true, color: { argb: MUTED } };
  header.alignment = { vertical: 'middle' };
  for (const key of NUMERIC) {
    ws.getColumn(key).alignment = { horizontal: 'right', vertical: 'middle' };
  }

  for (const b of rows) {
    const row = ws.addRow({
      title:            b.title ?? '',
      isbn:             b.isbn,
      state:            opts.withState ? lookupState(b) : undefined,
      price_standard:   b.price_standard,
      used_price:       b.used_price,
      used_min_price:   b.used_min_price,
      used_count:       b.used_count,
      price_sales:      b.price_sales,
      author:           b.author     ?? '',
      translator:       b.translator ?? '',
      publisher:        b.publisher  ?? '',
      scan_count:       b.scan_count,
      // 엑셀은 Date 를 UTC 기준 숫자로 담는다. 한국 시각으로 보이게 맞춰 넣는다.
      first_scanned_at: toExcelKst(b.first_scanned_at),
      last_scanned_at:  toExcelKst(b.last_scanned_at),
    });
    row.height    = 20;
    row.font      = { name: '맑은 고딕', size: 10, color: { argb: INK } };
    row.alignment = { horizontal: 'left', vertical: 'middle' };

    for (const k of NUMERIC) {
      const cell = row.getCell(k);
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
      if (typeof cell.value === 'number') cell.numFmt = '#,##0';
    }
    for (const k of DATES) {
      const cell = row.getCell(k);
      if (cell.value instanceof Date) cell.numFmt = 'yyyy-mm-dd hh:mm';
    }
  }

  // 선은 가로 한 줄만. 셀마다 사방을 두르면 눈이 피로하다.
  const lastCol = ws.columnCount;
  const lastRow = ws.rowCount;
  for (let r = 1; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const style: 'thin' | 'medium' = r === 1 ? 'medium' : 'thin';
    const color = r === 1 ? MUTED : RULE;
    for (let c = 1; c <= lastCol; c++) {
      row.getCell(c).border = { bottom: { style, color: { argb: color } } };
    }
  }
  if (lastRow === 1) {
    // 빈 탭은 「비었다」고 적어 준다. 아무것도 없으면 오류로 오해한다.
    const empty = ws.addRow({ title: '해당하는 도서가 없습니다.' });
    empty.font = { name: '맑은 고딕', size: 10, italic: true, color: { argb: MUTED } };
  } else {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: lastRow, column: lastCol } };
  }
  return ws;
}

type InventoryRow = {
  quantity: number;
  location: string | null;
  condition: string | null;
  memo: string | null;
  updated_at: string | null;
  books: {
    isbn: string; title: string | null; author: string | null; publisher: string | null;
    price_standard: number | null; used_price: number | null;
  } | null;
};

/** 재고 시트. 도서 목록과 다른 표라 서식을 따로 짠다. */
function addInventorySheet(wb: ExcelJS.Workbook, rows: InventoryRow[]) {
  const ws = wb.addWorksheet('재고', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: '도서 제목', key: 'title',     width: 40 },
    { header: 'ISBN',      key: 'isbn',      width: 17 },
    { header: '수량',      key: 'quantity',  width: 8  },
    { header: '위치',      key: 'location',  width: 14 },
    { header: '상태',      key: 'condition', width: 12 },
    { header: '정가',      key: 'price',     width: 11 },
    { header: '정가×수량', key: 'amount',    width: 13 },
    { header: '중고가',    key: 'used',      width: 11 },
    { header: '저자',      key: 'author',    width: 18 },
    { header: '출판사',    key: 'publisher', width: 16 },
    { header: '메모',      key: 'memo',      width: 24 },
    { header: '최근 변경', key: 'updated',   width: 19 },
  ];
  const nums = ['quantity', 'price', 'amount', 'used'];

  const header = ws.getRow(1);
  header.height    = 22;
  header.font      = { name: '맑은 고딕', size: 10, bold: true, color: { argb: MUTED } };
  header.alignment = { vertical: 'middle' };
  for (const k of nums) ws.getColumn(k).alignment = { horizontal: 'right', vertical: 'middle' };

  for (const r of rows) {
    const price = r.books?.price_standard ?? null;
    const row = ws.addRow({
      title:     r.books?.title ?? '',
      isbn:      r.books?.isbn ?? '',
      quantity:  r.quantity,
      location:  r.location  ?? '',
      condition: r.condition ?? '',
      price,
      // 정가가 없으면 곱셈 결과도 비운다. 0 으로 두면 「0원짜리 재고」로 읽힌다.
      amount:    price != null ? price * r.quantity : null,
      used:      r.books?.used_price ?? null,
      author:    r.books?.author ?? '',
      publisher: r.books?.publisher ?? '',
      memo:      r.memo ?? '',
      updated:   toExcelKst(r.updated_at),
    });
    row.height    = 20;
    row.font      = { name: '맑은 고딕', size: 10, color: { argb: INK } };
    row.alignment = { horizontal: 'left', vertical: 'middle' };
    for (const k of nums) {
      const cell = row.getCell(k);
      cell.alignment = { horizontal: 'right', vertical: 'middle' };
      if (typeof cell.value === 'number') cell.numFmt = '#,##0';
    }
    const u = row.getCell('updated');
    if (u.value instanceof Date) u.numFmt = 'yyyy-mm-dd hh:mm';
  }

  const lastCol = ws.columnCount;
  const lastRow = ws.rowCount;
  for (let r = 1; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const style: 'thin' | 'medium' = r === 1 ? 'medium' : 'thin';
    const color = r === 1 ? MUTED : RULE;
    for (let c = 1; c <= lastCol; c++) {
      row.getCell(c).border = { bottom: { style, color: { argb: color } } };
    }
  }
  if (lastRow === 1) {
    const empty = ws.addRow({ title: '잡아 둔 재고가 없습니다.' });
    empty.font = { name: '맑은 고딕', size: 10, italic: true, color: { argb: MUTED } };
  } else {
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: lastRow, column: lastCol } };
  }
}

/** 합계에 실제로 기여한 건수를 함께 돌려준다. 분모 없는 합계는 오해를 부른다. */
function sumOf(rows: BookRow[], key: keyof BookRow): { sum: number; n: number } {
  let sum = 0;
  let n = 0;
  for (const b of rows) {
    const v = b[key];
    if (typeof v === 'number' && Number.isFinite(v)) { sum += v; n++; }
  }
  return { sum, n };
}

function addSummarySheet(
  wb: ExcelJS.Workbook,
  all: BookRow[],
  found: BookRow[],
  missing: BookRow[],
  inv: InventoryRow[],
) {
  const ws = wb.addWorksheet('요약', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: '항목', key: 'label', width: 26 },
    { header: '값',   key: 'value', width: 20 },
    { header: '비고', key: 'note',  width: 40 },
  ];

  const header = ws.getRow(1);
  header.height    = 22;
  header.font      = { name: '맑은 고딕', size: 10, bold: true, color: { argb: MUTED } };
  header.alignment = { vertical: 'middle' };

  const pct = (n: number) => (all.length ? `${Math.round((n / all.length) * 100)}%` : '-');
  const totalScans = all.reduce((a, b) => a + (b.scan_count ?? 0), 0);
  const notFound = missing.filter((b) => lookupState(b) === '못 찾음').length;
  const notLooked = missing.filter((b) => lookupState(b) === '미조회').length;

  const priceStd  = sumOf(found, 'price_standard');
  const usedPrice = sumOf(found, 'used_price');
  const usedMin   = sumOf(found, 'used_min_price');

  const invQty = inv.reduce((a, r) => a + (r.quantity ?? 0), 0);
  // 정가가 있는 품목만 센다. 분모를 함께 적어야 숫자가 오해를 안 부른다.
  const invValue = inv.reduce(
    (acc, r) => {
      const p = r.books?.price_standard;
      if (typeof p === 'number') { acc.sum += p * (r.quantity ?? 0); acc.n++; }
      return acc;
    },
    { sum: 0, n: 0 },
  );

  const times = all
    .map((b) => b.last_scanned_at)
    .filter((t): t is string => !!t)
    .sort();
  const firsts = all
    .map((b) => b.first_scanned_at)
    .filter((t): t is string => !!t)
    .sort();

  type Line = { label: string; value: string | number | Date | null; note?: string; head?: boolean };
  const lines: Line[] = [
    { label: '집계 기준',   value: toExcelKst(new Date()), note: '이 파일을 내려받은 시각 (한국 시간)' },
    { label: '', value: null },

    { label: '도서', value: null, head: true },
    { label: '담긴 도서',   value: all.length,  note: '중복 없이 ISBN 기준' },
    { label: '총 스캔',     value: totalScans,  note: '같은 책을 다시 대면 누적됨' },
    { label: '첫 스캔',     value: firsts.length ? new Date(firsts[0]) : null },
    { label: '마지막 스캔', value: times.length ? new Date(times[times.length - 1]) : null },
    { label: '', value: null },

    { label: '알라딘 조회', value: null, head: true },
    { label: '검색됨',   value: found.length,  note: pct(found.length) },
    { label: '못 찾음',  value: notFound,      note: '조회했으나 알라딘에 자료 없음' },
    { label: '미조회',   value: notLooked,     note: '아직 조회하지 않음' },
    { label: '', value: null },

    { label: '금액 (검색된 것 기준)', value: null, head: true },
    { label: '정가 합계',     value: priceStd.sum,  note: `${priceStd.n}권 기준 · 값이 있는 것만 합산` },
    { label: '중고가 합계',   value: usedPrice.sum, note: `${usedPrice.n}권 기준` },
    { label: '중고최저 합계', value: usedMin.sum,   note: `${usedMin.n}권 기준` },
    {
      label: '정가 평균',
      value: priceStd.n ? Math.round(priceStd.sum / priceStd.n) : null,
      note: priceStd.n ? `${priceStd.n}권 평균` : '값이 있는 도서가 없음',
    },
    { label: '', value: null },

    { label: '재고', value: null, head: true },
    { label: '재고 품목', value: inv.length, note: '재고를 잡아 둔 도서 수' },
    { label: '재고 총 수량', value: invQty, note: '모든 품목의 수량 합' },
    {
      label: '재고 정가 합',
      value: invValue.sum,
      note: invValue.n ? `정가가 있는 ${invValue.n}품목만 합산` : '정가가 있는 품목이 없음',
    },
  ];

  for (const line of lines) {
    const row = ws.addRow({ label: line.label, value: line.value, note: line.note ?? '' });
    row.height = 20;
    row.font = line.head
      ? { name: '맑은 고딕', size: 10, bold: true, color: { argb: INK } }
      : { name: '맑은 고딕', size: 10, color: { argb: INK } };
    row.alignment = { horizontal: 'left', vertical: 'middle' };

    const v = row.getCell('value');
    if (typeof v.value === 'number') {
      v.numFmt = '#,##0';
      v.alignment = { horizontal: 'right', vertical: 'middle' };
    } else if (v.value instanceof Date) {
      v.numFmt = 'yyyy-mm-dd hh:mm';
    }
    row.getCell('note').font = { name: '맑은 고딕', size: 9, color: { argb: MUTED } };
    if (line.head) {
      row.getCell('label').border = { bottom: { style: 'thin', color: { argb: RULE } } };
    }
  }
  return ws;
}

/**
 * 서버에서 xlsx 를 만들고 Content-Disposition: attachment 로 응답하면
 * 모바일/데스크톱 모두 표준 다운로드 동작에 맡길 수 있다.
 *   - Android Chrome: 자동 다운로드 폴더로 저장
 *   - iOS Safari: 다운로드 시트 → "파일" 앱 또는 다른 앱으로 저장
 *   - 데스크톱: 그대로 다운로드 폴더
 */
export async function GET(req: NextRequest) {
  const ctx = await requireUser(req);
  if (!ctx) return new NextResponse('unauthorized', { status: 401 });
  const { supabase } = ctx;

  const { data, error } = await supabase
    .from('books')
    .select(BOOK_COLS)
    .order('last_scanned_at', { ascending: false })
    .limit(1000);
  if (error) return new NextResponse(error.message, { status: 500 });

  // 오래된 것이 위로 오도록 뒤집는다(스캔한 순서대로 읽힌다).
  // 재고는 없을 수도 있다. 조회가 실패해도 도서 목록은 내보낸다 —
  // 한쪽이 비었다고 파일 전체를 못 받게 하면 더 나쁘다.
  const { data: invData, error: invError } = await supabase
    .from('inventory')
    .select('quantity, location, condition, memo, updated_at, ' +
            'books!inner(isbn, title, author, publisher, price_standard, used_price)')
    .order('updated_at', { ascending: false })
    .limit(1000);
  const inv = (invError ? [] : (invData ?? [])) as unknown as InventoryRow[];

  const all = ((data ?? []) as unknown as BookRow[]).slice().reverse();
  const found   = all.filter(isFound);
  const missing = all.filter((b) => !isFound(b));

  const wb = new ExcelJS.Workbook();
  // 요약을 맨 앞에 둔다. 파일을 열면 먼저 보이는 것이 전체 그림이어야 한다.
  addSummarySheet(wb, all, found, missing, inv);
  addInventorySheet(wb, inv);
  addBookSheet(wb, '검색됨', found);
  addBookSheet(wb, '검색 안 됨', missing, { withState: true });

  const buf = await wb.xlsx.writeBuffer();
  const filename = `도서목록_${stampNow()}.xlsx`;
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':
        `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  });
}
