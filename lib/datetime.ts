/**
 * 시각 표시 — 한국 시간(Asia/Seoul) 고정.
 *
 * ⚠️ `toLocaleString('ko-KR')` 만으로는 부족하다.
 *    그것은 **표기 형식**만 한국식으로 만들고 **시간대는 기기 설정**을 따라간다.
 *    기기가 다른 시간대면 그쪽 시각이 한국식으로 찍혀서, 화면과 엑셀이 서로 다른
 *    시각을 말하게 된다. 그래서 timeZone 을 명시해 한 곳에서 고정한다.
 */

export const APP_TIME_ZONE = 'Asia/Seoul';

const timeFmt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: APP_TIME_ZONE,
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});

const dateTimeFmt = new Intl.DateTimeFormat('ko-KR', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

function toDate(v: string | number | Date): Date | null {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 09:41:22 */
export function formatTime(v: string | number | Date): string {
  const d = toDate(v);
  return d ? timeFmt.format(d) : '';
}

/** 2026. 09. 05. 09:41 */
export function formatDateTime(v: string | number | Date): string {
  const d = toDate(v);
  return d ? dateTimeFmt.format(d) : '';
}

/**
 * 엑셀에 넣을 Date 를 만든다.
 *
 * ExcelJS 는 Date 를 **UTC 기준 일련번호**로 바꿔 저장한다. 한국 시각을 그대로 넣으면
 * 파일을 열었을 때 9시간 어긋난다. 그래서 「한국 벽시계 값」을 UTC 인 척 담아 보낸다.
 * 셀에 보이는 숫자가 곧 한국 시각이 된다.
 *
 * 이 값으로 계산을 하면 안 된다 — 오직 표시용이다.
 */
export function toExcelKst(v: string | number | Date | null | undefined): Date | null {
  if (v == null) return null;
  const d = toDate(v);
  if (!d) return null;

  // Asia/Seoul 의 실제 오프셋을 그 시점 기준으로 구한다(상수 9시간을 쓰지 않는다).
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d);

  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return new Date(Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour') === 24 ? 0 : get('hour'), get('minute'), get('second'),
  ));
}
