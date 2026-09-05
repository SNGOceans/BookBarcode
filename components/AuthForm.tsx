'use client';

import { useEffect, useState } from 'react';
import Icon from '@/components/Icon';

type Props = {
  onAuthed: (user: { id: string; email: string }) => void;
};

/** 구글 로고. 브랜드 색이 정해져 있어 아이콘 세트에 넣지 않고 여기 둔다. */
function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.7-.4-3.9H24v7.1h12.1c-.2 1.8-1.6 4.6-4.5 6.4l6.9 5.3c4.1-3.8 6.6-9.4 6.6-14.9z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.3c-1.8 1.3-4.3 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C8.1 41.1 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.5 28.5c-.5-1.4-.7-2.9-.7-4.5s.3-3.1.7-4.5l-7.1-5.5C2.9 16.9 2 20.3 2 24s.9 7.1 2.4 10z" />
      <path fill="#EA4335" d="M24 10.6c4.1 0 6.9 1.8 8.5 3.2l6.2-6C34.9 4.3 29.9 2 24 2 15.4 2 8.1 6.9 4.4 14l7.1 5.5c1.8-5.3 6.7-8.9 12.5-8.9z" />
    </svg>
  );
}

export default function AuthForm({ onAuthed }: Props) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode]         = useState<'signin' | 'signup'>('signin');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState<string | null>(null);
  const [info, setInfo]         = useState<string | null>(null);

  // 소셜 로그인은 페이지를 떠났다 돌아온다. 실패 사유는 주소로 실려 온다.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const reason = p.get('auth_error');
    if (!reason) return;
    setErr(reason);
    // 새로고침할 때마다 같은 오류가 다시 뜨지 않게 주소를 정리한다.
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setInfo(null); setBusy(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, email, password }),
      });

      // 빈 본문 / non-JSON 응답에도 안전하게 파싱
      const text = await res.text();
      let json: any = {};
      if (text) {
        try { json = JSON.parse(text); }
        catch { /* keep raw text below */ }
      }

      if (!res.ok) {
        const msg = json?.error
          ?? (text ? text.slice(0, 300) : `HTTP ${res.status}`);
        setErr(msg);
        return;
      }
      if (json.needs_confirmation) {
        setInfo('가입 완료. 이메일 확인 링크를 클릭한 뒤 다시 로그인해 주세요.');
        return;
      }
      if (json.user) {
        // 토큰은 서버가 httpOnly cookie 로 심었으므로 클라이언트에서 다룰 게 없음
        onAuthed(json.user);
      } else {
        setErr('알 수 없는 응답');
      }
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <h2>{mode === 'signin' ? '로그인' : '회원가입'}</h2>

      {/* 페이지를 떠나 구글로 갔다 오는 흐름이라 form 제출이 아니라 링크다. */}
      <a className="auth-google" href="/api/auth/google">
        <GoogleMark />
        <span>Google 계정으로 계속하기</span>
      </a>

      <div className="auth-divider"><span>또는 이메일로</span></div>

      <input
        type="email" required value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="이메일"
        autoComplete="email"
      />
      <input
        type="password" required minLength={6} value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="비밀번호 (6자 이상)"
        autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
      />
      <button type="submit" className="primary" disabled={busy}>
        {busy ? '...' : (mode === 'signin' ? '로그인' : '가입하기')}
      </button>
      {err  && <div className="auth-error"><Icon name="alert" size={15} /> {err}</div>}
      {info && <div className="auth-info">{info}</div>}
      <button
        type="button" className="auth-toggle"
        onClick={() => { setErr(null); setInfo(null); setMode((m) => m === 'signin' ? 'signup' : 'signin'); }}
      >
        {mode === 'signin' ? '계정이 없으신가요? 회원가입' : '이미 계정이 있으신가요? 로그인'}
      </button>
    </form>
  );
}
