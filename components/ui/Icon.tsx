// One consistent line-SVG set (24px grid, 1.5 stroke, round caps). No emoji icons.
import type { ReactElement, SVGProps } from 'react';

const PATHS = {
  checklist: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" />
    </>
  ),
  itinerary: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M4 10h16M8 14h3" />
    </>
  ),
  budget: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </>
  ),
  library: <path d="M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1z" />,
  journal: (
    <>
      <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
      <path d="M5 17a3 3 0 0 1 3-3h11" />
    </>
  ),
  note: (
    <>
      <circle cx="8" cy="17.5" r="2.5" />
      <path d="M10.5 17.5V4.5c2.6.9 4.6 2.3 6 4.5" />
    </>
  ),
  'map-pin': (
    <>
      <path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z" />
      <circle cx="12" cy="10" r="2" />
    </>
  ),
  chevron: <path d="M6 9l6 6 6-6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  edit: (
    <>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 2.5" />
    </>
  ),
  plane: <path d="M3 14.5l18-7.5-7.5 18-2.5-8z" />,
  bed: (
    <>
      <path d="M3 18V8M3 14h18v4M21 14v-1.5A2.5 2.5 0 0 0 18.5 10H11v4" />
      <circle cx="7" cy="11.5" r="1.5" />
    </>
  ),
  car: (
    <>
      <path d="M3 15v-3l2.2-5.2A1.3 1.3 0 0 1 6.4 6h11.2a1.3 1.3 0 0 1 1.2.8L21 12v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <path d="M3.5 12h17M6.5 16v2M17.5 16v2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  external: (
    <>
      <path d="M14 5h5v5M19 5l-8 8" />
      <path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M21 16l-5-5-8 8" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 10A8 8 0 0 0 5.6 7L4 8.5M4 4v4.5h4.5" />
      <path d="M4.5 14A8 8 0 0 0 18.4 17l1.6-1.5M20 20v-4.5h-4.5" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof PATHS;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
  /** Accessible name. Without it the icon is decorative (aria-hidden). */
  label?: string;
  /** Degrees; e.g. chevron 180 = up, arrow 180 = left. */
  rotate?: 0 | 90 | 180 | 270;
}

export function Icon({ name, size = 20, label, rotate = 0, style, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={rotate ? { transform: `rotate(${rotate}deg)`, ...style } : style}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
