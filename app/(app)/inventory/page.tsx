'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import InventoryPanel from '@/components/InventoryPanel';

/**
 * 재고 화면.
 *
 * 도서 목록에서 「재고 잡기」를 누르면 `?isbn=...` 로 들어온다.
 * 그 책을 편집 상태로 열어 바로 수량을 넣을 수 있게 한다.
 */
function InventoryInner() {
  const params = useSearchParams();
  const isbn = params.get('isbn');
  return <InventoryPanel focusIsbn={isbn} />;
}

export default function InventoryPage() {
  // useSearchParams 는 정적 생성 시 경계가 필요하다.
  return (
    <Suspense fallback={<div className="pane"><div className="empty"><p>불러오는 중…</p></div></div>}>
      <InventoryInner />
    </Suspense>
  );
}
