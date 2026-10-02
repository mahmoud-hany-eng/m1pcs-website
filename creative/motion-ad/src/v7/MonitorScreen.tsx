import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { clamp01, ease, lerp, range } from "../lib/ease";
import { BRAND, glide, snap } from "../final/shared";
import { FONT } from "../final/fonts";
import { D, JLOG, Pill, Rect, SH, SW, TAP, V, jIndex, jTime } from "./time";

/**
 * Everything on the monitor's glass, authored in the capture's native pixels
 * (1620×2880 = the 720×1280 page at 2.25×) so the homography maps it 1:1:
 * the real page frame, the real pointer (drawn where the capture's mouse
 * was), the per-choice micro-interactions, the choices consolidating and the
 * quotation building itself.
 */

const Q = V.quote;
const PAGE_BG = "#0a0a0b";
const frameSrc = (i: number) => staticFile(`cap/journey7/f${String(i).padStart(5, "0")}.png`);
const X = (v: number) => v * D; // css px → capture px

/** a real crop of a frame at rect r (css), transformed about its centre */
const Crop: React.FC<{ index: number; r: Rect; transform?: string; opacity?: number; filter?: string; radius?: number }> = ({ index, r, transform, opacity = 1, filter, radius }) => (
  <div style={{ position: "absolute", left: X(r.x), top: X(r.y), width: X(r.w), height: X(r.h), overflow: "hidden", borderRadius: radius ?? X(r.h) / 2, transform, opacity, filter, transformOrigin: "50% 50%" }}>
    <Img src={frameSrc(index)} style={{ position: "absolute", left: -X(r.x), top: -X(r.y), width: SW, height: SH }} />
  </div>
);

const Takeover: React.FC<{ index: number; pills: Pill[]; fx: (p: Pill) => { dx: number; dy?: number; s: number; rot?: number; o: number } }> = ({ index, pills, fx }) => {
  const x0 = Math.min(...pills.map((p) => p.x)) - 6, x1 = Math.max(...pills.map((p) => p.x + p.w)) + 6;
  const y0 = Math.min(...pills.map((p) => p.y)) - 4, y1 = Math.max(...pills.map((p) => p.y + p.h)) + 4;
  return (
    <>
      <div style={{ position: "absolute", left: X(x0), top: X(y0), width: X(x1 - x0), height: X(y1 - y0), background: PAGE_BG }} />
      {pills.map((p) => {
        const f = fx(p);
        return <Crop key={p.label} index={index} r={p} opacity={f.o} transform={`translate(${X(f.dx)}px, ${X(f.dy ?? 0)}px) rotate(${f.rot ?? 0}deg) scale(${f.s})`} />;
      })}
    </>
  );
};
const rowOf = (i: number, group: string, pick: string) => {
  const g = JLOG[i].meta.groups[group];
  if (!g) return null;
  const p = g.find((q) => q.label === pick);
  return p ? { focus: p, row: g.filter((q) => Math.abs(q.y - p.y) < 4) } : null;
};

/** desktop pointer (vector), drawn at the capture's real mouse position */
const Pointer: React.FC<{ x: number; y: number; press: number; ring: number }> = ({ x, y, press, ring }) => (
  <>
    {ring > 0 && ring < 1 && <div style={{ position: "absolute", left: X(x) - X(6 + 22 * ring), top: X(y) - X(6 + 22 * ring), width: X(12 + 44 * ring), height: X(12 + 44 * ring), borderRadius: "50%", border: `${X(1.6)}px solid rgba(255,255,255,${0.6 * (1 - ring)})` }} />}
    <svg width={X(26)} height={X(30)} viewBox="0 0 26 30" style={{ position: "absolute", left: X(x) - X(2), top: X(y) - X(1), transformOrigin: "2px 1px", transform: `scale(${1 - 0.12 * press})`, filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.5))" }}>
      <path d="M2 1 L2 23 L7.5 17.5 L11.5 27 L15 25.5 L11 16.5 L19 16.5 Z" fill="#fff" stroke="#0a0a0b" strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  </>
);

