/**
 * 모바일 화면 캡처 도구 (디자인 작업용).
 *
 * 왜 필요한가 — 주요 화면이 로그인 뒤에 있어서 눈으로 볼 수가 없다.
 * 계정을 만들어 로그인하는 것은 할 수 없는 일이라, **API 응답만 가로채 가짜로 물리고
 * 진짜 컴포넌트를 그대로 렌더**한다. 제품 코드는 손대지 않는다.
 *
 * 카메라는 크로미움의 가짜 장치를 물려 스캐너 영역까지 실제로 그려지게 한다.
 *
 *   실행: node scripts/design-shots.mjs [출력폴더] [baseURL]
 */

import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = process.argv[2] || 'shots';
const BASE = process.argv[3] || 'http://localhost:3000';

mkdirSync(OUT_DIR, { recursive: true });

/** 화면 배치를 판단하려면 길이가 다양해야 한다. 실제 도서 정보가 아닌 예시다. */
const SAMPLE_BOOKS = [
  {
    id: 1, isbn: '9788934915515', scan_count: 3,
    first_scanned_at: '2026-09-05T01:10:00Z', last_scanned_at: '2026-09-05T03:42:00Z',
    title: '고요한 아침의 나라에서 보낸 열두 달',
    author: '김서연', translator: null, publisher: '한빛출판',
    cover_url: null,
    price_standard: 18000, price_sales: 16200,
    used_price: 9500, used_min_price: 7800, used_count: 14,
    meta_fetched_at: '2026-09-05T01:10:05Z',
  },
  {
    id: 2, isbn: '9791162243411', scan_count: 1,
    first_scanned_at: '2026-09-05T02:05:00Z', last_scanned_at: '2026-09-05T02:05:00Z',
    title: '자료구조',
    author: '박민준', translator: '이하늘', publisher: '초록책방',
    cover_url: null,
    price_standard: 32000, price_sales: 28800,
    used_price: 21000, used_min_price: 18500, used_count: 3,
    meta_fetched_at: '2026-09-05T02:05:04Z',
  },
  {
    id: 3, isbn: '9788901234567', scan_count: 7,
    first_scanned_at: '2026-09-04T22:31:00Z', last_scanned_at: '2026-09-05T03:50:00Z',
    title: '바다와 등대 그리고 오래된 편지들에 관한 아주 긴 제목의 산문집',
    author: '최지우', translator: null, publisher: '푸른모래',
    cover_url: null,
    price_standard: 15500, price_sales: 13950,
    used_price: null, used_min_price: null, used_count: null,
    meta_fetched_at: '2026-09-04T22:31:06Z',
  },
  {
    id: 4, isbn: '9788999887766', scan_count: 1,
    first_scanned_at: '2026-09-05T03:20:00Z', last_scanned_at: '2026-09-05T03:20:00Z',
    title: null,
    author: null, translator: null, publisher: null,
    cover_url: null,
    price_standard: null, price_sales: null,
    used_price: null, used_min_price: null, used_count: null,
    meta_fetched_at: '2026-09-05T03:20:03Z',
  },
];

const SAMPLE_INVENTORY = [
  {
    id: 1, quantity: 4, location: 'A-3 선반', condition: '중고 상', memo: null,
    updated_at: '2026-09-05T03:40:00Z',
    isbn: '9788934915515', title: '고요한 아침의 나라에서 보낸 열두 달',
    author: '김서연', publisher: '한빛출판', price_standard: 18000, used_price: 9500,
  },
  {
    id: 2, quantity: 1, location: 'B-1 박스', condition: null, memo: '표지 모서리 눌림',
    updated_at: '2026-09-05T02:10:00Z',
    isbn: '9791162243411', title: '자료구조',
    author: '박민준', publisher: '초록책방', price_standard: 32000, used_price: 21000,
  },
  {
    id: 3, quantity: 0, location: null, condition: null, memo: null,
    updated_at: '2026-09-04T23:05:00Z',
    isbn: '9788901234567', title: '바다와 등대 그리고 오래된 편지들에 관한 아주 긴 제목의 산문집',
    author: '최지우', publisher: '푸른모래', price_standard: 15500, used_price: null,
  },
];

