import React from "react";
import { AbsoluteFill } from "remotion";
import { ease, lerp, range } from "../lib/ease";
import { BRAND, glide, snap } from "./shared";
import { FONT } from "./fonts";
import { CHAT_END, DONE_CHECK } from "./Chat";
import T from "../../timeline.json";

const RC = T.final.cues.route;

/**
 * Shot 6: SOURCED FROM THE U.S. — the "Order confirmed" check becomes the
 * route's first node. The route uses the site's own sourcing visual language
 * (quadratic arc, U.S. node white, QATAR node red, the yellow parcel), drawn
 * as crisp vectors at film scale. The parcel travels, the camera tracks it,
 * and its arrival lands on the Qatar node — whose red light becomes the
 * first real build in the next shot.
 */

export const R0 = 10.0;
export const ARRIVE = RC.arrive;
export const ROUTE_OUT = RC.out;
const P0 = { x: 210, y: 1170 };
const P1 = { x: 540, y: 820 };
const P2 = { x: 870, y: 1170 };
export const QATAR = P2;
const qb = (t: number, a: number, b: number, c: number) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;
const at = (u: number) => ({ x: qb(u, P0.x, P1.x, P2.x), y: qb(u, P0.y, P1.y, P2.y) });
const ROUTE = `M ${P0.x} ${P0.y} Q ${P1.x} ${P1.y} ${P2.x} ${P2.y}`;
const LEN = 850;

/** the camera's push into the Qatar light (shared with the builds shot) */
export const routePush = (t: number) => ease.accelerate(range(t, ROUTE_OUT - 0.1, 12.05));

