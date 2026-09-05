/**
 * 스캔 파이프라인 회귀 벤치(Node).
 *
 * 카메라 없이 「거리 × 자세 × 촬영품질」을 합성해 판독 경로를 같은 입력으로 붙인다.
 *
 *   OLD   — 1280×720 프레임 전체를 전처리 없이 zbar 기본 스캐너에(개편 전 동작)
 *   zbar  — 전략 사다리 7종 + EAN-13 전용으로 조인 zbar
 *   zxing — zxing-cpp(tryHarder·tryRotate·tryInvert)
 *   사다리 — zxing 이 먼저, 놓치면 zbar. iOS 처럼 내장 엔진이 없는 기기의 실제 경로
 *
 * 왜 두는가 — 「빌드가 통과했다」는 인식률이 좋아졌다는 증거가 아니다.
 * 파이프라인을 건드린 다음 사람이 숫자로 확인할 수 있어야 한다.
 *
 * ⚠️ 브라우저 내장 BarcodeDetector 는 여기서 잴 수 없다(브라우저 API).
 *    그 경로는 /scan-lab 페이지를 실기기에서 열어 잰다.
 *
 *   실행: npm run bench:scan
 */

import {
  SCAN_VARIANTS,
  computeRoi,
  computeScale,
  computeBufferSize,
  buildStretchLut,
  applyLut,
  unsharpMask,
} from '../lib/scanner/pipeline.ts';
import {
  ean13Modules,
  renderScene,
  benchCases,
  seedRng,
  SCENE_SEED,
  SAMPLE_ISBN,
  POSES,
  QUALITIES,
} from '../lib/scanner/synth.ts';

/* -------------------------------------------------- 리샘플링(캔버스 대역) */

/**
 * ROI 를 잘라 회전·확대/축소해 스캔 버퍼로 옮긴다.
 * 브라우저에서 canvas drawImage 가 하는 일을 Node 에서 흉내낸다.
 * 축소일 때는 면적 평균, 확대일 때는 이중선형.
 */
function resample(src, sw, sh, roi, scale, rotateDeg, bw, bh) {
  const out = new Uint8Array(bw * bh);
  const rad = (rotateDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const inv = 1 / scale;
  const box = scale < 1 ? Math.max(1, Math.round(inv)) : 1;

  const rcx = roi.x + roi.w / 2;
  const rcy = roi.y + roi.h / 2;

  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const dx = x - bw / 2;
      const dy = y - bh / 2;
      const ux =  dx * cos + dy * sin;
      const uy = -dx * sin + dy * cos;
      const fx = rcx + ux * inv;
      const fy = rcy + uy * inv;

      let val;
      if (box > 1) {
        let acc = 0;
        let n = 0;
        const half = box / 2;
        for (let by = -half; by < half; by++) {
          for (let bx = -half; bx < half; bx++) {
            const sxp = Math.round(fx + bx);
            const syp = Math.round(fy + by);
            if (sxp < 0 || syp < 0 || sxp >= sw || syp >= sh) continue;
            acc += src[syp * sw + sxp];
            n++;
          }
        }
        val = n ? acc / n : 255;
      } else {
        val = bilinear(src, sw, sh, fx, fy);
      }
      out[y * bw + x] = val <= 0 ? 0 : val >= 255 ? 255 : val | 0;
    }
  }
  return out;
}

function bilinear(src, w, h, fx, fy) {
  if (fx < 0 || fy < 0 || fx > w - 1 || fy > h - 1) return 255;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const a = src[y0 * w + x0] * (1 - tx) + src[y0 * w + x1] * tx;
  const b = src[y1 * w + x0] * (1 - tx) + src[y1 * w + x1] * tx;
  return a * (1 - ty) + b * ty;
}

/** 프레임 전체를 단순 축소한다(옛 파이프라인의 저해상도 촬영을 흉내). */
function downscale(src, sw, sh, dw, dh) {
  return resample(src, sw, sh, { x: 0, y: 0, w: sw, h: sh }, dw / sw, 0, dw, dh);
}

/* ------------------------------------------------------------- 스캐너 준비 */

const zbar = await import('@undecaf/zbar-wasm');

/** 개편 전 동작 — 기본 스캐너(모든 심볼 종류, 기본 밀도) */
const legacyScanner = await zbar.getDefaultScanner();

