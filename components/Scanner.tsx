'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isValidEAN13 } from '@/lib/isbn';
import {
  PresenceGate,
  SCAN_VARIANTS,
  ScanCycle,
  bufferPointToFrame,
} from '@/lib/scanner/pipeline';
import { createFramePreparer } from '@/lib/scanner/frame';
import { engineSlots, type EngineSlot, type ScanEngine } from '@/lib/scanner/engines';
import { logDebug, logError, logInfo, logWarn } from '@/lib/logbus';

type Props = {
  onDetect: (isbn: string) => void;
  active: boolean;
};

/** 영상 위에 겹쳐 그릴 인식 마커 */
type Marker = {
  pts: { x: number; y: number }[];
  locked: boolean;
  at: number;
};

/** 카메라 해상도 사다리 — 높은 쪽부터 시도하고 실패하면 낮춘다. */
const RESOLUTION_LADDER = [
  { width: 2560, height: 1440 },
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
];

/** 마커가 화면에 남아 있는 시간(ms) */
const MARKER_TTL = 420;

export default function Scanner({ onDetect, active }: Props) {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const workRef     = useRef<HTMLCanvasElement>(null);
  const overlayRef  = useRef<HTMLCanvasElement>(null);
  const onDetectRef = useRef(onDetect);
  const gateRef     = useRef(new PresenceGate(1500));
  const markersRef  = useRef<Marker[]>([]);
  const trackRef    = useRef<MediaStreamTrack | null>(null);

  const [error, setError]     = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [aspect, setAspect]   = useState(4 / 3);
  const [locked, setLocked]   = useState(false);
  const [capture, setCapture] = useState<{ w: number; h: number } | null>(null);
  const [stat, setStat]       = useState<{ engine: string; ms: number } | null>(null);
  const [zoom, setZoom]       = useState<{ min: number; max: number; step: number; value: number } | null>(null);
  const [torch, setTorch]     = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false });

  useEffect(() => { onDetectRef.current = onDetect; }, [onDetect]);

  /** 확대 배율 변경 — 원거리 인식의 가장 확실한 지렛대 */
  const applyZoom = useCallback((value: number) => {
    const track = trackRef.current;
    if (!track) return;
    setZoom((z) => (z ? { ...z, value } : z));
    void track
      .applyConstraints({ advanced: [{ zoom: value } as unknown as MediaTrackConstraintSet] })
      .catch(() => { /* 지원하지 않는 기기는 무시 */ });
  }, []);

  /** 조명 토글 — 어두운 곳에서 노출시간을 줄여 흔들림을 없앤다 */
  const toggleTorch = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    setTorch((t) => {
      const next = !t.on;
      void track
        .applyConstraints({ advanced: [{ torch: next } as unknown as MediaTrackConstraintSet] })
        .catch(() => { /* 지원하지 않는 기기는 무시 */ });
      return { ...t, on: next };
    });
  }, []);

  useEffect(() => {
    if (!active) {
      gateRef.current.reset();
      markersRef.current = [];
      setLocked(false);
      return;
    }

    let stopped = false;
    let stream: MediaStream | null = null;
    let rafId: number | null = null;

    // 버퍼를 재사용하는 프레임 준비기(스캐너·진단 페이지 공용)
    const prepare = createFramePreparer();

    let scanInFlight = false;
    let lastScanAt   = 0;
    let scanCost     = 40;   // 직전 스캔 소요(ms) — 스로틀을 여기에 맞춘다

    // 엔진은 필요해질 때 로드한다. 내장 엔진으로 되는 기기는 wasm 을 받지 않는다.
    let slots: EngineSlot[] = [];
    let cycle: ScanCycle | null = null;
    const loaded = new Map<string, ScanEngine>();
    const failed = new Set<string>();

    (async () => {
      try {
        slots = engineSlots();
        if (!slots.length) throw new Error('이 브라우저에서 쓸 수 있는 바코드 판독 엔진이 없습니다.');
        cycle = new ScanCycle(slots.map((s) => s.variantIds.length));
        logInfo('engine.ladder', '판독 엔진 사다리 구성', { order: slots.map((s) => s.name) });

        // 해상도 사다리 — 높은 해상도일수록 멀리 있는 바코드의 바 하나가 더 많은 픽셀을 차지한다.
        for (const res of RESOLUTION_LADDER) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: {
                facingMode: { ideal: 'environment' },
                width:      { ideal: res.width },
                height:     { ideal: res.height },
                frameRate:  { ideal: 30 },
                advanced: [{ focusMode: 'continuous' }] as unknown as MediaTrackConstraintSet[],
              },
              audio: false,
            });
            break;
          } catch {
            stream = null;
          }
        }
        if (!stream) {
          // 마지막 폴백 — 제약 없이 아무 카메라나.
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const video   = videoRef.current;
        const work    = workRef.current;
        const overlay = overlayRef.current;
        if (!video || !work || !overlay) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const track = stream.getVideoTracks()[0] ?? null;
        trackRef.current = track;

        if (track) {
          // 연속 자동초점을 한 번 더 요청한다. getUserMedia 단계에서 무시되는 기기가 있다.
          try {
            await track.applyConstraints({
              advanced: [{ focusMode: 'continuous' } as unknown as MediaTrackConstraintSet],
            });
          } catch { /* 지원하지 않으면 넘어간다 */ }

          const caps = (track.getCapabilities?.() ?? {}) as Record<string, unknown>;
          const zoomCap = caps.zoom as { min: number; max: number; step?: number } | undefined;
          if (zoomCap && typeof zoomCap.max === 'number' && zoomCap.max > zoomCap.min) {
            const settings = (track.getSettings?.() ?? {}) as Record<string, unknown>;
            setZoom({
              min:   zoomCap.min,
              max:   zoomCap.max,
              step:  zoomCap.step && zoomCap.step > 0 ? zoomCap.step : (zoomCap.max - zoomCap.min) / 20,
              value: typeof settings.zoom === 'number' ? settings.zoom : zoomCap.min,
            });
          }
          if ('torch' in caps) setTorch({ supported: true, on: false });
        }

        video.srcObject = stream;
        try { await video.play(); } catch { /* autoplay 정책 */ }
        setRunning(true);
        setError(null);

        const ctx = work.getContext('2d', { willReadFrequently: true });
        if (!ctx) throw new Error('Canvas 2D context 를 사용할 수 없습니다.');
        const octx = overlay.getContext('2d');

        /** 인식 마커를 영상 위에 겹쳐 그린다. */
        const drawOverlay = (now: number) => {
          if (!octx) return;
          const rect = overlay.getBoundingClientRect();
          const dpr  = Math.min(2, window.devicePixelRatio || 1);
          const cw   = Math.max(1, Math.round(rect.width  * dpr));
          const ch   = Math.max(1, Math.round(rect.height * dpr));
          if (overlay.width  !== cw) overlay.width  = cw;
          if (overlay.height !== ch) overlay.height = ch;

          octx.clearRect(0, 0, cw, ch);

          const vw = video.videoWidth;
          const vh = video.videoHeight;
          if (!vw || !vh) return;
          const kx = cw / vw;
          const ky = ch / vh;

          let anyLocked = false;
          const live = markersRef.current.filter((m) => now - m.at < MARKER_TTL);
          markersRef.current = live;

          for (const m of live) {
            const age   = (now - m.at) / MARKER_TTL;
            const alpha = 1 - age * age;
            if (m.locked) anyLocked = true;

            // 확정은 주황, 아직 읽는 중은 노랑.
            const color = m.locked ? '251, 146, 60' : '253, 224, 71';
            const pts   = m.pts.map((p) => ({ x: p.x * kx, y: p.y * ky }));
            if (!pts.length) continue;

            if (pts.length >= 3) {
              octx.beginPath();
              octx.moveTo(pts[0].x, pts[0].y);
              for (let i = 1; i < pts.length; i++) octx.lineTo(pts[i].x, pts[i].y);
              octx.closePath();
              octx.strokeStyle = `rgba(${color}, ${alpha * 0.9})`;
              octx.lineWidth   = 3 * dpr;
              octx.lineJoin    = 'round';
              octx.stroke();
              octx.fillStyle = `rgba(${color}, ${alpha * 0.12})`;
              octx.fill();
            }

            // 꼭짓점 — 「지금 읽고 있다」를 눈으로 보여주는 점
            for (const p of pts) {
              octx.beginPath();
              octx.arc(p.x, p.y, 6 * dpr, 0, Math.PI * 2);
              octx.fillStyle = `rgba(${color}, ${alpha})`;
              octx.fill();
              octx.beginPath();
              octx.arc(p.x, p.y, 10 * dpr, 0, Math.PI * 2);
              octx.strokeStyle = `rgba(${color}, ${alpha * 0.45})`;
              octx.lineWidth   = 2 * dpr;
              octx.stroke();
            }
          }

          setLocked((prev) => (prev === anyLocked ? prev : anyLocked));
        };

        /** 슬롯의 엔진을 필요할 때 로드한다. 실패한 슬롯은 사다리에서 뺀다. */
        const engineFor = async (slot: EngineSlot): Promise<ScanEngine | null> => {
          const cached = loaded.get(slot.name);
          if (cached) return cached;
          if (failed.has(slot.name)) return null;
          const t0 = performance.now();
          const built = await slot.load();
          if (!built) {
            failed.add(slot.name);
            logWarn('engine.unavailable', `${slot.name} 엔진을 쓸 수 없어 사다리에서 제외`, { engine: slot.name });
            const alive = slots.filter((s) => !failed.has(s.name));
            if (alive.length) {
              slots = alive;
              cycle = new ScanCycle(slots.map((s) => s.variantIds.length));
            }
            return null;
          }
          loaded.set(slot.name, built);
          logInfo('engine.load', `${slot.name} 엔진 준비 완료`, {
            engine: slot.name,
            ms: Math.round(performance.now() - t0),
          });
          return built;
        };

        /** 검출 결과를 마커·기록으로 반영한다. */
        const consume = (
          dets: { code: string; points: { x: number; y: number }[] }[],
          toFrame: (p: { x: number; y: number }) => { x: number; y: number },
          now: number,
          engineName: string,
          variantName: string,
        ): boolean => {
          let hit = false;
          const markAt = performance.now();

          for (const d of dets) {
            const pts  = d.points.map(toFrame);
            const full = isValidEAN13(d.code);
            // 부분 인식도 마커로는 보여준다 — 「인식 중」 피드백.
            if (pts.length) markersRef.current.push({ pts, locked: full, at: markAt });
            if (!full) continue;

            hit = true;
            // 같은 책을 계속 비추고 있는 동안에는 한 번만 기록한다.
            if (gateRef.current.see(d.code, now)) {
              logInfo('scan.hit', d.code, { engine: engineName, variant: variantName });
              onDetectRef.current(d.code);
            } else {
              logDebug('scan.dedup', d.code, { reason: '계속 보이는 중 — 중복 기록 억제' });
            }
          }

          gateRef.current.sweep(now);
          return hit;
        };

        /** 한 (엔진, 전략) 조합으로 한 번 스캔한다. */
        const runOnce = async (slot: EngineSlot, variantId: number, now: number): Promise<boolean> => {
          const engine = await engineFor(slot);
          if (!engine) return false;

          const v  = SCAN_VARIANTS[variantId];
          const vw = video.videoWidth;
          const vh = video.videoHeight;

          // 변형이 전혀 없는 전략이고 엔진이 영상을 직접 읽을 수 있으면
          // 캔버스·픽셀 복사를 통째로 건너뛴다. 가장 빠른 경로다.
          const untouched =
            v.crop.wRatio === 1 && v.crop.hRatio === 1 && !v.stretch && !v.sharpen && !v.rotate;
          if (untouched && engine.detectVideo) {
            const dets = await engine.detectVideo(video);
            if (stopped) return false;
            return consume(dets, (p) => p, now, engine.name, `${v.name}(직접)`);
          }

          const f = prepare(video, vw, vh, v, work, ctx);
          const dets = await engine.detectBuffer({ gray: f.gray, width: f.width, height: f.height });
          if (stopped) return false;

          return consume(
            dets,
            (p) => bufferPointToFrame(p.x, p.y, f.roi, f.scale, f.rotate, f.width, f.height),
            now,
            engine.name,
            v.name,
          );
        };

        const tick = async () => {
          if (stopped) return;
          const now = performance.now();
          drawOverlay(now);

          // 직전 스캔 비용에 맞춰 간격을 조절한다. 빠른 경로일수록 더 자주 시도한다.
          const interval = Math.min(200, Math.max(30, scanCost * 0.5));

          if (
            cycle
            && !scanInFlight
            && now - lastScanAt > interval
            && video.readyState >= 2
            && video.videoWidth  > 0
            && video.videoHeight > 0
          ) {
            lastScanAt   = now;
            scanInFlight = true;
            const t0 = performance.now();
            const cur = cycle.current();
            const slot = slots[Math.min(cur.engine, slots.length - 1)];
            try {
              const variantId = slot.variantIds[Math.min(cur.variant, slot.variantIds.length - 1)];
              const ok = await runOnce(slot, variantId, now);
              if (ok) cycle?.hit();
              else    cycle?.miss();
            } catch {
              cycle?.miss();
            } finally {
              scanCost = performance.now() - t0;
              scanInFlight = false;
              if (!stopped) {
                const ms = Math.round(scanCost);
                setStat((p) => (p && p.engine === slot.name && Math.abs(p.ms - ms) < 4 ? p : { engine: slot.name, ms }));
              }
            }
          }
          rafId = requestAnimationFrame(() => { void tick(); });
        };

        // 영상 크기를 알게 되면 컨테이너 비율을 맞춰 잘림 없이 보여준다.
        let lastLoggedRes = '';
        const syncAspect = () => {
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            setAspect(video.videoWidth / video.videoHeight);
            setCapture({ w: video.videoWidth, h: video.videoHeight });
            const res = `${video.videoWidth}x${video.videoHeight}`;
            if (res !== lastLoggedRes) {
              lastLoggedRes = res;
              logInfo('camera.start', `카메라 해상도 ${res}`, {
                width: video.videoWidth,
                height: video.videoHeight,
              });
            }
          }
        };
        video.addEventListener('loadedmetadata', syncAspect);
        video.addEventListener('resize', syncAspect);
        syncAspect();

        rafId = requestAnimationFrame(() => { void tick(); });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        logError('camera.error', msg);
      }
    })();

    return () => {
      stopped = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
      const video = videoRef.current;
      if (video) {
        try { video.pause(); } catch { /* ignore */ }
        try { video.srcObject = null; } catch { /* ignore */ }
      }
      gateRef.current.reset();
      markersRef.current = [];
      setRunning(false);
      setLocked(false);
      setZoom(null);
      setTorch({ supported: false, on: false });
      setCapture(null);
      setStat(null);
    };
  }, [active]);

  return (
    <div className="scanner-wrap">
      <div className="scanner" style={{ aspectRatio: String(aspect) }}>
        <video  ref={videoRef}   className="scanner-video" muted playsInline />
        <canvas ref={workRef}    className="scanner-work" />
        <canvas ref={overlayRef} className="scanner-overlay" />
        <div className={'scan-frame' + (locked ? ' locked' : '')} />
        {active && running && <div className={'scan-line' + (locked ? ' locked' : '')} />}
        {!running && !error && active && <div className="scanner-status">카메라 시작 중…</div>}
        {error && <div className="scanner-status error">⚠ {error}</div>}
        {!active && <div className="scanner-status">⏸ 정지됨. 시작 버튼을 눌러주세요.</div>}
        {running && (
          <div className={'scan-badge' + (locked ? ' locked' : '')}>
            {locked ? '● 바코드 인식 중' : '○ 바코드 찾는 중'}
          </div>
        )}
      </div>

      {running && (
        <div className="scanner-tools">
          {zoom && (
            <label className="zoom">
              <span>확대</span>
              <input
                type="range"
                min={zoom.min}
                max={zoom.max}
                step={zoom.step}
                value={zoom.value}
                onChange={(e) => applyZoom(Number(e.target.value))}
              />
              <span className="zoom-value">{zoom.value.toFixed(1)}×</span>
            </label>
          )}
          {torch.supported && (
            <button
              type="button"
              className={'torch' + (torch.on ? ' on' : '')}
              onClick={toggleTorch}
            >
              {torch.on ? '🔦 조명 끄기' : '🔦 조명 켜기'}
            </button>
          )}
          <span className="scan-meta">
            {capture && <span>{capture.w}×{capture.h}</span>}
            {stat && <span>{stat.engine} · {stat.ms}ms</span>}
          </span>
        </div>
      )}
    </div>
  );
}
