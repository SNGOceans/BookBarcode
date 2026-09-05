/**
 * 스캔 전처리 파이프라인 (순수 함수 모음)
 *
 * 카메라 프레임을 zbar 가 잘 읽을 수 있는 형태로 다듬는다.
 * DOM 에 의존하지 않으므로 Node 에서 그대로 검증할 수 있다.
 */

/** 스캔 대상 영역(원본 프레임 좌표계) */
export type Roi = { x: number; y: number; w: number; h: number };

/** 한 번의 스캔 시도를 정의하는 전략 */
export type ScanVariant = {
  /** 로그·디버깅용 이름 */
  name: string;
  /** 프레임 대비 잘라낼 영역 비율. 1 이면 전체 프레임 */
  crop: { wRatio: number; hRatio: number };
  /** 스캔 버퍼의 목표 가로 길이(px). 원본이 작으면 확대, 크면 축소 */
  targetWidth: number;
  /** 명암 스트레치 적용 여부 */
  stretch: boolean;
  /** 언샤프 마스크 강도. 0 이면 미적용 */
  sharpen: number;
  /**
   * 스캔 전에 영상을 돌릴 각도(도).
   *
   * zbar 는 가로·세로 스캔라인만 쓰므로 0°·90° 부근은 잘 읽지만
   * 그 사이(대략 25°~65°)가 사각지대다. 45° 돌린 판을 한 장 더 만들면
   * 그 구간이 0° 부근으로 옮겨와 덮인다.
   */
  rotate: number;
};

/**
 * 스캔 전략 사다리.
 *
 * 위에서부터 「가깝고 선명하고 반듯한 바코드」용, 아래로 갈수록
 * 「멀고 흐리고 기울어진 바코드」용이다. 한 프레임에 전부 돌리면
 * 프레임률이 무너지므로 틱마다 하나씩 순환시키고, 성공한 전략은
 * 당분간 고정해서 쓴다(빠른 경로).
 */
export const SCAN_VARIANTS: ScanVariant[] = [
  // 0) 전체 프레임 축소 — 가까이 댄 큰 바코드. 가장 싸고 가장 흔한 경우.
  { name: 'wide',        crop: { wRatio: 1.00, hRatio: 1.00 }, targetWidth: 1280, stretch: false, sharpen: 0,   rotate: 0 },
  // 1) 전체 프레임 + 명암 보정 — 조명이 나쁜 경우.
  { name: 'wide-boost',  crop: { wRatio: 1.00, hRatio: 1.00 }, targetWidth: 1440, stretch: true,  sharpen: 0,   rotate: 0 },
  // 2) 중앙 확대 — 멀리 있어 바코드가 작게 잡히는 경우. 업샘플링으로 모듈당 픽셀 수를 늘린다.
  { name: 'tele',        crop: { wRatio: 0.62, hRatio: 0.42 }, targetWidth: 1680, stretch: true,  sharpen: 0,   rotate: 0 },
  // 3) 전체 프레임 45° — 비스듬히 놓인 바코드. zbar 의 각도 사각지대를 덮는다.
  { name: 'wide-45',     crop: { wRatio: 0.94, hRatio: 0.94 }, targetWidth: 1440, stretch: true,  sharpen: 0,   rotate: 45 },
  // 4) 중앙 확대 + 샤프닝 — 멀고 초점까지 나간 경우.
  { name: 'tele-sharp',  crop: { wRatio: 0.62, hRatio: 0.42 }, targetWidth: 2000, stretch: true,  sharpen: 0.9, rotate: 0 },
  // 5) 중앙 45° + 샤프닝 — 멀고 기울어진, 가장 어려운 조합.
  { name: 'tele-45',     crop: { wRatio: 0.70, hRatio: 0.62 }, targetWidth: 1700, stretch: true,  sharpen: 0.7, rotate: 45 },
  // 6) 중앙 넓게 + 샤프닝 — 위 전략들이 놓치는 살짝 벗어난 위치를 덮는다.
  { name: 'mid-sharp',   crop: { wRatio: 0.86, hRatio: 0.62 }, targetWidth: 1800, stretch: true,  sharpen: 0.7, rotate: 0 },
];
// −45° 판은 넣지 않는다. 스캔라인이 가로·세로 양쪽으로 도는 한
// +45° 한 장이면 두 대각선이 모두 0° 또는 90° 로 옮겨와 덮이기 때문이다.

