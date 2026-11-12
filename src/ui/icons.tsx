/** 内联 SVG 图标（16x16，stroke=currentColor，零依赖） */
type P = { size?: number; className?: string };

const base = (size = 16) => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

export function IconPull({ size, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M8 2v8" />
      <path d="M4.5 7 8 10.5 11.5 7" />
      <path d="M2.5 13.5h11" />
    </svg>
  );
}

export function IconPush({ size, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M8 13.5v-8" />
      <path d="M4.5 8.5 8 5l3.5 3.5" />
      <path d="M2.5 2.5h11" />
    </svg>
  );
}

export function IconCommit({ size, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M1.5 8h3.2" />
      <path d="M11.3 8h3.2" />
      <circle cx="8" cy="8" r="2.6" />
    </svg>
  );
}

export function IconMerge({ size, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="4" cy="3.2" r="1.6" />
      <circle cx="4" cy="12.8" r="1.6" />
      <circle cx="12" cy="8" r="1.6" />
      <path d="M4 4.8v6.4" />
      <path d="M5.6 3.6c1.6 1.2 3 2.6 4.8 4.4" />
    </svg>
  );
}

export function IconRebase({ size, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="3.4" cy="3.4" r="1.5" />
      <circle cx="12.6" cy="12.6" r="1.5" />
      <path d="M4.9 3.4h4.2a2.5 2.5 0 0 1 2.5 2.5v4.4" />
      <path d="M9.6 8.3 11.6 10.3 13.6 8.3" />
    </svg>
  );
}

export function IconStage({ size, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
      <path d="M8 5.6v4.8M5.6 8h4.8" />
    </svg>
  );
}

export function IconUnstage({ size, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
      <path d="M5.6 8h4.8" />
    </svg>
  );
}

export function IconDiscard({ size, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3 4.5h10" />
      <path d="M6.2 4.5V3.2h3.6v1.3" />
      <path d="M4.4 4.5l.6 8.2h6l.6-8.2" />
      <path d="M6.8 7v3.4M9.2 7v3.4" />
    </svg>
  );
}

export function IconStash({ size, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="2.2" y="3.2" width="11.6" height="9.6" rx="2" />
      <path d="M2.2 7h11.6" />
      <path d="M6.2 10h3.6" />
    </svg>
  );
}

export function IconTag({ size, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M8.4 2.2H13v4.6L7.9 11.9a1.5 1.5 0 0 1-2.1 0L3.2 9.3a1.5 1.5 0 0 1 0-2.1z" />
      <circle cx="10.6" cy="4.6" r=".9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconLog({ size, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2.2 4h9" />
      <path d="M2.2 8h6.4" />
      <path d="M2.2 12h9" />
      <circle cx="12.8" cy="8" r="1.1" />
    </svg>
  );
}

export function IconRefresh({ size, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M13 8a5 5 0 1 1-1.6-3.7" />
      <path d="M13 2.6v3.2h-3.2" />
    </svg>
  );
}

export function IconFolder({ size, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M2 4.6a1.4 1.4 0 0 1 1.4-1.4h2.4l1.3 1.6h5a1.4 1.4 0 0 1 1.4 1.4v5.4a1.4 1.4 0 0 1-1.4 1.4H3.4A1.4 1.4 0 0 1 2 11.6z" />
    </svg>
  );
}

export function IconSplit({ size, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="2" y="3" width="12" height="10" rx="1.6" />
      <path d="M8 3v10" />
    </svg>
  );
}

export function IconUnified({ size, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="2" y="3" width="12" height="10" rx="1.6" />
      <path d="M4.6 6h6.8M4.6 8.6h6.8M4.6 11.2h4" />
    </svg>
  );
}

export function IconSun({ size, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1.6v1.5M8 12.9v1.5M1.6 8h1.5M12.9 8h1.5" />
      <path d="M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1" />
    </svg>
  );
}

export function IconMoon({ size, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8 5.8 5.8 0 1 0 13.2 9.6z" />
    </svg>
  );
}

export function IconAuto({ size, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="8" cy="8" r="5.4" />
      <path d="M8 2.6a5.4 5.4 0 0 0 0 10.8z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconCompare({ size, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="2" y="2.6" width="7.4" height="7.4" rx="1.6" />
      <rect x="6.6" y="6.6" width="7.4" height="7.4" rx="1.6" />
      <path d="M8.6 10.2h3.6" />
    </svg>
  );
}

export function IconChevron({ size, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 6.2 8 10l4-3.8" />
    </svg>
  );
}

export function IconBranch({ size, className }: P) {
  return (
    <svg {...base(size)} className={className}>
      <circle cx="4" cy="3.4" r="1.5" />
      <circle cx="4" cy="12.6" r="1.5" />
      <circle cx="12" cy="6.6" r="1.5" />
      <path d="M4 4.9v6.2" />
      <path d="M10.5 6.6H7.2A3.2 3.2 0 0 0 4 9.8" />
    </svg>
  );
}

/**
 * 应用标志：泳道拐角 + 三个节点。
 * 比例与 scripts/gen-icons.mjs 里生成的 png/ico 完全一致，保证界面和图标是同一个标志。
 */
export function Logo({ size = 46, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 46 46" className={className} aria-hidden>
      <defs>
        <linearGradient id="gd-logo-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#232835" />
          <stop offset="1" stopColor="#141822" />
        </linearGradient>
      </defs>
      <rect x="1.6" y="1.6" width="42.8" height="42.8" rx="10.1" fill="url(#gd-logo-bg)" />
      <path
        d="M15.6 9.2 V31.3"
        stroke="#7ee787"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M15.6 31.3 H33.1"
        stroke="#58a6ff"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="15.6" cy="9.2" r="3.45" fill="#7ee787" />
      <circle cx="15.6" cy="31.3" r="3.45" fill="#58a6ff" />
      <circle cx="15.6" cy="31.3" r="1.45" fill="#161a24" />
      <circle cx="33.1" cy="31.3" r="3.45" fill="#58a6ff" />
      <circle cx="33.1" cy="31.3" r="1.45" fill="#161a24" />
    </svg>
  );
}