/** 개편 후 — EAN-13 전용, 밀도 최대, 불확실성 0, 반전 시도 */
const tunedScanner = await (async () => {
  const s = await zbar.ZBarScanner.create();
  const { ZBarSymbolType: S, ZBarConfigType: C } = zbar;
  s.setConfig(S.ZBAR_NONE,  C.ZBAR_CFG_ENABLE, 0);
  s.setConfig(S.ZBAR_EAN13, C.ZBAR_CFG_ENABLE, 1);
  s.setConfig(S.ZBAR_NONE,  C.ZBAR_CFG_BINARY, 1);
  s.setConfig(S.ZBAR_NONE,  C.ZBAR_CFG_X_DENSITY, 1);
  s.setConfig(S.ZBAR_NONE,  C.ZBAR_CFG_Y_DENSITY, 1);
  s.setConfig(S.ZBAR_EAN13, C.ZBAR_CFG_UNCERTAINTY, 0);
  s.setConfig(S.ZBAR_NONE,  C.ZBAR_CFG_TEST_INVERTED, 1);
  s.setConfig(S.ZBAR_EAN13, C.ZBAR_CFG_POSITION, 1);
  return s;
})();

async function decodeZbar(gray, w, h, scanner) {
  // scanGrayBuffer 는 정확히 w*h 바이트인 ArrayBuffer 를 요구한다.
  const exact = gray.byteLength === w * h && gray.byteOffset === 0
    ? gray.buffer
    : gray.slice(0, w * h).buffer;
  const symbols = await zbar.scanGrayBuffer(exact, w, h, scanner);
  for (const s of symbols) {
    try {
      const code = s.decode();
      if (/^\d{13}$/.test(code)) return code;
    } catch { /* 부분 인식 */ }
  }
  return null;
}

const zxing = await import('zxing-wasm/reader');

/** 그레이 버퍼를 zxing 이 받는 형태(raw RGBA)로 펼친다. */
function grayToImageLike(gray, width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    data[p] = data[p + 1] = data[p + 2] = gray[i];
    data[p + 3] = 255;
  }
  return { data, width, height };
}

async function decodeZxing(gray, w, h) {
  const results = await zxing.readBarcodes(grayToImageLike(gray, w, h), {
    formats: ['EAN13'],
    tryHarder: true,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: true,
    maxNumberOfSymbols: 2,
  });
  for (const r of results) {
    if (r.text && /^\d{13}$/.test(r.text)) return r.text;
  }
  return null;
}

/* ------------------------------------------------------------ 파이프라인들 */

/** 개편 전: 프레임 전체를 그대로 기본 스캐너에 */
const runLegacy = (frame, w, h) => decodeZbar(frame, w, h, legacyScanner);

/**
 * 전략 사다리를 차례로 시도한다.
 * 실사용에서는 틱마다 하나씩 돌지만, 벤치는 「몇 번째 전략에서 읽히나」를 본다.
 */
async function runLadderWith(frame, w, h, decoder, only) {
  for (let i = 0; i < SCAN_VARIANTS.length; i++) {
    const v = SCAN_VARIANTS[i];
    if (only && !only.includes(v.name)) continue;

    const roi = computeRoi(w, h, v);
    const scale = computeScale(roi.w, v.targetWidth);
    const { bw, bh } = computeBufferSize(roi, scale, v.rotate);
    const gray = resample(frame, w, h, roi, scale, v.rotate, bw, bh);

    if (v.stretch) {
      let sample;
      if (v.rotate) {
        const side = Math.round(Math.min(bw, bh) * 0.5);
        sample = { bufW: bw, bufH: bh, x: (bw - side) >> 1, y: (bh - side) >> 1, w: side, h: side };
      }
      const lut = buildStretchLut(gray, 7, sample);
      if (lut) applyLut(gray, lut);
    }
    if (v.sharpen > 0) {
      unsharpMask(gray, bw, bh, v.sharpen, new Uint8Array(bw * bh), new Uint8Array(bw * bh));
    }

    const code = await decoder(gray, bw, bh);
    if (code) return { code, variant: v.name, step: i + 1 };
  }
  return null;
}

const runZbar  = (frame, w, h) => runLadderWith(frame, w, h, (g, bw, bh) => decodeZbar(g, bw, bh, tunedScanner));
const ZXING_ONLY = ['wide', 'tele', 'wide-45', 'tele-sharp'];
const runZxing = (frame, w, h) => runLadderWith(frame, w, h, decodeZxing, ZXING_ONLY);