/** 전략 이름으로 인덱스를 찾는다(엔진별 구독 목록을 이름으로 적기 위해). */
export function variantIndex(name: string): number {
  const i = SCAN_VARIANTS.findIndex((v) => v.name === name);
  if (i < 0) throw new Error(`알 수 없는 스캔 전략: ${name}`);
  return i;
}

/** 프레임 크기와 전략으로 실제 잘라낼 영역을 계산한다(중앙 정렬). */
export function computeRoi(frameW: number, frameH: number, v: ScanVariant): Roi {
  const w = Math.max(16, Math.round(frameW * v.crop.wRatio));
  const h = Math.max(16, Math.round(frameH * v.crop.hRatio));
  return {
    x: Math.round((frameW - w) / 2),
    y: Math.round((frameH - h) / 2),
    w,
    h,
  };
}

/**
 * ROI 를 목표 폭으로 리샘플링할 때의 배율.
 *
 * 확대는 4배까지만 허용한다. 그 이상은 정보가 늘지 않으면서 비용만 커진다.
 * 축소는 제한하지 않는다(가까운 바코드는 작게 봐도 읽힌다).
 */
export function computeScale(roiW: number, targetWidth: number): number {
  if (roiW <= 0) return 1;
  const raw = targetWidth / roiW;
  return Math.min(4, Math.max(0.15, raw));
}

/** RGBA 버퍼를 8bit 그레이스케일로 변환한다(ITU-R BT.601 휘도). */
export function toGrayscale(rgba: Uint8ClampedArray | Uint8Array, out: Uint8Array): Uint8Array {
  const n = out.length;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    // 정수 근사(× 1/1024)로 부동소수점 연산을 피한다.
    out[i] = (rgba[p] * 306 + rgba[p + 1] * 601 + rgba[p + 2] * 117) >> 10;
  }
  return out;
}

/**
 * 백분위 기반 명암 스트레치 LUT 를 만든다.
 *
 * 흐리거나 역광인 프레임은 히스토그램이 좁은 구간에 몰려 있어
 * zbar 의 이진화가 바 경계를 못 잡는다. 양 끝 1% 를 잘라내고
 * 남은 구간을 0..255 로 펼쳐 경계를 살린다.
 *
 * 반환값이 null 이면 보정할 필요가 없거나(이미 충분히 넓음)
 * 보정하면 노이즈만 증폭되는 경우(너무 평평함)다.
 */
export function buildStretchLut(
  gray: Uint8Array,
  sampleStride = 7,
  /**
   * 히스토그램을 뽑을 영역. 회전 변형은 모서리가 흰 여백으로 채워지는데
   * 그 여백까지 세면 분포가 밝은 쪽으로 쏠려 보정이 꺼져버린다.
   * 여백이 없는 중앙 영역만 표본으로 삼는다.
   */
  sample?: { bufW: number; bufH: number; x: number; y: number; w: number; h: number },
): Uint8Array | null {
  const hist = new Uint32Array(256);
  let total = 0;

  if (sample) {
    const x1 = Math.max(0, Math.min(sample.bufW, sample.x));
    const y1 = Math.max(0, Math.min(sample.bufH, sample.y));
    const x2 = Math.max(x1, Math.min(sample.bufW, sample.x + sample.w));
    const y2 = Math.max(y1, Math.min(sample.bufH, sample.y + sample.h));
    for (let y = y1; y < y2; y++) {
      const row = y * sample.bufW;
      for (let x = x1; x < x2; x += 3) {
        hist[gray[row + x]]++;
        total++;
      }
    }
  } else {
    for (let i = 0; i < gray.length; i += sampleStride) {
      hist[gray[i]]++;
      total++;
    }
  }
  if (total === 0) return null;

  const cut = Math.max(1, Math.floor(total * 0.01));

  let lo = 0;
  for (let acc = 0, v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= cut) { lo = v; break; }
  }
  let hi = 255;
  for (let acc = 0, v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= cut) { hi = v; break; }
  }

  const span = hi - lo;
  // 이미 거의 전 구간을 쓰고 있으면 건드리지 않는다.
  if (span >= 220) return null;
  // 거의 단색이면 스트레치가 노이즈를 증폭시킨다.
  if (span < 12) return null;

  const lut = new Uint8Array(256);
  const k = 255 / span;
  for (let v = 0; v < 256; v++) {
    const t = (v - lo) * k;
    lut[v] = t <= 0 ? 0 : t >= 255 ? 255 : t | 0;
  }
  return lut;
}

