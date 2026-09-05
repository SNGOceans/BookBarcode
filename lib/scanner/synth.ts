/**
 * 합성 바코드 장면 생성기.
 *
 * 카메라 없이 「거리 × 자세 × 촬영품질」을 만들어 판독 엔진을 재는 데 쓴다.
 * Node 벤치(scripts/scan-bench.mjs)와 브라우저 진단 페이지(/scan-lab)가
 * **같은 장면**을 써야 두 결과를 나란히 놓고 볼 수 있다.
 *
 * DOM 에 의존하지 않는다.
 */

/* --------------------------------------------------------------- EAN-13 */

const L = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
const G = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
const R = ['1110010','1100110','1101100','1000010','1011100','1001110','1010000','1000100','1001000','1110100'];
const PARITY = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'];

/** 앞 12자리로 체크digit 을 계산한다. */
export function ean13CheckDigit(first12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 ? 3 : 1);
  return String((10 - (sum % 10)) % 10);
}

/** 13자리 EAN-13 을 95개 모듈(1=검정)로 편다. */
export function ean13Modules(code: string): number[] {
  const d = code.split('').map(Number);
  const parity = PARITY[d[0]];
  let bits = '101';
  for (let i = 0; i < 6; i++) bits += (parity[i] === 'L' ? L : G)[d[i + 1]];
  bits += '01010';
  for (let i = 0; i < 6; i++) bits += R[d[i + 7]];
  bits += '101';
  if (bits.length !== 95) throw new Error(`모듈 수가 95가 아니다: ${bits.length}`);
  return bits.split('').map((c) => (c === '1' ? 1 : 0));
}

/* ------------------------------------------------------------- 난수(고정) */

/**
 * 고정 시드 난수.
 * 잡음을 Math.random 으로 넣으면 실행할 때마다 결과가 흔들려
 * 「좋아졌는지」를 판정할 수 없다. 측정은 재현 가능해야 한다.
 */
