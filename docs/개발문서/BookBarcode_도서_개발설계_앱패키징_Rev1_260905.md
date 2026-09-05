# BookBarcode 개발설계 — 앱 패키징 (Rev1 · 2026-09-05)

> 대상: 안드로이드 APK 와 윈도우 설치 파일을 GitHub 에서 자동으로 굽는 구조.
> 범위: 왜 이렇게 감쌌는지, 무엇을 확인했고 무엇을 아직 모르는지.

---

## 1. 방침 — 사이트를 여는 셸

두 셸 모두 **배포된 사이트를 여는 창**이다. 화면 코드를 앱 안에 복제하지 않는다.

| | 안드로이드 | 윈도우 |
|---|---|---|
| 기술 | Capacitor 8 | Electron 44 + electron-builder 26 |
| 여는 곳 | `https://book-barcode.vercel.app` | 같음 |
| 산출물 | `app-debug.apk` | `BookReaderSetup.exe` |

**왜 정적으로 말아 넣지 않았나.**
이 앱의 인증·도서 조회·알라딘 메타·엑셀 생성은 전부 서버 라우트(`app/api/*`)다.
정적 내보내기로 APK 안에 넣으면 **그 기능이 전부 죽는다.**
셸로 두면 웹을 고치는 순간 앱과 설치본도 같이 고쳐지고, 다시 굽지 않아도 된다.

**대가.** 오프라인에서는 안내 화면만 뜬다(`www/index.html`, `desktop/offline.html`).
스캔 결과를 서버에 기록하는 앱이라 오프라인 동작은 애초에 성립하지 않는다.

---

## 2. 감쌌을 때 판독 품질이 달라지는가 — 실측

가장 걱정한 것은 **WebView 에 내장 `BarcodeDetector` 가 없어서**
가장 강한 판독 경로를 잃는 것이었다. 재 봤더니 **기우였다.**

같은 배포본을 같은 기기에서 두 환경으로 진단(`/scan-lab`, 합성 32케이스):

| 엔진 | Chrome 134 | 앱 WebView 149 |
|---|---|---|
| 내장 BarcodeDetector | 24/32 | 24/32 |
| zxing | 17/32 | 17/32 |
| zbar | 17/32 | 17/32 |

**세 엔진 모두 동일하다.** 앱으로 감싸도 판독 품질 손실이 없다.
안드로이드 WebView 는 Chromium 기반이고 이 기기에서는 오히려 Chrome 보다 최신이었다.

> ⚠️ **아직 모르는 것** — 위는 합성 이미지 기준이다.
> 실제 카메라 경로에서 `zoom`·`torch` 같은 트랙 제어가 WebView 에서도 노출되는지는 재지 않았다.
> 그 둘은 멀고 어두운 상황을 푸는 실질적 수단이라, 실기기에서 확인이 필요하다.

---

## 3. 안드로이드에서 놓치기 쉬운 것

**카메라 권한을 매니페스트에 선언해야 한다.**
스캐너는 WebView 안에서 `getUserMedia` 로 카메라를 연다.
선언이 없으면 Capacitor 브리지가 그 요청을 **거절**하고 화면에는 오류만 뜬다.
런타임 권한 요청은 브리지가 첫 요청 때 대신 띄운다.

```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-feature android:name="android.hardware.camera" android:required="false" />
```

**`androidScheme: 'https'` 를 유지한다.**
`getUserMedia` 는 보안 컨텍스트에서만 열린다. 평문으로 두면 스캐너가 조용히 죽는다.

**생성물은 커밋하지 않는다.**
`android/app/src/main/assets/capacitor.config.json` 은 `cap sync` 가 만든다.
Capacitor 의 `android/.gitignore` 가 이미 제외하고 있다. 시험용으로 주소를 바꿔 굽더라도
그 값이 저장소로 새지 않는다.

---

## 4. 윈도우에서 놓치기 쉬운 것

**`desktop/` 은 별도 패키지다.**
Electron 의존성을 웹 `package.json` 에 넣으면 Vercel 설치까지 무거워진다.
그리고 `tsconfig.json` 의 `include` 가 `**/*.ts` 라서 데스크톱 코드가
웹 타입검사에 딸려 들어온다 — `exclude` 에 `desktop` 과 `android` 를 넣어 막았다.

**카메라 권한은 출처로 막는다.**
`setPermissionRequestHandler` 에서 `media` 요청을 **우리 사이트 출처일 때만** 허용한다.
무조건 허용하면 창이 어딘가 다른 곳으로 갔을 때 그대로 열린다.

**외부 링크는 기본 브라우저로 보낸다.**
셸 창에 외부 사이트가 열리면 주소창도 뒤로가기도 없어 돌아올 길이 없다.

