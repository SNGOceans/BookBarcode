/**
 * 도서 메타 상태 판정.
 *
 * 라우트 밖에 두는 이유 — 이 규칙이 엑셀에서 **어느 탭으로 가는지**를 정한다.
 * HTTP 핸들러 안에 있으면 시험할 수 없고, 시험할 수 없는 분류는 조용히 틀어진다.
 */

/** 알라딘 조회 결과 상태. 값역에 「미조회」가 있는 것이 핵심이다. */
export type LookupState = '찾음' | '못 찾음' | '미조회';

export type MetaFields = {
  title: string | null;
  meta_fetched_at: string | null;
};

/**
 * 「못 찾음」과 「아직 조회 안 함」은 다른 상태다.
 *
 * 둘을 하나로 뭉치면 「알라딘에 없는 책」인지 「우리가 아직 안 물어본 책」인지
 * 구분이 사라진다. 앞은 사람이 손으로 채워야 하는 일이고,
 * 뒤는 조회를 한 번 더 돌리면 해결되는 일이라 대응이 정반대다.
 */
export function lookupState(b: MetaFields): LookupState {
  if (b.title) return '찾음';
  return b.meta_fetched_at ? '못 찾음' : '미조회';
}

/** 엑셀에서 「검색됨」 탭으로 갈 것인지 */
export function isFound(b: MetaFields): boolean {
  return lookupState(b) === '찾음';
}
