/** Crisp vector icons for the story overlay (1.8px strokes on a 24px grid). */

type IconProps = { className?: string };

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function IconCheck({ className }: IconProps) {
  return (
    <svg {...base} strokeWidth={2.4} className={className}>
      <path d="M5 12.5l4.2 4.2L19 7" />
    </svg>
  );
}

export function IconWallet({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M16 12.5h2.5" />
      <path d="M5 6l10-3 1.5 3" />
    </svg>
  );
}

export function IconGamepad({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M7 7h10a4 4 0 014 4v2.5a3 3 0 01-5.3 1.9L14.5 14h-5l-1.2 1.4A3 3 0 013 13.5V11a4 4 0 014-4z" />
      <path d="M7.5 10v3M6 11.5h3" />
      <circle cx="15.5" cy="10.8" r=".6" fill="currentColor" />
      <circle cx="17.5" cy="12.6" r=".6" fill="currentColor" />
    </svg>
  );
}

export function IconBolt({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M13 2.8L5.5 13.2h6L11 21.2l7.5-10.4h-6L13 2.8z" />
    </svg>
  );
}

export function IconPalette({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 3a9 9 0 100 18c1.3 0 1.9-.9 1.6-2-.4-1.4.4-2.6 1.9-2.6H18a3 3 0 003-3C21 7.2 17 3 12 3z" />
      <circle cx="7.6" cy="11" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="10.4" cy="7.2" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="7.6" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconCpu({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </svg>
  );
}

export function IconGpu({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="2.5" y="6" width="19" height="10.5" rx="2" />
      <circle cx="8.5" cy="11.25" r="2.6" />
      <circle cx="15.5" cy="11.25" r="2.6" />
      <path d="M5 16.5v2.5h7" />
    </svg>
  );
}

export function IconRam({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="2.5" y="7" width="19" height="8" rx="1.5" />
      <path d="M6 10.5v1M9.5 10.5v1M13 10.5v1M16.5 10.5v1M5 15v2.5M19 15v2.5M11 15v2.5" />
    </svg>
  );
}

export function IconStorage({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="2.5" y="8.5" width="19" height="7" rx="1.5" />
      <path d="M6 12h6M17.5 12h.5" />
    </svg>
  );
}

export function IconBoard({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <rect x="7" y="7" width="5" height="5" rx="1" />
      <path d="M15 7v5M17 7v5M7 15.5h10" />
    </svg>
  );
}

export function IconCase({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="6" y="2.8" width="12" height="18.4" rx="2" />
      <circle cx="12" cy="9" r="2.6" />
      <circle cx="12" cy="15.4" r="2.6" />
    </svg>
  );
}

export function IconTruck({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3v3h-7" />
      <circle cx="6.5" cy="17.5" r="1.7" />
      <circle cx="17" cy="17.5" r="1.7" />
    </svg>
  );
}

export function IconPhone({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M10.5 18.5h3" />
    </svg>
  );
}

export function IconBox({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3.5 7.5L12 3l8.5 4.5v9L12 21l-8.5-4.5z" />
      <path d="M3.5 7.5L12 12l8.5-4.5M12 12v9" />
    </svg>
  );
}

export function IconWrench({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M14.5 5.5a4 4 0 00-5.2 5.2L3.8 16.2a1.8 1.8 0 002.5 2.5l5.5-5.5a4 4 0 005.2-5.2l-2.4 2.4-2.3-.6-.6-2.3z" />
    </svg>
  );
}

export function IconPin({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0113 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </svg>
  );
}

export function IconPlane({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M21 13.5l-8-4.5V4.2a1.2 1.2 0 00-2.4 0V9L3 13.5v2l7.6-2.3v4.3L8.5 19v1.5l3.3-1 3.3 1V19l-2.1-1.5v-4.3L21 15.5z" />
    </svg>
  );
}