// ------------------------------------------------------------------ the quotation (screen-space, css units × D)
const CHOICES = [
  { key: "gaming", at: TAP.gaming.release + 0.3 },
  { key: "res", at: TAP.res.release + 0.3 },
  { key: "fps", at: TAP.fps.release + 0.15 },
  { key: "colour", at: TAP.colour.release + 0.3 },
] as const;
const fAt = (t: number) => Math.round((t - V.home.captureStart) * 60);
const CARD = { x: 40, y: 92, w: 640 };
const SUM_Y0 = 560, SUM_Y1 = CARD.y + 74;
const PS = 0.92;
const sumLayout = (() => {
  const ws = CHOICES.map((c) => (JLOG[fAt(c.at)].meta[c.key] as Rect).w * PS);
  const gap = 10;
  const total = ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1);
  let x = 360 - total / 2;
  return ws.map((w) => { const c = x + w / 2; x += w + gap; return c; });
})();
export const QUOTE_LINES = [
  ["CPU", "AMD Ryzen 7 9800X3D"],
  ["GPU", "NVIDIA RTX 5080 16GB"],
  ["RAM", "32GB 6000MHz"],
  ["Storage", "2TB M.2 SSD"],
];

export const MonitorScreen: React.FC<{ t: number }> = ({ t }) => {
  const idx = jIndex(t);
  const e = JLOG[idx];
  // micro-interactions
  const G = TAP.gaming, R = TAP.res, F = TAP.fps, C = TAP.colour, S = TAP.send;
  const gRow = rowOf(idx, "Primary use", "Gaming");
  const gFocus = ease.inOutCubic(range(t, Q.gaming.focus[0], Q.gaming.focus[1])) * (1 - ease.inOutCubic(range(t, G.release + 0.3, G.release + 0.6)));
  const rRow = rowOf(idx, "Target resolution", "1440p");
  const rFan = ease.outCubic(range(t, Q.res.fan[0], Q.res.fan[1])) * (1 - glide(range(t, R.release, R.release + 0.3)));
  const rFwd = ease.outCubic(range(t, Q.res.fan[0], Q.res.fan[1])) * (1 - glide(range(t, R.release + 0.08, R.release + 0.45)));
  const fRow = rowOf(idx, "Target FPS", "144+ FPS");
  const count = range(t, Q.fps.count[0], Q.fps.count[1]);
  const glowW = range(t, C.release, C.release + 0.8);

  // consolidation → quotation
  const [c0, c1] = Q.consolidate;
  const dim = ease.inOutCubic(range(t, c0, c0 + 0.4));
  const rise = ease.inOutCubic(range(t, Q.card, Q.card + 0.34));
  const sumY = lerp(SUM_Y0, SUM_Y1, rise);
  const unfold = ease.settle(range(t, Q.card + 0.06, Q.card + 0.46));
  const capsule = ease.settle(range(t, c1 - 0.25, c1 + 0.1));
  const cardTop = sumY - (SUM_Y1 - CARD.y);
  const cardH = lerp(150, 720, unfold);
  const line = (i: number) => snap(range(t, Q.lines[i], Q.lines[i] + 0.22));
  const price = ease.settle(range(t, Q.price, Q.price + 0.3));
  const sweep = glide(range(t, Q.price + 0.14, Q.price + 0.44));

  // pointer
  const m = e.mouse;
  let press = 0, ring = 0;
  for (const tp of [TAP.cta, TAP.build, G, R, F, C, S]) {
    press = Math.max(press, ease.outCubic(range(t, tp.press, tp.press + 0.05)) * (1 - ease.outCubic(range(t, tp.release, tp.release + 0.08))));
    if (t >= tp.press && t < tp.press + 0.4) ring = range(t, tp.press, tp.press + 0.4);
  }
  const pointerOn = m.x > -10 && m.x < 730 && t >= V.home.cursorIn[0] && t < S.release + 0.25;

  return (
    <AbsoluteFill style={{ width: SW, height: SH }}>
      <Img src={frameSrc(idx)} style={{ position: "absolute", left: 0, top: 0, width: SW, height: SH }} />
      {/* the page steps back while the request takes form above it */}
      {dim > 0 && <div style={{ position: "absolute", inset: 0, background: `rgba(5,5,6,${0.62 * dim})` }} />}
      {dim > 0 && e.meta.send && <Crop index={idx} r={e.meta.send} radius={X(30)} opacity={range(t, Q.scroll3[1] - 0.1, Q.scroll3[1] + 0.15)} />}

      {/* GAMING: the others step aside, Gaming slides into focus */}
      {gRow && gFocus > 0.001 && (
        <Takeover index={idx} pills={gRow.row} fx={(p) => (p.label === "Gaming" ? { dx: 5 * gFocus, s: 1 + 0.1 * gFocus, o: 1 } : { dx: 20 * gFocus, s: 1 - 0.05 * gFocus, o: 1 - 0.55 * gFocus })} />
      )}
      {gRow && t >= G.release && t < G.release + 0.7 && (() => {
        const r = gRow.focus;
        const k = glide(range(t, G.release, G.release + 0.26));
        return <div style={{ position: "absolute", left: X(r.x + 10), top: X(r.y + r.h + 5), width: X((r.w - 20) * k), height: X(3), borderRadius: X(2), background: BRAND.yellow, opacity: 1 - range(t, G.release + 0.45, G.release + 0.7) }} />;
      })()}
      {/* 1440p: the row fans out, 1440p comes forward */}
      {rRow && (rFan > 0.001 || rFwd > 0.001) && (
        <Takeover
          index={idx}
          pills={rRow.row}
          fx={(p) => {
            if (p.label === "1440p") return { dx: 0, dy: -2 * rFwd, s: 1 + 0.13 * rFwd, o: 1 };
            const side = p.x < rRow.focus.x ? -1 : 1;
            const order = Math.abs(rRow.row.indexOf(p) - rRow.row.indexOf(rRow.focus));
            return { dx: side * (7 + 6 * order) * rFan, dy: 3 * order * rFan, rot: side * 5 * order * rFan, s: 1 - 0.07 * rFan, o: 1 - 0.45 * rFan };
          }}
        />
      )}
      {/* 144+ FPS: the pointer sweeps 60 → 120+ → 144+ and a counter follows it */}
      {fRow && count > 0 && t < F.release + 0.55 && (() => {
        const steps = ["60", "120", "144+"];
        const i = Math.min(2, Math.floor(count * 3));
        const f = fRow.focus;
        const out = range(t, F.release + 0.2, F.release + 0.5);
        return (
          <div style={{ position: "absolute", left: X(f.x + f.w / 2 - 78), top: X(f.y - 92), width: X(156), height: X(78), borderRadius: X(14), background: "rgba(10,10,11,0.95)", border: `${X(1)}px solid rgba(249,194,4,0.4)`, textAlign: "center", fontFamily: FONT.display, fontWeight: 700, fontSize: X(52), lineHeight: `${X(78)}px`, color: BRAND.yellow, opacity: 1 - out, transform: `scale(${snap(range(t, Q.fps.count[0], Q.fps.count[0] + 0.14))})` }}>
            {steps[i]}
          </div>
        );
      })()}
      {fRow && t >= F.release && t < F.release + 0.65 && (() => {
        const r = fRow.focus;
        const k = snap(range(t, F.release, F.release + 0.22));
        return (
          <svg width={X(30)} height={X(30)} viewBox="0 0 64 64" style={{ position: "absolute", left: X(r.x + r.w - 15), top: X(r.y - 15), transform: `scale(${k})`, opacity: 1 - range(t, F.release + 0.45, F.release + 0.62) }}>
            <circle cx={32} cy={32} r={28} fill={BRAND.yellow} />
            <path d="M19 33 l9 9 l17 -19" fill="none" stroke="#000" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={40} strokeDashoffset={40 * (1 - range(t, F.release + 0.05, F.release + 0.18))} />
          </svg>
        );
      })()}
      {/* White: the choice softly lights its surroundings */}
      {glowW > 0 && glowW < 1 && e.meta.colour && (() => {
        const r = e.meta.colour;
        const g = Math.sin(Math.PI * glowW);
        return <div style={{ position: "absolute", left: X(r.x - 2), top: X(r.y - 2), width: X(r.w + 4), height: X(r.h + 4), borderRadius: X(40), boxShadow: `0 0 ${X(20 + 30 * glowW)}px ${X(6 + 14 * glowW)}px rgba(255,255,255,${0.3 * g}), 0 0 0 ${X(1.5 + 5 * glowW)}px rgba(249,194,4,${0.5 * (1 - glowW)})` }} />;
      })()}

      {/* the quotation */}
      {t >= c1 - 0.25 && (
        <div style={{ position: "absolute", left: X(CARD.x), top: X(cardTop), width: X(CARD.w), height: X(cardH), borderRadius: X(18), background: "#151517", border: `${X(1)}px solid rgba(255,255,255,0.1)`, boxShadow: `0 ${X(20)}px ${X(50)}px rgba(0,0,0,0.6)`, opacity: capsule, overflow: "hidden", fontFamily: FONT.ui }}>
          <div style={{ position: "absolute", left: X(26), top: X(22), fontSize: X(12), letterSpacing: X(3), fontWeight: 600, color: BRAND.yellow }}>YOUR REQUIREMENTS</div>
          <div style={{ position: "absolute", inset: 0, opacity: unfold }}>
            <div style={{ position: "absolute", left: X(26), right: X(26), top: X(122), height: X(1), background: "rgba(255,255,255,0.1)" }} />
            <div style={{ position: "absolute", left: X(26), top: X(138), fontSize: X(12), letterSpacing: X(3), fontWeight: 600, color: BRAND.yellow, opacity: range(t, Q.card + 0.15, Q.card + 0.35) }}>YOUR QUOTATION</div>
            <div style={{ position: "absolute", left: X(26), top: X(158), fontFamily: FONT.display, fontWeight: 700, fontSize: X(30), color: BRAND.white, opacity: range(t, Q.card + 0.2, Q.card + 0.4) }}>Ryzen 7 9800X3D / RTX 5080</div>
            <div style={{ position: "absolute", left: X(26), top: X(200), fontSize: X(13), color: BRAND.muted, opacity: range(t, Q.card + 0.25, Q.card + 0.45) }}>Prepared by M1 from your requirements</div>
            {QUOTE_LINES.map(([k, v], i) => {
              const a = line(i);
              return (
                <div key={k} style={{ position: "absolute", left: X(26), right: X(26), top: X(236 + i * 50), height: X(50), overflow: "hidden" }}>
                  <div style={{ display: "flex", alignItems: "center", height: "100%", transform: `translateY(${(1 - a) * -X(50)}px)`, opacity: clamp01(a * 2) }}>
                    <span style={{ width: X(110), fontSize: X(16), color: BRAND.muted }}>{k}</span>
                    <span style={{ fontSize: X(19), fontWeight: 600, color: BRAND.white }}>{v}</span>
                  </div>
                  <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: X(1), background: "rgba(255,255,255,0.07)", opacity: a }} />
                </div>
              );
            })}
            <div style={{ position: "absolute", left: X(26), right: X(26), top: X(450), height: X(46), display: "flex", alignItems: "center", opacity: price, transform: `translateY(${(1 - price) * X(10)}px)` }}>
              <span style={{ width: X(110), fontSize: X(14), letterSpacing: X(3), fontWeight: 700, color: BRAND.yellow }}>PRICE</span>
              <span style={{ fontSize: X(19), fontWeight: 700, color: BRAND.white }}>Current price & availability</span>
            </div>
            <div style={{ position: "absolute", left: X(26 + 110), top: X(496), height: X(2.5), width: X(300) * sweep, background: BRAND.yellow }} />
            <div style={{ position: "absolute", left: X(26), right: X(26), top: X(530), fontSize: X(13), lineHeight: 1.45, color: BRAND.muted, opacity: range(t, Q.price + 0.3, Q.price + 0.6) }}>
              Send the request — M1 confirms current price and availability on WhatsApp.
            </div>
          </div>
        </div>
      )}
      {/* the real chosen pills: drawn together into the summary, then carried by the card */}
      {t >= c0 - 0.05 &&
        CHOICES.map((ch, i) => {
          const f = fAt(ch.at);
          const r = JLOG[f].meta[ch.key] as Rect;
          const dy = JLOG[Math.min(JLOG.length - 1, fAt(c0))].scrollY - JLOG[f].scrollY;
          const k = glide(range(t, c0 + 0.08 * i, c1 - 0.18 + 0.06 * i));
          const sx = r.x + r.w / 2, sy = r.y + r.h / 2 - dy;
          const tx = sumLayout[i], ty = sumY;
          const x = lerp(sx, tx, k) + Math.sin(Math.PI * k) * (i % 2 ? 26 : -26);
          const y = lerp(sy, ty, k);
          const s = lerp(1, PS, k) * (1 + 0.08 * Math.sin(Math.PI * k));
          const land = snap(range(t, c1 - 0.22 + 0.06 * i, c1 - 0.04 + 0.06 * i));
          return <Crop key={ch.key} index={f} r={r} transform={`translate(${X(x - (r.x + r.w / 2))}px, ${X(y - (r.y + r.h / 2))}px) scale(${s * (1 + 0.05 * Math.sin(Math.PI * land))})`} />;
        })}

      {pointerOn && <Pointer x={m.x} y={m.y} press={press} ring={ring} />}
    </AbsoluteFill>
  );
};

/** the real floating WhatsApp button's centre (css px) — where the icon leaves the screen */
export const FAB_CSS = (() => {
  const f = JLOG[JLOG.length - 1].meta.fab ?? JLOG[0].meta.fab!;
  return { x: f.x + f.w / 2, y: f.y + f.h / 2, d: f.w };
})();
export { jTime };
