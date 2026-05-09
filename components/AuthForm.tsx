'use client';

import { useState } from 'react';

type Props = {
  onAuthed: (token: string, refresh: string, user: { id: string; email: string }) => void;
};

export default function AuthForm({ onAuthed }: Props) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode]         = useState<'signin' | 'signup'>('signin');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState<string | null>(null);
  const [info, setInfo]         = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setInfo(null); setBusy(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, email, password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setErr(json.error ?? `오류 ${res.status}`);
        return;
      }
      if (json.access_token) {
        onAuthed(json.access_token, json.refresh_token, json.user);
      } else if (json.needs_confirmation) {
        setInfo('가입 완료. 이메일 확인 링크를 클릭한 뒤 다시 로그인해 주세요.');
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
      {err  && <div className="auth-error">⚠ {err}</div>}
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
