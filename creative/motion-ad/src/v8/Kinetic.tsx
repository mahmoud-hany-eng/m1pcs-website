import React from "react";
import { bezier, clamp01, ease, lerp, range } from "../lib/ease";
import { BRAND } from "../final/shared";
import { FONT } from "../final/fonts";

/**
 * Kinetic type — the narration's emphasis made into motion (refs 1 & 2):
 * words arrive one at a time ON the spoken word (a rise out of a soft blur on
 * one clean S-curve), an emphasised word can be bigger /
 * coloured / pushed toward the camera, and phrases leave quickly so the
 * picture can take over again. Never subtitles: only the words that matter.
 */

export type KW = {
  w: string;
  at: number; // when it is said (s)
  color?: string;
  size?: number; // px; defaults to the line size
  weight?: number;
  font?: "display" | "ui";
  push?: [number, number, number]; // [t0, t1, extra scale] — drift toward camera
  gap?: number; // px after the word (default: 0.28em)
};
type LineProps = {
  t: number;
  words: KW[];
  x: number;
  y: number; // baseline-ish top of the line box (px)
  size: number;
  align?: "left" | "center" | "right";
  out?: number; // exit start
  outDur?: number;
  outMode?: "up" | "down" | "blur" | "scale";
  color?: string;
  weight?: number;
  font?: "display" | "ui";
  track?: number; // letter-spacing (em)
  shadow?: boolean;
  enterDur?: number;
  style?: React.CSSProperties;
};

/**
 * Word motion: ONE acceleration → clean travel → ONE deceleration → settled.
 * A symmetric-ish S-curve (no fast-start "settle" tail, no spring, no overshoot)
 * over a slightly longer travel; opacity and a light focus pull run on their own
 * shorter curves so the word is readable well before the travel ends.
 * Quick: ~0.36 s from first pixel to landed (MOVE → LAND → STAY), ~0.25 s out. Only
 * transform / opacity / filter animate — the layout (size, tracking, spacing)
 * never changes, and nothing is rounded to whole pixels.
 */
export const arrive = bezier(0.42, 0, 0.18, 1);
const depart = bezier(0.55, 0, 0.8, 0.35);
export const Word: React.FC<{ t: number; k: KW; size: number; color: string; weight: number; font: string; track: number; enterDur: number; exit: number; outMode: LineProps["outMode"] }> = ({ t, k, size, color, weight, font, track, enterDur, exit, outMode }) => {
  const u = range(t, k.at - 0.03, k.at - 0.03 + enterDur);
  const e = arrive(u);
  const vis = ease.inOutCubic(range(t, k.at - 0.03, k.at - 0.03 + enterDur * 0.5));
  const base: React.CSSProperties = { display: "inline-block", fontSize: k.size ?? size, marginRight: k.gap ?? "0.28em", letterSpacing: `${track}em`, whiteSpace: "pre" };
  if (vis <= 0) return <span style={{ ...base, opacity: 0 }}>{k.w}</span>;
  const push = k.push ? lerp(1, k.push[2], ease.inOutCubic(range(t, k.push[0], k.push[1]))) : 1;
  const ox = exit;
  const exitY = outMode === "down" ? 0.3 : outMode === "up" ? -0.3 : 0;
  const exitScale = outMode === "scale" ? 1 + 0.2 * ox : 1;
  const focus = 1 - ease.inOutCubic(clamp01(u / 0.6));
  return (
    <span
      style={{
        ...base,
        color: k.color ?? color,
        fontWeight: k.weight ?? weight,
        fontFamily: k.font === "ui" ? FONT.ui : k.font === "display" ? FONT.display : font,
        opacity: vis * (1 - ox),
        transform: `translate3d(0, ${((1 - e) * 0.42 + exitY * ox).toFixed(5)}em, 0) scale(${((0.965 + 0.035 * e) * push * exitScale).toFixed(5)})`,
        filter: `blur(${(7 * focus + (outMode === "blur" || outMode === "scale" ? 10 : 4) * ox).toFixed(3)}px)`,
        transformOrigin: "50% 70%",
      }}
    >
      {k.w}
    </span>
  );
};

/** a line of kinetic words */
export const Line: React.FC<LineProps> = ({ t, words, x, y, size, align = "left", out = 1e9, outDur = 0.25, outMode = "up", color = BRAND.white, weight = 700, font = "display", track = -0.02, shadow = true, enterDur = 0.36, style }) => {
  if (t < words[0].at - 0.05 || t > out + outDur + 0.05) return null;
  const exit = depart(range(t, out, out + outDur));
  return (
    <div
      style={{
        position: "absolute",
        left: align === "left" ? x : align === "center" ? x - 1080 : undefined,
        right: align === "right" ? 1080 - x : undefined,
        width: align === "center" ? 2160 : undefined,
        top: y,
        textAlign: align,
        fontFamily: font === "ui" ? FONT.ui : FONT.display,
        lineHeight: 1,
        whiteSpace: "nowrap",
        textShadow: shadow ? "0 6px 36px rgba(0,0,0,0.85)" : undefined,
        pointerEvents: "none",
        ...style,
      }}
    >
      {words.map((k, i) => (
        <Word key={i} t={t} k={k} size={size} color={color} weight={weight} font={font === "ui" ? FONT.ui : FONT.display} track={track} enterDur={enterDur} exit={exit} outMode={outMode} />
      ))}
    </div>
  );
};

/** a short underline that draws under a word (emphasis) */
export const Underline: React.FC<{ t: number; at: number; x: number; y: number; w: number; color?: string; thick?: number; out?: number }> = ({ t, at, x, y, w, color = BRAND.yellow, thick = 6, out = 1e9 }) => {
  const k = arrive(range(t, at, at + 0.36));
  if (k <= 0) return null;
  const o = 1 - range(t, out, out + 0.25);
  return <div style={{ position: "absolute", left: x, top: y, width: w, transformOrigin: "0 50%", transform: `scaleX(${k.toFixed(5)})`, height: thick, borderRadius: thick / 2, background: color, opacity: o, boxShadow: `0 0 18px ${color}` }} />;
};
