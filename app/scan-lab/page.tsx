'use client';

/**
 * 스캔 진단 페이지.
 *
 * 카메라 없이 합성 바코드를 만들어 이 기기에서 쓸 수 있는 판독 엔진을 전부 재 본다.
 * Node 벤치로는 **브라우저 내장 BarcodeDetector 를 잴 수 없어서** 이 페이지가 필요하다.
 * 「이 폰에서 왜 안 읽히나」를 현장에서 확인하는 용도이기도 하다.
 *
 * 같은 장면 생성기·같은 프레임 준비기를 스캐너 본체와 공유한다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { SCAN_VARIANTS } from '@/lib/scanner/pipeline';
import { createFramePreparer } from '@/lib/scanner/frame';
import { engineSlots, hasNativeDetector, type ScanEngine } from '@/lib/scanner/engines';
import {
  SAMPLE_ISBN,
  SCENE_SEED,
  benchCases,
  ean13Modules,
  renderScene,
  seedRng,
} from '@/lib/scanner/synth';

const SCENE_W = 1280;
const SCENE_H = 720;

type Row = {
  거리: string;
  자세: string;
  품질: string;
  results: Record<string, boolean>;
  hitVariant: Record<string, string>;
};

export default function ScanLabPage() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [engineNames, setEngineNames] = useState<string[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [note, setNote] = useState<string | null>(null);
  const sceneRef = useRef<HTMLCanvasElement>(null);
  const workRef  = useRef<HTMLCanvasElement>(null);

  // 브라우저에만 있는 값(내장 엔진 유무·UA)은 마운트 후에 채운다.
  // 서버 렌더 결과와 다르면 하이드레이션이 깨진다.
  const [env, setEnv] = useState<{ native: boolean; ua: string } | null>(null);
  useEffect(() => {
    setEnv({ native: hasNativeDetector(), ua: navigator.userAgent });
  }, []);

  const run = useCallback(async () => {
    const sceneCanvas = sceneRef.current;
    const workCanvas  = workRef.current;
    if (!sceneCanvas || !workCanvas) return;

    setRunning(true);
    setRows([]);
    setNote(null);
    setProgress(0);

    try {
      const slots = engineSlots();
      const engines: ScanEngine[] = [];
      for (const s of slots) {
        const e = await s.load();
        if (e) engines.push(e);
      }
      if (!engines.length) {
        setNote('이 브라우저에서 쓸 수 있는 판독 엔진이 없습니다.');
        setRunning(false);
        return;
      }
      const names = engines.map((e) => e.name);
      setEngineNames(names);

      const sceneCtx = sceneCanvas.getContext('2d', { willReadFrequently: true });
      const workCtx  = workCanvas.getContext('2d', { willReadFrequently: true });
      if (!sceneCtx || !workCtx) throw new Error('Canvas 2D context 를 쓸 수 없습니다.');

      sceneCanvas.width  = SCENE_W;
      sceneCanvas.height = SCENE_H;

      const prepare = createFramePreparer();
      const modules = ean13Modules(SAMPLE_ISBN);
      const cases = benchCases();
      const tally: Record<string, number> = {};
      for (const n of names) tally[n] = 0;

      const out: Row[] = [];
      const rgba = new Uint8ClampedArray(SCENE_W * SCENE_H * 4);

      for (let i = 0; i < cases.length; i++) {
        const c = cases[i];
        seedRng(SCENE_SEED);
        const gray = renderScene(modules, {
          width: SCENE_W, height: SCENE_H,
          barcodeFrac: c.frac,
          rollDeg: c.pose.rollDeg, yawDeg: c.pose.yawDeg, pitchDeg: c.pose.pitchDeg,
          blur: c.q.blur, contrast: c.q.contrast, glare: c.q.glare, noise: c.q.noise,
        });

        for (let p = 0, g = 0; g < gray.length; g++, p += 4) {
          rgba[p] = rgba[p + 1] = rgba[p + 2] = gray[g];
          rgba[p + 3] = 255;
        }
        sceneCtx.putImageData(new ImageData(rgba, SCENE_W, SCENE_H), 0, 0);

        const results: Record<string, boolean> = {};
        const hitVariant: Record<string, string> = {};

        for (const engine of engines) {
          let hit = false;
          let where = '-';
          for (const vid of engine.variantIds) {
            const v = SCAN_VARIANTS[vid];
            const f = prepare(sceneCanvas, SCENE_W, SCENE_H, v, workCanvas, workCtx);
            let dets;
            try {
              dets = await engine.detectBuffer({ gray: f.gray, width: f.width, height: f.height });
            } catch {
              continue;
            }
            if (dets.some((d) => d.code === SAMPLE_ISBN)) {
              hit = true;
              where = v.name;
              break;
            }
          }
          results[engine.name] = hit;
          hitVariant[engine.name] = where;
          if (hit) tally[engine.name]++;
        }

        out.push({
          거리: `${Math.round(c.frac * 100)}%`,
          자세: c.pose.label,
          품질: c.q.label,
          results,
          hitVariant,
        });

        setProgress(Math.round(((i + 1) / cases.length) * 100));
        setRows([...out]);
        setTotals({ ...tally });
        // 화면이 멈추지 않게 매 케이스마다 양보한다.
        await new Promise((r) => setTimeout(r, 0));
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, []);

  const total = rows.length;

  return (
    <main className="lab">
      <h1>스캔 진단</h1>

      <p className="lab-desc">
        합성 바코드({SAMPLE_ISBN})를 거리·자세·촬영품질별로 만들어
        이 기기에서 쓸 수 있는 판독 엔진을 모두 돌립니다.
        장면 해상도는 {SCENE_W}×{SCENE_H} 이며, 엔진끼리의 비교용 수치입니다.
      </p>

      <div className="lab-env">
        <div>
          내장 BarcodeDetector:{' '}
          {env
            ? <strong className={env.native ? 'ok' : 'no'}>{env.native ? '있음' : '없음'}</strong>
            : <strong className="muted">확인 중…</strong>}
        </div>
        <div className="muted">{env?.ua ?? ''}</div>
      </div>

      <button className="primary" onClick={() => void run()} disabled={running}>
        {running ? `측정 중… ${progress}%` : '▶ 측정 시작'}
      </button>

      {note && <div className="lab-note">⚠ {note}</div>}

      {total > 0 && (
        <>
          <div className="lab-totals">
            {engineNames.map((n) => (
              <div key={n} className="lab-total">
                <span className="lab-total-name">{n}</span>
                <span className="lab-total-value">
                  {totals[n] ?? 0}/{total}
                </span>
              </div>
            ))}
          </div>

          <div className="lab-table-wrap">
            <table className="lab-table">
              <thead>
                <tr>
                  <th>거리</th>
                  <th>자세</th>
                  <th>품질</th>
                  {engineNames.map((n) => <th key={n}>{n}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.거리}</td>
                    <td>{r.자세}</td>
                    <td>{r.품질}</td>
                    {engineNames.map((n) => (
                      <td key={n} className={r.results[n] ? 'ok' : 'no'}>
                        {r.results[n] ? `O ${r.hitVariant[n]}` : 'X'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <canvas ref={sceneRef} className="lab-hidden" />
      <canvas ref={workRef}  className="lab-hidden" />
    </main>
  );
}
