"use client";

import { FIGURE_COLORS } from "./figures";

type IconProps = { size?: number; color?: string; className?: string };

const base = (size: number | undefined) => ({ width: size ?? 40, height: size ?? 40 });

export function CpuIcon({ size, color = FIGURE_COLORS.textPrimary, className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" {...base(size)} className={className} fill="none">
      {[10, 18, 26].map((y) => (
        <g key={y}>
          <rect x={2} y={y} width={6} height={3} rx={1} fill={color} opacity={0.7} />
          <rect x={40} y={y} width={6} height={3} rx={1} fill={color} opacity={0.7} />
        </g>
      ))}
      {[10, 18, 26].map((x) => (
        <g key={x}>
          <rect x={x} y={2} width={3} height={6} rx={1} fill={color} opacity={0.7} />
          <rect x={x} y={40} width={3} height={6} rx={1} fill={color} opacity={0.7} />
        </g>
      ))}
      <rect x={8} y={8} width={32} height={32} rx={4} stroke={color} strokeWidth={3} />
      <rect x={17} y={17} width={14} height={14} rx={2} fill={FIGURE_COLORS.red} />
    </svg>
  );
}

export function GpuIcon({ size, color = FIGURE_COLORS.textPrimary, className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" {...base(size)} className={className} fill="none">
      <rect x={4} y={14} width={40} height={22} rx={4} stroke={color} strokeWidth={3} />
      <circle cx={16} cy={25} r={6.5} stroke={color} strokeWidth={2.5} />
      <circle cx={32} cy={25} r={6.5} stroke={color} strokeWidth={2.5} />
      <path d="M16 20.5v9M11.5 25h9" stroke={color} strokeWidth={1.6} opacity={0.7} />
      <path d="M32 20.5v9M27.5 25h9" stroke={color} strokeWidth={1.6} opacity={0.7} />
      <rect x={2} y={38} width={12} height={4} rx={1} fill={FIGURE_COLORS.gold} />
    </svg>
  );
}

export function RamIcon({ size, color = FIGURE_COLORS.textPrimary, className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" {...base(size)} className={className} fill="none">
      <rect x={10} y={4} width={10} height={40} rx={3} stroke={color} strokeWidth={3} />
      <rect x={28} y={4} width={10} height={40} rx={3} stroke={color} strokeWidth={3} />
      {[10, 16, 22, 28, 34].map((y) => (
        <g key={y}>
          <rect x={13} y={y} width={4} height={2.4} fill={FIGURE_COLORS.red} />
          <rect x={31} y={y} width={4} height={2.4} fill={FIGURE_COLORS.gold} />
        </g>
      ))}
    </svg>
  );
}

export function SsdIcon({ size, color = FIGURE_COLORS.textPrimary, className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" {...base(size)} className={className} fill="none">
      <rect x={4} y={12} width={40} height={24} rx={5} stroke={color} strokeWidth={3} />
      <circle cx={16} cy={24} r={5} fill={FIGURE_COLORS.gold} />
      <path d="M28 20h10M28 24h10M28 28h6" stroke={color} strokeWidth={2.4} strokeLinecap="round" opacity={0.75} />
    </svg>
  );
}

export function MotherboardIcon({ size, color = FIGURE_COLORS.textPrimary, className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" {...base(size)} className={className} fill="none">
      <rect x={4} y={4} width={40} height={40} rx={4} stroke={color} strokeWidth={3} />
      <rect x={11} y={11} width={12} height={12} rx={2} fill={FIGURE_COLORS.red} opacity={0.85} />
      <rect x={28} y={11} width={9} height={20} rx={2} stroke={color} strokeWidth={2} />
      <path d="M11 30h9M11 34h6M28 36h9" stroke={color} strokeWidth={2} strokeLinecap="round" opacity={0.7} />
      <circle cx={39} cy={39} r={2} fill={FIGURE_COLORS.gold} />
    </svg>
  );
}

export function CaseIcon({ size, color = FIGURE_COLORS.textPrimary, className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" {...base(size)} className={className} fill="none">
      <rect x={12} y={3} width={24} height={42} rx={4} stroke={color} strokeWidth={3} />
      <circle cx={24} cy={11} r={2.4} fill={FIGURE_COLORS.gold} />
      <path d="M17 19v20" stroke={color} strokeWidth={2} opacity={0.6} />
      <rect x={21} y={19} width={11} height={11} rx={2} stroke={color} strokeWidth={2} opacity={0.8} />
    </svg>
  );
}

