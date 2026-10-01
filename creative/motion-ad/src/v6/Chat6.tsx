import React from "react";
import { AbsoluteFill } from "remotion";
import { clamp01, ease, lerp, range } from "../lib/ease";
import { K, toScreen } from "../lib/SiteFrame";
import { BRAND, camAt, glide, snap } from "../final/shared";
import { FONT } from "../final/fonts";
import { Cut, quoteCam } from "./Journey6";
import { JLOG, TAP, V, jTime } from "./time";

/**
 * v6 shots 4–5.
 *  4. The four real choices (crops of the selected pills) are drawn together
 *     into one compact object — the build summary. It rises, and the
 *     quotation constructs itself beneath it, line by line, price last, with
 *     the real "Send Request via WhatsApp" button waiting below.
 *  5. The real Send press: the quotation shrinks into a document attachment
 *     in a WhatsApp conversation (fictional demo copy), and the story is told
 *     one readable beat at a time — proceed, typing, checking PRICE / STOCK /
 *     SHIPPING, confirmed, deposit, payment, ORDER CONFIRMED.
 */

const Q = V.quote;
const CH = V.chat;
const SE = TAP.send;
export const WA = { bg: "#0b141a", header: "#1f2c34", inBubble: "#202c33", outBubble: "#005c4b", text: "#e9edef", meta: "#8696a0", tick: "#53bdeb", green: "#25D366" };
const WA_GLYPH =
  "M16.004 3C9.377 3 4 8.373 4 15c0 2.34.66 4.523 1.807 6.383L4 29l7.81-1.767A11.94 11.94 0 0 0 16.004 27C22.63 27 28 21.627 28 15S22.63 3 16.004 3Zm0 21.75c-1.98 0-3.85-.55-5.44-1.51l-.39-.23-4.63 1.05 1.08-4.5-.25-.42A9.71 9.71 0 0 1 5.25 15c0-5.93 4.82-10.75 10.754-10.75S26.75 9.07 26.75 15 21.938 24.75 16.004 24.75Zm5.87-7.98c-.32-.16-1.9-.94-2.2-1.05-.29-.11-.51-.16-.72.16-.21.32-.83 1.05-1.02 1.26-.19.21-.37.24-.69.08-.32-.16-1.35-.5-2.57-1.58-.95-.85-1.59-1.9-1.78-2.22-.19-.32-.02-.49.14-.65.14-.14.32-.37.48-.55.16-.19.21-.32.32-.53.11-.21.05-.4-.03-.56-.08-.16-.72-1.74-.99-2.38-.26-.63-.53-.54-.72-.55-.19-.01-.4-.01-.61-.01-.21 0-.56.08-.85.4-.29.32-1.12 1.09-1.12 2.67s1.15 3.1 1.31 3.31c.16.21 2.26 3.45 5.48 4.84.77.33 1.37.53 1.84.68.77.24 1.47.21 2.02.13.62-.09 1.9-.78 2.17-1.53.27-.75.27-1.39.19-1.53-.08-.13-.29-.21-.61-.37Z";

// ------------------------------------------------------------------ the choices
const CHOICES = [
  { key: "gaming", label: "Primary use", at: TAP.gaming.release + 0.25 },
  { key: "res", label: "Resolution", at: TAP.res.release + 0.35 },
  { key: "fps", label: "Target FPS", at: TAP.fps.release + 0.2 },
  { key: "colour", label: "Colour", at: TAP.colour.release + 0.3 },
] as const;
const frameAt = (t: number) => Math.round((t - V.home.captureStart) * 60);
const PILL_S = 0.84;
// the compact summary: the four pills in one row inside a dark capsule
const SUM = (() => {
  const ws = CHOICES.map((c) => (JLOG[frameAt(c.at)].meta[c.key] as { w: number }).w * K * PILL_S);
  const gap = 14;
  const total = ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1);
  let x = 540 - total / 2;
  const xs = ws.map((w) => {
    const c = x + w / 2;
    x += w + gap;
    return c;
  });
  return { ws, xs, total };
})();
const SUM_Y0 = 820; // where the choices meet
const CARD = { x: 90, y: 300, w: 900, h: 760 };
const SUM_Y1 = CARD.y + 128; // the summary's place at the top of the quotation