/** LUT 를 제자리에 적용한다. */
export function applyLut(gray: Uint8Array, lut: Uint8Array): void {
  for (let i = 0; i < gray.length; i++) gray[i] = lut[gray[i]];
}

/**
 * 반경 r 의 분리형 박스 블러(누적합 방식).
 * 언샤프 마스크의 저주파 성분을 얻는 데만 쓴다.
 */
function boxBlur(src: Uint8Array, w: number, h: number, r: number, tmp: Uint8Array, dst: Uint8Array): void {
  const win = r * 2 + 1;

  // 가로 방향
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[row + Math.min(w - 1, Math.max(0, i))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = (sum / win) | 0;
      const out = row + Math.min(w - 1, Math.max(0, x - r));
      const inc = row + Math.min(w - 1, Math.max(0, x + r + 1));
      sum += src[inc] - src[out];
    }
  }

  // 세로 방향
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = (sum / win) | 0;
      const out = Math.min(h - 1, Math.max(0, y - r)) * w + x;
      const inc = Math.min(h - 1, Math.max(0, y + r + 1)) * w + x;
      sum += tmp[inc] - tmp[out];
    }
  }
}

/**
 * 언샤프 마스크: gray + amount × (gray − blur).
 *
 * 초점이 나간 프레임의 바 경계를 되살린다. 원본을 제자리에서 고친다.
 * scratch 버퍼 2개를 재사용해 매 프레임 할당을 피한다.
 */
export function unsharpMask(
  gray: Uint8Array,
  w: number,
  h: number,
  amount: number,
  scratchA: Uint8Array,
  scratchB: Uint8Array,
  radius = 2,
): void {
  if (amount <= 0) return;
  boxBlur(gray, w, h, radius, scratchA, scratchB);
  for (let i = 0; i < gray.length; i++) {
    const t = gray[i] + amount * (gray[i] - scratchB[i]);
    gray[i] = t <= 0 ? 0 : t >= 255 ? 255 : t | 0;
  }
}

/**
 * 회전을 적용했을 때 잘린 영역 전체를 담는 스캔 버퍼 크기.
 * 돌린 사각형의 바운딩 박스라서 원본보다 커진다.
 */
