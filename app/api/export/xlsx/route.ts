import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';
import ExcelJS from 'exceljs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BOOK_COLS =
  'id, isbn, scan_count, first_scanned_at, last_scanned_at, ' +
  'title, author, translator, publisher, ' +
  'price_standard, price_sales, used_price, used_min_price, used_count';

function pad2(n: number) { return String(n).padStart(2, '0'); }
function stampNow(): string {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`
       + `_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
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

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('도서 목록', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  // 열 순서 = 실제로 보는 순서. 제목과 값(가격·수량)을 앞에 두고,
  // 서지 정보와 스캔 이력은 뒤로 보낸다.
  ws.columns = [
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

  const NUMERIC = [
    'price_standard', 'used_price', 'used_min_price',
    'used_count', 'price_sales', 'scan_count',
  ];
  const DATES = ['first_scanned_at', 'last_scanned_at'];

  const INK   = 'FF1F2937';   // 본문 글자
  const MUTED = 'FF6B7280';   // 머리글 글자
  const RULE  = 'FFE5E7EB';   // 가로 구분선

  // 머리글 — 색을 깔지 않는다. 굵기와 아래 선만으로 구분한다.
  const header = ws.getRow(1);
  header.height    = 22;
  header.font      = { name: '맑은 고딕', size: 10, bold: true, color: { argb: MUTED } };
  header.alignment = { vertical: 'middle' };
  for (const key of NUMERIC) {
    ws.getColumn(key).alignment = { horizontal: 'right', vertical: 'middle' };
  }

  const ordered = (data ?? []).slice().reverse();
  ordered.forEach((b: any) => {
    const row = ws.addRow({
      title:            b.title      ?? '',
      isbn:             b.isbn,
      price_standard:   b.price_standard,
      used_price:       b.used_price,
      used_min_price:   b.used_min_price,
      used_count:       b.used_count,
      price_sales:      b.price_sales,
      author:           b.author     ?? '',
      translator:       b.translator ?? '',
      publisher:        b.publisher  ?? '',
      scan_count:       b.scan_count,
      first_scanned_at: b.first_scanned_at ? new Date(b.first_scanned_at) : null,
      last_scanned_at:  b.last_scanned_at  ? new Date(b.last_scanned_at)  : null,
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
  });

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
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: lastRow, column: lastCol } };

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
