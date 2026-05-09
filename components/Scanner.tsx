'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  onDetect: (isbn: string) => void;
  active: boolean;
};

export default function Scanner({ onDetect, active }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const recentRef = useRef<Map<string, number>>(new Map());
  const onDetectRef = useRef(onDetect);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => { onDetectRef.current = onDetect; }, [onDetect]);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let Quagga: any = null;

    const onDetected = (result: any) => {
      const arr = Array.isArray(result) ? result : [result];
      const now = Date.now();
      for (const r of arr) {
        const code: string | undefined = r?.codeResult?.code;
        const format: string | undefined = r?.codeResult?.format;
        if (!code) continue;
        if (format !== 'ean_13') continue;
        const last = recentRef.current.get(code) ?? 0;
        // 같은 코드의 연속 프레임 노이즈만 묶기 위한 짧은 디바운스.
        // 같은 책을 다시 갖다 대면 재인식되어 scan_count 가 누적됨.
        if (now - last < 500) continue;
        recentRef.current.set(code, now);
        onDetectRef.current(code);
      }
      for (const [k, v] of recentRef.current) {
        if (now - v > 3000) recentRef.current.delete(k);
      }
    };

    (async () => {
      try {
        Quagga = (await import('@ericblade/quagga2')).default;
        if (stopped) return;
        await new Promise<void>((resolve, reject) => {
          Quagga.init(
            {
              inputStream: {
                type: 'LiveStream',
                target: containerRef.current!,
                constraints: {
                  facingMode: { ideal: 'environment' },
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                },
                area: { top: '20%', right: '10%', left: '10%', bottom: '20%' },
              },
              locator: { patchSize: 'medium', halfSample: true },
              numOfWorkers:
                typeof navigator !== 'undefined' && navigator.hardwareConcurrency
                  ? Math.min(4, navigator.hardwareConcurrency)
                  : 2,
              frequency: 10,
              decoder: { readers: ['ean_reader'], multiple: true },
              locate: true,
            },
            (err: any) => (err ? reject(err) : resolve()),
          );
        });
        if (stopped) { try { Quagga.stop(); } catch {} return; }
        Quagga.onDetected(onDetected);
        Quagga.start();
        setRunning(true);
        setError(null);
      } catch (e: any) {
        setError(e?.message ?? String(e));
      }
    })();

    return () => {
      stopped = true;
      try { Quagga?.offDetected(onDetected); } catch {}
      try { Quagga?.stop(); } catch {}
      setRunning(false);
    };
  }, [active]);

  return (
    <div className="scanner">
      <div ref={containerRef} className="scanner-viewport" />
      <div className="scan-frame" />
      {active && running && <div className="scan-line" />}
      {!running && !error && active && <div className="scanner-status">카메라 시작 중…</div>}
      {error && <div className="scanner-status error">⚠ {error}</div>}
      {!active && <div className="scanner-status">⏸ 정지됨. 시작 버튼을 눌러주세요.</div>}
    </div>
  );
}
