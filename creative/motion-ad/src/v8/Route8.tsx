import React from "react";
import { AbsoluteFill } from "remotion";
import { clamp01, ease, lerp, range } from "../lib/ease";
import { BRAND, glide, snap } from "../final/shared";
import { FONT } from "../final/fonts";
import { V } from "./time";
import { Line } from "./Kinetic";

const WA = { green: "#25D366" };
/** where the "Order confirmed" check is on screen (projected from the phone), and its size */
export type CheckAt = (t: number) => { x: number; y: number; size: number };
import WORLD from "../data/world-dots.json";

/**
 * v7 sourcing (route born from the phone's confirmation check) — SOURCED FROM THE U.S.
 * The "Order confirmed" check is the start of the journey: the camera pushes
 * into it, its disc becomes the U.S. node and its long stroke keeps going —
 * it IS the route. A dotted world (the site's own How It Works land mask, U.S.
 * and Qatar cells tagged) fades in under it and tilts into depth; the camera
 * follows a small luminous parcel along the arc, markers tick past, Qatar
 * glows ahead, the parcel lands, a ripple, a held beat — then the camera
 * pushes into Qatar's light, which becomes the ring of a real PC fan.
 */

const R = V.route;
const PUSH = V.chat.push;
let CHECK: CheckAt = () => ({ x: 540, y: 960, size: 64 });
const K = 18; // map px per degree (equirectangular)
const geo = (lat: number, lon: number) => ({ x: (lon + 180) * K, y: (90 - lat) * K });
const US = geo(39.2, -97.5); // the same points the site's globe uses
const QA = geo(25.3, 51.2);
// the route leaves the U.S. in the direction of the check's long stroke (13, -15)
const P1 = { x: (US.x + QA.x) / 2, y: US.y - (((US.x + QA.x) / 2 - US.x) * 15) / 13 };
const qb = (u: number, a: number, b: number, c: number) => (1 - u) * (1 - u) * a + 2 * (1 - u) * u * b + u * u * c;
const at = (u: number) => ({ x: qb(u, US.x, P1.x, QA.x), y: qb(u, US.y, P1.y, QA.y) });
const ROUTE_N = 160;
const ROUTE_PTS = Array.from({ length: ROUTE_N + 1 }, (_, i) => at(i / ROUTE_N));
const MARKERS = [0.2, 0.36, 0.52, 0.68, 0.84];

// ------------------------------------------------------------------ camera over the map
type MapCam = { x: number; y: number; zoom: number; tilt: number; ax: number; ay: number };
const Y0 = 1150; // horizon pivot for the tilt
const PERSP = 1700;
const travelU = (t: number) => ease.inOutCubic(range(t, R.travel[0], R.travel[1]));
function mapCam(t: number): MapCam {
  // start: the U.S. node sits exactly where the check's vertex is after the push
  const dc = CHECK(R.stroke[0] + 0.3);
  const unit = dc.size / 48;
  const vertex = { x: dc.x + (21 - 24) * unit, y: dc.y + (32 - 24) * unit };
  const anchor0 = vertex;
  const anchor1 = { x: 300, y: 1180 };
  const settle = ease.inOutCubic(range(t, R.stroke[0] + 0.3, R.stroke[1] + 0.25));
  const ax = lerp(anchor0.x, anchor1.x, settle), ay = lerp(anchor0.y, anchor1.y, settle);
  const zoom = 0.55;
  // follow the parcel (with a little lead), then frame Qatar
  const u = travelU(t);
  const lead = at(Math.min(1, u + 0.06));
  const follow = ease.inOutCubic(range(t, R.travel[0] - 0.1, R.travel[0] + 0.5));
  const fx = lerp(US.x, lead.x, follow) - (540 - ax) / zoom * (1 - follow) * 0;
  const fy = lerp(US.y, lead.y, follow);
  const tilt = 34 * ease.inOutCubic(range(t, R.travel[0] - 0.1, R.travel[0] + 0.7)) * (1 - ease.inOutCubic(range(t, R.fan[0], R.fan[0] + 0.35)));
  // anchor drifts to frame centre while following
  return { x: fx, y: fy, zoom, tilt, ax: lerp(ax, 540, follow), ay: lerp(ay, 1120, follow) };
}
function project(m: { x: number; y: number }, c: MapCam, extraZoom = 1, about?: { x: number; y: number }) {
  let px = (m.x - c.x) * c.zoom + c.ax;
  let py = (m.y - c.y) * c.zoom + c.ay;
  if (about && extraZoom !== 1) {
    px = about.x + (px - about.x) * extraZoom;
    py = about.y + (py - about.y) * extraZoom;
  }
  const a = (c.tilt * Math.PI) / 180;
  const yRel = py - Y0;
  const z = -yRel * Math.sin(a);
  const f = PERSP / (PERSP + z);
  return { x: 540 + (px - 540) * f, y: Y0 + yRel * Math.cos(a) * f, f };
}