export function CoolingIcon({ size, color = FIGURE_COLORS.textPrimary, className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" {...base(size)} className={className} fill="none">
      <circle cx={24} cy={24} r={20} stroke={color} strokeWidth={3} />
      {[0, 60, 120, 180, 240, 300].map((deg) => (
        <ellipse
          key={deg}
          cx={24}
          cy={13}
          rx={4.5}
          ry={8}
          fill={FIGURE_COLORS.red}
          opacity={0.75}
          transform={`rotate(${deg} 24 24)`}
        />
      ))}
      <circle cx={24} cy={24} r={5} fill={FIGURE_COLORS.gold} />
    </svg>
  );
}

export function CheckIcon({ size, color = FIGURE_COLORS.textPrimary, className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" {...base(size)} className={className} fill="none">
      <circle cx={24} cy={24} r={21} fill={FIGURE_COLORS.red} />
      <path d="M14 24.5l7 7 13-14" stroke={color} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function ReceiptIcon({ size, color = FIGURE_COLORS.textPrimary, className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" {...base(size)} className={className} fill="none">
      <path
        d="M12 4h24v38l-4-3-4 3-4-3-4 3-4-3-4 3V4z"
        stroke={color}
        strokeWidth={2.6}
        strokeLinejoin="round"
        fill={FIGURE_COLORS.surfaceElevated}
      />
      <path d="M17 14h14M17 20h14M17 26h9" stroke={color} strokeWidth={2.2} strokeLinecap="round" opacity={0.75} />
      <circle cx={30} cy={31} r={5} fill={FIGURE_COLORS.gold} />
    </svg>
  );
}

export function CoinIcon({ size, className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" {...base(size)} className={className} fill="none">
      <circle cx={24} cy={24} r={19} fill={FIGURE_COLORS.gold} stroke={FIGURE_COLORS.goldHover} strokeWidth={2.4} />
      <path d="M24 15v18M18 20a6 5 0 0112 0c0 3-6 3-6 5a6 5 0 0012 0" stroke="#7a5c00" strokeWidth={2.4} strokeLinecap="round" fill="none" opacity={0.75} />
    </svg>
  );
}

export function ParcelIcon({ size, color = FIGURE_COLORS.textPrimary, className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" {...base(size)} className={className} fill="none">
      <path d="M6 15l18-9 18 9-18 9-18-9z" fill={FIGURE_COLORS.gold} stroke={color} strokeWidth={2} strokeLinejoin="round" />
      <path d="M6 15v18l18 9 18-9V15" stroke={color} strokeWidth={2} strokeLinejoin="round" fill={FIGURE_COLORS.goldHover} opacity={0.9} />
      <path d="M24 24v18" stroke={color} strokeWidth={2} opacity={0.6} />
      <path d="M6 15l18 9 18-9" stroke={FIGURE_COLORS.red} strokeWidth={2.4} fill="none" opacity={0.9} />
    </svg>
  );
}

export function PinIcon({ size, color = FIGURE_COLORS.red, className, label }: IconProps & { label?: string }) {
  return (
    <svg viewBox="0 0 40 52" width={size ?? 32} height={(size ?? 32) * 1.3} className={className} fill="none">
      <path
        d="M20 2c9.4 0 17 7.6 17 17 0 12.5-17 31-17 31S3 31.5 3 19C3 9.6 10.6 2 20 2z"
        fill={color}
      />
      <circle cx={20} cy={19} r={7.5} fill={FIGURE_COLORS.background} />
      {label && (
        <text x={20} y={23} textAnchor="middle" fontSize={9} fontWeight={700} fill={color}>
          {label}
        </text>
      )}
    </svg>
  );
}

export function ReadyScreenIcon({ size, color = FIGURE_COLORS.textPrimary, className }: IconProps) {
  return (
    <svg viewBox="0 0 48 48" {...base(size)} className={className} fill="none">
      <rect x={4} y={6} width={40} height={26} rx={3} stroke={color} strokeWidth={3} fill={FIGURE_COLORS.surfaceElevated} />
      <path d="M18 40h12M24 32v8" stroke={color} strokeWidth={3} strokeLinecap="round" />
      <path d="M14 19.5l6 6 12-13" stroke={FIGURE_COLORS.gold} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
