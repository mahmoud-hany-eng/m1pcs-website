"use client";

import { useId } from "react";
import { motion, type MotionValue } from "framer-motion";

/** M1's real brand tokens (src/app/globals.css), hardcoded as hex since
 *  these fills live inside inline SVG rather than Tailwind classes. */
export const FIGURE_COLORS = {
  red: "#e73225",
  redDark: "#9d2e16",
  redLight: "#f0584a",
  gold: "#f9c204",
  goldHover: "#dcae03",
  background: "#0a0a0b",
  surface: "#151517",
  surfaceElevated: "#1d1d20",
  border: "#2a2a2e",
  borderStrong: "#3a3a3f",
  textPrimary: "#f5f5f7",
  textSecondary: "#a6a6ad",
  textMuted: "#75757c",
} as const;

export type Expression = "neutral" | "smile" | "happy" | "surprised" | "focused";

/** Arm/head angles are usually a MotionValue driven by scroll progress
 *  (so the gesture plays out AS the user scrolls, fully reversible) but a
 *  plain number works too for a fixed pose — framer's `style` prop accepts
 *  either transparently. */
export interface CharacterPose {
  armL: number | MotionValue<number>;
  armR: number | MotionValue<number>;
  headTilt: number | MotionValue<number>;
  expression: Expression;
}

export const REST_POSE: CharacterPose = { armL: 14, armR: -14, headTilt: 0, expression: "neutral" };

/** Face features drawn relative to the head's OWN centre (0,0) — see the
 *  head group below, which pivots exactly there. */
function Face({ expression }: { expression: Expression }) {
  switch (expression) {
    case "happy":
      return (
        <>
          <path d="M-6.5 -2.5 Q-4 -5.5 -1.5 -2.5" stroke="#1c1917" strokeWidth={1.8} strokeLinecap="round" fill="none" />
          <path d="M1.5 -2.5 Q4 -5.5 6.5 -2.5" stroke="#1c1917" strokeWidth={1.8} strokeLinecap="round" fill="none" />
          <path d="M-6.5 2 Q0 9 6.5 2" stroke="#1c1917" strokeWidth={2} strokeLinecap="round" fill="none" />
        </>
      );
    case "smile":
      return (
        <>
          <circle cx={-5} cy={-3} r={1.8} fill="#1c1917" />
          <circle cx={5} cy={-3} r={1.8} fill="#1c1917" />
          <path d="M-6 3 Q0 8 6 3" stroke="#1c1917" strokeWidth={2} strokeLinecap="round" fill="none" />
        </>
      );
    case "surprised":
      return (
        <>
          <circle cx={-5} cy={-3} r={2.2} fill="#1c1917" />
          <circle cx={5} cy={-3} r={2.2} fill="#1c1917" />
          <ellipse cx={0} cy={4.5} rx={2.6} ry={3.4} fill="#1c1917" />
        </>
      );
    case "focused":
      return (
        <>
          <path d="M-7.5 -3.5 L-2.5 -3.5" stroke="#1c1917" strokeWidth={1.8} strokeLinecap="round" />
          <path d="M2.5 -3.5 L7.5 -3.5" stroke="#1c1917" strokeWidth={1.8} strokeLinecap="round" />
          <path d="M-4.5 4 Q0 2.3 4.5 4" stroke="#1c1917" strokeWidth={1.8} strokeLinecap="round" fill="none" />
        </>
      );
    case "neutral":
    default:
      return (
        <>
          <circle cx={-5} cy={-3} r={1.8} fill="#1c1917" />
          <circle cx={5} cy={-3} r={1.8} fill="#1c1917" />
          <path d="M-4.5 4 L4.5 4" stroke="#1c1917" strokeWidth={1.8} strokeLinecap="round" />
        </>
      );
  }
}

/** A single rotating limb: a static outer <g translate> places the pivot
 *  (shoulder/hip) at the right spot in the 100x172 viewBox; the inner
 *  motion.g rotates around fraction-origin (0,0) of ITS OWN geometry — the
 *  line is drawn starting exactly at that inner origin, so the fraction is
 *  correct regardless of how much the SVG is scaled down by its container
 *  (unlike a pixel-value transform-origin, which framer/SVG interprets
 *  relative to the element's rendered bounding box under `fill-box`, not
 *  the viewBox's own units — that mismatch was silently sending every
 *  gesture's pivot far outside the actual line, swinging limbs in
 *  unintended directions). */
