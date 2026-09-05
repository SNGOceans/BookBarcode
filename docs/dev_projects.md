# BookBarcode — 프로젝트 상태

> **이 파일이 「어디까지 했나」의 정본이다.** 새 세션은 코드를 읽기 전에 여기를 먼저 읽는다.
> 자세한 내역은 각 작업노트로 간다.

---

## 정체성

| 항목 | 값 |
|---|---|
| 제품 | 도서 바코드(ISBN) 스캔 → 알라딘 메타·가격 조회 → 목록·엑셀 |
| 저장소 | `SNGOceans/BookBarcode` (main) |
| 배포 | Vercel `book-barcode` — https://book-barcode.vercel.app |
| DB | Supabase `Book` (ref `xtvtfyrlylisnzuuueuw`, Tokyo) |
| 스택 | Next.js 16(App Router) · React 19 · TypeScript 5 · Supabase(자체 쿠키 세션) · ExcelJS |
| 판독 | 내장 BarcodeDetector → zxing-wasm → zbar-wasm (사다리) |

⚠️ 이 프로젝트는 **표준 스택(Hono·Drizzle) 프로젝트가 아니다.** 현행 구조를 따른다.

---

## 진행상황

**2026-09-05 (4) — 화면 개편 · 재고 관리 · 구글 로그인 · 로그 정리 (`a317e17`)**

- **모바일 화면 전면 개편.** 톱바 신설, 사이드바를 왼쪽 접기/펼치기 패널로 재작성,
  목록을 카드→행으로 바꿔 밀도를 4배로, 카메라가 화면을 꽉 채우게, 이모지→SVG 아이콘.
- **재고 관리 신규** — 수량·위치·상태·메모 CRUD. 현재 수량과 이동 원장을 함께 둔다.
- **구글 로그인** — 서버 쿠키 세션 방식 그대로. 토큰이 화면에 노출되지 않는다.
- **플랫폼 로그 일일 정리** — 크론이 하루 한 번 vercel·supabase 로그만 비운다.
- **시각을 한국 시간으로 고정** — 공용 모듈 하나로 모았다. 기기 시간대를 따라가던 문제.
- 판매(POS)는 **설계 문서만** 작성. 착수 전 답이 필요한 6가지를 함께 적었다.
- 상세 = `docs/개발문서/BookBarcode_도서_개발설계_판매시스템_Rev1_260905.md`

**2026-09-05 (3) — 앱 패키징 자동화 · 엑셀 탭 분리 (`34cf689` · `3994d06`)**

- **안드로이드 APK**(Capacitor)와 **윈도우 설치 파일**(Electron, `BookReaderSetup.exe`)을
  GitHub Actions 에서 자동으로 굽는다. 둘 다 배포된 사이트를 여는 셸이다.
- **앱으로 감싸도 판독 품질 동일** — 같은 배포본을 크롬과 앱 WebView 에서 재니
  내장 24/32 · zxing 17/32 · zbar 17/32 로 세 엔진 모두 같았다.
- 엑셀을 **요약 / 검색됨 / 검색 안 됨** 3탭으로 나눴다. 조회 상태는 「찾음·못 찾음·미조회」 3값.
- 상세 = `docs/개발문서/BookBarcode_도서_개발설계_앱패키징_Rev1_260905.md`

**2026-09-05 (2) — 인식 표시 형태 변경 · 단일 인식 · 속도 회귀 수정 (`df29398`)**

- 판독 표시를 **사각형 → 기준선 위의 점**으로 바꿈. 선과 점을 같은 캔버스에서 그린다.
- 한 프레임에 여럿이 잡혀도 **기준선에 가장 가까운 하나만** 기록.
- 속도 회귀 수정 — 탐색 중 싼 조합을 매번 끼우고, 오버레이의 프레임당 비용을 캐시로 제거.
- 전략 폭 축소는 `tele-sharp` 만 인식률에 영향(27→26). 그 값만 되돌려 27 유지.

**2026-09-05 (1) — 스캐너 판독 개편 + 개발자 로그 (`a7a034e`)**

- 인식 실패 네 가지(원거리·흐림·기울기·속도)를 **엔진 사다리 + 전처리 전략 사다리**로 처리.
  안드로이드 크롬 실측: 내장 24/32 · zbar 17/32 · zxing 16/32 — 어느 엔진도 혼자 이기지 못해 순차 위임.
