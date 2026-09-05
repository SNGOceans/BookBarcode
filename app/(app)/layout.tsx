import AppShell from '@/components/AppShell';

/**
 * 로그인이 필요한 화면들의 공용 껍데기.
 *
 * 진단 페이지(/scan-lab)는 이 그룹 밖에 둔다 — 로그인 없이 열려야
 * 「이 폰에서 왜 안 읽히나」를 현장에서 바로 볼 수 있다.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
