/**
 * 도서 메타 상태 판정 시험.
 *
 * 이 규칙이 엑셀에서 **어느 탭으로 가는지**를 정한다.
 * 틀리면 파일은 멀쩡히 만들어지고 책만 엉뚱한 탭에 들어간다 — 아무도 못 잡는 종류다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { lookupState, isFound } from '../lib/book-meta.ts';

test('제목이 있으면 찾음', () => {
  assert.equal(lookupState({ title: '데미안', meta_fetched_at: '2026-09-05T00:00:00Z' }), '찾음');
});

test('조회했는데 제목이 없으면 못 찾음', () => {
  assert.equal(lookupState({ title: null, meta_fetched_at: '2026-09-05T00:00:00Z' }), '못 찾음');
});

test('아직 조회하지 않았으면 미조회', () => {
  assert.equal(lookupState({ title: null, meta_fetched_at: null }), '미조회');
});

test('못 찾음과 미조회를 하나로 뭉치지 않는다', () => {
  // 대응이 정반대다 — 앞은 손으로 채워야 하고, 뒤는 조회를 한 번 더 돌리면 된다.
  const notFound = lookupState({ title: null, meta_fetched_at: '2026-09-05T00:00:00Z' });
  const notLooked = lookupState({ title: null, meta_fetched_at: null });
  assert.notEqual(notFound, notLooked);
});

test('빈 문자열 제목은 찾은 것으로 치지 않는다', () => {
  // 알라딘이 빈 값을 준 경우. 「제목이 있다」로 세면 검색됨 탭에 빈 줄이 생긴다.
  assert.equal(lookupState({ title: '', meta_fetched_at: '2026-09-05T00:00:00Z' }), '못 찾음');
});

test('검색됨 탭에는 찾은 것만 간다', () => {
  const rows = [
    { title: '데미안', meta_fetched_at: '2026-09-05T00:00:00Z' },
    { title: null,     meta_fetched_at: '2026-09-05T00:00:00Z' },
    { title: null,     meta_fetched_at: null },
  ];
  const found = rows.filter(isFound);
  const missing = rows.filter((r) => !isFound(r));
  assert.equal(found.length, 1);
  assert.equal(missing.length, 2, '나머지는 모두 검색 안 됨 탭으로');
  // 두 탭의 합이 전체와 같아야 한다. 어느 쪽에도 안 들어가는 책이 있으면 안 된다.
  assert.equal(found.length + missing.length, rows.length);
});
