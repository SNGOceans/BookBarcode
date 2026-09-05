/**
 * zxing-wasm 의 wasm 바이너리를 public/ 으로 복사한다.
 *
 * 왜 필요한가 — zxing-wasm 은 기본적으로 「자기 스크립트 옆」에서 wasm 을 찾는데,
 * 번들링을 거치면 그 경로가 사라진다. 우리 도메인에서 직접 서빙해야 배포본이 동작한다.
 *
 * 왜 빌드 때마다 복사하는가 — wasm 은 JS 와 **버전이 정확히 맞아야** 한다.
 * 손으로 한 번 복사해 두면 다음 업그레이드 때 조용히 어긋나고,
 * 그 고장은 로컬이 아니라 배포본에서만 난다.
 */
import { copyFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const JOBS = [
  {
    from: join(root, 'node_modules', 'zxing-wasm', 'dist', 'reader', 'zxing_reader.wasm'),
    to:   join(root, 'public', 'zxing_reader.wasm'),
  },
];

mkdirSync(join(root, 'public'), { recursive: true });

let copied = 0;
for (const job of JOBS) {
  if (!existsSync(job.from)) {
    console.error(`[copy-wasm] 원본이 없다: ${job.from}`);
    process.exit(1);
  }
  copyFileSync(job.from, job.to);
  copied++;
  console.log(`[copy-wasm] ${job.to} (${(statSync(job.to).size / 1024 / 1024).toFixed(2)} MB)`);
}

// 0건이면 실패로 끝낸다 — 「조용히 아무것도 안 함」이 가장 비싼 실패 모양이다.
if (copied !== JOBS.length) {
  console.error(`[copy-wasm] ${JOBS.length}건 중 ${copied}건만 복사됐다`);
  process.exit(1);
}
console.log(`[copy-wasm] 완료 — ${copied}/${JOBS.length}건`);