let rngState = 0x9e3779b9;
export function seedRng(seed: number): void { rngState = seed >>> 0; }
function rng(): number {
  rngState = (rngState + 0x6d2b79f5) >>> 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/* ------------------------------------------------------------ 장면 렌더링 */

export type ScenePose = {
  label: string;
  /** 화면 안에서 돌아간 각도 */
  rollDeg: number;
  /** 좌우로 기울여 본 각(원근 발생) */
  yawDeg: number;
  /** 위아래로 기울여 본 각(원근 발생) */
  pitchDeg: number;
};

export type SceneQuality = {
  label: string;
  /** 흐림 반경(px) */
  blur: number;
  /** 인쇄 명암(1=진함, 낮을수록 흐린 인쇄·역광) */
  contrast: number;
  /** 반사광 세기(0..1) */
  glare: number;
  /** 잡음 세기(0..1) */
  noise: number;
};

export type SceneOptions = {
  width: number;
  height: number;
  /** 바코드 가로가 화면에서 차지하는 비율(=거리 대용) */
  barcodeFrac: number;
} & Omit<ScenePose, 'label'> & Omit<SceneQuality, 'label'>;

/** Rz(roll)·Ry(yaw)·Rx(pitch) 회전행렬의 1·2열만 돌려준다. */
function planeAxes(rollDeg: number, yawDeg: number, pitchDeg: number) {
  const r = (rollDeg  * Math.PI) / 180;
  const a = (yawDeg   * Math.PI) / 180;
  const p = (pitchDeg * Math.PI) / 180;
  const cr = Math.cos(r), sr = Math.sin(r);
  const ca = Math.cos(a), sa = Math.sin(a);
  const cp = Math.cos(p), sp = Math.sin(p);
  return {
    R1: { x: cr * ca,                y: sr * ca,                z: -sa },
    R2: { x: cr * sa * sp - sr * cp, y: sr * sa * sp + cr * cp, z: ca * sp },
  };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function boxBlurPass(src: Uint8Array, w: number, h: number, r: number, tmp: Uint8Array): void {
  const win = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[row + clamp(i, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = (sum / win) | 0;
      sum += src[row + clamp(x + r + 1, 0, w - 1)] - src[row + clamp(x - r, 0, w - 1)];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += tmp[clamp(i, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      src[y * w + x] = (sum / win) | 0;
      sum += tmp[clamp(y + r + 1, 0, h - 1) * w + x] - tmp[clamp(y - r, 0, h - 1) * w + x];
    }
  }
}

/** 박스 블러 3회 = 가우시안 근사. 초점이 나간 프레임을 흉내낸다. */
function gaussianish(buf: Uint8Array, w: number, h: number, radius: number): void {
  const r = Math.max(1, Math.round(radius));
  const tmp = new Uint8Array(buf.length);
  for (let pass = 0; pass < 3; pass++) boxBlurPass(buf, w, h, r, tmp);
}

/**
 * 바코드가 든 프레임을 그린다(8bit 그레이스케일).
 *
 * 실제 촬영에서 판독을 깨는 것은 각도만이 아니다. 손으로 든 휴대폰은
 * 평면을 비스듬히 보므로 바코드가 사다리꼴로 찌그러지고(원근),
 * 코팅된 표지에는 반사광이 뜨며, 조명은 한쪽으로 기운다.
 * 이 셋을 넣지 않으면 시험이 너무 쉬워져 개선을 잴 수 없다.
 */
export function renderScene(modules: number[], opts: SceneOptions): Uint8Array {
  const {
    width: W, height: H, barcodeFrac,
    rollDeg = 0, yawDeg = 0, pitchDeg = 0,
    blur = 0, contrast = 1, glare = 0, noise = 0,
  } = opts;

  // 평면 좌표계: 바코드 가로를 1 로 두고 거리 D 에서 초점거리 f 로 본다.
  const D = 10;
  const f = W * barcodeFrac * D;
  const { R1, R2 } = planeAxes(rollDeg, yawDeg, pitchDeg);

  const halfU = 0.5;
  const halfV = 0.62 / 2;      // 실제 도서 바코드에 가까운 세로 비율
  const quietU = 0.08;
  const quietV = 0.05;
  const moduleU = 1 / 95;

  const cx = W / 2;
  const cy = H / 2;
  const buf = new Uint8Array(W * H);
  const SS = 3;                // 픽셀당 3×3 초과표본 — 계단현상 제거
  const BG = 200;
  const DARK = 30;
  const LIGHT = 240;

  const targetPx = W * barcodeFrac;
  const glareX = cx + targetPx * 0.22;
  const glareY = cy - targetPx * 0.14;
  const glareR = targetPx * 0.42;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let acc = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS - 0.5 - cx;
          const py = y + (sy + 0.5) / SS - 0.5 - cy;

          // 화면 점 → 평면 좌표 (u, v). 2×2 선형계를 푼다.
          const a11 = px * R1.z - f * R1.x;
          const a12 = px * R2.z - f * R2.x;
          const a21 = py * R1.z - f * R1.y;
          const a22 = py * R2.z - f * R2.y;
          const det = a11 * a22 - a12 * a21;
          if (Math.abs(det) < 1e-9) { acc += BG; continue; }
          const b1 = -px * D;
          const b2 = -py * D;
          const u = (b1 * a22 - a12 * b2) / det;
          const v = (a11 * b2 - b1 * a21) / det;

          if (Math.abs(u) > halfU + quietU || Math.abs(v) > halfV + quietV) { acc += BG; continue; }
          if (Math.abs(u) > halfU || Math.abs(v) > halfV) { acc += LIGHT; continue; }

          const idx = Math.floor((u + halfU) / moduleU);
          acc += modules[Math.min(94, Math.max(0, idx))] ? DARK : LIGHT;
        }
      }

      let g = (acc / (SS * SS)) * (0.78 + 0.32 * (x / W));   // 한쪽으로 기운 조명

      if (glare > 0) {
        const dx = x - glareX;
        const dy = y - glareY;
        const t = Math.exp(-(dx * dx + dy * dy) / (2 * glareR * glareR));
        g = g + (255 - g) * glare * t;
      }
      buf[y * W + x] = g <= 0 ? 0 : g >= 255 ? 255 : g | 0;
    }
  }

  if (blur > 0) gaussianish(buf, W, H, blur);

  if (contrast !== 1 || noise > 0) {
    for (let i = 0; i < buf.length; i++) {
      let g = 128 + (buf[i] - 128) * contrast;
      if (noise > 0) g += (rng() - 0.5) * 255 * noise;
      buf[i] = g <= 0 ? 0 : g >= 255 ? 255 : g | 0;
    }
  }
  return buf;
}

/* ------------------------------------------------------------- 시험 조건 */

/** 손에 든 휴대폰의 자세 */
export const POSES: ScenePose[] = [
  { label: '정면',     rollDeg: 0,  yawDeg: 0,  pitchDeg: 0  },
  { label: '살짝기움', rollDeg: 15, yawDeg: 20, pitchDeg: 10 },
  { label: '많이기움', rollDeg: 35, yawDeg: 30, pitchDeg: 15 },
  { label: '대각',     rollDeg: 45, yawDeg: 15, pitchDeg: 25 },
];

/** 촬영 품질 */
export const QUALITIES: SceneQuality[] = [
  { label: '양호',   blur: 0, contrast: 0.90, glare: 0.15, noise: 0.020 },
  { label: '악조건', blur: 2, contrast: 0.58, glare: 0.45, noise: 0.045 },
];

/** 거리 대용 — 바코드가 화면 가로에서 차지하는 비율 */
export const DISTANCES = [0.40, 0.28, 0.18, 0.12];

/** 시험에 쓰는 도서 ISBN(체크digit 포함) */
export const SAMPLE_ISBN = '978893491551' + ean13CheckDigit('978893491551');

export type BenchCase = { frac: number; pose: ScenePose; q: SceneQuality };

/** 거리 × 자세 × 품질 전 조합 */
export function benchCases(): BenchCase[] {
  const out: BenchCase[] = [];
  for (const frac of DISTANCES) {
    for (const pose of POSES) {
      for (const q of QUALITIES) out.push({ frac, pose, q });
    }
  }
  return out;
}

/** 고정 시드 — 모든 케이스가 같은 잡음에서 출발하게 한다. */
export const SCENE_SEED = 0x5eed0001;