- 같은 책을 계속 비출 때 중복 기록되던 문제를 **보이는 동안 1회** 규칙으로 수정.
- 인식 진행을 영상 위 주황 마커로 실시간 표시.
- 엑셀 서식 단순화 + 주요 열 앞으로 이동.
- 사이드바(카드형 도서 목록 + 개발자 로그 탭) 신설.
- `app_logs` 표 신설, 클라이언트/서버 로그 적재 + Vercel·Supabase 로그 수집 경로 추가.
- 상세 = `docs/작업노트/260905/BookBarcode_도서_작업노트_스캐너개편_260905.md`

---

## 지금 열려 있는 것

### 🔴 사람만 할 수 있는 것 (셋 다 코드는 끝났고 설정만 남았다)

| 무엇 | 왜 막혔나 | 무엇을 하면 되나 |
|---|---|---|
| **재고 기능** | 마이그레이션 `0003` 미적용. Supabase CLI 가 다른 계정으로 로그인돼 있어 `Book` 프로젝트가 안 보인다(403) | `supabase login` 으로 SNGOceans 쪽 계정 전환 후 `supabase db push --dry-run --linked` → `--linked` |
| **구글 로그인** | Supabase 에서 Google 공급자가 꺼져 있다 (`provider is not enabled`) | 대시보드 → Authentication → Providers → Google 켜고 Client ID/Secret 입력, Redirect URL 에 `https://book-barcode.vercel.app/api/auth/callback` 추가 |
| **로그 일일 정리** | 크론은 등록됐으나 `CRON_SECRET` 미설정이라 401 로 아무것도 안 지운다 | `vercel env add CRON_SECRET production --sensitive` |

⚠️ 재고는 마이그레이션 전까지 화면에 「준비되지 않았습니다」로 뜬다. 앱은 정상 동작한다.

### 그 밖에

1. **플랫폼 로그 수집이 아직 안 돈다** — 토큰 4종 미등록. `docs/작업노트/260905/` 참조.
2. **엑셀 「중고최고가」 열 미결** — 알라딘 응답에 해당 값이 없다. `docs/백로그.md` 참조.
3. **iOS 는 안 만들었고 측정도 못 했다** — 내장 판독 엔진이 없어 가장 약한 경로로 돈다. `docs/백로그.md` 참조.
4. **로그 보존 기간 미정** — `app_logs` 가 무한히 쌓인다. `docs/백로그.md` 참조.
5. **앱 서명·아이콘 미정** — 안드로이드는 디버그 서명, 윈도우는 미서명, 아이콘은 기본값.

## 배포물 받는 법

**main 에 커밋이 올라갈 때마다 `latest` 릴리스가 자동으로 갱신된다.**
아래 주소는 바뀌지 않으므로 그대로 공유하면 된다.

```
https://github.com/SNGOceans/BookBarcode/releases/download/latest/BookReaderSetup.exe
https://github.com/SNGOceans/BookBarcode/releases/download/latest/BookReader.apk
```

| 무엇 | 어디서 |
|---|---|
| 웹 | https://book-barcode.vercel.app (main push 시 자동) |
| 최신 앱·설치본 | 위 고정 주소 또는 Releases → 「최신 빌드」 |
| 버전 릴리스 | `git tag v1.0.0 && git push origin v1.0.0` |
| 다른 주소로 굽기 | Actions → Release → Run workflow 에서 주소 입력(스테이징 확인용) |

⚠️ 워크플로에 **경로 필터를 두지 않는다.** 한 push 트리거에 `branches`·`tags`·`paths`
를 같이 두면 태그를 밀었을 때 필터에 걸려 워크플로가 통째로 건너뛴다.
실패로도 안 잡혀 「왜 릴리스가 안 올라오지」만 남는다(2026-09-05 실측).
대가로 문서만 고쳐도 빌드가 돈다 — 2분이라 감수한다.

---

## 문서 위치

| 종류 | 경로 |
|---|---|
| 프로젝트 상태(이 파일) | `docs/dev_projects.md` |
| 작업노트 | `docs/작업노트/{YYMMDD}/` |
| 개발설계 | `docs/개발문서/` |
| 백로그 | `docs/백로그.md` |
