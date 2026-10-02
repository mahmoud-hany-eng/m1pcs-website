import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { clamp01, ease, lerp, range } from "../lib/ease";
import { BRAND, glide, snap } from "../final/shared";
import { FONT } from "../final/fonts";
import { D, JLOG, Pill, Rect, SH, SW, TAP, V, jIndex } from "./time";

/**
 * Everything on the monitor's glass, in the capture's native pixels
 * (1620×2880 = the 720×1280 page at 2.25×) so the homography maps it 1:1:
 * the real page, the real pointer (drawn where the capture's mouse was),
 * small acknowledgements of each choice, the choices consolidating into the
 * quotation, and the quotation condensing into an attachment on the real
 * "Send Request via WhatsApp" button.
 *
 * layer="base": the page + pointer + acknowledgements (+ the dim).
 * layer="card": only the quotation card and the travelling pills — drawn by
 * the composition on its own quad so it can rise off the screen plane.
 */

const Q = V.quote;
const PAGE_BG = "#0a0a0b";
const frameSrc = (i: number) => staticFile(`cap/journey8/f${String(i).padStart(5, "0")}.png`);
const X = (v: number) => v * D; // css px → capture px

const Crop: React.FC<{ index: number; r: Rect; transform?: string; opacity?: number; filter?: string; radius?: number }> = ({ index, r, transform, opacity = 1, filter, radius }) => (
  <div style={{ position: "absolute", left: X(r.x), top: X(r.y), width: X(r.w), height: X(r.h), overflow: "hidden", borderRadius: radius ?? X(r.h) / 2, transform, opacity, filter, transformOrigin: "50% 50%" }}>
    <Img src={frameSrc(index)} style={{ position: "absolute", left: -X(r.x), top: -X(r.y), width: SW, height: SH }} />
  </div>
);

/** desktop pointer (vector), drawn at the capture's real mouse position */
const Pointer: React.FC<{ x: number; y: number; press: number; ring: number }> = ({ x, y, press, ring }) => (
  <>
    {ring > 0 && ring < 1 && <div style={{ position: "absolute", left: X(x) - X(6 + 22 * ring), top: X(y) - X(6 + 22 * ring), width: X(12 + 44 * ring), height: X(12 + 44 * ring), borderRadius: "50%", border: `${X(1.6)}px solid rgba(255,255,255,${0.6 * (1 - ring)})` }} />}
    <svg width={X(26)} height={X(30)} viewBox="0 0 26 30" style={{ position: "absolute", left: X(x) - X(2), top: X(y) - X(1), transformOrigin: "2px 1px", transform: `scale(${1 - 0.12 * press})`, filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.5))" }}>
      <path d="M2 1 L2 23 L7.5 17.5 L11.5 27 L15 25.5 L11 16.5 L19 16.5 Z" fill="#fff" stroke="#0a0a0b" strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  </>
);