const LINES = [
  ["CPU", "AMD Ryzen 7 9800X3D"],
  ["GPU", "NVIDIA RTX 5080 16GB"],
  ["RAM", "32GB 6000MHz"],
  ["Storage", "2TB M.2 SSD"],
];

/** The quotation card's contents at card-local coordinates. */
const QuoteBody: React.FC<{ t: number; reveal: number }> = ({ t, reveal }) => {
  const line = (i: number) => snap(range(t, Q.lines[i], Q.lines[i] + 0.2));
  const price = ease.settle(range(t, Q.price, Q.price + 0.3));
  const sweep = glide(range(t, Q.price + 0.12, Q.price + 0.4));
  return (
    <div style={{ position: "absolute", inset: 0, fontFamily: FONT.ui }}>
      <div style={{ position: "absolute", left: 46, top: 34, fontSize: 25, letterSpacing: 6, fontWeight: 600, color: BRAND.yellow }}>YOUR REQUIREMENTS</div>
      <div style={{ position: "absolute", inset: 0, opacity: reveal }}>
      <div style={{ position: "absolute", left: 46, right: 46, top: 196, height: 1.5, background: "rgba(255,255,255,0.1)" }} />
      <div style={{ position: "absolute", left: 46, top: 224, fontSize: 25, letterSpacing: 6, fontWeight: 600, color: BRAND.yellow, opacity: range(t, Q.card + 0.15, Q.card + 0.35) }}>YOUR QUOTATION</div>
      <div style={{ position: "absolute", left: 46, top: 262, fontFamily: FONT.display, fontWeight: 700, fontSize: 52, color: BRAND.white, letterSpacing: -1, opacity: range(t, Q.card + 0.2, Q.card + 0.4) }}>Ryzen 7 9800X3D / RTX 5080</div>
      <div style={{ position: "absolute", left: 46, top: 332, fontSize: 27, color: BRAND.muted, opacity: range(t, Q.card + 0.25, Q.card + 0.45) }}>Prepared by M1 from your requirements</div>
      {LINES.map(([k, v], i) => {
        const a = line(i);
        return (
          // each line slides out of the one above, like a drawer, with a small overshoot
          <div key={k} style={{ position: "absolute", left: 46, right: 46, top: 392 + i * 70, height: 70, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", height: "100%", transform: `translateY(${(1 - a) * -70}px)`, opacity: clamp01(a * 2) }}>
              <span style={{ width: 170, fontSize: 32, color: BRAND.muted }}>{k}</span>
              <span style={{ fontSize: 36, fontWeight: 600, color: BRAND.white }}>{v}</span>
            </div>
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1.5, background: "rgba(255,255,255,0.07)", opacity: a }} />
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 46, right: 46, top: 690, height: 60, display: "flex", alignItems: "center", opacity: price, transform: `translateY(${(1 - price) * 18}px)` }}>
        <span style={{ width: 170, fontSize: 30, letterSpacing: 5, fontWeight: 700, color: BRAND.yellow }}>PRICE</span>
        <span style={{ fontSize: 36, fontWeight: 700, color: BRAND.white }}>Current price & availability</span>
      </div>
      <div style={{ position: "absolute", left: 46 + 170, top: 752, height: 4, borderRadius: 2, width: 560 * sweep, background: BRAND.yellow }} />
      </div>
    </div>
  );
};

// ------------------------------------------------------------------ the conversation
type Msg = { id: string; side: "in" | "out"; a: number; h: (t: number) => number; w: (t: number) => number };
const c = (n: number) => () => n;
const ATT = { w: 720, preview: 440, bar: 112 };
const MSGS: Msg[] = [
  { id: "attach", side: "in", a: SE.release, h: c(12 + ATT.preview + ATT.bar), w: c(ATT.w) },
  { id: "proceed", side: "out", a: CH.proceed, h: c(140), w: c(700) },
  // typing dots grow into the reply
  { id: "reply", side: "in", a: CH.typing, h: (t) => lerp(104, 150, ease.inOutCubic(range(t, CH.reply - 0.04, CH.reply + 0.16))), w: (t) => lerp(196, 800, ease.inOutCubic(range(t, CH.reply - 0.04, CH.reply + 0.16))) },
  // the status tokens collapse into the confirmation
  { id: "status", side: "in", a: CH.tokens[0], h: (t) => lerp(96, 128, range(t, CH.collapse[0], CH.collapse[1])), w: (t) => lerp(800, 740, range(t, CH.collapse[0], CH.collapse[1])) },
  { id: "order", side: "in", a: CH.order, h: c(300), w: c(700) },
  { id: "paid", side: "out", a: CH.paid, h: c(214), w: c(560) },
  { id: "done", side: "in", a: CH.done, h: c(140), w: c(600) },
];
const GAP = 26;
const TOP = 440;
const BOTTOM = 1490;
const enter = (t: number, m: Msg) => (m.id === "attach" ? 1 : glide(range(t, m.a, m.a + 0.26)));
function layout(t: number) {
  let y = TOP;
  const pos: Record<string, { top: number; k: number; h: number; w: number }> = {};
  for (const m of MSGS) {
    if (t < m.a) break;
    const k = enter(t, m);
    const h = m.h(t);
    pos[m.id] = { top: y, k, h, w: m.w(t) };
    y += (h + GAP) * k;
  }
  const over = Math.max(0, y - GAP - BOTTOM);
  // the conversation scrolls with a soft follow, never a jump
  for (const id in pos) pos[id].top -= over;
  return pos;
}
const X_IN = 92;
const X_OUT_R = 958;
/** screen position + size of the "Order confirmed" check (the next shot starts from it) */
export const DONE_CHECK = (t: number) => {
  const p = layout(t).done;
  const top = p ? p.top : BOTTOM - 140;
  return { x: X_IN + 600 - 92, y: top + 70, size: 64 };
};
export const CHAT_PUSH = CH.push;

const Ticks: React.FC<{ blue: number }> = ({ blue }) => (
  <svg width={44} height={26} viewBox="0 0 22 13" style={{ display: "block" }}>
    <path d="M1 7 l4 4 l8 -9 M8 9.5 l1.5 1.5 l8 -9" fill="none" stroke={blue > 0.5 ? WA.tick : WA.meta} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const Check: React.FC<{ size: number; k?: number; ring?: number }> = ({ size, k = 1, ring = 0 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" style={{ display: "block", overflow: "visible" }}>
    {ring > 0 && ring < 1 && <circle cx={24} cy={24} r={22 + 22 * ease.outCubic(ring)} fill="none" stroke={WA.green} strokeWidth={3 * (1 - ring)} opacity={1 - ring} />}
    <circle cx={24} cy={24} r={22 * Math.min(1, k * 1.4)} fill={WA.green} />
    <path d="M14 25 l7 7 l13 -15" fill="none" stroke="#08130c" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={34} strokeDashoffset={34 * (1 - clamp01((k - 0.3) / 0.7))} />
  </svg>
);

const Bubble: React.FC<{ m: Msg; top: number; k: number; w: number; h: number; scale?: number; children: React.ReactNode }> = ({ m, top, k, w, h, scale = 1, children }) => {
  const left = m.side === "in" ? X_IN : X_OUT_R - w;
  const ox = m.side === "in" ? 0 : w;
  const bg = m.side === "in" ? WA.inBubble : WA.outBubble;
  return (
    <div style={{ position: "absolute", left, top, width: w, height: h, transformOrigin: `${ox}px 0px`, transform: `translateY(${(1 - k) * 46}px) scale(${(0.94 + 0.06 * k) * scale})`, opacity: clamp01(k * 1.6) }}>
      <svg width={18} height={22} style={{ position: "absolute", top: 0, [m.side === "in" ? "left" : "right"]: -14 } as React.CSSProperties}>
        <path d={m.side === "in" ? "M18 0 H0 L18 20 Z" : "M0 0 H18 L0 20 Z"} fill={bg} />
      </svg>
      <div style={{ position: "absolute", inset: 0, borderRadius: 24, [m.side === "in" ? "borderTopLeftRadius" : "borderTopRightRadius"]: 4, background: bg, boxShadow: "0 2px 3px rgba(0,0,0,0.35)", padding: "22px 30px", boxSizing: "border-box", fontFamily: FONT.ui, color: WA.text, fontSize: 40, lineHeight: 1.3, overflow: "hidden" } as React.CSSProperties}>
        {children}
      </div>
    </div>
  );
};

export const Chat6: React.FC<{ t: number }> = ({ t }) => {
  if (t < Q.consolidate[0] - 0.05 || t > CHAT_PUSH + 0.6) return null;

  // ---------------------------------------------------------- consolidation → summary → quotation
  const toSum = (i: number) => glide(range(t, Q.consolidate[0] + 0.08 * i, Q.consolidate[1] - 0.18 + 0.06 * i));
  const capsule = ease.settle(range(t, Q.consolidate[1] - 0.25, Q.consolidate[1] + 0.1));
  const rise = ease.inOutCubic(range(t, Q.card, Q.card + 0.32));
  const sumY = lerp(SUM_Y0, SUM_Y1, rise);
  const unfold = ease.settle(range(t, Q.card + 0.05, Q.card + 0.42));
  // the send hand-off: the quotation becomes an attachment
  const att = ease.inOutCubic(range(t, SE.release, CH.attach[1]));
  const pos = layout(t);
  const attTop = pos.attach ? pos.attach.top : TOP;
  const attScale = (ATT.w - 20) / CARD.w;
  const cardX = lerp(CARD.x, X_IN + 10, att);
  const cardY = lerp(sumY - (SUM_Y1 - CARD.y), attTop + 10, att);
  const cardS = lerp(1, attScale, att);
  const cardH = lerp(lerp(214, CARD.h, unfold), ATT.preview / attScale, att);

  // ---------------------------------------------------------- WhatsApp chrome
  const chatBg = ease.inOutCubic(range(t, SE.release + 0.05, SE.release + 0.42));
  const fabScreen = toScreen(384, 720, quoteCam(SE.release));
  const fly = ease.inOutCubic(range(t, SE.release + 0.04, SE.release + 0.44));
  const lift = ease.outCubic(range(t, SE.release - 0.02, SE.release + 0.1));
  const headX = 132, headY = 334;
  const iconX = lerp(fabScreen.x, headX, fly) - 40 * Math.sin(Math.PI * fly);
  const iconY = lerp(fabScreen.y, headY, fly) - 160 * Math.sin(Math.PI * fly);
  const iconD = lerp(56 * K, 84, fly) * (1 + 0.14 * lift * (1 - fly));
  const headText = ease.settle(range(t, SE.release + 0.3, SE.release + 0.56));
  const chatVisible = t >= SE.release;

  // ---------------------------------------------------------- the push into the confirmation check (the next shot carries on)
  const push = ease.inCubic(range(t, CHAT_PUSH, CHAT_PUSH + 0.5));
  const dc = DONE_CHECK(CHAT_PUSH);
  const latest = [...MSGS].reverse().find((mm) => t >= mm.a);
  const nudge = latest && latest.id !== "attach" ? 1 - glide(range(t, latest.a, latest.a + 0.55)) : 0;
  const camShift = latest ? (latest.side === "in" ? 12 : -12) * nudge : 0;

  const doneLocal = t - CH.done;
  const payoff = range(t, CH.payoff[0], CH.payoff[1]);
  const doneScale = 1 + 0.035 * Math.sin(Math.PI * range(t, CH.payoff[0] + 0.1, CH.payoff[0] + 0.32));

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {chatVisible && (
        <AbsoluteFill style={{ backgroundColor: WA.bg, opacity: chatBg * (1 - range(push, 0.3, 0.9)) }}>
          <AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.035) 1.5px, transparent 1.6px)", backgroundSize: "34px 34px" }} />
        </AbsoluteFill>
      )}

      <AbsoluteFill
        style={{
          transformOrigin: `${dc.x}px ${dc.y}px`,
          transform: `translateX(${camShift * (1 - push)}px) scale(${(1 + 0.01 * nudge) * (1 + 5 * push)})`,
          opacity: 1 - range(push, 0.35, 0.8),
        }}
      >
        {/* ------------------------------------------------ conversation */}
        {chatVisible && (
          <AbsoluteFill style={{ clipPath: "inset(410px 0 0 0)" }}>
            {/* the attachment bubble frame (the quotation itself is drawn below and lands in it) */}
            {pos.attach && (
              <Bubble m={MSGS[0]} top={pos.attach.top} k={1} w={ATT.w} h={pos.attach.h}>
                <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: ATT.bar, display: "flex", alignItems: "center", gap: 20, padding: "0 26px", background: "rgba(0,0,0,0.18)", opacity: range(att, 0.6, 1) }}>
                  <svg width={46} height={56} viewBox="0 0 20 24">
                    <path d="M2 1h11l5 5v17H2z" fill="#e2483d" />
                    <text x={10} y={18} textAnchor="middle" fontSize={5.2} fontWeight={700} fill="#fff" fontFamily="sans-serif">PDF</text>
                  </svg>
                  <div>
                    <div style={{ fontSize: 34, fontWeight: 600, color: WA.text }}>M1 Quotation.pdf</div>
                    <div style={{ fontSize: 26, color: WA.meta }}>1 page · PDF</div>
                  </div>
                </div>
              </Bubble>
            )}
            {MSGS.slice(1).map((mm) => {
              const p = pos[mm.id];
              if (!p) return null;
              const local = t - mm.a;
              let body: React.ReactNode = null;
              let scale = 1;
              if (mm.id === "proceed") {
                body = (
                  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", height: "100%" }}>
                    <span>I'd like to proceed with this build.</span>
                    <Ticks blue={range(local, 0.32, 0.36)} />
                  </div>
                );
              } else if (mm.id === "reply") {
                const toText = range(t, CH.reply - 0.02, CH.reply + 0.12);
                // three dots arrive one by one, breathe, then the reply
                const dot = (d: number) => {
                  const on = ease.outBack(range(local, 0.04 + d * 0.1, 0.16 + d * 0.1), 2);
                  const wave = local > 0.36 ? Math.max(0, Math.sin((local - 0.36) * 11 - d * 0.9)) : 0;
                  return { s: on, y: -9 * wave, o: (0.45 + 0.55 * on) * (0.55 + 0.45 * wave + 0.45 * (local < 0.36 ? 1 : 0)) };
                };
                body = (
                  <div style={{ position: "relative", height: "100%" }}>
                    <div style={{ position: "absolute", inset: 0, display: "flex", gap: 16, alignItems: "center", opacity: 1 - toText }}>
                      {[0, 1, 2].map((d) => {
                        const q = dot(d);
                        return <div key={d} style={{ width: 22, height: 22, borderRadius: 11, background: WA.meta, transform: `translateY(${q.y}px) scale(${q.s})`, opacity: q.o }} />;
                      })}
                    </div>
                    <div style={{ position: "absolute", inset: 0, opacity: toText, transform: `translateY(${(1 - toText) * 12}px)`, width: 740 }}>We'll confirm the current price and availability.</div>
                  </div>
                );
              } else if (mm.id === "status") {
                const col = ease.inOutCubic(range(t, CH.collapse[0], CH.collapse[1]));
                body = (
                  <div style={{ position: "relative", height: "100%" }}>
                    <div style={{ position: "absolute", inset: 0, display: "flex", gap: 14, alignItems: "center", opacity: 1 - col }}>
                      {["PRICE", "STOCK", "SHIPPING"].map((w, i) => {
                        const on = snap(range(t, CH.tokens[i], CH.tokens[i] + 0.2));
                        const ck = range(t, CH.checks[i], CH.checks[i] + 0.16);
                        const x = lerp(0, (1 - i) * 230, col);
                        return (
                          <div key={w} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 18px 6px 12px", borderRadius: 40, border: `2px solid ${ck > 0.5 ? WA.green : "rgba(134,150,160,0.6)"}`, background: ck > 0.5 ? "rgba(37,211,102,0.12)" : "transparent", fontSize: 28, fontWeight: 700, letterSpacing: 3, color: WA.text, transform: `translateX(${x}px) scale(${on * (1 - 0.3 * col)})` }}>
                            <svg width={30} height={30} viewBox="0 0 30 30">
                              {ck <= 0 ? (
                                <circle cx={15} cy={15} r={9} fill="none" stroke={WA.meta} strokeWidth={3} strokeDasharray="14 44" transform={`rotate(${local * 600} 15 15)`} />
                              ) : (
                                <path d="M7 16 l5 5 l11 -12" fill="none" stroke={WA.green} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={26} strokeDashoffset={26 * (1 - ck)} />
                              )}
                            </svg>
                            {w}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", gap: 18, opacity: col, transform: `scale(${0.9 + 0.1 * col})`, transformOrigin: "0 50%" }}>
                      <Check size={46} k={range(t, CH.collapse[1] - 0.04, CH.collapse[1] + 0.2)} />
                      <span style={{ fontWeight: 600, fontSize: 38 }}>Price & availability confirmed</span>
                    </div>
                  </div>
                );
              } else if (mm.id === "order") {
                body = (
                  <>
                    <div style={{ fontSize: 26, letterSpacing: 5, fontWeight: 700, color: BRAND.yellow, marginBottom: 12 }}>ORDER CONFIRMATION</div>
                    <div style={{ fontWeight: 600, fontSize: 44, opacity: glide(range(local, 0.12, 0.3)) }}>Deposit required</div>
                    <div style={{ display: "flex", gap: 14, marginTop: 16 }}>
                      {["Cash", "Fawran"].map((pp, i) => (
                        <div key={pp} style={{ border: `2px solid ${WA.meta}`, borderRadius: 40, padding: "4px 26px", fontSize: 34, opacity: glide(range(local, 0.22 + i * 0.07, 0.4 + i * 0.07)), transform: `translateY(${(1 - glide(range(local, 0.22 + i * 0.07, 0.4 + i * 0.07))) * 16}px)` }}>
                          {pp}
                        </div>
                      ))}
                    </div>
                  </>
                );
              } else if (mm.id === "paid") {
                const doc = ease.outBack(range(local, 0.05, 0.3), 1.4);
                body = (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 18, background: "rgba(0,0,0,0.22)", borderRadius: 14, padding: "14px 20px", fontSize: 32 }}>
                      <svg width={40} height={46} viewBox="0 0 20 23" style={{ transform: `translateY(${(1 - doc) * 40}px) rotate(${(1 - doc) * -14}deg)`, opacity: clamp01(doc * 1.5) }}>
                        <path d="M2 1h11l5 5v16H2z" fill="none" stroke={WA.text} strokeWidth={1.6} strokeLinejoin="round" />
                        <path d="M6 12l3 3 5-6" fill="none" stroke={WA.green} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={12} strokeDashoffset={12 * (1 - range(local, 0.28, 0.42))} />
                      </svg>
                      <span>Payment confirmation</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 10 }}>
                      <span>Payment sent.</span>
                      <Ticks blue={range(local, 0.34, 0.38)} />
                    </div>
                  </>
                );
              } else if (mm.id === "done") {
                scale = doneScale;
                body = (
                  <div style={{ display: "flex", alignItems: "center", height: "100%", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 700, fontSize: 46 }}>Order confirmed</span>
                    <div style={{ opacity: 1 - range(t, CHAT_PUSH + 0.02, CHAT_PUSH + 0.08) }}>
                      <Check size={64} k={range(doneLocal, 0.06, 0.34)} ring={payoff} />
                    </div>
                  </div>
                );
              }
              return (
                <Bubble key={mm.id} m={mm} top={p.top} k={p.k} w={p.w} h={p.h} scale={scale}>
                  {body}
                </Bubble>
              );
            })}
          </AbsoluteFill>
        )}

        {/* ------------------------------------------------ the quotation (a card on the page → an attachment) */}
        {t >= Q.consolidate[1] - 0.25 && (
          <AbsoluteFill style={{ clipPath: att > 0.55 ? "inset(410px 0 0 0)" : undefined }}>
            <div
              style={{
                position: "absolute",
                left: cardX,
                top: cardY,
                width: CARD.w,
                height: cardH,
                transformOrigin: "0 0",
                transform: `scale(${cardS})`,
                borderRadius: lerp(30, 18, att),
                background: lerp(0, 1, att) > 0.5 ? "#151517" : "#151517",
                border: `2px solid rgba(255,255,255,${0.1 * (1 - att)})`,
                boxShadow: `0 30px 80px rgba(0,0,0,${0.55 * (1 - att)})`,
                opacity: capsule,
                overflow: "hidden",
              }}
            >
              <QuoteBody t={t} reveal={unfold} />
            </div>
          </AbsoluteFill>
        )}

        {/* the real selected pills: drawn together, then carried in the summary (they ride the card into the attachment) */}
        {t >= Q.consolidate[0] - 0.05 &&
          CHOICES.map((ch, i) => {
            const f = frameAt(ch.at);
            const r = JLOG[f].meta[ch.key] as { x: number; y: number; w: number; h: number };
            const nowIdx = Math.min(JLOG.length - 1, frameAt(Q.consolidate[0]));
            const dy = JLOG[nowIdx].scrollY - JLOG[f].scrollY;
            const c0 = quoteCam(Q.consolidate[0]);
            const s0 = toScreen(r.x + r.w / 2, r.y + r.h / 2 - dy, c0);
            const k = toSum(i);
            // in the summary row
            const sx = SUM.xs[i], sy = sumY;
            // and later inside the card / the attachment
            const inCardX = cardX + (SUM.xs[i] - CARD.x) * cardS;
            const inCardY = cardY + (SUM_Y1 - CARD.y) * cardS;
            const x = att > 0 ? inCardX : lerp(s0.x, sx, k) + Math.sin(Math.PI * k) * (i % 2 ? 50 : -50);
            const y = att > 0 ? inCardY : lerp(s0.y, sy, k);
            const sc = att > 0 ? PILL_S * cardS : lerp(c0.s, PILL_S, k) * (1 + 0.08 * Math.sin(Math.PI * k));
            const land = snap(range(t, Q.consolidate[1] - 0.22 + 0.06 * i, Q.consolidate[1] - 0.06 + 0.06 * i));
            return (
              <AbsoluteFill key={ch.key} style={{ clipPath: att > 0.55 ? "inset(410px 0 0 0)" : undefined }}>
                <Cut index={f} cam={camAt(r.x + r.w / 2, r.y + r.h / 2, x, y, sc)} r={r} transform={`scale(${1 + 0.06 * Math.sin(Math.PI * land)})`} />
              </AbsoluteFill>
            );
          })}

        {/* ------------------------------------------------ header: the site's WhatsApp glyph arrives */}
        {chatVisible && (
          <>
            <AbsoluteFill style={{ opacity: chatBg }}>
              <div style={{ position: "absolute", left: 0, top: 0, width: 1080, height: 410, background: WA.header }} />
            </AbsoluteFill>
            <div style={{ position: "absolute", left: headX + 66, top: headY - 56, fontFamily: FONT.ui, opacity: headText, transform: `translateX(${(1 - headText) * -30}px)` }}>
              <div style={{ fontSize: 46, fontWeight: 600, color: WA.text, letterSpacing: -0.5 }}>M1 Gaming PCs</div>
              <div style={{ fontSize: 31, color: WA.meta, marginTop: 2 }}>WhatsApp · online</div>
            </div>
          </>
        )}
        {t >= SE.release - 0.02 && (
          <div style={{ position: "absolute", left: iconX - iconD / 2, top: iconY - iconD / 2, width: iconD, height: iconD, borderRadius: iconD / 2, background: WA.green, boxShadow: `0 ${10 * (1 - fly)}px ${30 * (1 - fly) + 6}px rgba(0,0,0,0.45)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg viewBox="0 0 32 32" width={iconD * 0.5} height={iconD * 0.5}>
              <path d={WA_GLYPH} fill="#000" />
            </svg>
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const chatSamples6 = (t: number) => {
  if (t >= Q.consolidate[0] && t < Q.consolidate[1] + 0.05) return 10;
  if (t >= Q.card && t < Q.card + 0.35) return 4;
  if (t >= SE.release && t < CH.attach[1] + 0.05) return 6;
  if (t >= CHAT_PUSH && t < CHAT_PUSH + 0.55) return 8;
  return 1;
};

export { jTime };