**서명하지 않는다.**
`CSC_IDENTITY_AUTO_DISCOVERY=false` 로 두지 않으면 서명서를 찾다가 CI 가 멈춘다.
서명 없는 설치 파일은 SmartScreen 경고가 뜬다 — 릴리스 문구에 그 안내를 넣었다.

---

## 5. 워크플로 — `.github/workflows/release.yml` 하나

잡 세 개다. `android`(ubuntu)와 `windows`(windows-latest)가 각각 굽고,
`release` 가 **둘 다 끝난 뒤** 받아서 올린다.

```
android ─┐
         ├─→ release  (needs: [android, windows])
windows ─┘
```

두 워크플로로 나누면 각자 같은 릴리스를 동시에 건드려 경합이 난다.
한 워크플로 안에서 합류시키는 것이 맞다.

| 언제 | 무엇이 되나 |
|---|---|
| main push | `latest` 릴리스를 **지우고 다시 만든다** — 항상 최신을 받는 고정 주소가 유지된다 |
| `v*` 태그 | 그 버전의 정식 릴리스 |
| 수동 실행 | 여는 주소를 바꿔 구울 수 있다(스테이징 확인용) |

### 🚨 경로 필터를 두지 마라 (2026-09-05 실측)

처음에는 `paths` 로 「안드로이드 폴더가 바뀔 때만」 돌게 했다. 두 가지가 겹쳐 터졌다.

1. 릴리스 첨부를 태그일 때로만 걸어 두어 **평소에는 릴리스가 아예 안 생겼다.**
   산출물은 Actions 산출물로만 남는데 30일 뒤 사라지고 받으려면 로그인해야 한다.
2. 한 `push` 트리거에 `branches`·`tags`·`paths` 를 같이 두면
   **태그를 밀어도 경로 필터에 걸려 워크플로가 통째로 건너뛴다.**
   실패로도 안 잡혀서 「왜 안 올라오지」만 남는다.

⇒ 필터를 없앴다. 문서만 고쳐도 빌드가 돌지만 2분이라 감수한다.
**예측 가능한 쪽이 2분보다 비싸다.**

### 확인 단계 — 초록불을 성공의 근거로 쓰지 않는다

빌드가 통과해도 껍데기가 나오는 경우가 있다. 세 곳에서 막는다.

```
APK       : 1MB 미만이면 실패
Setup.exe : 40MB 미만이면 실패
server.url: 비어 있으면 실패 (앱이 빈 화면을 여는데 빌드는 통과한다)
릴리스 자산: 2개가 아니면 실패 (릴리스만 생기고 파일이 안 붙는 경우가 있다)
```

실제로 이 중 `server.url` 검사가 첫 빌드에서 내 버그를 잡았다(§7).

### 릴리스 설명은 heredoc 으로 만들지 마라

YAML 안의 `run:` 블록은 들여쓰기가 붙는다. heredoc 종료 표시가 열 0 에 있어야 하는데
그럴 수 없어 **스크립트가 통째로 깨진다.** 줄 단위 `echo` 로 파일을 만들고
`--notes-file` 로 넘긴다.

---

## 7. 첫 빌드에서 잡힌 것 — 빈 문자열이 주소를 지웠다

`capacitor.config.ts` 를 이렇게 썼다.

```ts
const SITE_URL = process.env.CAP_SERVER_URL ?? DEFAULT;   // ❌
```

CI 의 `workflow_dispatch` 입력은 **값을 안 넣어도 빈 문자열로 들어온다.**
`??` 는 `null`·`undefined` 만 거르므로 `""` 가 그대로 주소가 됐다.
빌드는 성공하고 앱만 빈 화면을 연다.

```ts
const SITE_URL = (process.env.CAP_SERVER_URL || '').trim() || DEFAULT;   // ⭕
```

이 고장은 **워크플로에 넣어 둔 `server.url` 확인 단계가 잡았다.**
그 단계가 없었으면 빈 화면 앱이 릴리스에 올라갔을 것이고,
「빌드 성공」이라는 초록불만 남았을 것이다.

---

## 6. 아직 안 한 것

- **릴리스 서명.** 안드로이드는 디버그 서명, 윈도우는 미서명이다.
  스토어 배포나 사내 배포 정책이 정해지면 keystore·인증서를 비밀값으로 넣고 바꾼다.
- **앱 아이콘.** 둘 다 기본 아이콘이다.
- **iOS.** 안 만들었다. iOS 는 내장 판독 엔진이 없어 wasm 경로로만 도는데,
  그 인식률을 아직 재지 못했다(`docs/백로그.md`).
