/**
 * 프레임 준비 — 영상(또는 이미지)에서 한 전략만큼 잘라 다듬어 그레이 버퍼로 만든다.
 *
 * 스캐너 본체와 진단 페이지가 **같은 함수**를 쓴다.
 * 두 벌로 두면 한쪽만 고쳐지는 순간 진단 결과가 실제와 달라진다.
 */

import {
  applyLut,
  buildStretchLut,
  computeBufferSize,
  computeRoi,
  computeScale,
  toGrayscale,
  unsharpMask,
  type Roi,
  type ScanVariant,
} from './pipeline';

export type PreparedFrame = {
  gray: Uint8Array;
  width: number;
  height: number;
  roi: Roi;
  scale: number;
  rotate: number;
};

/**
 * 버퍼를 재사용하는 준비기를 만든다.
 * 매 프레임 수 MB 를 새로 할당하면 GC 가 스캔 루프를 끊는다.
 */
export function createFramePreparer() {
  let gray: Uint8Array | null = null;
  let scratchA: Uint8Array | null = null;
  let scratchB: Uint8Array | null = null;
  let size = -1;

  return function prepare(
    source: CanvasImageSource,
    sourceW: number,
    sourceH: number,
    variant: ScanVariant,
    canvas: HTMLCanvasElement | OffscreenCanvas,
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  ): PreparedFrame {
    const roi = computeRoi(sourceW, sourceH, variant);
    const scale = computeScale(roi.w, variant.targetWidth);
    const { bw, bh } = computeBufferSize(roi, scale, variant.rotate);

    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;

    // 업샘플링 시 보간 품질을 높여 바 경계를 부드럽게 복원한다.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    if (variant.rotate) {
      // 돌리면 모서리에 빈 곳이 생긴다. 흰색으로 채워야 한다 —
      // 검은 여백은 굵은 바로 오인돼 판독을 망친다.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, bw, bh);
      ctx.translate(bw / 2, bh / 2);
      ctx.rotate((variant.rotate * Math.PI) / 180);
      const dw = roi.w * scale;
      const dh = roi.h * scale;
      ctx.drawImage(source, roi.x, roi.y, roi.w, roi.h, -dw / 2, -dh / 2, dw, dh);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else {
      ctx.drawImage(source, roi.x, roi.y, roi.w, roi.h, 0, 0, bw, bh);
    }

    const rgba = ctx.getImageData(0, 0, bw, bh).data;
    const n = bw * bh;
    if (size !== n) {
      gray = new Uint8Array(n);
      scratchA = new Uint8Array(n);
      scratchB = new Uint8Array(n);
      size = n;
    }
    const g = gray as Uint8Array;
    toGrayscale(rgba, g);

    // 흐리거나 역광인 프레임을 자동으로 펴 준다.
    if (variant.stretch) {
      // 회전 변형은 모서리 흰 여백이 분포를 밝은 쪽으로 끌어당긴다.
      // 여백이 닿지 않는 중앙 정사각형만 표본으로 삼는다.
      let sample;
      if (variant.rotate) {
        const side = Math.round(Math.min(bw, bh) * 0.5);
        sample = { bufW: bw, bufH: bh, x: (bw - side) >> 1, y: (bh - side) >> 1, w: side, h: side };
      }
      const lut = buildStretchLut(g, 7, sample);
      if (lut) applyLut(g, lut);
    }
    if (variant.sharpen > 0) {
      unsharpMask(g, bw, bh, variant.sharpen, scratchA as Uint8Array, scratchB as Uint8Array);
    }

    return { gray: g, width: bw, height: bh, roi, scale, rotate: variant.rotate };
  };
}