export const ROUTE_END = R.fan[1];

export const Route8: React.FC<{ t: number; check: CheckAt }> = ({ t, check }) => {
  CHECK = check;
  if (t < R.stroke[0] || t > R.fan[1] + 0.1) return null;

  // the camera has pushed into the confirmation check on the phone (the world camera did it)
  const dc = check(Math.min(t, R.stroke[0] + 0.3));
  const c = mapCam(t);

  // the camera's final push into Qatar's light
  const fanK = ease.inCubic(range(t, R.fan[0], R.fan[1]));
  const qa0 = project(QA, c);
  const extra = Math.pow(14, fanK);
  const P = (m: { x: number; y: number }) => project(m, c, extra, qa0);

  const mapIn = ease.inOutCubic(range(t, R.stroke[0] + 0.25, R.stroke[0] + 0.7));
  const mapOut = range(fanK, 0.25, 0.7);

  // the check: disc → U.S. node, short stroke fades, long stroke becomes the route
  const unit = dc.size / 48;
  const morph = ease.inOutCubic(range(t, R.stroke[0] + 0.25, R.stroke[1]));
  const usP = P(US);
  const vertexScreen = morph > 0 ? usP : { x: dc.x + (21 - 24) * unit, y: dc.y + (32 - 24) * unit };
  const discR = lerp(22 * unit, 15, morph);
  const discC = { x: lerp(dc.x, usP.x, morph), y: lerp(dc.y, usP.y, morph) };
  const shortOut = range(t, R.stroke[0] + 0.25, R.stroke[0] + 0.45);
  const stretch = glide(range(t, R.stroke[0] + 0.3, R.stroke[1] + 0.15));

  // route drawn ahead of the parcel
  const u = travelU(t);
  const drawn = Math.max(0.1 * stretch, t >= R.travel[0] ? Math.min(1, u + 0.07) : 0);
  const nDrawn = Math.max(1, Math.round(drawn * ROUTE_N));
  const routeScreen = ROUTE_PTS.slice(0, nDrawn + 1).map((p) => P(p));
  const routePath = routeScreen.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const fullPath = ROUTE_PTS.map((p, i) => {
    const q = P(p);
    return `${i ? "L" : "M"}${q.x.toFixed(1)},${q.y.toFixed(1)}`;
  }).join(" ");
  // first segment = the check's long stroke, in its own orientation, until the map takes over
  const strokeTip = { x: vertexScreen.x + 13 * unit * (1 - morph), y: vertexScreen.y - 15 * unit * (1 - morph) };

  const parcelIn = snap(range(t, R.parcel, R.parcel + 0.3));
  const pp = P(at(u));
  const arrive = range(t, R.arrive, R.arrive + 0.6);
  const qaGlow = range(t, R.travel[1] - 0.6, R.arrive) + 0.6 * arrive;

  const hOut = ease.inCubic(range(t, R.fan[0] - 0.15, R.fan[0] + 0.1));
  const RW = R.words;
  // "U.S." leaves the headline and becomes the route's origin label
  const usFly = ease.inOutCubic(range(t, RW.us + 0.42, RW.us + 0.95));
  const qaWord = ease.settle(range(t, R.qatarWord - 0.04, R.qatarWord + 0.45));

  const dotR = 4.4 * c.zoom * extra;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ backgroundColor: BRAND.bg, opacity: range(t, R.stroke[0] + 0.05, R.stroke[0] + 0.4) }} />

      {/* the dotted world, tilting into depth */}
      <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, opacity: mapIn * (1 - mapOut) }}>
        {(WORLD.dots as number[][]).map(([cx, cy, val], i) => {
          const m = { x: (cx * 2 + 1) * K, y: (cy * 2 + 1) * K };
          const q = P(m);
          if (q.x < -40 || q.x > 1120 || q.y < -40 || q.y > 1960) return null;
          const depth = clamp01((q.f - 0.55) / 0.6);
          const col = val === 2 ? `rgba(245,245,247,${0.55 * depth + 0.3})` : val === 3 ? BRAND.red : `rgba(176,176,184,${0.5 * depth + 0.28})`;
          return <circle key={i} cx={q.x} cy={q.y} r={dotR * q.f} fill={col} />;
        })}
      </svg>

      <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", opacity: 1 - mapOut }}>
        <defs>
          <radialGradient id="qglow6">
            <stop offset="0" stopColor="#ff5a3c" stopOpacity={0.95} />
            <stop offset="0.35" stopColor="#e73225" stopOpacity={0.4} />
            <stop offset="1" stopColor="#e73225" stopOpacity={0} />
          </radialGradient>
          <linearGradient id="trail6" gradientUnits="userSpaceOnUse" x1={P(US).x} y1={0} x2={pp.x} y2={0}>
            <stop offset="0" stopColor={BRAND.yellow} stopOpacity={0.25} />
            <stop offset="1" stopColor={BRAND.yellow} stopOpacity={1} />
          </linearGradient>
        </defs>
        {/* the rest of the journey, faint and dotted (the site's route style) */}
        <path d={fullPath} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={3} strokeDasharray="2 14" strokeLinecap="round" opacity={range(t, R.travel[0] - 0.3, R.travel[0])} />
        {/* the travelled line — born from the check's stroke */}
        {morph > 0.02 ? (
          <path d={routePath} fill="none" stroke="url(#trail6)" strokeWidth={lerp(5 * unit / 8, 6, morph)} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <line x1={vertexScreen.x} y1={vertexScreen.y} x2={strokeTip.x} y2={strokeTip.y} stroke={WA.green} strokeWidth={0} />
        )}
        {/* route markers tick past as the parcel reaches them */}
        {MARKERS.map((mu) => {
          const on = range(u, mu - 0.02, mu + 0.02);
          if (on <= 0) return null;
          const q = P(at(mu));
          const pulse = range(t, R.travel[0] + (mu - 0.02) * (R.travel[1] - R.travel[0]), R.travel[0] + (mu + 0.12) * (R.travel[1] - R.travel[0]));
          return (
            <g key={mu}>
              <circle cx={q.x} cy={q.y} r={5 * q.f} fill={BRAND.yellow} opacity={0.9} />
              {pulse < 1 && <circle cx={q.x} cy={q.y} r={(8 + 26 * pulse) * q.f} fill="none" stroke={BRAND.yellow} strokeWidth={2} opacity={0.6 * (1 - pulse)} />}
            </g>
          );
        })}
        {/* Qatar: glows ahead, then the arrival */}
        {(() => {
          const q = P(QA);
          return (
            <g>
              <circle cx={q.x} cy={q.y} r={(90 + 140 * qaGlow) * q.f * Math.min(extra, 6)} fill="url(#qglow6)" opacity={range(t, R.travel[0], R.travel[0] + 0.4)} />
              <circle cx={q.x} cy={q.y} r={(13 + 6 * snap(arrive)) * q.f * Math.min(extra, 6)} fill={BRAND.red} opacity={range(t, R.travel[0], R.travel[0] + 0.3)} />
              {arrive > 0 && arrive < 1 && [0, 0.18].map((d) => {
                const a2 = clamp01((arrive - d) / (1 - d));
                return <circle key={d} cx={q.x} cy={q.y} r={(20 + 150 * ease.outCubic(a2)) * q.f} fill="none" stroke={d ? BRAND.yellow : BRAND.red} strokeWidth={d ? 3 : 4} opacity={1 - a2} />;
              })}
            </g>
          );
        })()}
        {/* the parcel: a small luminous M1-red body with a yellow core */}
        {t >= R.parcel && arrive < 0.5 && (
          <g transform={`translate(${pp.x} ${pp.y}) scale(${parcelIn * pp.f * (1 - range(arrive, 0, 0.5))})`}>
            <rect x={-30} y={-30} width={60} height={60} rx={14} fill="rgba(231,50,37,0.25)" />
            <rect x={-18} y={-18} width={36} height={36} rx={8} fill={BRAND.red} />
            <rect x={-8} y={-8} width={16} height={16} rx={4} fill={BRAND.yellow} />
          </g>
        )}
        {/* the check: its disc becomes the U.S. node */}
        <circle cx={discC.x} cy={discC.y} r={discR} fill={morph < 0.5 ? WA.green : BRAND.white} opacity={morph < 0.5 ? 1 : 1} />
        {morph < 0.98 && (
          <g opacity={1 - shortOut}>
            <path
              d={`M${vertexScreen.x - 7 * unit} ${vertexScreen.y - 7 * unit} L${vertexScreen.x} ${vertexScreen.y}`}
              fill="none"
              stroke="#08130c"
              strokeWidth={5 * unit}
              strokeLinecap="round"
            />
          </g>
        )}
        {morph < 0.5 && (
          <path d={`M${vertexScreen.x} ${vertexScreen.y} L${vertexScreen.x + 13 * unit * (1 + 2.5 * stretch)} ${vertexScreen.y - 15 * unit * (1 + 2.5 * stretch)}`} fill="none" stroke={morph < 0.25 ? "#08130c" : BRAND.yellow} strokeWidth={5 * unit} strokeLinecap="round" opacity={1 - range(morph, 0.3, 0.5)} />
        )}
        {/* labels */}
        {(() => {
          const us = P(US), qa = P(QA);
          const lab = range(t, R.words.us + 0.85, R.words.us + 1.0) * (1 - mapOut);
          return (
            <>
              <text x={us.x} y={us.y + 70 * us.f} textAnchor="middle" fill={BRAND.white} style={{ fontFamily: FONT.ui, fontWeight: 700, fontSize: 36 * us.f, letterSpacing: 5 }} opacity={lab}>
                U.S.
              </text>
              {/* U.S. node alive */}
              <circle cx={us.x} cy={us.y} r={(16 + 30 * range(t, R.words.us + 0.9, R.words.us + 1.4)) * us.f} fill="none" stroke={BRAND.white} strokeWidth={3} opacity={(1 - range(t, R.words.us + 0.9, R.words.us + 1.4)) * (t >= R.words.us + 0.9 ? 0.8 : 0)} />
            </>
          );
        })()}
      </svg>

      {/* the push into Qatar's light becomes a fan ring */}
      {fanK > 0 && (
        <AbsoluteFill style={{ opacity: range(fanK, 0.2, 0.5) }}>
          <svg width={1080} height={1920}>
            <defs>
              <radialGradient id="fanlight">
                <stop offset="0" stopColor="#2a0a12" />
                <stop offset="0.55" stopColor="#2a0a12" />
                <stop offset="0.68" stopColor={`rgb(${Math.round(lerp(255, 240, fanK))},${Math.round(lerp(70, 90, fanK))},${Math.round(lerp(50, 200, fanK))})`} />
                <stop offset="0.8" stopColor={`rgba(${Math.round(lerp(231, 200, fanK))},50,${Math.round(lerp(37, 180, fanK))},0.5)`} />
                <stop offset="1" stopColor="rgba(0,0,0,0)" />
              </radialGradient>
            </defs>
            <circle cx={540} cy={960} r={lerp(120, 900, fanK)} fill="url(#fanlight)" />
          </svg>
        </AbsoluteFill>
      )}

      {/* headline — said, not subtitled: SOURCED / DIRECTLY FROM / THE U.S. */}
      <div style={{ position: "absolute", inset: 0, opacity: 1 - hOut, transform: `translateY(${-80 * hOut}px)` }}>
        <Line t={t} x={86} y={270} size={128} words={[{ w: "SOURCED", at: RW.sourced, gap: 0 }]} />
        <Line t={t} x={90} y={406} size={74} weight={600} track={0.02} words={[{ w: "DIRECTLY", at: RW.directly }, { w: "FROM", at: RW.directly + 0.3, gap: 0 }]} />
        <Line t={t} x={86} y={492} size={128} words={[{ w: "THE", at: RW.us - 0.12 }, { w: "U.S.", at: RW.us + 0.02, color: BRAND.yellow, gap: 0 }]} />
      </div>
      {usFly > 0 && usFly < 1 && (() => {
        const us = P(US);
        const from = { x: 86 + 128 * 1.62, y: 492 }, to = { x: us.x - 34 * us.f, y: us.y + 44 * us.f };
        const x = lerp(from.x, to.x, usFly), y = lerp(from.y, to.y, usFly) - 120 * Math.sin(Math.PI * usFly);
        const size = lerp(128, 36 * us.f, usFly);
        return <div style={{ position: "absolute", left: x, top: y, fontFamily: FONT.display, fontWeight: 700, fontSize: size, color: BRAND.yellow, opacity: 0.9 * (1 - range(usFly, 0.85, 1)), filter: `blur(${(4 * Math.sin(Math.PI * usFly)).toFixed(2)}px)`, textShadow: "0 0 24px rgba(249,194,4,0.8)", whiteSpace: "nowrap" }}>U.S.</div>;
      })()}
      {/* QATAR — arrives deliberately with the narrator */}
      {qaWord > 0 && (() => {
        const qa = P(QA);
        const o = 1 - range(fanK, 0, 0.25);
        return (
          <div style={{ position: "absolute", left: qa.x - 400, width: 800, top: qa.y + 70 * qa.f, textAlign: "center", fontFamily: FONT.display, fontWeight: 700, fontSize: 68 * qa.f, letterSpacing: `${0.18 + 0.2 * (1 - qaWord)}em`, color: BRAND.white, opacity: clamp01(qaWord * 1.5) * o, transform: `scale(${lerp(1.35, 1, qaWord)})`, filter: `blur(${(8 * (1 - qaWord)).toFixed(2)}px)`, textShadow: "0 0 30px rgba(231,50,37,0.9), 0 6px 30px rgba(0,0,0,0.8)" }}>
            QATAR
          </div>
        );
      })()}
    </AbsoluteFill>
  );
};

export const routeSamples8 = (t: number) => {
  if (t >= R.stroke[0] && t < R.stroke[0] + 0.7) return 6;
  if (t >= R.travel[0] && t < R.travel[1]) return 3;
  if (t >= R.fan[0] && t < R.fan[1]) return 8;
  return 1;
};
