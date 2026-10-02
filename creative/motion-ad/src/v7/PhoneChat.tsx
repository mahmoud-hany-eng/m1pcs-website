import React from "react";
import { AbsoluteFill } from "remotion";
import { clamp01, ease, lerp, range } from "../lib/ease";
import { BRAND, glide, snap } from "../final/shared";
import { FONT } from "../final/fonts";
import { V } from "./time";
import { QUOTE_LINES } from "./MonitorScreen";

/**
 * The phone's screen: a clean WhatsApp-style conversation (FICTIONAL demo
 * copy — no real chat, number or payment data), authored in the phone's own
 * pixels (1170×2538, 3× a 390×846 screen) and mapped onto the glass.
 */
export const PW = 1170;
export const PH = 2538;
const U = 3;
const CH = V.chat;
export const WA = { bg: "#0b141a", header: "#1f2c34", inBubble: "#202c33", outBubble: "#005c4b", text: "#e9edef", meta: "#8696a0", tick: "#53bdeb", green: "#25D366" };
export const WA_GLYPH =
  "M16.004 3C9.377 3 4 8.373 4 15c0 2.34.66 4.523 1.807 6.383L4 29l7.81-1.767A11.94 11.94 0 0 0 16.004 27C22.63 27 28 21.627 28 15S22.63 3 16.004 3Zm0 21.75c-1.98 0-3.85-.55-5.44-1.51l-.39-.23-4.63 1.05 1.08-4.5-.25-.42A9.71 9.71 0 0 1 5.25 15c0-5.93 4.82-10.75 10.754-10.75S26.75 9.07 26.75 15 21.938 24.75 16.004 24.75Zm5.87-7.98c-.32-.16-1.9-.94-2.2-1.05-.29-.11-.51-.16-.72.16-.21.32-.83 1.05-1.02 1.26-.19.21-.37.24-.69.08-.32-.16-1.35-.5-2.57-1.58-.95-.85-1.59-1.9-1.78-2.22-.19-.32-.02-.49.14-.65.14-.14.32-.37.48-.55.16-.19.21-.32.32-.53.11-.21.05-.4-.03-.56-.08-.16-.72-1.74-.99-2.38-.26-.63-.53-.54-.72-.55-.19-.01-.4-.01-.61-.01-.21 0-.56.08-.85.4-.29.32-1.12 1.09-1.12 2.67s1.15 3.1 1.31 3.31c.16.21 2.26 3.45 5.48 4.84.77.33 1.37.53 1.84.68.77.24 1.47.21 2.02.13.62-.09 1.9-.78 2.17-1.53.27-.75.27-1.39.19-1.53-.08-.13-.29-.21-.61-.37Z";

type Msg = { id: string; side: "in" | "out"; a: number; h: (t: number) => number; w: (t: number) => number };
const c = (n: number) => () => n;
const MSGS: Msg[] = [
  { id: "attach", side: "in", a: CH.attach, h: c(800), w: c(860) },
  { id: "proceed", side: "out", a: CH.proceed, h: c(190), w: c(860) },
  { id: "reply", side: "in", a: CH.typing, h: (t) => lerp(140, 250, ease.inOutCubic(range(t, CH.reply - 0.04, CH.reply + 0.18))), w: (t) => lerp(250, 900, ease.inOutCubic(range(t, CH.reply - 0.04, CH.reply + 0.18))) },
  { id: "status", side: "in", a: CH.tokens[0], h: (t) => lerp(140, 170, range(t, CH.collapse[0], CH.collapse[1])), w: (t) => lerp(980, 920, range(t, CH.collapse[0], CH.collapse[1])) },
  { id: "order", side: "in", a: CH.order, h: c(390), w: c(800) },
  { id: "paid", side: "out", a: CH.paid, h: c(290), w: c(700) },
  { id: "done", side: "in", a: CH.done, h: c(180), w: c(720) },
];
const GAP = 30;
const TOP = 470;
const BOTTOM = 2330;
const X_IN = 50, X_OUT_R = 1120;
const enter = (t: number, m: Msg) => glide(range(t, m.a, m.a + 0.3));
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
  for (const id in pos) pos[id].top -= over;
  return pos;
}
/** the "Order confirmed" check, in phone px (the next shot is born from it) */
export const DONE_CHECK_PHONE = (t: number) => {
  const p = layout(t).done;
  const top = p ? p.top : BOTTOM - 180;
  return { x: X_IN + 720 - 110, y: top + 90, size: 86 };
};

