/**
 * 바코드 판독 엔진 사다리.
 *
 * 한 엔진에 걸지 않는 이유 — 공개 벤치마크들이 공통으로 보여주는 것은
 * 「흐리거나 작게 잡힌 바코드에서는 어느 오픈소스 엔진도 혼자서는 무너진다」다.
 * 그래서 성능이 좋은 순서로 세워 두고, 앞 엔진이 놓치면 뒤 엔진이 받는다.
 *
 *  1. native  — 브라우저 내장 BarcodeDetector. 안드로이드 크롬에 구글 엔진이 들어 있어
 *               기울기·흐림·거리에 가장 강하고, 영상을 그대로 넘길 수 있어 픽셀 복사가 0 이다.
 *               iOS 사파리에는 아직 없다.
 *  2. zxing   — zxing-cpp 의 wasm 빌드. tryHarder·tryRotate·tryInvert 를 갖고 있어
 *               iOS 에서 native 를 대신한다.
 *  3. zbar    — 기존 엔진. 반듯하고 선명한 바코드에 여전히 빠르고 정확해서 마지막 보루로 남긴다.
 */

import { variantIndex } from './pipeline';

/** 엔진이 돌려주는 판독 결과. 좌표는 넘겨준 버퍼(또는 영상)의 좌표계다. */
export type Detection = {
  /** 디코드된 문자열. 부분 인식이라 못 읽었으면 빈 문자열 */
  code: string;
  points: { x: number; y: number }[];
};

export type EngineName = 'native' | 'zxing' | 'zbar';

export type BufferInput = {
  gray: Uint8Array;
  width: number;
  height: number;
};

export type ScanEngine = {
  readonly name: EngineName;
  /** 이 엔진이 순환할 SCAN_VARIANTS 인덱스 */
  readonly variantIds: number[];
  /** 영상에서 바로 읽을 수 있으면 전처리 자체를 건너뛴다(가장 빠른 경로) */
  detectVideo?: (video: HTMLVideoElement) => Promise<Detection[]>;
  detectBuffer: (input: BufferInput) => Promise<Detection[]>;
};

/** 그레이스케일 버퍼를 RGBA ImageData 로 펼친다(버퍼 재사용). */
function makeRgbaExpander() {
  // ImageData 는 ArrayBuffer 를 기반으로 한 뷰만 받는다.
  // ArrayBuffer 를 먼저 만들어 두어야 타입이 좁혀진다.
  let rgba: Uint8ClampedArray<ArrayBuffer> | null = null;
  let size = -1;
  return (gray: Uint8Array, width: number, height: number): ImageData => {
    const n = width * height;
    if (size !== n) {
      rgba = new Uint8ClampedArray(new ArrayBuffer(n * 4));
      size = n;
      // 알파는 한 번만 채우면 이후로 바뀌지 않는다.
      for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
    }
    const buf = rgba as Uint8ClampedArray<ArrayBuffer>;
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const g = gray[i];
      buf[p] = g;
      buf[p + 1] = g;
      buf[p + 2] = g;
    }
    return new ImageData(buf, width, height);
  };
}

/* ------------------------------------------------------------------ native */

type NativeDetectorLike = {
  detect: (source: CanvasImageSource | ImageData) => Promise<
    { rawValue: string; cornerPoints?: { x: number; y: number }[] }[]
  >;
};

function nativeCtor() {
  return (globalThis as unknown as {
    BarcodeDetector?: {
      new (opts?: { formats?: string[] }): NativeDetectorLike;
      getSupportedFormats?: () => Promise<string[]>;
    };
  }).BarcodeDetector;
}

/** 내장 엔진이 있는지 동기로 확인한다(로드 전에 사다리를 세우기 위해). */
export function hasNativeDetector(): boolean {
  return typeof nativeCtor() === 'function';
}

