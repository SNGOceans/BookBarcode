/**
 * 스캔 파이프라인 단위 시험 (Node 내장 러너 — 새 의존성 없음).
 *
 *   실행: npm test
 *
 * 여기 있는 것들은 카메라 없이 검증할 수 있으면서 **틀리면 조용히 망가지는** 로직이다.
 *   · 멱등 게이트  → 틀리면 같은 책이 여러 번 기록된다(사용자가 신고한 그 증상)
 *   · 엔진 순환기  → 틀리면 못 읽는 엔진에 갇히거나 빠른 경로를 못 쓴다
 *   · 좌표 역변환  → 틀리면 인식 마커가 엉뚱한 자리에 찍힌다
 *   · 명암 보정    → 틀리면 흐린 프레임에서 오히려 잡음을 키운다
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PresenceGate,
  ScanCycle,
  buildStretchLut,
  applyLut,
  computeRoi,
  computeScale,
  computeBufferSize,
  bufferPointToFrame,
  toGrayscale,
  SCAN_VARIANTS,
  variantIndex,
} from '../lib/scanner/pipeline.ts';

/* --------------------------------------------------------- 멱등 게이트 */

test('계속 비추고 있는 동안에는 한 번만 기록한다', () => {
  const gate = new PresenceGate(1500);
  assert.equal(gate.see('9788934915515', 0), true, '처음 보였으면 기록');
  assert.equal(gate.see('9788934915515', 200), false, '계속 보이는 중이면 무시');
  assert.equal(gate.see('9788934915515', 900), false);
  assert.equal(gate.see('9788934915515', 1400), false);
});

test('사라졌다가 다시 나타나면 새 스캔으로 친다', () => {
  const gate = new PresenceGate(1500);
  gate.see('X', 0);
  // 1500ms 를 넘겨 한 번도 안 잡히면 사라진 것으로 본다.
  assert.equal(gate.see('X', 3000), true, '다시 대면 카운트가 올라가야 한다');
});

test('sweep 이 오래된 코드를 비워 다음 등장이 잡히게 한다', () => {
  const gate = new PresenceGate(1000);
  gate.see('A', 0);
  assert.equal(gate.isPresent('A', 500), true);
  gate.sweep(5000);
  assert.equal(gate.isPresent('A', 5000), false);
  assert.equal(gate.see('A', 5000), true);
});

test('서로 다른 책은 각각 한 번씩 기록된다', () => {
  const gate = new PresenceGate(1500);
  assert.equal(gate.see('A', 0), true);
  assert.equal(gate.see('B', 0), true);
  assert.equal(gate.see('A', 100), false);
  assert.equal(gate.see('B', 100), false);
});

/* --------------------------------------------------------- 엔진 순환기 */

test('성공한 조합은 고정되어 다음에도 그대로 쓰인다', () => {
  const cycle = new ScanCycle([2, 4], 3);
  const first = cycle.current();
  cycle.hit();
  const second = cycle.current();
  assert.deepEqual(
    { engine: second.engine, variant: second.variant },
    { engine: first.engine, variant: first.variant },
  );
  assert.equal(second.pinned, true);
});

test('고정 경로가 연달아 놓치면 탐색으로 돌아간다', () => {
  const cycle = new ScanCycle([2, 4], 3);
  cycle.hit();
  for (let i = 0; i <= 3; i++) cycle.miss();
  assert.equal(cycle.current().pinned, false, '고정이 풀려야 한다');
});

test('탐색 중에는 가장 싼 조합을 한 번씩 사이에 끼운다', () => {
  // 비싼 전략만 연달아 돌면 흔한 경우(가까이 반듯하게 댄 바코드)를 늦게 잡는다.
  const cycle = new ScanCycle([2, 4], 0);
  const seq = [];
  for (let i = 0; i < 6; i++) { seq.push(pick(cycle)); cycle.miss(); }

  // 홀수 번째마다 (0,0) 이 나와야 한다.
  for (let i = 0; i < seq.length; i += 2) {
    assert.deepEqual(seq[i], { engine: 0, variant: 0 }, `${i}번째가 싼 조합이 아니다`);
  }
  // 그 사이 자리는 (0,0) 이 아닌 다른 후보여야 한다.
  for (let i = 1; i < seq.length; i += 2) {
    assert.notDeepEqual(seq[i], { engine: 0, variant: 0 }, `${i}번째가 중복이다`);
  }
});