const Ticks: React.FC<{ blue: number }> = ({ blue }) => (
  <svg width={60} height={36} viewBox="0 0 22 13" style={{ display: "block", flex: "none" }}>
    <path d="M1 7 l4 4 l8 -9 M8 9.5 l1.5 1.5 l8 -9" fill="none" stroke={blue > 0.5 ? WA.tick : WA.meta} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
export const Check: React.FC<{ size: number; k?: number; ring?: number }> = ({ size, k = 1, ring = 0 }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" style={{ display: "block", overflow: "visible", flex: "none" }}>
    {ring > 0 && ring < 1 && <circle cx={24} cy={24} r={22 + 24 * ease.outCubic(ring)} fill="none" stroke={WA.green} strokeWidth={3 * (1 - ring)} opacity={1 - ring} />}
    <circle cx={24} cy={24} r={22 * Math.min(1, k * 1.4)} fill={WA.green} />
    <path d="M14 25 l7 7 l13 -15" fill="none" stroke="#08130c" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={34} strokeDashoffset={34 * (1 - clamp01((k - 0.3) / 0.7))} />
  </svg>
);
const Bubble: React.FC<{ m: Msg; top: number; k: number; w: number; h: number; scale?: number; children: React.ReactNode }> = ({ m, top, k, w, h, scale = 1, children }) => {
  const left = m.side === "in" ? X_IN : X_OUT_R - w;
  const bg = m.side === "in" ? WA.inBubble : WA.outBubble;
  return (
    <div style={{ position: "absolute", left, top, width: w, height: h, transformOrigin: `${m.side === "in" ? 0 : w}px 0px`, transform: `translateY(${(1 - k) * 60}px) scale(${(0.95 + 0.05 * k) * scale})`, opacity: clamp01(k * 1.6) }}>
      <svg width={24} height={30} style={{ position: "absolute", top: 0, [m.side === "in" ? "left" : "right"]: -19 } as React.CSSProperties}>
        <path d={m.side === "in" ? "M24 0 H0 L24 27 Z" : "M0 0 H24 L0 27 Z"} fill={bg} />
      </svg>
      <div style={{ position: "absolute", inset: 0, borderRadius: 32, [m.side === "in" ? "borderTopLeftRadius" : "borderTopRightRadius"]: 6, background: bg, padding: "30px 40px", boxSizing: "border-box", fontFamily: FONT.ui, color: WA.text, fontSize: 52, lineHeight: 1.3, overflow: "hidden" } as React.CSSProperties}>
        {children}
      </div>
    </div>
  );
};

/** a small static preview of the quotation (the attachment's thumbnail) */
const QuotePreview: React.FC = () => (
  <div style={{ position: "absolute", left: 14, top: 14, right: 14, height: 600, borderRadius: 20, background: "#151517", overflow: "hidden", fontFamily: FONT.ui }}>
    <div style={{ position: "absolute", left: 34, top: 30, fontSize: 24, letterSpacing: 6, fontWeight: 600, color: BRAND.yellow }}>YOUR REQUIREMENTS</div>
    <div style={{ position: "absolute", left: 34, top: 76, display: "flex", gap: 12 }}>
      {["Gaming", "1440p", "144+ FPS", "White"].map((s) => (
        <div key={s} style={{ background: BRAND.yellow, color: "#000", borderRadius: 40, padding: "8px 22px", fontSize: 28, fontWeight: 600 }}>{s}</div>
      ))}
    </div>
    <div style={{ position: "absolute", left: 34, right: 34, top: 160, height: 2, background: "rgba(255,255,255,0.1)" }} />
    <div style={{ position: "absolute", left: 34, top: 182, fontSize: 24, letterSpacing: 6, fontWeight: 600, color: BRAND.yellow }}>YOUR QUOTATION</div>
    <div style={{ position: "absolute", left: 34, top: 218, fontFamily: FONT.display, fontSize: 46, fontWeight: 700, color: BRAND.white }}>Ryzen 7 9800X3D / RTX 5080</div>
    {QUOTE_LINES.map(([k, v], i) => (
      <div key={k} style={{ position: "absolute", left: 34, right: 34, top: 300 + i * 66, display: "flex", fontSize: 32 }}>
        <span style={{ width: 170, color: BRAND.muted }}>{k}</span>
        <span style={{ color: BRAND.white, fontWeight: 600 }}>{v}</span>
      </div>
    ))}
  </div>
);

export const PhoneChat: React.FC<{ t: number }> = ({ t }) => {
  const pos = layout(t);
  const latest = [...MSGS].reverse().find((m) => t >= m.a);
  const doneLocal = t - CH.done;
  const payoff = range(t, CH.payoff[0], CH.payoff[1]);
  return (
    <AbsoluteFill style={{ width: PW, height: PH, background: WA.bg, overflow: "hidden" }}>
      <AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.035) 2px, transparent 2.1px)", backgroundSize: "44px 44px" }} />
      {/* conversation */}
      <AbsoluteFill style={{ clipPath: `inset(${440}px 0 ${PH - 2390}px 0)` }}>
        {MSGS.map((m) => {
          const p = pos[m.id];
          if (!p) return null;
          const local = t - m.a;
          let body: React.ReactNode = null;
          let scale = 1;
          if (m.id === "attach") {
            body = (
              <>
                <div style={{ position: "absolute", inset: 0, margin: -30 }}>
                  <QuotePreview />
                  <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 170, display: "flex", alignItems: "center", gap: 28, padding: "0 40px", background: "rgba(0,0,0,0.2)" }}>
                    <svg width={66} height={80} viewBox="0 0 20 24"><path d="M2 1h11l5 5v17H2z" fill="#e2483d" /><text x={10} y={18} textAnchor="middle" fontSize={5.2} fontWeight={700} fill="#fff" fontFamily="sans-serif">PDF</text></svg>
                    <div>
                      <div style={{ fontSize: 46, fontWeight: 600 }}>M1 Quotation.pdf</div>
                      <div style={{ fontSize: 36, color: WA.meta }}>1 page · PDF</div>
                    </div>
                  </div>
                </div>
              </>
            );
          } else if (m.id === "proceed") {
            body = (
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", height: "100%", gap: 20 }}>
                <span>I'd like to proceed with this build.</span>
                <Ticks blue={range(local, 0.35, 0.4)} />
              </div>
            );
          } else if (m.id === "reply") {
            const toText = range(t, CH.reply - 0.02, CH.reply + 0.14);
            const dot = (d: number) => {
              const on = ease.outBack(range(local, 0.06 + d * 0.13, 0.2 + d * 0.13), 2);
              const wave = local > 0.48 ? Math.max(0, Math.sin((local - 0.48) * 10 - d * 0.9)) : 0;
              return { s: on, y: -12 * wave, o: 0.5 + 0.5 * on };
            };
            body = (
              <div style={{ position: "relative", height: "100%" }}>
                <div style={{ position: "absolute", inset: 0, display: "flex", gap: 22, alignItems: "center", opacity: 1 - toText }}>
                  {[0, 1, 2].map((d) => { const q = dot(d); return <div key={d} style={{ width: 30, height: 30, borderRadius: 15, background: WA.meta, transform: `translateY(${q.y}px) scale(${q.s})`, opacity: q.o }} />; })}
                </div>
                <div style={{ position: "absolute", left: 0, top: 0, width: 820, opacity: toText, transform: `translateY(${(1 - toText) * 14}px)` }}>We'll confirm the current price and availability.</div>
              </div>
            );
          } else if (m.id === "status") {
            const col = ease.inOutCubic(range(t, CH.collapse[0], CH.collapse[1]));
            body = (
              <div style={{ position: "relative", height: "100%" }}>
                <div style={{ position: "absolute", inset: 0, display: "flex", gap: 18, alignItems: "center", opacity: 1 - col }}>
                  {["PRICE", "STOCK", "SHIPPING"].map((w, i) => {
                    const on = snap(range(t, CH.tokens[i], CH.tokens[i] + 0.22));
                    const ck = range(t, CH.checks[i], CH.checks[i] + 0.18);
                    return (
                      <div key={w} style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 22px 8px 14px", borderRadius: 50, border: `3px solid ${ck > 0.5 ? WA.green : "rgba(134,150,160,0.6)"}`, background: ck > 0.5 ? "rgba(37,211,102,0.12)" : "transparent", fontSize: 36, fontWeight: 700, letterSpacing: 3, transform: `translateX(${lerp(0, (1 - i) * 290, col)}px) scale(${on * (1 - 0.3 * col)})` }}>
                        <svg width={40} height={40} viewBox="0 0 30 30">
                          {ck <= 0 ? <circle cx={15} cy={15} r={9} fill="none" stroke={WA.meta} strokeWidth={3} strokeDasharray="14 44" transform={`rotate(${local * 600} 15 15)`} /> : <path d="M7 16 l5 5 l11 -12" fill="none" stroke={WA.green} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={26} strokeDashoffset={26 * (1 - ck)} />}
                        </svg>
                        {w}
                      </div>
                    );
                  })}
                </div>
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", gap: 24, opacity: col, transformOrigin: "0 50%", transform: `scale(${0.9 + 0.1 * col})` }}>
                  <Check size={64} k={range(t, CH.collapse[1] - 0.04, CH.collapse[1] + 0.22)} />
                  <span style={{ fontWeight: 600, fontSize: 50 }}>Price & availability confirmed</span>
                </div>
              </div>
            );
          } else if (m.id === "order") {
            body = (
              <>
                <div style={{ fontSize: 34, letterSpacing: 7, fontWeight: 700, color: BRAND.yellow, marginBottom: 16 }}>ORDER CONFIRMATION</div>
                <div style={{ fontWeight: 600, fontSize: 60, opacity: glide(range(local, 0.12, 0.32)) }}>Deposit required</div>
                <div style={{ display: "flex", gap: 20, marginTop: 24 }}>
                  {["Cash", "Fawran"].map((pp, i) => (
                    <div key={pp} style={{ border: `3px solid ${WA.meta}`, borderRadius: 50, padding: "6px 36px", fontSize: 46, opacity: glide(range(local, 0.24 + i * 0.08, 0.44 + i * 0.08)) }}>{pp}</div>
                  ))}
                </div>
              </>
            );
          } else if (m.id === "paid") {
            const doc = ease.outBack(range(local, 0.05, 0.32), 1.4);
            body = (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 24, background: "rgba(0,0,0,0.22)", borderRadius: 18, padding: "18px 26px", fontSize: 42 }}>
                  <svg width={52} height={60} viewBox="0 0 20 23" style={{ transform: `translateY(${(1 - doc) * 50}px) rotate(${(1 - doc) * -14}deg)`, opacity: clamp01(doc * 1.5) }}>
                    <path d="M2 1h11l5 5v16H2z" fill="none" stroke={WA.text} strokeWidth={1.6} strokeLinejoin="round" />
                    <path d="M6 12l3 3 5-6" fill="none" stroke={WA.green} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={12} strokeDashoffset={12 * (1 - range(local, 0.3, 0.45))} />
                  </svg>
                  <span>Payment confirmation</span>
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 14 }}>
                  <span>Payment sent.</span>
                  <Ticks blue={range(local, 0.38, 0.42)} />
                </div>
              </>
            );
          } else if (m.id === "done") {
            scale = 1 + 0.03 * Math.sin(Math.PI * range(t, CH.payoff[0] + 0.1, CH.payoff[0] + 0.34));
            body = (
              <div style={{ display: "flex", alignItems: "center", height: "100%", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700, fontSize: 60 }}>Order confirmed</span>
                <div style={{ opacity: 1 - range(t, CH.push + 0.3, CH.push + 0.36) }}>
                  <Check size={86} k={range(doneLocal, 0.06, 0.36)} ring={payoff} />
                </div>
              </div>
            );
          }
          return (
            <Bubble key={m.id} m={m} top={p.top} k={m.id === "attach" ? snap(range(t, m.a, m.a + 0.35)) : p.k} w={p.w} h={p.h} scale={scale}>
              {body}
            </Bubble>
          );
        })}
      </AbsoluteFill>
      {/* status bar + header */}
      <div style={{ position: "absolute", left: 0, top: 0, width: PW, height: 430, background: WA.header }} />
      <div style={{ position: "absolute", left: 70, top: 44, fontFamily: FONT.ui, fontSize: 40, fontWeight: 600, color: WA.text }}>9:41</div>
      <div style={{ position: "absolute", left: 70, top: 220, width: 130, height: 130, borderRadius: 65, background: WA.green, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg viewBox="0 0 32 32" width={70} height={70}><path d={WA_GLYPH} fill="#000" /></svg>
      </div>
      <div style={{ position: "absolute", left: 236, top: 222, fontFamily: FONT.ui }}>
        <div style={{ fontSize: 58, fontWeight: 600, color: WA.text }}>M1 Gaming PCs</div>
        <div style={{ fontSize: 40, color: WA.meta, marginTop: 4 }}>{latest && latest.id === "reply" && t < CH.reply ? "typing…" : "online"}</div>
      </div>
      {/* input bar (decorative) */}
      <div style={{ position: "absolute", left: 40, right: 170, top: 2410, height: 110, borderRadius: 55, background: "#2a3942", fontFamily: FONT.ui, fontSize: 44, color: WA.meta, display: "flex", alignItems: "center", paddingLeft: 50 }}>Message</div>
      <div style={{ position: "absolute", right: 40, top: 2410, width: 110, height: 110, borderRadius: 55, background: WA.green }} />
    </AbsoluteFill>
  );
};