async function createNativeEngine(): Promise<ScanEngine | null> {
  const Ctor = nativeCtor();
  if (!Ctor) return null;

  try {
    // ean_13 지원을 **명시적으로 확인**될 때만 쓴다.
    // 안드로이드에서 내장 판독은 Play 서비스 모듈이 있어야 동작하고,
    // 없으면 생성자는 멀쩡한데 목록이 비고 detect 가 늘 빈 배열을 준다.
    // 「조용히 아무것도 못 읽는 엔진」이 사다리 맨 앞에 서는 것이 가장 나쁘다.
    const formats = (await Ctor.getSupportedFormats?.()) ?? [];
    if (!formats.includes('ean_13')) return null;

    const detector = new Ctor({ formats: ['ean_13'] });
    const expand = makeRgbaExpander();

    const toDetections = (
      raw: { rawValue: string; cornerPoints?: { x: number; y: number }[] }[],
    ): Detection[] =>
      raw.map((r) => ({
        code: r.rawValue ?? '',
        points: (r.cornerPoints ?? []).map((p) => ({ x: p.x, y: p.y })),
      }));

    const engine: ScanEngine = {
      name: 'native',
      // 내장 엔진이 기울기·흐림을 스스로 처리하므로 우리 보정 전략은 최소만 쓴다.
      variantIds: NATIVE_VARIANTS(),
      detectVideo: async (video) => toDetections(await detector.detect(video)),
      detectBuffer: async ({ gray, width, height }) =>
        toDetections(await detector.detect(expand(gray, width, height))),
    };

    return engine;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------- zxing */

async function createZxingEngine(): Promise<ScanEngine | null> {
  try {
    const mod = await import('zxing-wasm/reader');
    // wasm 은 우리 도메인에서 서빙한다(scripts/copy-wasm.mjs 가 public/ 에 복사).
    mod.prepareZXingModule({
      overrides: { locateFile: (path: string) => (path.endsWith('.wasm') ? '/zxing_reader.wasm' : path) },
    });

    const expand = makeRgbaExpander();

    const engine: ScanEngine = {
      name: 'zxing',
      variantIds: ZXING_VARIANTS(),
      detectBuffer: async ({ gray, width, height }) => {
        const results = await mod.readBarcodes(expand(gray, width, height), {
          formats: ['EAN13'],
          // 정확도 우선. 놓치는 것보다 한 프레임 늦는 편이 낫다.
          tryHarder: true,
          tryRotate: true,
          tryInvert: true,
          tryDownscale: true,
          // 한 번에 하나만 기록하므로 엔진에도 하나만 요구한다(그만큼 빨라진다).
          maxNumberOfSymbols: 1,
        });
        return results.map((r) => {
          const p = r.position;
          return {
            code: r.text ?? '',
            points: p ? [p.topLeft, p.topRight, p.bottomRight, p.bottomLeft] : [],
          };
        });
      },
    };

    return engine;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------- zbar */

async function createZbarEngine(): Promise<ScanEngine | null> {
  try {
    const zbar = await import('@undecaf/zbar-wasm');
    const scanner = await zbar.ZBarScanner.create();
    const { ZBarSymbolType: S, ZBarConfigType: C } = zbar;

    // EAN-13 만 켠다. 심볼 종류를 줄이면 한 프레임당 비용이 크게 떨어져
    // 초당 시도 횟수를 늘릴 수 있다(스캔 속도에 직접 기여).
    scanner.setConfig(S.ZBAR_NONE,  C.ZBAR_CFG_ENABLE, 0);
    scanner.setConfig(S.ZBAR_EAN13, C.ZBAR_CFG_ENABLE, 1);
    scanner.setConfig(S.ZBAR_NONE,  C.ZBAR_CFG_BINARY, 1);
    // 스캔 라인 간격을 최소로 — 멀리 있어 작게 잡힌 바코드를 놓치지 않는다.
    scanner.setConfig(S.ZBAR_NONE,  C.ZBAR_CFG_X_DENSITY, 1);
    scanner.setConfig(S.ZBAR_NONE,  C.ZBAR_CFG_Y_DENSITY, 1);
    // 첫 판독에서 바로 보고. 오검출은 EAN-13 체크digit 으로 걸러낸다.
    scanner.setConfig(S.ZBAR_EAN13, C.ZBAR_CFG_UNCERTAINTY, 0);
    // 반전 인쇄·역광 프레임도 한 번 더 시도.
    scanner.setConfig(S.ZBAR_NONE,  C.ZBAR_CFG_TEST_INVERTED, 1);
    // 마커를 그리려면 좌표가 필요하다.
    scanner.setConfig(S.ZBAR_EAN13, C.ZBAR_CFG_POSITION, 1);

    const engine: ScanEngine = {
      name: 'zbar',
      // zbar 는 스스로 각도·흐림을 못 다루므로 우리 보정 전략을 전부 쓴다.
      variantIds: ZBAR_VARIANTS(),
      detectBuffer: async ({ gray, width, height }) => {
        // scanGrayBuffer 는 정확히 width*height 바이트인 ArrayBuffer 를 요구한다.
        const symbols = await zbar.scanGrayBuffer(gray.buffer as ArrayBuffer, width, height, scanner);
        return symbols.map((s) => {
          let code = '';
          try { code = s.decode(); } catch { /* 부분 인식 심볼 */ }
          return { code, points: (s.points ?? []).map((p) => ({ x: p.x, y: p.y })) };
        });
      },
    };

    return engine;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ 사다리 */

/**
 * 아직 로드하지 않은 엔진 자리.
 *
 * 전략 목록은 미리 알 수 있으므로 사다리는 먼저 세우고,
 * 실제 엔진(=wasm)은 순환이 그 자리에 처음 닿을 때 불러온다.
 * 내장 엔진으로 다 되는 기기는 wasm 을 한 바이트도 받지 않는다.
 */
export type EngineSlot = {
  name: EngineName;
  variantIds: number[];
  load: () => Promise<ScanEngine | null>;
};

const ZXING_VARIANTS = () => [
  variantIndex('wide'),
  variantIndex('tele'),
  variantIndex('wide-45'),
  variantIndex('tele-sharp'),
];

const NATIVE_VARIANTS = () => [variantIndex('wide'), variantIndex('tele')];

const ZBAR_VARIANTS = () => [0, 1, 2, 3, 4, 5, 6];

/**
 * 쓸 수 있는 엔진 자리를 성능 순으로 세워 돌려준다.
 * 하나도 없으면 빈 배열이다 — 호출부는 그 경우를 오류로 처리해야 한다.
 */
export function engineSlots(): EngineSlot[] {
  const slots: EngineSlot[] = [];
  if (hasNativeDetector()) {
    slots.push({ name: 'native', variantIds: NATIVE_VARIANTS(), load: createNativeEngine });
  }
  slots.push({ name: 'zxing', variantIds: ZXING_VARIANTS(), load: createZxingEngine });
  slots.push({ name: 'zbar',  variantIds: ZBAR_VARIANTS(),  load: createZbarEngine });
  return slots;
}