export function computeBufferSize(
  roi: Roi,
  scale: number,
  rotateDeg: number,
): { bw: number; bh: number } {
  const w = roi.w * scale;
  const h = roi.h * scale;
  if (!rotateDeg) {
    return { bw: Math.max(16, Math.round(w)), bh: Math.max(16, Math.round(h)) };
  }
  const rad = (rotateDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return {
    bw: Math.max(16, Math.round(w * c + h * s)),
    bh: Math.max(16, Math.round(w * s + h * c)),
  };
}

/**
 * 스캔 버퍼 좌표를 원본 프레임 좌표로 되돌린다.
 * 인식 마커를 영상 위에 겹쳐 그릴 때 쓴다. 회전을 적용했으면 반대로 되돌린다.
 */
export function bufferPointToFrame(
  px: number,
  py: number,
  roi: Roi,
  scale: number,
  rotateDeg = 0,
  bw = 0,
  bh = 0,
): { x: number; y: number } {
  if (!rotateDeg) {
    return { x: roi.x + px / scale, y: roi.y + py / scale };
  }
  const rad = (rotateDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // 버퍼 중심 기준 좌표로 옮긴 뒤 반대 방향으로 회전한다.
  const dx = px - bw / 2;
  const dy = py - bh / 2;
  const ux =  dx * cos + dy * sin;
  const uy = -dx * sin + dy * cos;
  return {
    x: roi.x + roi.w / 2 + ux / scale,
    y: roi.y + roi.h / 2 + uy / scale,
  };
}

/**
 * 같은 바코드를 계속 비추고 있을 때 기록이 중복되지 않게 막는 게이트.
 *
 * 「보이는 동안 1회」가 원칙이다. 코드가 화면에서 사라졌다가
 * (= absenceMs 동안 한 번도 안 잡힘) 다시 나타나야 새 스캔으로 친다.
 * 책을 뗐다가 다시 대면 카운트가 올라가는 기존 동작은 유지된다.
 */
export class PresenceGate {
  private lastSeen = new Map<string, number>();
  private fired = new Set<string>();
  private absenceMs: number;

  // 파라미터 프로퍼티를 쓰지 않는다 — Node 의 타입 스트리핑으로 이 모듈을
  // 그대로 실행해 검증 스크립트에서 재사용하기 위해서다.
  constructor(absenceMs = 1500) {
    this.absenceMs = absenceMs;
  }

  /**
   * 이번 프레임에 code 가 보였음을 알린다.
   * @returns 새 스캔으로 기록해야 하면 true
   */
  see(code: string, now: number): boolean {
    const prev = this.lastSeen.get(code);
    this.lastSeen.set(code, now);

    // 처음 보였거나, 사라졌다가 다시 나타났으면 새 스캔이다.
    const absent = prev === undefined || now - prev > this.absenceMs;
    if (absent || !this.fired.has(code)) {
      this.fired.add(code);
      return true;
    }
    // 계속 보이는 중 — 이미 기록했으므로 무시한다.
    return false;
  }

  /** 사라진 지 오래된 코드를 정리해 다음 등장 때 다시 잡히게 한다. */
  sweep(now: number): void {
    for (const [code, t] of this.lastSeen) {
      if (now - t > this.absenceMs) {
        this.lastSeen.delete(code);
        this.fired.delete(code);
      }
    }
  }

  /** 지금 화면에 보이는 것으로 간주되는 코드인지 */
  isPresent(code: string, now: number): boolean {
    const t = this.lastSeen.get(code);
    return t !== undefined && now - t <= this.absenceMs;
  }

  reset(): void {
    this.lastSeen.clear();
    this.fired.clear();
  }
}

/**
 * 엔진 × 전략 순환기.
 *
 * 엔진은 성능이 좋은 순서로 넣는다(네이티브 → zxing → zbar).
 * 성공한 조합은 고정해 두고 빠르게 반복하며, 연속으로 놓치기 시작하면
 * 같은 엔진의 다음 전략으로, 그것도 다 떨어지면 다음 엔진으로 넘어간다.
 *
 * 카메라·DOM 에 의존하지 않으므로 그대로 검증할 수 있다.
 */
export class ScanCycle {
  private counts: number[];
  private pinLimit: number;
  private engineIdx = 0;
  private variantIdx = 0;
  private pinned = false;
  private missStreak = 0;

  constructor(variantCountPerEngine: number[], pinLimit = 6) {
    if (!variantCountPerEngine.length) throw new Error('엔진이 하나도 없다');
    this.counts = variantCountPerEngine.map((n) => Math.max(1, n));
    this.pinLimit = pinLimit;
  }

  current(): { engine: number; variant: number; pinned: boolean } {
    return { engine: this.engineIdx, variant: this.variantIdx, pinned: this.pinned };
  }

  /** 이번 조합으로 읽어냈다 — 다음 프레임도 같은 조합으로 간다. */
  hit(): void {
    this.pinned = true;
    this.missStreak = 0;
  }

  /** 이번 조합이 놓쳤다. */
  miss(): void {
    if (this.pinned) {
      this.missStreak++;
      // 고정 경로가 연달아 놓치면 상황이 바뀐 것이다. 다시 탐색으로 돌아간다.
      if (this.missStreak > this.pinLimit) {
        this.pinned = false;
        this.missStreak = 0;
        this.advance();
      }
      return;
    }
    this.advance();
  }

  private advance(): void {
    this.variantIdx++;
    if (this.variantIdx >= this.counts[this.engineIdx]) {
      this.variantIdx = 0;
      this.engineIdx = (this.engineIdx + 1) % this.counts.length;
    }
  }

  reset(): void {
    this.engineIdx = 0;
    this.variantIdx = 0;
    this.pinned = false;
    this.missStreak = 0;
  }
}
