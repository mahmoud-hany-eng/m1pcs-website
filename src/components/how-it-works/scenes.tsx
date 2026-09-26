"use client";

import { motion, useTransform, type MotionValue } from "framer-motion";
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
 *  start of its 20%-wide window, 1 at the end — NOT "how close to active",
 *  which snaps to 1 almost immediately and then sits flat for the whole
 *  hold). Reversible for free since it's a pure function of scroll
 *  position. */
function useStagger(progress: MotionValue<number>, start: number, end: number) {
  const opacity = useTransform(progress, [start, end], [0, 1]);
  const y = useTransform(opacity, [0, 1], [14, 0]);
  const scale = useTransform(opacity, [0, 1], [0.88, 1]);
  return { opacity, y, scale };
}

/** The tabletop every seated scene plays out on — a simple trapezoid
 *  suggesting a desk viewed from slightly above, not a literal 3D model. */
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

// Both characters share this footprint across every scene: pushed close
// to the stage edges so the centre stays clear for cards/icons/labels.
const CUSTOMER_SLOT = "absolute bottom-[4%] left-[1%] h-[60%] w-[19%] sm:left-[4%] sm:w-[17%]";
const REP_SLOT = "absolute bottom-[4%] right-[1%] h-[60%] w-[19%] sm:right-[4%] sm:w-[17%]";

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
    // Static centring lives on this outer, transform-free element; the
    // inner motion.div owns opacity/y/scale. Framer Motion writes the
    // whole `transform` CSS property whenever any of x/y/scale/rotate is
    // passed via `style`, which silently overrides a Tailwind
    // `-translate-x-1/2` class on the SAME element — so the two transform
    // sources must live on different elements, not merged onto one.
    <div style={{ left: `${x}%`, top: `${y}%` }} className="absolute -translate-x-1/2 -translate-y-1/2">
      <motion.div style={{ opacity, y: ry, scale }} className="flex flex-col items-center gap-1.5">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border-strong bg-surface shadow-lg sm:h-14 sm:w-14">
          {children}
        </div>
        <span className="whitespace-nowrap font-display text-[9px] font-bold uppercase tracking-[0.15em] text-text-muted sm:text-[10px]">
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
  const customerPose: CharacterPose = { armL: 10, armR: -55, headTilt: -4, expression: "focused" };
  const repPose: CharacterPose = { armL: 55, armR: -10, headTilt: 4, expression: "smile" };

  return (
    <div className="relative h-full w-full">
      <Desk progress={progress} />

      <div className={CUSTOMER_SLOT}>
        <Character variant="customer" pose={customerPose} />
      </div>
      <div className={REP_SLOT}>
        <Character variant="rep" pose={repPose} flip />
      </div>

      <PartCard progress={progress} start={0.05} end={0.22} x={38} y={20} label="CPU">
        <CpuIcon size={26} />
      </PartCard>
      <PartCard progress={progress} start={0.12} end={0.29} x={50} y={12} label="GPU">
        <GpuIcon size={26} />
      </PartCard>
      <PartCard progress={progress} start={0.19} end={0.36} x={62} y={20} label="RAM">
        <RamIcon size={26} />
      </PartCard>
      <PartCard progress={progress} start={0.26} end={0.43} x={38} y={44} label="Storage">
        <SsdIcon size={26} />
      </PartCard>
      <PartCard progress={progress} start={0.33} end={0.5} x={50} y={52} label="Case">
        <CaseIcon size={26} />
      </PartCard>
      <PartCard progress={progress} start={0.4} end={0.57} x={62} y={44} label="Cooling">
        <CoolingIcon size={26} />
      </PartCard>
    </div>
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
  const customerPose: CharacterPose = { armL: 14, armR: -18, headTilt: 3, expression: "smile" };
  const repPose: CharacterPose = { armL: 20, armR: -60, headTilt: -3, expression: "smile" };

  const card = useStagger(progress, 0.04, 0.2);
  const rows: [string, string][] = [
    ["Selected parts", "6 components"],
    ["Price", "Current pricing"],
    ["Shipping estimate", "Provided"],
  ];

  return (
    <div className="relative h-full w-full">
      <Desk progress={progress} />

      <div className={CUSTOMER_SLOT}>
        <Character variant="customer" pose={customerPose} />
      </div>
      <div className={REP_SLOT}>
        <Character variant="rep" pose={repPose} flip />
      </div>

      <div className="absolute left-1/2 top-[16%] w-[60%] max-w-[270px] -translate-x-1/2">
        <motion.div
          style={{ opacity: card.opacity, y: card.y, scale: card.scale }}
          className="rounded-2xl border border-border-strong bg-surface p-4 shadow-2xl sm:p-5"
        >
          <div className="mb-3 flex items-center gap-2">
            <ReceiptIcon size={24} />
            <span className="font-display text-xs font-bold uppercase tracking-[0.15em] text-text-primary">
              Quotation
            </span>
          </div>
          <div className="flex flex-col gap-2">
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scene 3 — Confirm Your Order                                        */
/* ------------------------------------------------------------------ */

export function SceneConfirm({ progress }: { progress: MotionValue<number> }) {
  const customerPose: CharacterPose = { armL: 10, armR: -70, headTilt: 2, expression: "focused" };
  const repPose: CharacterPose = { armL: 16, armR: -14, headTilt: -2, expression: "smile" };

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
    <div className="relative h-full w-full">
      <Desk progress={progress} />

      <div className={CUSTOMER_SLOT}>
        <Character variant="customer" pose={customerPose} rightHand={<CoinIcon size={22} />} />
      </div>
      <div className={REP_SLOT}>
        <Character variant="rep" pose={repPose} flip />
      </div>

      <motion.div
        style={{ opacity: pulse }}
        className="absolute left-1/2 top-[22%] h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent"
      />

      <div className="absolute left-1/2 top-[22%] flex -translate-x-1/2 -translate-y-1/2 items-center gap-3 sm:gap-5">
        {stages.map(([label, s], i) => (
          <div key={label} className="flex items-center gap-3 sm:gap-5">
            <motion.div
              style={{ opacity: s.opacity, scale: s.scale }}
              className="flex flex-col items-center gap-1.5"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border-strong bg-surface shadow-lg sm:h-14 sm:w-14">
                {label === "Deposit" && <CoinIcon size={26} />}
                {label === "Confirmed" && <CheckIcon size={26} />}
                {label === "Order placed" && <ReceiptIcon size={26} />}
              </div>
              <span className="whitespace-nowrap font-display text-[9px] font-bold uppercase tracking-[0.15em] text-text-muted sm:text-[10px]">
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
    </div>
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

const sourcingCustomerPose: CharacterPose = { armL: 10, armR: -12, headTilt: 0, expression: "neutral" };
const sourcingRepPose: CharacterPose = { armL: 12, armR: -10, headTilt: 0, expression: "neutral" };

export function SceneSourcing({ progress }: { progress: MotionValue<number> }) {
  const deskOpacity = useTransform(progress, [0, 0.1], [1, 0]);
  const deskScale = useTransform(progress, [0, 0.2], [1, 0.7]);

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
    <div className="relative h-full w-full">
      <motion.div style={{ opacity: deskOpacity, scale: deskScale }} className="absolute inset-0">
        <Desk progress={progress} />
        <div className={CUSTOMER_SLOT}>
          <Character variant="customer" pose={sourcingCustomerPose} />
        </div>
        <div className={REP_SLOT}>
          <Character variant="rep" pose={sourcingRepPose} flip />
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
          <PinIcon size={26} color={FIGURE_COLORS.textPrimary} />
          <span className="mt-1 font-display text-xs font-bold uppercase tracking-[0.15em] text-text-primary">
            U.S.
          </span>
        </motion.div>

        <motion.div
          style={{ opacity: qatarLabel, left: `${(ROUTE_P2[0] / 640) * 100}%`, top: `${(ROUTE_P2[1] / 200) * 100}%` }}
          className="absolute -translate-x-1/2 -translate-y-[calc(100%+6px)] flex flex-col items-center"
        >
          <PinIcon size={26} color={FIGURE_COLORS.red} />
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
          <ParcelIcon size={26} />
        </motion.div>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scene 5 — Built. Set Up. Delivered.                                 */
/* ------------------------------------------------------------------ */

const BUILD_STAGES: Array<{ label: string; icon: React.ReactNode; start: number; end: number }> = [
  { label: "Build", icon: <CaseIcon size={24} />, start: 0.02, end: 0.14 },
  { label: "Setup", icon: <CoolingIcon size={24} />, start: 0.1, end: 0.22 },
  { label: "Ready", icon: <ReadyScreenIcon size={24} />, start: 0.18, end: 0.3 },
  { label: "Delivered", icon: <ParcelIcon size={24} />, start: 0.26, end: 0.38 },
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
      className="flex flex-col items-center gap-1.5"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border-strong bg-surface shadow-lg sm:h-14 sm:w-14">
        {icon}
      </div>
      <span className="whitespace-nowrap font-display text-[9px] font-bold uppercase tracking-[0.15em] text-text-muted sm:text-[10px]">
        {label}
      </span>
    </motion.div>
  );
}

const deliveredRepPose: CharacterPose = { armL: 50, armR: -50, headTilt: -3, expression: "focused" };
const deliveredCustomerPose: CharacterPose = { armL: 10, armR: -30, headTilt: -3, expression: "happy" };

export function SceneDelivered({ progress }: { progress: MotionValue<number> }) {
  const buildPhase = useTransform(progress, [0, 0.4, 0.5], [1, 1, 0]);
  const handoffPhase = useTransform(progress, [0.46, 0.64], [0, 1]);
  const noteOpacity = useTransform(progress, [0.7, 0.86], [0, 1]);

  return (
    <div className="relative h-full w-full">
      <Desk progress={progress} />

      <motion.div
        style={{ opacity: buildPhase }}
        className="absolute inset-x-0 top-[8%] flex justify-center gap-3 sm:gap-5"
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
        <Character variant="customer" pose={deliveredCustomerPose} />
      </div>
      <div className={REP_SLOT}>
        <Character variant="rep" pose={deliveredRepPose} flip rightHand={<CaseIcon size={16} />} />
      </div>

      <div className="absolute left-1/2 top-[40%] -translate-x-1/2 -translate-y-1/2">
        <motion.div
          style={{ opacity: handoffPhase, scale: useTransform(handoffPhase, [0, 1], [0.85, 1]) }}
          className="flex flex-col items-center gap-1.5"
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-accent bg-surface shadow-xl">
            <CaseIcon size={34} />
          </div>
          <span className="font-display text-[10px] font-bold uppercase tracking-[0.15em] text-accent">
            Your PC
          </span>
        </motion.div>
      </div>

      <motion.p
        style={{ opacity: noteOpacity }}
        className="absolute inset-x-0 bottom-[2%] text-center text-xs text-text-muted"
      >
        Pickup or delivery can then be arranged.
      </motion.p>
    </div>
  );
}
