# 소셜 로그인(Google OAuth) 설정 안내

> 코드는 이미 들어가 있다. **이 문서의 설정만 끝나면 그 즉시 동작한다.**
> 여기 나오는 두 단계는 사람이 직접 해야 한다 — 구글 계정 소유자만 할 수 있는 일이다.

---

## 0. 왜 코드만으로는 안 되나

세 가지가 서로 다른 것인데 이름이 비슷해서 자주 헷갈린다.

| 무엇 | 뜻 | 지금 상태 |
|---|---|---|
| Supabase CLI 로그인 | **내가** 프로젝트를 관리할 권한 | 되어 있음 |
| Google OAuth 클라이언트 | **구글이** 우리 앱을 알아보게 하는 자격증명 | 없음 ← 만들어야 함 |
| Supabase 의 Google 공급자 | **앱 사용자**가 구글로 로그인하게 하는 스위치 | 꺼져 있음 ← 켜야 함 |

CLI 에 어떤 계정으로 로그인했든 아래 두 개는 따로 해야 한다.

현재 증상 — 앱에서 구글 버튼을 누르면 Supabase 가 이렇게 답한다.

```json
{"code":400,"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}
```

---

## 1. 구글 클라우드에서 OAuth 클라이언트 만들기

1. https://console.cloud.google.com 접속
2. 상단에서 프로젝트 선택 또는 **새 프로젝트 만들기**
3. 좌측 메뉴 → **API 및 서비스** → **OAuth 동의 화면**
   - User Type: **외부(External)**
   - 앱 이름: `Book Barcode` (사용자에게 보이는 이름이다)
   - 사용자 지원 이메일 / 개발자 연락처: 본인 이메일
   - 범위(Scopes)는 기본값 그대로 둔다 — 이메일과 프로필만 있으면 된다
   - 게시 상태가 **테스트**면 「테스트 사용자」에 로그인할 계정을 추가해야 한다.
     여러 사람이 쓸 거면 **게시(프로덕션)** 로 올린다
4. 좌측 메뉴 → **사용자 인증 정보** → **사용자 인증 정보 만들기** → **OAuth 클라이언트 ID**
   - 애플리케이션 유형: **웹 애플리케이션**
   - 이름: `Book Barcode Web`
5. **승인된 리디렉션 URI** 에 아래를 넣는다

```
https://xtvtfyrlylisnzuuueuw.supabase.co/auth/v1/callback
```

> 🚨 **여기가 가장 많이 틀리는 자리다.**
> 우리 앱 주소(`book-barcode.vercel.app/...`)를 넣으면 안 된다.
> 구글은 **Supabase 로** 돌려보내고, Supabase 가 다시 **우리 앱으로** 돌려보낸다.
> 사슬이 두 단계라 각 단계의 주소를 서로 다른 곳에 등록한다.

6. 만들고 나면 **클라이언트 ID** 와 **클라이언트 보안 비밀번호**가 나온다. 복사해 둔다.

---

## 2. Supabase 에서 Google 공급자 켜기

1. https://supabase.com/dashboard 에서 **Book** 프로젝트 선택
   (ref: `xtvtfyrlylisnzuuueuw`)
2. **Authentication** → **Sign In / Providers** → **Google**
3. **Enable Sign in with Google** 켜기
4. 1단계에서 받은 값을 붙여넣는다
   - Client ID
   - Client Secret
5. **Save**

이어서 우리 앱으로 돌아올 주소를 허용 목록에 넣는다.

6. **Authentication** → **URL Configuration**
7. **Redirect URLs** 에 아래를 추가한다

```
https://book-barcode.vercel.app/api/auth/callback
http://localhost:3000/api/auth/callback
```

> 두 번째 줄은 로컬에서 시험할 때 쓴다. 운영만 쓸 거면 없어도 된다.

8. **Site URL** 이 비어 있으면 `https://book-barcode.vercel.app` 로 채운다.

---

## 3. 확인

설정 직후 바로 확인할 수 있다. 배포를 다시 할 필요는 없다.

**터미널에서 한 줄로:**

```bash
curl -s -o /dev/null -w "%{redirect_url}\n" \
  "https://book-barcode.vercel.app/api/auth/google"
```

- 잘 되면 → `https://accounts.google.com/o/oauth2/v2/auth?...` 로 시작하는 주소가 나온다
- 아직이면 → `.../auth/v1/authorize?provider=google...` 이 나오고, 그 주소를 열면
  `provider is not enabled` 가 보인다

**브라우저에서:**

앱에 접속해 「Google 계정으로 계속하기」를 누른다.
구글 계정 선택 → 승인 → 앱으로 돌아오면서 로그인된 상태가 된다.

---

## 4. 잘 안 될 때

| 증상 | 원인 | 조치 |
|---|---|---|
| `provider is not enabled` | 2단계를 안 했거나 저장이 안 됨 | Supabase → Providers → Google 다시 확인 |
| 구글이 `redirect_uri_mismatch` | 1-5 의 주소가 다름 | 오타·끝 슬래시 확인. `https://<ref>.supabase.co/auth/v1/callback` 정확히 |
| 로그인 후 앱이 아니라 다른 곳으로 감 | 2-7 의 Redirect URLs 누락 | 앱 콜백 주소 추가 |
| `로그인 시간이 지났습니다` | PKCE 쿠키가 10분을 넘김 | 다시 시도. 브라우저를 바꿔 돌아온 경우에도 난다 |
| 「이 앱은 확인되지 않았습니다」 경고 | OAuth 동의 화면이 테스트 상태 | 테스트 사용자에 추가하거나 프로덕션으로 게시 |

---

## 5. 다른 공급자를 더 붙일 때

카카오·네이버·애플 등도 같은 구조다. **코드는 거의 그대로 쓸 수 있다.**

`app/api/auth/google/route.ts` 의 `provider: 'google'` 만 바꾼 경로를 하나 더 만들고,
로그인 화면에 버튼을 더한다. 콜백(`/api/auth/callback`)은 공급자와 무관하게 공용이다.

단, 공급자마다 **Supabase 가 지원하는지 먼저 확인**해야 한다.
지원하지 않는 곳(예: 국내 일부)은 직접 OAuth 를 구현해야 해서 일이 완전히 달라진다.

---

## 6. 우리 쪽 구현이 어떻게 되어 있나 (참고)

세션을 브라우저가 아니라 **서버가 httpOnly 쿠키로** 들고 있다.
비밀번호 로그인과 같은 방식이라, 토큰이 화면에 한 번도 노출되지 않는다.

```
[앱] Google 버튼
  → /api/auth/google        주소를 만들고 PKCE 검증값을 쿠키에 담아 보관
  → accounts.google.com     사용자가 구글에서 승인
  → <ref>.supabase.co/auth/v1/callback
  → /api/auth/callback      코드를 세션으로 바꿔 httpOnly 쿠키에 심음
  → /                       로그인된 상태로 복귀
```

관련 파일

| 파일 | 역할 |
|---|---|
| `app/api/auth/google/route.ts` | 로그인 시작. 구글 주소 생성 + PKCE 검증값 보관 |
| `app/api/auth/callback/route.ts` | 코드 → 세션 교환, 쿠키 설정 |
| `lib/supabase/server.ts` 의 `getOAuthClient` | 서버에 없는 브라우저 저장소를 대신하는 어댑터 |
| `components/AuthForm.tsx` | 구글 버튼, 실패 사유 표시 |
