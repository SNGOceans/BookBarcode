/**
 * 아이콘 세트.
 *
 * 이모지를 쓰지 않는다 — 기기·OS 마다 모양과 크기가 제각각이고 색을 맞출 수 없어
 * 화면이 통일되지 않는다. 선 굵기와 색을 글자에 맞출 수 있는 SVG 로 둔다.
 *
 * 모두 24 격자, 선 기반, `currentColor`. 크기는 `size` 로만 바꾼다.
 */

type Props = {
  name: IconName;
  size?: number;
  className?: string;
  /** 뜻을 담은 아이콘이면 이름을 준다. 장식이면 비운다(스크린리더가 건너뛴다). */
  label?: string;
};

export type IconName =
  | 'book' | 'list' | 'terminal' | 'close' | 'download' | 'refresh'
  | 'play' | 'stop' | 'zoom' | 'flash' | 'copy' | 'trash' | 'logout'
  | 'search' | 'check' | 'alert' | 'sync' | 'cart' | 'shield'
  | 'chevron-right' | 'chevron-down' | 'chevron-up'
  | 'panel-open' | 'panel-close' | 'plus' | 'minus' | 'edit';

const PATHS: Record<IconName, React.ReactNode> = {
  book: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5A2.5 2.5 0 0 1 4 20.5z" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h12M8 12h12M8 18h12" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" />
    </>
  ),
  terminal: (
    <>
      <path d="M5 7l4 4-4 4" />
      <path d="M12 15h7" />
      <rect x="2" y="3" width="20" height="18" rx="2.5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  download: (
    <>
      <path d="M12 3v12" />
      <path d="M7 11l5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 6.3" />
      <path d="M20 5v6h-6" />
    </>
  ),
  play: <path d="M7 4.5l12 7.5-12 7.5z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  zoom: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5L21 21" />
      <path d="M8 10.5h5M10.5 8v5" />
    </>
  ),
  flash: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
      <path d="M9 7V4h6v3" />
    </>
  ),
  logout: (
    <>
      <path d="M15 12H4" />
      <path d="M8 8l-4 4 4 4" />
      <path d="M10 4h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-8" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5L21 21" />
    </>
  ),
  check: <path d="M4 12.5l5 5L20 6.5" />,
  alert: (
    <>
      <path d="M12 8v5" />
      <path d="M12 17h.01" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
  sync: (
    <>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M21 4v4h-4M3 20v-4h4" />
    </>
  ),
  cart: (
    <>
      <circle cx="9" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
      <path d="M2 3h2.5l2.4 12.2a1.5 1.5 0 0 0 1.5 1.2h9.1a1.5 1.5 0 0 0 1.5-1.2L21 7H5.5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7.5 3v5.5c0 4.5-3 8.3-7.5 9.5-4.5-1.2-7.5-5-7.5-9.5V6z" />
      <path d="M9.2 12.2l2 2 3.6-3.9" />
    </>
  ),
  'chevron-right': <path d="M9 5l7 7-7 7" />,
  'chevron-down':  <path d="M5 9l7 7 7-7" />,
  'chevron-up':    <path d="M5 15l7-7 7 7" />,
  // 패널이 열릴지 닫힐지를 화살표 방향으로 알려 준다.
  // 방향이 고정이면 아이콘이 아무 말도 하지 않는다.
  'panel-open': (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="M14 10l2 2-2 2" />
    </>
  ),
  'panel-close': (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="M16 10l-2 2 2 2" />
    </>
  ),
  plus:  <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  edit: (
    <>
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="M14.5 6.5l3 3" />
    </>
  ),
};

/** 면으로 그리는 아이콘. 선 아이콘과 섞이면 굵기가 안 맞아 따로 표시한다. */
const FILLED = new Set<IconName>(['play', 'stop', 'flash']);

export default function Icon({ name, size = 20, className, label }: Props) {
  const filled = FILLED.has(name);
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
