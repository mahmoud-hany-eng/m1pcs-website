"use client";

import { useId } from "react";
import { motion } from "framer-motion";

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

export interface CharacterPose {
  /** Degrees, 0 = arm hanging straight down at the character's side. */
  armL: number;
  armR: number;
  headTilt: number;
  expression: Expression;
}

export const REST_POSE: CharacterPose = { armL: 12, armR: -12, headTilt: 0, expression: "neutral" };

function Face({ expression }: { expression: Expression }) {
  switch (expression) {
    case "happy":
      return (
        <>
          <path d="M62 54 Q68 46 74 54" stroke="#1c1917" strokeWidth={4} strokeLinecap="round" fill="none" />
          <path d="M86 54 Q92 46 98 54" stroke="#1c1917" strokeWidth={4} strokeLinecap="round" fill="none" />
          <path d="M62 66 Q80 84 98 66" stroke="#1c1917" strokeWidth={4.5} strokeLinecap="round" fill="none" />
        </>
      );
    case "smile":
      return (
        <>
          <circle cx={67} cy={52} r={4.5} fill="#1c1917" />
          <circle cx={93} cy={52} r={4.5} fill="#1c1917" />
          <path d="M64 66 Q80 78 96 66" stroke="#1c1917" strokeWidth={4.5} strokeLinecap="round" fill="none" />
        </>
      );
    case "surprised":
      return (
        <>
          <circle cx={67} cy={52} r={5.5} fill="#1c1917" />
          <circle cx={93} cy={52} r={5.5} fill="#1c1917" />
          <ellipse cx={80} cy={70} rx={7} ry={9} fill="#1c1917" />
        </>
      );
    case "focused":
      return (
        <>
          <path d="M61 51 L73 51" stroke="#1c1917" strokeWidth={4.5} strokeLinecap="round" />
          <path d="M87 51 L99 51" stroke="#1c1917" strokeWidth={4.5} strokeLinecap="round" />
          <path d="M68 70 Q80 66 92 70" stroke="#1c1917" strokeWidth={4} strokeLinecap="round" fill="none" />
        </>
      );
    case "neutral":
    default:
      return (
        <>
          <circle cx={67} cy={52} r={4.5} fill="#1c1917" />
          <circle cx={93} cy={52} r={4.5} fill="#1c1917" />
          <path d="M68 70 L92 70" stroke="#1c1917" strokeWidth={4} strokeLinecap="round" />
        </>
      );
  }
}

/**
 * A soft, rounded "wobble-blob" figure — head, pill torso, two rotatable
 * capsule arms (pose-driven, one per scene) plus a continuous subtle idle
 * wobble/bob layered on top so every character feels alive even while its
 * pose target holds still. Reused for both the customer and the M1
 * representative across every scene; only the colour, pose, and any
 * hand-held prop differ per use.
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
  const bodyGradId = `body-grad-${uid}`;
  const headGradId = `head-grad-${uid}`;

  const isRep = variant === "rep";
  const bodyTop = isRep ? FIGURE_COLORS.gold : FIGURE_COLORS.textPrimary;
  const bodyBottom = isRep ? FIGURE_COLORS.goldHover : "#c9c9d1";
  const headTop = isRep ? "#ffe07a" : "#ffffff";
  const headBottom = isRep ? FIGURE_COLORS.gold : "#dcdce2";
  const accent = isRep ? FIGURE_COLORS.red : FIGURE_COLORS.red;

  return (
    // Visibility/opacity is owned entirely by the enclosing scene panel's
    // own crossfade — this component only ever renders at full strength,
    // no redundant second fade layered on top.
    <div className={className}>
      <motion.svg
        viewBox="0 0 160 220"
        width="100%"
        height="100%"
        style={{ transform: flip ? "scaleX(-1)" : undefined }}
        animate={{ y: [0, isRep ? -5 : -4, 0], rotate: [-1.4, 1.4, -1.4] }}
        transition={{
          y: { duration: isRep ? 3.6 : 3.1, repeat: Infinity, ease: "easeInOut" },
          rotate: { duration: isRep ? 4.4 : 3.9, repeat: Infinity, ease: "easeInOut" },
        }}
      >
        <defs>
          <linearGradient id={bodyGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={bodyTop} />
            <stop offset="100%" stopColor={bodyBottom} />
          </linearGradient>
          <linearGradient id={headGradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={headTop} />
            <stop offset="100%" stopColor={headBottom} />
          </linearGradient>
        </defs>

        {/* soft contact shadow */}
        <ellipse cx={80} cy={208} rx={44} ry={9} fill="#000000" opacity={0.35} />

        {/* left arm (viewer's left) */}
        <motion.g
          style={{ originX: "50px", originY: "112px" }}
          animate={{ rotate: pose.armL }}
          transition={{ type: "spring", stiffness: 120, damping: 14 }}
        >
          <rect x={50 - 9} y={112} width={18} height={62} rx={9} fill={`url(#${bodyGradId})`} />
          <circle cx={50} cy={176} r={11} fill={headBottom} />
          {leftHand}
        </motion.g>

        {/* right arm (viewer's right) */}
        <motion.g
          style={{ originX: "110px", originY: "112px" }}
          animate={{ rotate: pose.armR }}
          transition={{ type: "spring", stiffness: 120, damping: 14 }}
        >
          <rect x={110 - 9} y={112} width={18} height={62} rx={9} fill={`url(#${bodyGradId})`} />
          <circle cx={110} cy={176} r={11} fill={headBottom} />
          {rightHand}
        </motion.g>

        {/* torso */}
        <rect x={38} y={104} width={84} height={96} rx={38} fill={`url(#${bodyGradId})`} />
        <rect x={62} y={118} width={36} height={14} rx={7} fill={accent} opacity={0.85} />

        {/* head */}
        <motion.g
          style={{ originX: "80px", originY: "100px" }}
          animate={{ rotate: pose.headTilt }}
          transition={{ type: "spring", stiffness: 120, damping: 14 }}
        >
          <circle cx={80} cy={58} r={40} fill={`url(#${headGradId})`} />
          <Face expression={pose.expression} />
        </motion.g>
      </motion.svg>
    </div>
  );
}
