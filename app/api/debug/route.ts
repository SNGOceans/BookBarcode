/**
 * 임시 진단용 라우트. admin@admin.com 으로 로그인된 cookie 가 있을 때만 응답.
 * 진단이 끝나면 이 파일을 삭제할 것.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireUser } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_EMAIL = 'admin@admin.com';

export async function GET(req: NextRequest) {
  const ctx = await requireUser(req);
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (ctx.user.email !== ADMIN_EMAIL) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = process.env.SUPABASE_URL ?? '';
  const srk = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !srk) {
    return NextResponse.json({ error: 'service role env missing', has_url: !!url, has_srk: !!srk }, { status: 500 });
  }

  // JWT payload 의 role 만 디코딩 (서명검증 X). 'service_role' 이어야 정상.
  let srkRole = 'unknown';
  try {
    const payload = JSON.parse(Buffer.from(srk.split('.')[1], 'base64').toString('utf8'));
    srkRole = payload?.role ?? 'unknown';
  } catch {}

  const admin = createClient(url, srk, { auth: { persistSession: false } });

  const [usersRes, booksRes] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 1000 }),
    admin.from('books').select('id, user_id, isbn, title, scan_count, last_scanned_at')
                       .order('last_scanned_at', { ascending: false }),
  ]);

  const users = usersRes?.data?.users ?? [];
  const books = booksRes?.data ?? [];

  const userEmail: Record<string, string> = {};
  for (const u of users) {
    if (u.id) userEmail[u.id] = u.email ?? '(no email)';
  }

  const countByUser: Record<string, number> = {};
  for (const b of books) {
    countByUser[b.user_id] = (countByUser[b.user_id] ?? 0) + 1;
  }

  const summary = Object.entries(countByUser).map(([uid, n]) => ({
    user_id: uid,
    email: userEmail[uid] ?? '(unknown)',
    books_count: n,
  })).sort((a, b) => b.books_count - a.books_count);

  return NextResponse.json({
    srk_role: srkRole,
    users_total: users.length,
    users_error: usersRes?.error?.message ?? null,
    users_brief: users.map((u) => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      email_confirmed_at: (u as any).email_confirmed_at ?? null,
    })),
    books_total: books.length,
    books_error: booksRes?.error?.message ?? null,
    summary_per_user: summary,
    sample_books: books.slice(0, 10),
  });
}
