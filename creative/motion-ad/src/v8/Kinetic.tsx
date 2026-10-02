import React from "react";
import { clamp01, ease, lerp, range } from "../lib/ease";
import { BRAND } from "../final/shared";
import { FONT } from "../final/fonts";

/**
 * Kinetic type — the narration's emphasis made into motion (refs 1 & 2):
 * words arrive one at a time ON the spoken word (a short rise out of a soft
 * blur, tracking tightening as they land), an emphasised word can be bigger /
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

/** a single animated word */
export const Word: React.FC<{ t: number; k: KW; size: number; color: string; weight: number; font: string; track: number; enterDur: number; exit: number; outMode: LineProps["outMode"] }> = ({ t, k, size, color, weight, font, track, enterDur, exit, outMode }) => {
  const e = ease.settle(range(t, k.at, k.at + enterDur));
  const vis = clamp01(range(t, k.at, k.at + enterDur * 0.55));
  if (vis <= 0) return <span style={{ display: "inline-block", opacity: 0, fontSize: k.size ?? size, marginRight: k.gap ?? "0.28em" }}>{k.w}</span>;
  const push = k.push ? lerp(1, k.push[2], ease.inOutCubic(range(t, k.push[0], k.push[1]))) : 1;
  const ox = exit;
  const exitY = outMode === "down" ? 0.35 : outMode === "up" ? -0.35 : 0;
  const exitScale = outMode === "scale" ? 1 + 0.25 * ox : 1;
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: k.size ?? size,
        color: k.color ?? color,
        fontWeight: k.weight ?? weight,
        fontFamily: k.font === "ui" ? FONT.ui : k.font === "display" ? FONT.display : font,
        marginRight: k.gap ?? "0.28em",
        letterSpacing: `${track + 0.09 * (1 - e)}em`,
        opacity: vis * (1 - ox),
        transform: `translateY(${((1 - e) * 0.42 + exitY * ox).toFixed(4)}em) scale(${((0.94 + 0.06 * e) * push * exitScale).toFixed(4)})`,
        filter: `blur(${(10 * (1 - e) * (1 - e) + (outMode === "blur" || outMode === "scale" ? 12 : 4) * ox).toFixed(2)}px)`,
        transformOrigin: "50% 70%",
        whiteSpace: "pre",
      }}
    >
      {k.w}
    </span>
  );
};

/** a line of kinetic words */
export const Line: React.FC<LineProps> = ({ t, words, x, y, size, align = "left", out = 1e9, outDur = 0.35, outMode = "up", color = BRAND.white, weight = 700, font = "display", track = -0.02, shadow = true, enterDur = 0.42, style }) => {
  if (t < words[0].at - 0.05 || t > out + outDur + 0.05) return null;
  const exit = ease.inCubic(range(t, out, out + outDur));
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
  const k = ease.settle(range(t, at, at + 0.4));
  if (k <= 0) return null;
  const o = 1 - range(t, out, out + 0.25);
  return <div style={{ position: "absolute", left: x, top: y, width: w * k, height: thick, borderRadius: thick / 2, background: color, opacity: o, boxShadow: `0 0 18px ${color}` }} />;
};
