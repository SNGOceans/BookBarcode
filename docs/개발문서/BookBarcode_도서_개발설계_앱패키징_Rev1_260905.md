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

## 5. 워크플로

| | 파일 | 언제 | 산출물 |
|---|---|---|---|
| 안드로이드 | `.github/workflows/android.yml` | main(해당 경로 변경)·`v*` 태그·수동 | Actions 산출물, 태그면 릴리스 첨부 |
| 윈도우 | `.github/workflows/desktop.yml` | 같음 | 같음 |

**두 워크플로 모두 산출물 크기를 확인한다.**
빌드가 통과해도 껍데기만 나오는 경우가 있다. 「초록불」을 성공의 근거로 쓰지 않는다.

```
APK      : 1MB 미만이면 실패 처리
Setup.exe: 40MB 미만이면 실패 처리
```

안드로이드는 동기화 뒤 `capacitor.config.json` 의 `server.url` 이 비어 있지 않은지도 본다.
비어 있으면 앱이 빈 화면을 여는데, 빌드는 멀쩡히 통과한다.

**수동 실행 시 주소를 바꿀 수 있다.** Actions → Run workflow 의 입력에
다른 주소를 넣으면 그 주소를 여는 빌드가 나온다. 스테이징 확인용이다.

**릴리스는 태그를 밀 때만.** 평소 push 는 Actions 산출물로만 받는다.

```bash
git tag v1.0.0 && git push origin v1.0.0
```

---

## 6. 아직 안 한 것

- **릴리스 서명.** 안드로이드는 디버그 서명, 윈도우는 미서명이다.
  스토어 배포나 사내 배포 정책이 정해지면 keystore·인증서를 비밀값으로 넣고 바꾼다.
- **앱 아이콘.** 둘 다 기본 아이콘이다.
- **iOS.** 안 만들었다. iOS 는 내장 판독 엔진이 없어 wasm 경로로만 도는데,
  그 인식률을 아직 재지 못했다(`docs/백로그.md`).
