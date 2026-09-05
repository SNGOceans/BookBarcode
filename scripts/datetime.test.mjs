/**
 * 시각 표시 시험.
 *
 * 시간대는 **조용히 어긋난다.** 화면에는 그럴듯한 숫자가 찍히고
 * 아무 오류도 안 나므로, 시험이 없으면 누가 지적할 때까지 모른다.
 * 그래서 「기기 시간대와 무관하게 한국 시각인가」를 못박아 둔다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { formatTime, formatDateTime, toExcelKst, APP_TIME_ZONE } from '../lib/datetime.ts';

// 2026-09-05T00:30:00Z = 한국 시각 2026-09-05 09:30
const UTC_MIDNIGHT_ISH = '2026-09-05T00:30:00Z';

test('한국 시간대로 고정되어 있다', () => {
  assert.equal(APP_TIME_ZONE, 'Asia/Seoul');
});

test('UTC 00:30 은 한국 시각 09:30 으로 보인다', () => {
  assert.equal(formatTime(UTC_MIDNIGHT_ISH), '09:30:00');
});

test('날짜가 넘어가는 시각도 한국 기준으로 계산된다', () => {
  // UTC 로는 9월 4일 22시지만 한국은 이미 9월 5일 07시다.
  const s = formatDateTime('2026-09-04T22:00:00Z');
  assert.ok(s.includes('2026'), s);
  assert.ok(s.includes('09'), s);
  assert.ok(s.includes('05'), `한국 기준으로 5일이어야 한다: ${s}`);
});

test('기기 시간대를 바꿔도 결과가 같다', () => {
  // 이 시험의 핵심 — toLocaleString 만 쓰면 여기서 값이 흔들린다.
  const before = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    const ny = formatTime(UTC_MIDNIGHT_ISH);
    process.env.TZ = 'Asia/Seoul';
    const kr = formatTime(UTC_MIDNIGHT_ISH);
    assert.equal(ny, kr, '기기 시간대에 따라 달라지면 안 된다');
    assert.equal(ny, '09:30:00');
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
});

test('엑셀용 값은 한국 벽시계를 UTC 인 척 담는다', () => {
  // 엑셀은 Date 를 UTC 기준 숫자로 저장한다. 그래서 「UTC 로 읽었을 때
  // 한국 시각이 나오는」 값을 넣어야 셀에 한국 시각이 보인다.
  const d = toExcelKst(UTC_MIDNIGHT_ISH);
  assert.ok(d instanceof Date);
  assert.equal(d.getUTCHours(), 9);
  assert.equal(d.getUTCMinutes(), 30);
  assert.equal(d.getUTCDate(), 5);
});

test('빈 값은 빈 값으로 돌려준다', () => {
  assert.equal(toExcelKst(null), null);
  assert.equal(toExcelKst(undefined), null);
  assert.equal(formatTime('말도 안 되는 값'), '');
  assert.equal(formatDateTime(''), '');
});

test('엑셀 값과 화면 표시가 같은 시각을 말한다', () => {
  // 두 경로가 갈라지면 「화면은 09:30 인데 엑셀은 00:30」 같은 사고가 난다.
  const shown = formatTime(UTC_MIDNIGHT_ISH);            // 09:30:00
  const excel = toExcelKst(UTC_MIDNIGHT_ISH);
  const excelShown =
    `${String(excel.getUTCHours()).padStart(2, '0')}:` +
    `${String(excel.getUTCMinutes()).padStart(2, '0')}:` +
    `${String(excel.getUTCSeconds()).padStart(2, '0')}`;
  assert.equal(excelShown, shown);
});