test('후보는 전략을 다 쓰면 다음 엔진으로 넘어가고 끝에서 되돈다', () => {
  // 엔진 0 은 전략 1개, 엔진 1 은 전략 2개
  const cycle = new ScanCycle([1, 2], 0);
  const candidates = [];
  for (let i = 0; i < 6; i++) {
    const c = pick(cycle);
    cycle.miss();
    if (!(c.engine === 0 && c.variant === 0)) candidates.push(c);
  }
  assert.deepEqual(candidates.slice(0, 3), [
    { engine: 1, variant: 0 },
    { engine: 1, variant: 1 },
    { engine: 1, variant: 0 },
  ], '후보가 (1,0) → (1,1) 을 돌아야 한다');
});

test('싼 조합으로 읽어내면 그 조합이 고정된다', () => {
  const cycle = new ScanCycle([2, 4], 3);
  cycle.miss();                       // 싼 차례를 흘려보내 후보 차례로
  const candidate = pick(cycle);
  assert.notDeepEqual(candidate, { engine: 0, variant: 0 });
  cycle.miss();                       // 다시 싼 차례
  const probe = pick(cycle);
  assert.deepEqual(probe, { engine: 0, variant: 0 });
  cycle.hit();
  assert.deepEqual(pick(cycle), { engine: 0, variant: 0 }, '고정 대상은 방금 낸 조합이다');
  assert.equal(cycle.current().pinned, true);
});

test('엔진이 하나도 없으면 만들 수 없다', () => {
  assert.throws(() => new ScanCycle([]), /엔진이 하나도 없다/);
});

function pick(cycle) {
  const c = cycle.current();
  return { engine: c.engine, variant: c.variant };
}

/* ------------------------------------------------------- 좌표 역변환 */

test('회전 없는 전략에서 버퍼 좌표가 원래 프레임 좌표로 정확히 돌아온다', () => {
  const v = SCAN_VARIANTS[variantIndex('tele')];
  const fw = 2560, fh = 1440;
  const roi = computeRoi(fw, fh, v);
  const scale = computeScale(roi.w, v.targetWidth);
  const { bw, bh } = computeBufferSize(roi, scale, v.rotate);

  // 버퍼 중앙은 ROI 중앙 = 프레임 중앙이어야 한다.
  const mid = bufferPointToFrame(bw / 2, bh / 2, roi, scale, v.rotate, bw, bh);
  assert.ok(Math.abs(mid.x - fw / 2) < 1.5, `x=${mid.x}`);
  assert.ok(Math.abs(mid.y - fh / 2) < 1.5, `y=${mid.y}`);
});

test('45도 회전 전략에서도 중앙이 프레임 중앙으로 돌아온다', () => {
  const v = SCAN_VARIANTS[variantIndex('wide-45')];
  const fw = 1920, fh = 1080;
  const roi = computeRoi(fw, fh, v);
  const scale = computeScale(roi.w, v.targetWidth);
  const { bw, bh } = computeBufferSize(roi, scale, v.rotate);

  const mid = bufferPointToFrame(bw / 2, bh / 2, roi, scale, v.rotate, bw, bh);
  assert.ok(Math.abs(mid.x - fw / 2) < 1.5, `x=${mid.x}`);
  assert.ok(Math.abs(mid.y - fh / 2) < 1.5, `y=${mid.y}`);
});

test('회전 버퍼는 원본을 담을 만큼 커진다', () => {
  const roi = { x: 0, y: 0, w: 100, h: 100 };
  const flat = computeBufferSize(roi, 1, 0);
  const tilted = computeBufferSize(roi, 1, 45);
  assert.equal(flat.bw, 100);
  // 정사각형을 45도 돌리면 대각선 길이(약 141)가 된다.
  assert.ok(tilted.bw > 140 && tilted.bw < 143, `bw=${tilted.bw}`);
});

test('확대 배율은 4배를 넘지 않는다', () => {
  // 아주 작은 ROI 를 아주 큰 목표폭으로 늘려도 상한이 걸려야 한다.
  assert.equal(computeScale(10, 10000), 4);
});

