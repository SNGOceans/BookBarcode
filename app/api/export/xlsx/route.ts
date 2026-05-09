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

  ws.columns = [
    { header: '번호',         key: 'no',               width:  6 },
    { header: 'ISBN',         key: 'isbn',             width: 18 },
    { header: '도서 제목',     key: 'title',            width: 40 },
    { header: '저자',          key: 'author',           width: 20 },
    { header: '평역자/옮김',   key: 'translator',       width: 20 },
    { header: '출판사',        key: 'publisher',        width: 18 },
    { header: '정가',          key: 'price_standard',   width: 12 },
    { header: '판매가',        key: 'price_sales',      width: 12 },
    { header: '중고가',        key: 'used_price',       width: 12 },
    { header: '중고최저가',    key: 'used_min_price',   width: 12 },
    { header: '중고수량',      key: 'used_count',       width: 10 },
    { header: '스캔횟수',      key: 'scan_count',       width: 10 },
    { header: '최초스캔',      key: 'first_scanned_at', width: 22 },
    { header: '최근스캔',      key: 'last_scanned_at',  width: 22 },
  ];

  const header = ws.getRow(1);
  header.height    = 30;
  header.font      = { name: '맑은 고딕', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
  header.alignment = { horizontal: 'center', vertical: 'middle' };

  const ordered = (data ?? []).slice().reverse();
  ordered.forEach((b: any, i: number) => {
    const row = ws.addRow({
      no:               i + 1,
      isbn:             b.isbn,
      title:            b.title          ?? '',
      author:           b.author         ?? '',
      translator:       b.translator     ?? '',
      publisher:        b.publisher      ?? '',
      price_standard:   b.price_standard,
      price_sales:      b.price_sales,
      used_price:       b.used_price,
      used_min_price:   b.used_min_price,
      used_count:       b.used_count,
      scan_count:       b.scan_count,
      first_scanned_at: b.first_scanned_at ? new Date(b.first_scanned_at) : null,
      last_scanned_at:  b.last_scanned_at  ? new Date(b.last_scanned_at)  : null,
    });
    row.height    = 25;
    row.font      = { name: '맑은 고딕', size: 10 };
    row.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true, indent: 1 };
    row.getCell('isbn').font = { name: 'Consolas', size: 10 };

    for (const k of ['price_standard', 'price_sales', 'used_price', 'used_min_price', 'used_count', 'scan_count']) {
      const cell = row.getCell(k);
      if (typeof cell.value === 'number') cell.numFmt = '#,##0';
    }
    for (const k of ['first_scanned_at', 'last_scanned_at']) {
      const cell = row.getCell(k);
      if (cell.value instanceof Date) cell.numFmt = 'yyyy-mm-dd hh:mm:ss';
    }

    const hasPrice = b.price_standard != null || b.price_sales != null;
    const fillArgb = !hasPrice ? 'FFFFB6C1' : ((i + 1) % 2 === 0 ? 'FFF3F0FF' : null);
    if (fillArgb) {
      row.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
      });
    }
  });

  const lastCol = ws.columnCount;
  const lastRow = ws.rowCount;
  for (let r = 1; r <= lastRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= lastCol; c++) {
      row.getCell(c).border = {
        top:    { style: 'thin', color: { argb: 'FFD0D0D0' } },
        left:   { style: 'thin', color: { argb: 'FFD0D0D0' } },
        bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
        right:  { style: 'thin', color: { argb: 'FFD0D0D0' } },
      };
    }
  }
  header.eachCell((c) => {
    c.border = {
      ...(c.border ?? {}),
      bottom: { style: 'medium', color: { argb: 'FF6D28D9' } },
    };
  });
  if (lastRow > 1) {
    const last = ws.getRow(lastRow);
    last.eachCell((c) => {
      c.border = {
        ...(c.border ?? {}),
        bottom: { style: 'medium', color: { argb: 'FF7C3AED' } },
      };
    });
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
