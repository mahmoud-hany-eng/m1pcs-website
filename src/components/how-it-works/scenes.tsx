"use client";

import { motion, useSpring, useTransform, type MotionValue } from "framer-motion";
import { Character, FIGURE_COLORS, type CharacterPose } from "./figures";
import {
  CaseIcon,
  CheckIcon,
  CoinIcon,
  CoolingIcon,
  CpuIcon,
  GpuIcon,
  ParcelIcon,
  PinIcon,
  RamIcon,
  ReadyScreenIcon,
  ReceiptIcon,
  SsdIcon,
} from "./icons";

/** Shared entrance stagger: a small piece of a scene fades/rises in across
 *  a [start, end] slice of the scene's own local scroll progress (0 at the
 *  start of its 20%-wide window, 1 at the end). Reversible for free since
 *  it's a pure function of scroll position. */
function useStagger(progress: MotionValue<number>, start: number, end: number) {
  const opacity = useTransform(progress, [start, end], [0, 1]);
  const y = useTransform(opacity, [0, 1], [14, 0]);
  const scale = useTransform(opacity, [0, 1], [0.88, 1]);
  return { opacity, y, scale };
}

/** A gesture angle: a plain scroll-derived useTransform keyframe chain,
 *  softened through a bouncy spring so every point/reach/nod feels like
 *  soft spring motion rather than a mechanical scrub — while still being
 *  a pure function of scroll position (so it's exactly reversible). */
function useGesture(progress: MotionValue<number>, input: number[], output: number[]) {
  const raw = useTransform(progress, input, output);
  return useSpring(raw, { stiffness: 170, damping: 13, mass: 0.45 });
}

/** Centres a fixed-proportion "tableau" (the desk/characters/cards
 *  composition) inside the taller scroll stage, so the scene's own visual
 *  weight sits in the middle of the stage instead of pinned to its bottom
 *  edge with a dead gap above it. */
function SceneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="relative aspect-[16/10] w-full max-w-[560px]">{children}</div>
    </div>
  );
}

/** The tabletop every desk scene plays out on — a simple trapezoid
 *  suggesting a surface viewed from slightly above, not a literal 3D
 *  model. */
function Desk({ progress }: { progress: MotionValue<number> }) {
  const opacity = useTransform(progress, [0, 0.12], [0, 1]);
  return (
    <motion.svg
      viewBox="0 0 640 170"
      style={{ opacity }}
      className="absolute inset-x-0 bottom-0 w-full"
      preserveAspectRatio="none"
    >
      <path
        d="M70 26 L570 26 L636 160 L4 160 Z"
        fill={FIGURE_COLORS.surfaceElevated}
        stroke={FIGURE_COLORS.border}
        strokeWidth={2}
      />
      <path d="M70 26 L570 26" stroke={FIGURE_COLORS.borderStrong} strokeWidth={2} />
    </motion.svg>
  );
}

// Both characters share this footprint across every desk scene: pushed
// close to the tableau's edges so the centre stays clear for cards/icons.
const CUSTOMER_SLOT = "absolute bottom-[8%] left-0 h-[68%] w-[15%]";
const REP_SLOT = "absolute bottom-[8%] right-0 h-[68%] w-[15%]";