const SAMPLE_LOGS = [
  { id: 5, source: 'client', level: 'info',  event: 'scan.hit',      message: '9788934915515', meta: { engine: 'native', variant: 'wide' },  logged_at: '2026-09-05T03:50:11Z' },
  { id: 4, source: 'client', level: 'debug', event: 'scan.dedup',    message: '9788934915515', meta: { reason: '계속 보이는 중' },           logged_at: '2026-09-05T03:50:10Z' },
  { id: 3, source: 'client', level: 'info',  event: 'engine.load',   message: 'native 엔진 준비 완료', meta: { ms: 12 },                    logged_at: '2026-09-05T03:49:58Z' },
  { id: 2, source: 'client', level: 'info',  event: 'camera.start',  message: '카메라 해상도 1920x1080', meta: { width: 1920, height: 1080 }, logged_at: '2026-09-05T03:49:57Z' },
  { id: 1, source: 'client', level: 'warn',  event: 'book.record.fail', message: 'invalid barcode', meta: { isbn: '0000000000000' },        logged_at: '2026-09-05T03:48:02Z' },
];

async function mockApi(page) {
  await page.route('**/api/auth/me', (r) =>
    r.fulfill({ json: { user: { id: 'demo-user', email: 'demo@example.com' } } }));
  await page.route('**/api/books', (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: { books: SAMPLE_BOOKS } });
    return r.fulfill({ json: { book: SAMPLE_BOOKS[0] } });
  });
  await page.route('**/api/logs**', (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: { logs: SAMPLE_LOGS } });
    return r.fulfill({ json: { inserted: 0 } });
  });
  await page.route('**/api/inventory**', (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: { items: SAMPLE_INVENTORY } });
    return r.fulfill({ json: { item: SAMPLE_INVENTORY[0] } });
  });
}

/** 스캐너의 애니메이션이 캡처마다 달라지지 않게 잠깐 재운다. */
const settle = (page) => page.waitForTimeout(1200);

async function shoot(page, name) {
  const file = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  ${file}`);
}

const browser = await chromium.launch({
  args: [
    // 카메라가 없는 환경이라 가짜 장치를 물린다. 없으면 스캐너가 오류 화면만 보여준다.
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
  ],
});

try {
  // ---------- 모바일 ----------
  const phone = await browser.newContext({
    ...devices['Pixel 7'],
    permissions: ['camera'],
    locale: 'ko-KR',
  });
  const page = await phone.newPage();
  await mockApi(page);

  console.log('모바일 캡처');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await settle(page);
  await shoot(page, 'm1-홈');

  // 스캔 시작 — 카메라가 열린 상태
  const startBtn = page.getByRole('button', { name: /스캔 시작/ });
  if (await startBtn.count()) {
    await startBtn.click();
    await page.waitForTimeout(2500);
    await shoot(page, 'm2-스캔중');
    await page.getByRole('button', { name: /스캔 정지/ }).click().catch(() => {});
    await page.waitForTimeout(400);
  }

  // 왼쪽 패널 — 도서 탭
  const openBtn = page.locator('.topbar-toggle');
  if (await openBtn.count()) {
    await openBtn.click();
    await settle(page);
    await shoot(page, 'm3-목록');

    // 왼쪽 패널 — 재고 탭
    // ⚠️ 이름으로 찾으면 패널 밖의 다른 버튼과 겹친다. 탭 자체를 짚는다.
    const invTab = page.locator('.panel-tab', { hasText: '재고' });
    if (await invTab.count()) {
      await invTab.first().click();
      await page.waitForTimeout(900);
      await shoot(page, 'm4-재고');
      // 편집 폼을 펼친 모습도 남긴다
      const edit = page.locator('.inv-edit').first();
      if (await edit.count()) {
        await edit.click();
        await page.waitForTimeout(500);
        await shoot(page, 'm5-재고편집');
      }
    }

    // 왼쪽 패널 — 로그 탭
    const logTab = page.locator('.panel-tab', { hasText: '로그' });
    if (await logTab.count()) {
      await logTab.first().click();
      await page.waitForTimeout(700);
      await shoot(page, 'm6-로그');
    }
  } else {
    throw new Error('패널 여는 버튼(.topbar-toggle)을 못 찾았다 — 선택자가 낡았다');
  }

  // 로그인 화면
  const anon = await browser.newContext({ ...devices['Pixel 7'], locale: 'ko-KR' });
  const anonPage = await anon.newPage();
  await anonPage.route('**/api/auth/me', (r) => r.fulfill({ json: { user: null } }));
  await anonPage.goto(BASE, { waitUntil: 'networkidle' });
  await settle(anonPage);
  await shoot(anonPage, "m7-로그인");
  await anon.close();
  await phone.close();

  // ---------- 데스크톱 ----------
  console.log('데스크톱 캡처');
  const desk = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    permissions: ['camera'],
    locale: 'ko-KR',
  });
  const deskPage = await desk.newPage();
  await mockApi(deskPage);
  await deskPage.goto(BASE, { waitUntil: 'networkidle' });
  await settle(deskPage);
  await shoot(deskPage, 'd1-홈');
  await desk.close();

  console.log('완료');
} finally {
  await browser.close();
}