// ------------------------------------------------------------------ the chosen pills (real crops) and the quotation
export const CHOICES = [
  { key: "gaming", tap: TAP.gaming },
  { key: "res", tap: TAP.res },
  { key: "fps", tap: TAP.fps },
  { key: "colour", tap: TAP.colour },
] as const;
const fAt = (t: number) => Math.min(JLOG.length - 1, Math.max(0, Math.round((t - V.home.captureStart) * 60)));
export const pillRect = (key: string, t: number) => JLOG[fAt(t)].meta[key as "gaming"] as Rect;
const CARD = { x: 40, y: 92, w: 640 };
const SUM_Y0 = 560, SUM_Y1 = CARD.y + 74;
const PS = 0.92;
const sumLayout = (() => {
  const ws = CHOICES.map((c) => pillRect(c.key, c.tap.release + 0.3).w * PS);
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
export const GAMES = Q.games.text;
export const BUDGET = "QAR " + Number(Q.budget.text).toLocaleString("en-US");
const SEND = JLOG[fAt(Q.captureEnd - 0.05)].meta.send ?? { x: 24, y: 947, w: 672, h: 60 };
/** the compact attachment, docked on the Send button (css px) */
export const CHIP = { x: SEND.x + 14, y: SEND.y - 70, w: 300, h: 58 };

/** quotation card geometry over time (css px) */
export function cardBox(t: number) {
  const rise = ease.inOutCubic(range(t, Q.card, Q.card + 0.34));
  const sumY = lerp(SUM_Y0, SUM_Y1, rise);
  const unfold = ease.settle(range(t, Q.card + 0.06, Q.card + 0.46));
  const top = sumY - (SUM_Y1 - CARD.y);
  const h = lerp(150, 760, unfold);
  const a = range(t, Q.attach[0], Q.attach[1]);
  return { x: CARD.x, y: top, w: CARD.w, h, sumY, unfold, attach: a, rise };
}

export const MonitorScreen8: React.FC<{ t: number; layer?: "base" | "card" }> = ({ t, layer = "base" }) => {
  const idx = jIndex(t);
  const e = JLOG[idx];
  const G = TAP.gaming, R = TAP.res, F = TAP.fps, B = TAP.budget, C = TAP.colour, S = TAP.send;
  const [c0, c1] = Q.consolidate;

  if (layer === "card") {
    if (t < c0 - 0.05 || t > V.toPhone.lift[1] + 0.05) return null;
    const cb = cardBox(t);
    const capsule = ease.settle(range(t, c1 - 0.25, c1 + 0.1));
    const line = (i: number) => snap(range(t, Q.lines[i], Q.lines[i] + 0.22));
    const price = ease.settle(range(t, Q.price, Q.price + 0.3));
    const sweep = glide(range(t, Q.price + 0.14, Q.price + 0.44));
    const chip = range(cb.attach, 0.56, 0.78);
    const dock = ease.inCubic(range(t, V.toPhone.lift[0], V.toPhone.lift[1])); // swallowed by the WhatsApp disc
    return (
      <AbsoluteFill style={{ width: SW, height: SH }}>
        {t >= c1 - 0.25 && (() => {
          const pa = ease.inOutCubic(range(cb.attach, 0, 0.62));
          const pb = ease.inOutCubic(range(cb.attach, 0.5, 1));
          const ccx = cb.x + cb.w / 2, ccy = cb.y + cb.h / 2;
          const kx = CHIP.x + CHIP.w / 2, ky = CHIP.y + CHIP.h / 2;
          const sA = lerp(1, 0.34, pa);
          const cardO = capsule * (1 - range(cb.attach, 0.52, 0.72));
          const bw = lerp(cb.w * 0.34, CHIP.w, pb), bh = lerp(cb.h * 0.34, CHIP.h, pb);
          return (
            <>
              {cardO > 0.001 && (
                <div style={{ position: "absolute", left: X(cb.x), top: X(cb.y), width: X(cb.w), height: X(cb.h), borderRadius: X(18), background: "#151517", border: `${X(1)}px solid rgba(255,255,255,0.1)`, boxShadow: `0 ${X(20)}px ${X(50)}px rgba(0,0,0,0.6)`, opacity: cardO, overflow: "hidden", fontFamily: FONT.ui, transformOrigin: "50% 50%", transform: `translate(${X(lerp(0, kx - ccx, pa))}px, ${X(lerp(0, ky - ccy, pa))}px) scale(${sA})` }}>
                  <div style={{ position: "absolute", left: X(26), top: X(22), fontSize: X(12), letterSpacing: X(3), fontWeight: 600, color: BRAND.yellow }}>YOUR REQUIREMENTS</div>
                  <div style={{ position: "absolute", inset: 0, opacity: cb.unfold }}>
                    <div style={{ position: "absolute", left: X(26), right: X(26), top: X(116), fontSize: X(14), color: BRAND.muted, opacity: range(t, Q.card + 0.1, Q.card + 0.3), whiteSpace: "nowrap" }}>
                      Games <span style={{ color: BRAND.white, fontWeight: 600 }}>{GAMES}</span>
                      <span style={{ display: "inline-block", width: X(28) }} />
                      Budget <span style={{ color: BRAND.white, fontWeight: 600 }}>{BUDGET}</span>
                    </div>
                    <div style={{ position: "absolute", left: X(26), right: X(26), top: X(150), height: X(1), background: "rgba(255,255,255,0.1)" }} />
                    <div style={{ position: "absolute", left: X(26), top: X(166), fontSize: X(12), letterSpacing: X(3), fontWeight: 600, color: BRAND.yellow, opacity: range(t, Q.card + 0.15, Q.card + 0.35) }}>YOUR QUOTATION</div>
                    <div style={{ position: "absolute", left: X(26), top: X(186), fontFamily: FONT.display, fontWeight: 700, fontSize: X(30), color: BRAND.white, opacity: range(t, Q.card + 0.2, Q.card + 0.4) }}>Ryzen 7 9800X3D / RTX 5080</div>
                    <div style={{ position: "absolute", left: X(26), top: X(228), fontSize: X(13), color: BRAND.muted, opacity: range(t, Q.card + 0.25, Q.card + 0.45) }}>Prepared by M1 from your requirements</div>
                    {QUOTE_LINES.map(([k, v], i) => {
                      const a2 = line(i);
                      return (
                        <div key={k} style={{ position: "absolute", left: X(26), right: X(26), top: X(264 + i * 50), height: X(50), overflow: "hidden" }}>
                          <div style={{ display: "flex", alignItems: "center", height: "100%", transform: `translateY(${(1 - a2) * -X(50)}px)`, opacity: clamp01(a2 * 2) }}>
                            <span style={{ width: X(110), fontSize: X(16), color: BRAND.muted }}>{k}</span>
                            <span style={{ fontSize: X(19), fontWeight: 600, color: BRAND.white }}>{v}</span>
                          </div>
                          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: X(1), background: "rgba(255,255,255,0.07)", opacity: a2 }} />
                        </div>
                      );
                    })}
                    <div style={{ position: "absolute", left: X(26), right: X(26), top: X(478), height: X(46), display: "flex", alignItems: "center", opacity: price, transform: `translateY(${(1 - price) * X(10)}px)` }}>
                      <span style={{ width: X(110), fontSize: X(14), letterSpacing: X(3), fontWeight: 700, color: BRAND.yellow }}>PRICE</span>
                      <span style={{ fontSize: X(19), fontWeight: 700, color: BRAND.white }}>Current price & availability</span>
                    </div>
                    <div style={{ position: "absolute", left: X(26 + 110), top: X(524), height: X(2.5), width: X(300) * sweep, background: BRAND.yellow }} />
                    <div style={{ position: "absolute", left: X(26), right: X(26), top: X(558), fontSize: X(13), lineHeight: 1.45, color: BRAND.muted, opacity: range(t, Q.price + 0.3, Q.price + 0.6) }}>
                      Send the request — M1 confirms current price and availability on WhatsApp.
                    </div>
                  </div>
                </div>
              )}
              {/* the compact attachment */}
              {cb.attach > 0.5 && (
                <div style={{ position: "absolute", left: X(kx - bw / 2), top: X(ky - bh / 2), width: X(bw), height: X(bh), borderRadius: X(14), background: "#1b1b1e", border: `${X(1)}px solid rgba(255,255,255,0.22)`, boxShadow: `0 ${X(10)}px ${X(24)}px rgba(0,0,0,0.55)`, overflow: "hidden", fontFamily: FONT.ui, opacity: (1 - dock) * range(cb.attach, 0.5, 0.62), transform: `scale(${1 - 0.6 * dock})`, transformOrigin: "50% 100%" }}>
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", gap: X(12), padding: `0 ${X(14)}px`, opacity: chip, whiteSpace: "nowrap" }}>
                    <svg width={X(26)} height={X(32)} viewBox="0 0 20 24"><path d="M2 1h11l5 5v17H2z" fill="#e2483d" /><text x={10} y={18} textAnchor="middle" fontSize={5.2} fontWeight={700} fill="#fff" fontFamily="sans-serif">PDF</text></svg>
                    <div style={{ lineHeight: 1.15 }}>
                      <div style={{ fontSize: X(15), fontWeight: 600, color: BRAND.white }}>M1 Quotation.pdf</div>
                      <div style={{ fontSize: X(12), color: BRAND.muted }}>Ryzen 7 9800X3D / RTX 5080</div>
                    </div>
                  </div>
                </div>
              )}
            </>
          );
        })()}
        {/* the real chosen pills: drawn together into the summary, then carried by the card */}
        {t < Q.attach[0] + 0.3 &&
          CHOICES.map((ch, i) => {
            const at = ch.tap.release + 0.3;
            const f = fAt(at);
            const r = pillRect(ch.key, at);
            const dy = JLOG[fAt(c0)].scrollY - JLOG[f].scrollY;
            const k = glide(range(t, c0 + 0.08 * i, c1 - 0.18 + 0.06 * i));
            const sx = r.x + r.w / 2, sy = r.y + r.h / 2 - dy;
            const tx = sumLayout[i], ty = cb.sumY;
            const x = lerp(sx, tx, k) + Math.sin(Math.PI * k) * (i % 2 ? 26 : -26);
            const y = lerp(sy, ty, k);
            const s = lerp(1, PS, k) * (1 + 0.08 * Math.sin(Math.PI * k));
            const land = snap(range(t, c1 - 0.22 + 0.06 * i, c1 - 0.04 + 0.06 * i));
            return <Crop key={ch.key} index={f} r={r} opacity={1 - range(t, Q.attach[0], Q.attach[0] + 0.2)} transform={`translate(${X(x - (r.x + r.w / 2))}px, ${X(y - (r.y + r.h / 2))}px) scale(${s * (1 + 0.05 * Math.sin(Math.PI * land))})`} />;
          })}
      </AbsoluteFill>
    );
  }

  // ---------------------------------------------------------------- base layer
  const dim = ease.inOutCubic(range(t, c0, c0 + 0.4));
  const m = e.mouse;
  let press = 0, ring = 0;
  for (const tp of [TAP.cta, TAP.build, G, TAP.games, R, F, B, C, S]) {
    press = Math.max(press, ease.outCubic(range(t, tp.press, tp.press + 0.05)) * (1 - ease.outCubic(range(t, tp.release, tp.release + 0.08))));
    if (t >= tp.press && t < tp.press + 0.4) ring = range(t, tp.press, tp.press + 0.4);
  }
  const pointerOn = m.x > -10 && m.x < 730 && t >= V.home.cursorIn[0] && t < S.release + 0.25;
  const glowW = range(t, C.release, C.release + 0.8);
  const budgetGlow = range(t, Q.budget.type[1], Q.budget.type[1] + 0.7);
  const sendHot = range(t, Q.attach[1] - 0.2, Q.attach[1]) * (1 - range(t, V.toPhone.lift[1], V.toPhone.lift[1] + 0.3));

  return (
    <AbsoluteFill style={{ width: SW, height: SH }}>
      <Img src={frameSrc(idx)} style={{ position: "absolute", left: 0, top: 0, width: SW, height: SH }} />
      {dim > 0 && <div style={{ position: "absolute", inset: 0, background: `rgba(5,5,6,${0.62 * dim})` }} />}
      {dim > 0 && e.meta.send && <Crop index={idx} r={e.meta.send} radius={X(30)} opacity={range(t, Q.scroll3[1] - 0.1, Q.scroll3[1] + 0.15)} />}
      {sendHot > 0 && e.meta.send && (() => {
        const r = e.meta.send;
        return <div style={{ position: "absolute", left: X(r.x - 3), top: X(r.y - 3), width: X(r.w + 6), height: X(r.h + 6), borderRadius: X(33), boxShadow: `0 0 ${X(26)}px ${X(6)}px rgba(37,211,102,${0.45 * sendHot})` }} />;
      })()}

      {/* Gaming: a yellow underline zips under the choice */}
      {t >= G.release && t < G.release + 0.75 && e.meta.gaming && (() => {
        const r = e.meta.gaming;
        const k = glide(range(t, G.release, G.release + 0.26));
        return <div style={{ position: "absolute", left: X(r.x + 10), top: X(r.y + r.h + 5), width: X((r.w - 20) * k), height: X(3), borderRadius: X(2), background: BRAND.yellow, opacity: 1 - range(t, G.release + 0.5, G.release + 0.75) }} />;
      })()}
      {/* 144+ FPS: a small yellow tick */}
      {t >= F.release && t < F.release + 0.7 && e.meta.fps && (() => {
        const r = e.meta.fps;
        const k = snap(range(t, F.release, F.release + 0.22));
        return (
          <svg width={X(30)} height={X(30)} viewBox="0 0 64 64" style={{ position: "absolute", left: X(r.x + r.w - 15), top: X(r.y - 15), transform: `scale(${k})`, opacity: 1 - range(t, F.release + 0.5, F.release + 0.7) }}>
            <circle cx={32} cy={32} r={28} fill={BRAND.yellow} />
            <path d="M19 33 l9 9 l17 -19" fill="none" stroke="#000" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={40} strokeDashoffset={40 * (1 - range(t, F.release + 0.05, F.release + 0.18))} />
          </svg>
        );
      })()}
      {/* budget: the typed figure settles with a soft yellow pulse */}
      {budgetGlow > 0 && budgetGlow < 1 && e.meta.budget && (() => {
        const r = e.meta.budget;
        return <div style={{ position: "absolute", left: X(r.x - 2), top: X(r.y - 2), width: X(r.w + 4), height: X(r.h + 4), borderRadius: X(12), boxShadow: `0 0 ${X(18 + 24 * budgetGlow)}px ${X(4 + 8 * budgetGlow)}px rgba(249,194,4,${0.35 * Math.sin(Math.PI * budgetGlow)})` }} />;
      })()}
      {/* White: the choice softly lights its surroundings */}
      {glowW > 0 && glowW < 1 && e.meta.colour && (() => {
        const r = e.meta.colour;
        const g = Math.sin(Math.PI * glowW);
        return <div style={{ position: "absolute", left: X(r.x - 2), top: X(r.y - 2), width: X(r.w + 4), height: X(r.h + 4), borderRadius: X(40), boxShadow: `0 0 ${X(20 + 30 * glowW)}px ${X(6 + 14 * glowW)}px rgba(255,255,255,${0.3 * g}), 0 0 0 ${X(1.5 + 5 * glowW)}px rgba(249,194,4,${0.5 * (1 - glowW)})` }} />;
      })()}
      {pointerOn && <Pointer x={m.x} y={m.y} press={press} ring={ring} />}
    </AbsoluteFill>
  );
};

/** the choice pills that lift off the glass when chosen: [key, tap] */
export const LIFTS: { key: "gaming" | "res" | "fps" | "colour"; tap: typeof TAP.gaming }[] = [
  { key: "gaming", tap: TAP.gaming },
  { key: "res", tap: TAP.res },
  { key: "fps", tap: TAP.fps },
  { key: "colour", tap: TAP.colour },
];
export { frameSrc, X as cssToCap };
export type { Pill };