export const Route: React.FC<{ t: number }> = ({ t }) => {
  if (t < CHAT_END - 0.05 || t > 12.1) return null;

  // the check flies from the chat bubble to the U.S. node
  const from = DONE_CHECK(CHAT_END);
  const fly = ease.inOutCubic(range(t, CHAT_END - 0.02, CHAT_END + 0.34));
  const node = { x: lerp(from.x, P0.x, fly), y: lerp(from.y, P0.y, fly) - 120 * Math.sin(Math.PI * fly) };
  const nodeR = lerp(30, 17, fly);
  const checkOut = range(t, CHAT_END + 0.2, CHAT_END + 0.34);

  const draw = glide(range(t, RC.draw, ARRIVE));
  const parcel = at(draw);
  const arrive = range(t, ARRIVE, ARRIVE + 0.5);
  const scene = range(t, CHAT_END + 0.1, CHAT_END + 0.4);

  // camera: tracks the parcel a little, then pushes into Qatar's light
  const track = lerp(50, -40, glide(range(t, 10.3, ARRIVE + 0.1)));
  const push = routePush(t);
  const zoom = 1 + 0.035 * glide(range(t, 10.2, ARRIVE)) + 7 * push;
  const outK = range(t, ROUTE_OUT, 11.9);

  const h1 = ease.settle(range(t, 10.28, 10.6));
  const h2 = ease.settle(range(t, 10.36, 10.68));
  const textOut = ease.inCubic(range(t, ROUTE_OUT - 0.1, ROUTE_OUT + 0.12));

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ backgroundColor: BRAND.bg, opacity: scene }} />

      {/* headline */}
      <div style={{ position: "absolute", left: 90, top: 390, fontFamily: FONT.display, fontWeight: 700, fontSize: 122, lineHeight: 1.0, letterSpacing: -3, color: BRAND.white, opacity: 1 - textOut, transform: `translateY(${-80 * textOut}px)` }}>
        <div style={{ overflow: "hidden", paddingBottom: 8 }}>
          <div style={{ transform: `translateY(${(1 - h1) * 110}%)` }}>SOURCED FROM</div>
        </div>
        <div style={{ overflow: "hidden", paddingBottom: 8 }}>
          <div style={{ transform: `translateY(${(1 - h2) * 110}%)` }}>
            THE <span style={{ color: BRAND.yellow }}>U.S.</span>
          </div>
        </div>
      </div>

      <AbsoluteFill style={{ transformOrigin: `${P2.x}px ${P2.y}px`, transform: `translateX(${track * (1 - push)}px) scale(${zoom})` }}>
        <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, overflow: "visible", opacity: scene * (1 - outK) }}>
          <defs>
            <linearGradient id="trail" gradientUnits="userSpaceOnUse" x1={P0.x} y1={0} x2={P2.x} y2={0}>
              <stop offset="0" stopColor={BRAND.yellow} stopOpacity={0} />
              <stop offset="1" stopColor={BRAND.yellow} stopOpacity={0.95} />
            </linearGradient>
            <radialGradient id="qglow">
              <stop offset="0" stopColor="#ff4a2e" stopOpacity={0.9} />
              <stop offset="0.4" stopColor="#e73225" stopOpacity={0.35} />
              <stop offset="1" stopColor="#e73225" stopOpacity={0} />
            </radialGradient>
          </defs>
          {/* the full route, faint and dotted (as on the site) */}
          <path d={ROUTE} fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth={4} strokeDasharray="3 15" strokeLinecap="round" opacity={range(t, 10.2, 10.4)} />
          {/* the travelled part, bright */}
          <path d={ROUTE} fill="none" stroke="url(#trail)" strokeWidth={6} strokeLinecap="round" strokeDasharray={`${LEN * draw} ${LEN * 2}`} />
          {/* U.S. */}
          <circle cx={P0.x} cy={P0.y} r={17} fill={BRAND.white} opacity={fly > 0.98 ? 1 : 0} />
          <text x={P0.x} y={P0.y + 76} textAnchor="middle" fill={BRAND.white} style={{ fontFamily: FONT.ui, fontWeight: 700, fontSize: 34, letterSpacing: 5 }} opacity={range(t, 10.25, 10.45)}>
            U.S.
          </text>
          {/* QATAR */}
          <circle cx={P2.x} cy={P2.y} r={120 + 120 * arrive} fill="url(#qglow)" opacity={range(t, 10.3, 10.6) * (0.25 + 0.75 * Math.sin(Math.PI * Math.min(1, arrive * 1.4 + (arrive > 0 ? 0.3 : 0))))} />
          <circle cx={P2.x} cy={P2.y} r={17 + 8 * snap(arrive)} fill={BRAND.red} opacity={range(t, 10.3, 10.5)} />
          {arrive > 0 && arrive < 1 && <circle cx={P2.x} cy={P2.y} r={22 + 110 * ease.outCubic(arrive)} fill="none" stroke={BRAND.red} strokeWidth={4} opacity={1 - arrive} />}
          <text x={P2.x} y={P2.y + 76} textAnchor="middle" fill={BRAND.red} style={{ fontFamily: FONT.ui, fontWeight: 700, fontSize: 34, letterSpacing: 5 }} opacity={range(t, 10.3, 10.5)}>
            QATAR
          </text>
          {/* parcel (the site's yellow parcel) */}
          {t >= 10.36 && arrive < 0.6 && (
            <g transform={`translate(${parcel.x} ${parcel.y}) rotate(${(draw - 0.5) * 50}) scale(${1 - 0.6 * range(arrive, 0, 0.6)})`}>
              <rect x={-26} y={-26} width={52} height={52} rx={11} fill={BRAND.yellow} />
              <path d="M-26 -8 H26 M0 -26 V-8" stroke="#7a5d00" strokeWidth={4} />
            </g>
          )}
        </svg>
        {/* the check from the chat, landing as the U.S. node */}
        {fly < 1 && (
          <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            <circle cx={node.x} cy={node.y} r={nodeR} fill={fly < 0.5 ? "#25D366" : BRAND.white} />
            <path d={`M${node.x - nodeR * 0.45} ${node.y + nodeR * 0.05} l${nodeR * 0.3} ${nodeR * 0.3} l${nodeR * 0.55} ${-nodeR * 0.62}`} fill="none" stroke="#08130c" strokeWidth={nodeR * 0.2} strokeLinecap="round" strokeLinejoin="round" opacity={1 - checkOut} />
          </svg>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const routeSamples = (t: number) => {
  if (t >= CHAT_END && t < CHAT_END + 0.34) return 6;
  if (t >= 10.5 && t < ARRIVE) return 4; // parcel travel
  if (t >= ROUTE_OUT && t < 12.05) return 8; // push into the light
  return 1;
};