/* --------------------------------------------------------- 명암 보정 */

test('이미 명암이 넓은 영상은 건드리지 않는다', () => {
  const gray = new Uint8Array(1000);
  for (let i = 0; i < gray.length; i++) gray[i] = i % 256;
  assert.equal(buildStretchLut(gray), null, '보정할 필요가 없으면 null');
});

test('거의 단색인 영상은 보정하지 않는다 (잡음만 커진다)', () => {
  const gray = new Uint8Array(1000).fill(128);
  gray[0] = 130;
  assert.equal(buildStretchLut(gray), null);
});

test('좁은 구간에 몰린 영상을 0..255 로 펼친다', () => {
  // 100~150 사이에만 값이 있는 흐릿한 프레임
  const gray = new Uint8Array(2000);
  for (let i = 0; i < gray.length; i++) gray[i] = 100 + (i % 51);
  const lut = buildStretchLut(gray);
  assert.ok(lut, '보정이 필요한 프레임인데 null 이 나왔다');
  applyLut(gray, lut);

  let min = 255, max = 0;
  for (const v of gray) { if (v < min) min = v; if (v > max) max = v; }
  assert.ok(min <= 5,   `보정 후 최소=${min}`);
  assert.ok(max >= 250, `보정 후 최대=${max}`);
});

test('표본 영역을 지정하면 그 바깥(회전 여백)이 분포를 왜곡하지 않는다', () => {
  // 8x8 버퍼: 중앙 4x4 만 내용(100~148), 나머지는 회전 여백(흰색)
  const w = 8, h = 8;
  const gray = new Uint8Array(w * h).fill(255);
  for (let y = 2; y < 6; y++) {
    for (let x = 2; x < 6; x++) {
      gray[y * w + x] = 100 + (x - 2) * 12 + (y - 2) * 4;   // 100 … 148
    }
  }

  const withSample    = buildStretchLut(gray, 1, { bufW: w, bufH: h, x: 2, y: 2, w: 4, h: 4 });
  const withoutSample = buildStretchLut(gray, 7);
  assert.ok(withSample,    '중앙만 보면 보정 대상이다');
  assert.ok(withoutSample, '전체를 봐도 LUT 자체는 나온다');

  // 핵심 — 내용의 가장 밝은 값(148)이 어디로 가는가.
  // 중앙만 보면 꼭대기(255)까지 펴지지만,
  // 흰 여백까지 세면 그 여백이 꼭대기를 차지해 내용이 어두운 쪽에 눌린다.
  assert.equal(withSample[148], 255, `표본 지정 시 148 → ${withSample[148]}`);
  assert.ok(
    withoutSample[148] < 150,
    `여백까지 세면 148 이 눌려야 한다 (실제 ${withoutSample[148]})`,
  );
});

/* ------------------------------------------------------ 그레이스케일 */

test('RGBA 를 휘도로 옮긴다', () => {
  const rgba = new Uint8ClampedArray([
    255, 255, 255, 255,   // 흰색
    0,   0,   0,   255,   // 검정
    255, 0,   0,   255,   // 빨강
  ]);
  const out = new Uint8Array(3);
  toGrayscale(rgba, out);
  assert.equal(out[0], 255);
  assert.equal(out[1], 0);
  // 빨강의 휘도는 대략 0.299 → 76 근처
  assert.ok(out[2] > 70 && out[2] < 82, `red=${out[2]}`);
});

/* ------------------------------------------------------------ 전략 표 */

test('전략 이름은 서로 겹치지 않는다', () => {
  const names = SCAN_VARIANTS.map((v) => v.name);
  assert.equal(new Set(names).size, names.length);
});

test('없는 전략 이름을 찾으면 조용히 넘어가지 않고 멈춘다', () => {
  assert.throws(() => variantIndex('없는전략'), /알 수 없는 스캔 전략/);
});

test('엔진이 구독하는 전략은 모두 실재한다', async () => {
  // engines.ts 는 브라우저 API 를 참조하므로 이름 목록만 대조한다.
  const subscribed = ['wide', 'tele', 'wide-45', 'tele-sharp'];
  for (const name of subscribed) {
    assert.ok(variantIndex(name) >= 0, `${name} 전략이 없다`);
  }
});
