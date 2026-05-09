'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  onDetect: (isbn: string) => void;
  active: boolean;
};

export default function Scanner({ onDetect, active }: Props) {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const recentRef   = useRef<Map<string, number>>(new Map());
  const onDetectRef = useRef(onDetect);
  const [error, setError]     = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => { onDetectRef.current = onDetect; }, [onDetect]);

  useEffect(() => {
    if (!active) return;

    let stopped       = false;
    let stream: MediaStream | null = null;
    let rafId: number | null       = null;
    let scanInFlight  = false;
    let lastScanAt    = 0;

    (async () => {
      try {
        // zbar-wasm 은 동적 import 로 지연 로딩 (~600KB wasm, 한 번 로드되면 캐시됨)
        const { scanImageData } = await import('@undecaf/zbar-wasm');
        if (stopped) return;

        // 후면 카메라 우선
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width:      { ideal: 1280 },
            height:     { ideal: 720 },
          },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const video  = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        video.srcObject = stream;
        try { await video.play(); } catch { /* user gesture / autoplay 정책 */ }
        setRunning(true);
        setError(null);

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Canvas 2D context 를 사용할 수 없습니다.');

        // 매 프레임 RAF 로 회전, 100ms throttle 로 실제 scan 호출
        const tick = async () => {
          if (stopped) return;
          const now = performance.now();
          if (
            !scanInFlight
            && now - lastScanAt > 100
            && video.readyState >= 2
            && video.videoWidth  > 0
            && video.videoHeight > 0
          ) {
            lastScanAt   = now;
            scanInFlight = true;
            try {
              const w = video.videoWidth;
              const h = video.videoHeight;
              if (canvas.width  !== w) canvas.width  = w;
              if (canvas.height !== h) canvas.height = h;
              ctx.drawImage(video, 0, 0, w, h);
              const img = ctx.getImageData(0, 0, w, h);

              const symbols = await scanImageData(img);
              const ts = Date.now();

              for (const s of symbols) {
                let code: string;
                try { code = s.decode(); } catch { continue; }
                if (!code || !/^\d{13}$/.test(code)) continue;

                const last = recentRef.current.get(code) ?? 0;
                // 같은 코드의 연속 프레임 노이즈만 묶기 위한 짧은 디바운스.
                // 같은 책을 다시 갖다 대면 재인식되어 scan_count 가 누적됨.
                if (ts - last < 500) continue;
                recentRef.current.set(code, ts);
                onDetectRef.current(code);
              }

              for (const [k, v] of recentRef.current) {
                if (ts - v > 3000) recentRef.current.delete(k);
              }
            } catch {
              /* 프레임별 scan 에러는 무시하고 다음 프레임 진행 */
            } finally {
              scanInFlight = false;
            }
          }
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    })();

    return () => {
      stopped = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      const video = videoRef.current;
      if (video) {
        try { video.pause(); } catch { /* ignore */ }
        try { video.srcObject = null; } catch { /* ignore */ }
      }
      setRunning(false);
    };
  }, [active]);

  return (
    <div className="scanner">
      <video    ref={videoRef}  className="scanner-video"  muted playsInline />
      <canvas   ref={canvasRef} className="scanner-canvas" />
      <div className="scan-frame" />
      {active && running && <div className="scan-line" />}
      {!running && !error && active && <div className="scanner-status">카메라 시작 중…</div>}
      {error && <div className="scanner-status error">⚠ {error}</div>}
      {!active && <div className="scanner-status">⏸ 정지됨. 시작 버튼을 눌러주세요.</div>}
    </div>
  );
}