function PartCard({
  progress,
  start,
  end,
  x,
  y,
  label,
  children,
}: {
  progress: MotionValue<number>;
  start: number;
  end: number;
  x: number;
  y: number;
  label: string;
  children: React.ReactNode;
}) {
  const { opacity, y: ry, scale } = useStagger(progress, start, end);
  return (
    <div style={{ left: `${x}%`, top: `${y}%` }} className="absolute -translate-x-1/2 -translate-y-1/2">
      <motion.div style={{ opacity, y: ry, scale }} className="flex flex-col items-center gap-1.5">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border-strong bg-surface shadow-lg sm:h-12 sm:w-12">
          {children}
        </div>
        <span className="whitespace-nowrap font-display text-[9px] font-bold uppercase tracking-[0.15em] text-text-muted">
          {label}
        </span>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scene 1 — Pick Your Parts                                           */
/* ------------------------------------------------------------------ */

export function SceneParts({ progress }: { progress: MotionValue<number> }) {
  // Customer points out three preferences in sequence: CPU -> GPU -> RAM.
  const customerArmR = useGesture(
    progress,
    [0, 0.06, 0.18, 0.26, 0.42, 0.5, 0.66, 0.74, 0.92, 0.98],
    [-14, -14, -75, -75, -100, -100, -125, -125, -14, -14]
  );
  // The rep raises an open hand — presenting the options — and holds it.
  const repArmL = useGesture(progress, [0, 0.1, 0.24, 0.88, 0.96], [14, 14, -80, -80, 14]);
  const customerNod = useGesture(progress, [0, 0.55, 0.62, 0.68, 0.74], [0, 0, -8, 0, -6]);

  const customerPose: CharacterPose = { armL: 10, armR: customerArmR, headTilt: customerNod, expression: "focused" };
  const repPose: CharacterPose = { armL: repArmL, armR: -10, headTilt: 4, expression: "smile" };

  return (
    <SceneFrame>
      <Desk progress={progress} />

      <div className={CUSTOMER_SLOT}>
        <Character variant="customer" pose={customerPose} />
      </div>
      <div className={REP_SLOT}>
        <Character variant="rep" pose={repPose} flip />
      </div>

      <PartCard progress={progress} start={0.05} end={0.22} x={36} y={16} label="CPU">
        <CpuIcon size={24} />
      </PartCard>
      <PartCard progress={progress} start={0.12} end={0.29} x={50} y={8} label="GPU">
        <GpuIcon size={24} />
      </PartCard>
      <PartCard progress={progress} start={0.19} end={0.36} x={64} y={16} label="RAM">
        <RamIcon size={24} />
      </PartCard>
      <PartCard progress={progress} start={0.26} end={0.43} x={36} y={42} label="Storage">
        <SsdIcon size={24} />
      </PartCard>
      <PartCard progress={progress} start={0.33} end={0.5} x={50} y={50} label="Case">
        <CaseIcon size={24} />
      </PartCard>
      <PartCard progress={progress} start={0.4} end={0.57} x={64} y={42} label="Cooling">
        <CoolingIcon size={24} />
      </PartCard>
    </SceneFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Scene 2 — Review Your Quotation                                     */
/* ------------------------------------------------------------------ */

function QuotationRow({
  label,
  value,
  progress,
  start,
  end,
}: {
  label: string;
  value: string;
  progress: MotionValue<number>;
  start: number;
  end: number;
}) {
  const row = useStagger(progress, start, end);
  return (
    <motion.div
      style={{ opacity: row.opacity, y: row.y }}
      className="flex items-center justify-between border-t border-border pt-2 first:border-t-0 first:pt-0"
    >
      <span className="text-xs text-text-secondary">{label}</span>
      <span className="text-xs font-semibold text-text-primary">{value}</span>
    </motion.div>
  );
}

export function SceneQuotation({ progress }: { progress: MotionValue<number> }) {
  // The rep raises an arm to point at the card as it appears, and holds
  // the point while walking through it.
  const repArmL = useGesture(progress, [0, 0.06, 0.16, 0.8, 0.92], [14, 14, -95, -95, 14]);
  // The customer leans in (arm rises, as if resting a hand on the table
  // to lean closer), then raises in approval once every row has shown.
  const customerArmR = useGesture(progress, [0, 0.1, 0.2, 0.55, 0.68, 0.85, 0.95], [-14, -14, -35, -35, -70, -70, -14]);
  const customerNod = useGesture(progress, [0, 0.6, 0.68, 0.76, 0.84], [0, 0, -10, 0, -8]);

  const customerPose: CharacterPose = { armL: 12, armR: customerArmR, headTilt: customerNod, expression: "smile" };
  const repPose: CharacterPose = { armL: repArmL, armR: -16, headTilt: -3, expression: "smile" };

  const card = useStagger(progress, 0.04, 0.2);
  const rows: [string, string][] = [
    ["Selected parts", "6 components"],
    ["Price", "Current pricing"],
    ["Shipping estimate", "Provided"],
  ];

  return (
    <SceneFrame>
      <Desk progress={progress} />

      <div className={CUSTOMER_SLOT}>
        <Character variant="customer" pose={customerPose} />
      </div>
      <div className={REP_SLOT}>
        <Character variant="rep" pose={repPose} flip />
      </div>

      <div className="absolute left-1/2 top-[10%] w-[58%] max-w-[250px] -translate-x-1/2">
        <motion.div
          style={{ opacity: card.opacity, y: card.y, scale: card.scale }}
          className="rounded-2xl border border-border-strong bg-surface p-3.5 shadow-2xl sm:p-4"
        >
          <div className="mb-2.5 flex items-center gap-2">
            <ReceiptIcon size={20} />
            <span className="font-display text-xs font-bold uppercase tracking-[0.15em] text-text-primary">
              Quotation
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {rows.map(([label, value], i) => (
              <QuotationRow
                key={label}
                label={label}
                value={value}
                progress={progress}
                start={0.22 + i * 0.15}
                end={0.4 + i * 0.15}
              />
            ))}
          </div>
        </motion.div>
      </div>
    </SceneFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Scene 3 — Confirm Your Order                                        */
/* ------------------------------------------------------------------ */

export function SceneConfirm({ progress }: { progress: MotionValue<number> }) {
  // Customer reaches the deposit forward toward the rep...
  const customerArmR = useGesture(progress, [0, 0.03, 0.14, 0.24, 0.3], [-70, -70, -20, -20, -70]);
  // ...the rep reaches out to receive it, then raises the confirmation.
  const repArmL = useGesture(progress, [0, 0.05, 0.16, 0.26, 0.34, 0.5, 0.62], [14, 14, -25, -25, 14, -70, -70]);
  const bothNod = useGesture(progress, [0, 0.34, 0.4, 0.46, 0.52], [0, 0, -9, 0, -7]);

  const customerPose: CharacterPose = {
    armL: 10,
    armR: customerArmR,
    headTilt: 2,
    expression: "focused",
  };
  const repPose: CharacterPose = { armL: repArmL, armR: -14, headTilt: bothNod, expression: "smile" };

  const coin = useStagger(progress, 0.04, 0.18);
  const pulse = useTransform(progress, [0.15, 0.26, 0.36], [0, 1, 0]);
  const check = useStagger(progress, 0.34, 0.5);
  const receipt = useStagger(progress, 0.5, 0.66);

  const stages: [string, ReturnType<typeof useStagger>][] = [
    ["Deposit", coin],
    ["Confirmed", check],
    ["Order placed", receipt],
  ];

  return (
    <SceneFrame>
      <Desk progress={progress} />

      <div className={CUSTOMER_SLOT}>
        <Character variant="customer" pose={customerPose} rightHand={<CoinIcon size={18} />} />
      </div>
      <div className={REP_SLOT}>
        <Character variant="rep" pose={repPose} flip />
      </div>

      <motion.div
        style={{ opacity: pulse }}
        className="absolute left-1/2 top-[14%] h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent"
      />

      <div className="absolute left-1/2 top-[14%] flex -translate-x-1/2 -translate-y-1/2 items-center gap-2.5 sm:gap-4">
        {stages.map(([label, s], i) => (
          <div key={label} className="flex items-center gap-2.5 sm:gap-4">
            <motion.div
              style={{ opacity: s.opacity, scale: s.scale }}
              className="flex flex-col items-center gap-1"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-full border border-border-strong bg-surface shadow-lg sm:h-12 sm:w-12">
                {label === "Deposit" && <CoinIcon size={22} />}
                {label === "Confirmed" && <CheckIcon size={22} />}
                {label === "Order placed" && <ReceiptIcon size={22} />}
              </div>
              <span className="whitespace-nowrap font-display text-[8px] font-bold uppercase tracking-[0.15em] text-text-muted sm:text-[9px]">
                {label}
              </span>
            </motion.div>
            {i < stages.length - 1 && (
              <motion.span style={{ opacity: stages[i + 1][1].opacity }} className="text-text-muted">
                &rarr;
              </motion.span>
            )}
          </div>
        ))}
      </div>
    </SceneFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Scene 4 — Sourced From The U.S. / shipping to Qatar                 */
/* ------------------------------------------------------------------ */

function quadraticPoint(t: number, p0: [number, number], p1: [number, number], p2: [number, number]) {
  const x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0];
  const y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1];
  return { x, y };
}

const ROUTE_P0: [number, number] = [70, 150];
const ROUTE_P1: [number, number] = [320, 30];
const ROUTE_P2: [number, number] = [570, 150];

export function SceneSourcing({ progress }: { progress: MotionValue<number> }) {
  const deskOpacity = useTransform(progress, [0, 0.1], [1, 0]);
  const deskScale = useTransform(progress, [0, 0.2], [1, 0.7]);
  const waveArmR = useGesture(progress, [0, 0.05, 0.09], [-14, -60, -60]);

  const mapOpacity = useTransform(progress, [0.08, 0.22], [0, 1]);
  const lineLength = useTransform(progress, [0.16, 0.62], [0, 1]);
  const parcelOpacity = useTransform(progress, [0.18, 0.26], [0, 1]);
  const parcelT = useTransform(progress, [0.2, 0.68], [0, 1]);
  const parcelX = useTransform(parcelT, (t) => quadraticPoint(t, ROUTE_P0, ROUTE_P1, ROUTE_P2).x);
  const parcelY = useTransform(parcelT, (t) => quadraticPoint(t, ROUTE_P0, ROUTE_P1, ROUTE_P2).y);
  const usaLabel = useTransform(progress, [0.1, 0.2], [0.4, 1]);
  const qatarLabel = useTransform(progress, [0.58, 0.72], [0.4, 1]);
  const arrivedRing = useTransform(progress, [0.66, 0.76, 0.9], [0, 1, 0]);

  return (
    <SceneFrame>
      <motion.div style={{ opacity: deskOpacity, scale: deskScale }} className="absolute inset-0">
        <Desk progress={progress} />
        <div className={CUSTOMER_SLOT}>
          <Character
            variant="customer"
            pose={{ armL: 10, armR: -14, headTilt: 0, expression: "neutral" }}
          />
        </div>
        <div className={REP_SLOT}>
          <Character
            variant="rep"
            pose={{ armL: waveArmR, armR: -10, headTilt: 0, expression: "neutral" }}
            flip
          />
        </div>
      </motion.div>

      <motion.div style={{ opacity: mapOpacity }} className="absolute inset-0">
        <svg viewBox="0 0 640 200" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
          <path
            d={`M${ROUTE_P0[0]},${ROUTE_P0[1]} Q${ROUTE_P1[0]},${ROUTE_P1[1]} ${ROUTE_P2[0]},${ROUTE_P2[1]}`}
            stroke={FIGURE_COLORS.border}
            strokeWidth={2}
            strokeDasharray="6 8"
            fill="none"
          />
          <motion.path
            d={`M${ROUTE_P0[0]},${ROUTE_P0[1]} Q${ROUTE_P1[0]},${ROUTE_P1[1]} ${ROUTE_P2[0]},${ROUTE_P2[1]}`}
            stroke={FIGURE_COLORS.gold}
            strokeWidth={2.5}
            fill="none"
            style={{ pathLength: lineLength }}
          />
          <motion.circle
            cx={ROUTE_P0[0]}
            cy={ROUTE_P0[1]}
            r={16}
            fill="none"
            stroke={FIGURE_COLORS.red}
            strokeWidth={2}
            style={{ opacity: arrivedRing }}
          />
        </svg>

        <motion.div
          style={{ opacity: usaLabel, left: `${(ROUTE_P0[0] / 640) * 100}%`, top: `${(ROUTE_P0[1] / 200) * 100}%` }}
          className="absolute -translate-x-1/2 -translate-y-[calc(100%+6px)] flex flex-col items-center"
        >
          <PinIcon size={24} color={FIGURE_COLORS.textPrimary} />
          <span className="mt-1 font-display text-xs font-bold uppercase tracking-[0.15em] text-text-primary">
            U.S.
          </span>
        </motion.div>

        <motion.div
          style={{ opacity: qatarLabel, left: `${(ROUTE_P2[0] / 640) * 100}%`, top: `${(ROUTE_P2[1] / 200) * 100}%` }}
          className="absolute -translate-x-1/2 -translate-y-[calc(100%+6px)] flex flex-col items-center"
        >
          <PinIcon size={24} color={FIGURE_COLORS.red} />
          <span className="mt-1 font-display text-xs font-bold uppercase tracking-[0.15em] text-text-primary">
            Qatar
          </span>
        </motion.div>

        <motion.div
          style={{
            opacity: parcelOpacity,
            left: useTransform(parcelX, (x) => `${(x / 640) * 100}%`),
            top: useTransform(parcelY, (y) => `${(y / 200) * 100}%`),
          }}
          className="absolute -translate-x-1/2 -translate-y-1/2"
        >
          <ParcelIcon size={24} />
        </motion.div>
      </motion.div>
    </SceneFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Scene 5 — Built. Set Up. Delivered.                                 */
/* ------------------------------------------------------------------ */

const BUILD_STAGES: Array<{ label: string; icon: React.ReactNode; start: number; end: number }> = [
  { label: "Build", icon: <CaseIcon size={22} />, start: 0.02, end: 0.14 },
  { label: "Setup", icon: <CoolingIcon size={22} />, start: 0.1, end: 0.22 },
  { label: "Ready", icon: <ReadyScreenIcon size={22} />, start: 0.18, end: 0.3 },
  { label: "Delivered", icon: <ParcelIcon size={22} />, start: 0.26, end: 0.38 },
];

function BuildStageCard({
  label,
  icon,
  progress,
  start,
  end,
}: {
  label: string;
  icon: React.ReactNode;
  progress: MotionValue<number>;
  start: number;
  end: number;
}) {
  const st = useStagger(progress, start, end);
  return (
    <motion.div
      style={{ opacity: st.opacity, y: st.y, scale: st.scale }}
      className="flex flex-col items-center gap-1"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border-strong bg-surface shadow-lg sm:h-12 sm:w-12">
        {icon}
      </div>
      <span className="whitespace-nowrap font-display text-[8px] font-bold uppercase tracking-[0.15em] text-text-muted sm:text-[9px]">
        {label}
      </span>
    </motion.div>
  );
}

export function SceneDelivered({ progress }: { progress: MotionValue<number> }) {
  const buildPhase = useTransform(progress, [0, 0.4, 0.5], [1, 1, 0]);
  const handoffPhase = useTransform(progress, [0.46, 0.64], [0, 1]);
  const noteOpacity = useTransform(progress, [0.7, 0.86], [0, 1]);

  // The rep "assembles" — arm dips down to place each part, once per
  // build-stage icon, then rises to present the finished PC during the
  // handoff phase.
  const repArmL = useGesture(
    progress,
    [0, 0.02, 0.08, 0.1, 0.16, 0.18, 0.24, 0.26, 0.32, 0.46, 0.56],
    [14, 60, 20, 60, 20, 60, 20, 60, 20, -90, -90]
  );
  // The customer watches, then raises both arms to receive the PC.
  const customerArmR = useGesture(progress, [0, 0.44, 0.56, 0.68], [-14, -14, -75, -75]);
  const customerNod = useGesture(progress, [0, 0.56, 0.64, 0.72, 0.8], [0, 0, -10, 0, -8]);

  const repPose: CharacterPose = { armL: repArmL, armR: -10, headTilt: -3, expression: "focused" };
  const customerPose: CharacterPose = { armL: 10, armR: customerArmR, headTilt: customerNod, expression: "happy" };

  return (
    <SceneFrame>
      <Desk progress={progress} />

      <motion.div
        style={{ opacity: buildPhase }}
        className="absolute inset-x-0 top-[4%] flex justify-center gap-2.5 sm:gap-4"
      >
        {BUILD_STAGES.map((s) => (
          <BuildStageCard
            key={s.label}
            label={s.label}
            icon={s.icon}
            progress={progress}
            start={s.start}
            end={s.end}
          />
        ))}
      </motion.div>

      <div className={CUSTOMER_SLOT}>
        <Character variant="customer" pose={customerPose} />
      </div>
      <div className={REP_SLOT}>
        <Character variant="rep" pose={repPose} flip rightHand={<CaseIcon size={14} />} />
      </div>

      <div className="absolute left-1/2 top-[32%] -translate-x-1/2 -translate-y-1/2">
        <motion.div
          style={{ opacity: handoffPhase, scale: useTransform(handoffPhase, [0, 1], [0.85, 1]) }}
          className="flex flex-col items-center gap-1"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent bg-surface shadow-xl">
            <CaseIcon size={28} />
          </div>
          <span className="font-display text-[9px] font-bold uppercase tracking-[0.15em] text-accent">
            Your PC
          </span>
        </motion.div>
      </div>

      <motion.p
        style={{ opacity: noteOpacity }}
        className="absolute inset-x-0 bottom-[1%] text-center text-[11px] text-text-muted"
      >
        Pickup or delivery can then be arranged.
      </motion.p>
    </SceneFrame>
  );
}
