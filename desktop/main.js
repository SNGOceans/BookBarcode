/**
 * 데스크톱 셸 (Electron).
 *
 * 안드로이드 앱과 같은 방침이다 — **배포된 사이트를 여는 창**이고,
 * 화면과 서버는 웹과 같은 것을 쓴다. 웹을 고치면 설치본도 같이 고쳐진다.
 *
 * 정적으로 말아 넣지 않는 이유는 capacitor.config.ts 의 설명과 같다.
 * 인증·도서 조회·엑셀 생성이 전부 서버 라우트라 떼어낼 수 없다.
 */

const { app, BrowserWindow, session, shell } = require('electron');
const path = require('node:path');

const SITE_URL = process.env.DESKTOP_SITE_URL || 'https://book-barcode.vercel.app';
const SITE_ORIGIN = new URL(SITE_URL).origin;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: '#0f172a',
    title: 'Book Reader',
    autoHideMenuBar: true,
    webPreferences: {
      // 이 창은 남의 코드를 실행하지 않는다. 그래도 기본 격리는 켜 둔다.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 바코드 스캐너는 카메라를 연다. 우리 사이트에서 온 요청만 허용한다.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const from = webContents.getURL();
    const allowed = permission === 'media' && from.startsWith(SITE_ORIGIN);
    callback(allowed);
  });

  // 사이트 밖 링크는 기본 브라우저로 보낸다. 앱 창이 엉뚱한 곳으로 가면 돌아올 길이 없다.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(SITE_ORIGIN)) {
      void shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(SITE_ORIGIN)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  // 연결이 안 되면 흰 화면 대신 안내를 띄운다.
  win.webContents.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
    if (!isMainFrame) return;
    console.error(`로드 실패 ${code} ${desc} — ${failedUrl}`);
    void win.loadFile(path.join(__dirname, 'offline.html'));
  });

  void win.loadURL(SITE_URL);
  return win;
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
