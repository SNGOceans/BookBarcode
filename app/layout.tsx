import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Book Barcode Scanner',
  description: '책 바코드(ISBN)를 연속으로 스캔합니다.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f172a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
