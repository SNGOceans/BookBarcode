import type { CapacitorConfig } from '@capacitor/cli';

/**
 * 안드로이드 셸 설정.
 *
 * **왜 배포된 사이트를 불러오나 (정적으로 말아 넣지 않는 이유)**
 * 이 앱의 인증·도서 조회·알라딘 메타·엑셀 생성은 전부 서버 라우트(`app/api/*`)다.
 * 정적 내보내기로 APK 안에 넣으면 그 기능이 전부 죽는다.
 * 그래서 앱은 **배포본을 여는 네이티브 셸**로 두고, 화면과 서버는 웹과 같은 것을 쓴다.
 * 웹을 고치면 앱도 같이 고쳐진다 — 앱을 다시 굽지 않아도 된다.
 *
 * ⚠️ 대가: WebView 는 크롬이 아니다. 내장 BarcodeDetector 가 없을 수 있고,
 *    그러면 판독이 wasm 경로로만 돈다. `/scan-lab` 을 앱에서 열어 확인할 것.
 */

const DEFAULT_SITE_URL = 'https://book-barcode.vercel.app';

// ⚠️ `??` 를 쓰면 안 된다.
// CI 의 workflow_dispatch 입력은 값을 안 넣어도 **빈 문자열**로 들어오는데,
// `??` 는 null·undefined 만 거르므로 빈 문자열이 그대로 주소가 된다.
// 그러면 빌드는 멀쩡히 통과하고 앱만 빈 화면을 연다.
const SITE_URL = (process.env.CAP_SERVER_URL || '').trim() || DEFAULT_SITE_URL;

const config: CapacitorConfig = {
  appId: 'com.sngoceans.bookbarcode',
  appName: 'Book Barcode',
  // server.url 을 쓰더라도 webDir 은 존재해야 한다. 연결 실패 시 보여줄 화면을 둔다.
  webDir: 'www',
  server: {
    url: SITE_URL,
    // 카메라(getUserMedia)는 보안 컨텍스트에서만 열린다. http 로 두면 스캐너가 죽는다.
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    // 디버그 빌드에서도 http 평문을 허용하지 않는다. 위 이유와 같다.
    allowMixedContent: false,
  },
};

export default config;