/** 내장 엔진이 없는 기기(iOS)에서 실제로 도는 사다리 */
async function runCombined(frame, w, h) {
  const a = await runZxing(frame, w, h);
  if (a) return { ...a, engine: 'zxing' };
  const b = await runZbar(frame, w, h);
  return b ? { ...b, engine: 'zbar' } : null;
}

/* -------------------------------------------------------------------- 실행 */

const MODULES = ean13Modules(SAMPLE_ISBN);
const HI = { width: 2560, height: 1440 };   // 개편 후 카메라가 요청하는 해상도
const LO = { width: 1280, height: 720 };    // 개편 전 해상도
const CASES = benchCases();

console.log(`대상 ISBN: ${SAMPLE_ISBN}`);
console.log(`케이스 ${CASES.length}건 — 거리 ${CASES.length / (POSES.length * QUALITIES.length)} × 자세 ${POSES.length} × 품질 ${QUALITIES.length}`);
console.log('');

const rows = [];
let legacyOk = 0;
let zbarOk = 0;
let zxingOk = 0;
let combinedOk = 0;

for (const c of CASES) {
  // 케이스마다 같은 시드로 시작해 결과를 재현 가능하게 만든다.
  seedRng(SCENE_SEED);
  const sceneHi = renderScene(MODULES, {
    width: HI.width, height: HI.height,
    barcodeFrac: c.frac,
    rollDeg: c.pose.rollDeg, yawDeg: c.pose.yawDeg, pitchDeg: c.pose.pitchDeg,
    blur: c.q.blur, contrast: c.q.contrast, glare: c.q.glare, noise: c.q.noise,
  });
  const sceneLo = downscale(sceneHi, HI.width, HI.height, LO.width, LO.height);

  const legacy   = await runLegacy(sceneLo, LO.width, LO.height);
  const zb       = await runZbar(sceneHi, HI.width, HI.height);
  const zx       = await runZxing(sceneHi, HI.width, HI.height);
  const combined = await runCombined(sceneHi, HI.width, HI.height);

  const okLegacy   = legacy === SAMPLE_ISBN;
  const okZbar     = zb?.code === SAMPLE_ISBN;
  const okZxing    = zx?.code === SAMPLE_ISBN;
  const okCombined = combined?.code === SAMPLE_ISBN;

  if (okLegacy)   legacyOk++;
  if (okZbar)     zbarOk++;
  if (okZxing)    zxingOk++;
  if (okCombined) combinedOk++;

  rows.push({
    거리: `${Math.round(c.frac * 100)}%`,
    자세: c.pose.label,
    품질: c.q.label,
    OLD: okLegacy ? 'O' : 'X',
    zbar: okZbar ? 'O' : 'X',
    zxing: okZxing ? 'O' : 'X',
    사다리: okCombined ? 'O' : 'X',
    적중: okCombined ? `${combined.engine}/${combined.variant}` : '-',
  });
}

console.table(rows);

const pct = (n) => `${n}/${CASES.length} (${Math.round((n / CASES.length) * 100)}%)`;
console.log('');
console.log(`OLD    개편 전(1280×720 · 전처리 없음 · 기본 스캐너) : ${pct(legacyOk)}`);
console.log(`zbar   전략 사다리 7종 + EAN-13 전용 스캐너         : ${pct(zbarOk)}`);
console.log(`zxing  zxing-cpp + tryHarder/tryRotate             : ${pct(zxingOk)}`);
console.log(`사다리 zxing 먼저, 놓치면 zbar                      : ${pct(combinedOk)}`);
console.log('');
console.log('※ 내장 BarcodeDetector 는 브라우저 API 라 여기서 잴 수 없다 — 판정 불가.');
console.log('  실기기에서 /scan-lab 을 열어 재기 전까지 그 경로의 인식률을 수치로 주장하지 않는다.');
console.log('');

if (combinedOk < legacyOk) {
  console.error('❌ 새 엔진 사다리가 개편 전보다 못하다. 회귀다.');
  process.exit(1);
}
console.log(`✅ 회귀 없음 — 개편 전 ${legacyOk}건 → 엔진 사다리 ${combinedOk}건`);