function Limb({
  originX,
  originY,
  angle,
  length,
  stroke,
  capRadius = 3.6,
  swayAmplitude,
  swayDuration = 3.6,
  children,
}: {
  originX: number;
  originY: number;
  angle: number | MotionValue<number>;
  length: number;
  stroke: string;
  capRadius?: number;
  /** Idle sway amplitude in degrees. When set, `angle` must be a plain
   *  number (legs use this) — the sway keyframes are baked into THIS same
   *  rotation, rather than layering a second motion.g on top, which is what
   *  caused the fill-box origin bug in the first place (a pixel-value
   *  origin on an outer wrapper is measured against that wrapper's own
   *  rendered bbox, not the viewBox — nesting one rotation is always safe,
   *  nesting two independently-pivoting ones is not). */
  swayAmplitude?: number;
  swayDuration?: number;
  children?: React.ReactNode;
}) {
  const useSway = swayAmplitude != null;
  const baseAngle = useSway ? (angle as number) : 0;
  return (
    <g transform={`translate(${originX}, ${originY})`}>
      <motion.g
        style={useSway ? { originX: 0, originY: 0 } : { originX: 0, originY: 0, rotate: angle }}
        animate={
          useSway
            ? { rotate: [baseAngle - swayAmplitude!, baseAngle + swayAmplitude!, baseAngle - swayAmplitude!] }
            : undefined
        }
        transition={useSway ? { duration: swayDuration, repeat: Infinity, ease: "easeInOut" } : undefined}
      >
        <line x1={0} y1={0} x2={0} y2={length} stroke={stroke} strokeWidth={5.5} strokeLinecap="round" />
        <circle cx={0} cy={length} r={capRadius} fill={stroke} />
        {children}
      </motion.g>
    </g>
  );
}

/**
 * A minimal wobble stick figure — round head, thin capsule-line limbs, a
 * single torso stroke. Arms and head-tilt are driven by whatever the scene
 * passes in (usually a scroll-linked, spring-smoothed MotionValue), so the
 * SAME figure component acts out completely different gestures per scene
 * without any scene-specific markup of its own. A gentle always-on idle
 * sway is layered underneath so it never looks frozen even mid-gesture.
 */
export function Character({
  variant,
  pose,
  flip = false,
  leftHand,
  rightHand,
  className,
}: {
  variant: "customer" | "rep";
  pose: CharacterPose;
  flip?: boolean;
  leftHand?: React.ReactNode;
  rightHand?: React.ReactNode;
  className?: string;
}) {
  const uid = useId();
  const glowId = `glow-${uid}`;
  const isRep = variant === "rep";
  const stroke = isRep ? FIGURE_COLORS.gold : FIGURE_COLORS.textPrimary;
  const headFill = isRep ? FIGURE_COLORS.gold : FIGURE_COLORS.textPrimary;
  const accent = FIGURE_COLORS.red;

  return (
    <div className={className}>
      <motion.svg
        viewBox="0 0 100 172"
        width="100%"
        height="100%"
        style={{ transform: flip ? "scaleX(-1)" : undefined, overflow: "visible" }}
        animate={{ y: [0, isRep ? -4 : -3.4, 0] }}
        transition={{ duration: isRep ? 3.4 : 3.0, repeat: Infinity, ease: "easeInOut" }}
      >
        <defs>
          <filter id={glowId} x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="2" stdDeviation="2.2" floodColor="#000000" floodOpacity="0.4" />
          </filter>
        </defs>

        <ellipse cx={50} cy={166} rx={26} ry={5} fill="#000000" opacity={0.32} />

        <g filter={`url(#${glowId})`}>
          {/* legs — drawn straight down from the hip, splayed via rotation
              (not baked into the line geometry) so every limb shares the
              same simple, scale-safe pivot. */}
          <Limb originX={50} originY={98} angle={-14} length={50} stroke={stroke} swayAmplitude={2.2} swayDuration={3.6} />
          <Limb originX={50} originY={98} angle={14} length={50} stroke={stroke} swayAmplitude={2.2} swayDuration={3.9} />

          {/* torso */}
          <line x1={50} y1={40} x2={50} y2={100} stroke={stroke} strokeWidth={6.5} strokeLinecap="round" />
          {isRep && <line x1={44} y1={52} x2={56} y2={52} stroke={accent} strokeWidth={3} strokeLinecap="round" />}

          <Limb originX={50} originY={48} angle={pose.armL} length={40} stroke={stroke}>
            {leftHand}
          </Limb>
          <Limb originX={50} originY={48} angle={pose.armR} length={40} stroke={stroke}>
            {rightHand}
          </Limb>

          {/* head — pivots on its own centre, which is exact regardless of
              render scale since it's a fraction (0.5, 0.5) of the circle's
              own bounding box. */}
          <g transform="translate(50, 24)">
            <motion.g style={{ originX: 0.5, originY: 0.5, rotate: pose.headTilt }}>
              <circle cx={0} cy={0} r={16} fill={headFill} />
              <Face expression={pose.expression} />
            </motion.g>
          </g>
        </g>
      </motion.svg>
    </div>
  );
}
