import React from "react";
import { AbsoluteFill } from "remotion";
import { clamp01, ease, lerp, range } from "../lib/ease";
import { K, toScreen } from "../lib/SiteFrame";
import { Cut, quoteCam } from "./Journey";
import { BRAND, JLOG, TAP, camAt, glide, snap } from "./shared";
import { FONT } from "./fonts";
import T from "../../timeline.json";

const CU = T.final.cues.chat;

/**
 * Shot 4b + 5: the customer's real choices lift off the page and assemble
 * into the request the site itself builds ("New M1 Quote Request", same
 * field labels as the site's WhatsApp message). The real "Send Request via
 * WhatsApp" press hands off to WhatsApp: the site's own WhatsApp button
 * glyph rises into a chat header, the request becomes the first sent
 * message, and a short FICTIONAL demo conversation confirms price,
 * availability, deposit and the order. No real chat, number or payment data.
 */

const SE = TAP.send;
const WA_GLYPH =
  "M16.004 3C9.377 3 4 8.373 4 15c0 2.34.66 4.523 1.807 6.383L4 29l7.81-1.767A11.94 11.94 0 0 0 16.004 27C22.63 27 28 21.627 28 15S22.63 3 16.004 3Zm0 21.75c-1.98 0-3.85-.55-5.44-1.51l-.39-.23-4.63 1.05 1.08-4.5-.25-.42A9.71 9.71 0 0 1 5.25 15c0-5.93 4.82-10.75 10.754-10.75S26.75 9.07 26.75 15 21.938 24.75 16.004 24.75Zm5.87-7.98c-.32-.16-1.9-.94-2.2-1.05-.29-.11-.51-.16-.72.16-.21.32-.83 1.05-1.02 1.26-.19.21-.37.24-.69.08-.32-.16-1.35-.5-2.57-1.58-.95-.85-1.59-1.9-1.78-2.22-.19-.32-.02-.49.14-.65.14-.14.32-.37.48-.55.16-.19.21-.32.32-.53.11-.21.05-.4-.03-.56-.08-.16-.72-1.74-.99-2.38-.26-.63-.53-.54-.72-.55-.19-.01-.4-.01-.61-.01-.21 0-.56.08-.85.4-.29.32-1.12 1.09-1.12 2.67s1.15 3.1 1.31 3.31c.16.21 2.26 3.45 5.48 4.84.77.33 1.37.53 1.84.68.77.24 1.47.21 2.02.13.62-.09 1.9-.78 2.17-1.53.27-.75.27-1.39.19-1.53-.08-.13-.29-.21-.61-.37Z";

export const WA = { bg: "#0b141a", header: "#1f2c34", inBubble: "#202c33", outBubble: "#005c4b", text: "#e9edef", meta: "#8696a0", tick: "#53bdeb", green: "#25D366" };

// ------------------------------------------------------------------ the request card
const CARD = { x: 100, y: 300, w: 880, h: 688 };
const ROW0 = CARD.y + 216;
const ROW_H = 112;
const PILL_S = 0.84; // zoom of the landed pills
const PILLS = [
  { key: "gaming", label: "Primary use", value: "Gaming", frame: 206, start: 5.24 },
  { key: "res", label: "Resolution", value: "1440p", frame: 224, start: 5.29 },
  { key: "fps", label: "Target FPS", value: "144+ FPS", frame: 242, start: 5.34 },
  { key: "colour", label: "Colour", value: "White", frame: 285, start: 5.4 },
];
const FLY = 0.42;

// ------------------------------------------------------------------ the conversation
type Msg = { id: string; side: "in" | "out"; a: number; h: number; w: number };
const GAP = 26;
const MSGS: Msg[] = [
  { id: "request", side: "out", a: SE.release, h: 452, w: 760 },
  { id: "quote", side: "in", a: CU.quote, h: 424, w: 800 },
  { id: "proceed", side: "out", a: CU.proceed, h: 140, w: 700 },
  { id: "confirm", side: "in", a: CU.confirm, h: 140, w: 760 },
  { id: "order", side: "in", a: CU.order, h: 300, w: 700 },
  { id: "paid", side: "out", a: CU.paid, h: 214, w: 560 },
  { id: "done", side: "in", a: CU.done, h: 128, w: 560 },
];
const TOP = 440; // first message top
const BOTTOM = 1500; // keep clear of the Reels caption zone
const enter = (t: number, m: Msg) => (m.id === "request" ? 1 : glide(range(t, m.a, m.a + 0.24)));
function layout(t: number) {
  let y = TOP;
  const pos: Record<string, { top: number; k: number }> = {};
  for (const m of MSGS) {
    if (t < m.a) break;
    const k = enter(t, m);
    pos[m.id] = { top: y, k };
    y += (m.h + GAP) * k;
  }
  const over = Math.max(0, y - GAP - BOTTOM);
  for (const id in pos) pos[id].top -= over;
  return pos;
}
const X_IN = 92;
const X_OUT_R = 958;
export const CHAT_END = CU.end;
export const DONE_CHECK = (t: number) => {
  // screen position of the "Order confirmed" check (the route's first node)
  const p = layout(t).done;
  const m = MSGS[6];
  return { x: X_IN + m.w - 82, y: (p ? p.top : BOTTOM - m.h) + m.h / 2 };
};

const Ticks: React.FC<{ blue: number }> = ({ blue }) => (
  <svg width={44} height={26} viewBox="0 0 22 13" style={{ display: "block" }}>
    <path d="M1 7 l4 4 l8 -9 M8 9.5 l1.5 1.5 l8 -9" fill="none" stroke={blue > 0.5 ? WA.tick : WA.meta} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const Check: React.FC<{ size: number; k?: number; color?: string; stroke?: string }> = ({ size, k = 1, color = WA.green, stroke = "#08130c" }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" style={{ display: "block" }}>
    <circle cx={24} cy={24} r={22 * Math.min(1, k * 1.4)} fill={color} />
    <path d="M14 25 l7 7 l13 -15" fill="none" stroke={stroke} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={34} strokeDashoffset={34 * (1 - clamp01((k - 0.3) / 0.7))} />
  </svg>
);

const Bubble: React.FC<{ m: Msg; top: number; k: number; children: React.ReactNode; bg?: string }> = ({ m, top, k, children, bg }) => {
  const left = m.side === "in" ? X_IN : X_OUT_R - m.w;
  const ox = m.side === "in" ? 0 : m.w;
  return (
    <div
      style={{
        position: "absolute",
        left,
        top,
        width: m.w,
        height: m.h,
        transformOrigin: `${ox}px 0px`,
        transform: `translateY(${(1 - k) * 46}px) scale(${0.94 + 0.06 * k})`,
        opacity: clamp01(k * 1.6),
      }}
    >
      <svg width={18} height={22} style={{ position: "absolute", top: 0, [m.side === "in" ? "left" : "right"]: -14 } as React.CSSProperties}>
        <path d={m.side === "in" ? "M18 0 H0 L18 20 Z" : "M0 0 H18 L0 20 Z"} fill={bg ?? (m.side === "in" ? WA.inBubble : WA.outBubble)} />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 24,
          [m.side === "in" ? "borderTopLeftRadius" : "borderTopRightRadius"]: 4,
          background: bg ?? (m.side === "in" ? WA.inBubble : WA.outBubble),
          boxShadow: "0 2px 3px rgba(0,0,0,0.35)",
          padding: "22px 30px",
          boxSizing: "border-box",
          fontFamily: FONT.ui,
          color: WA.text,
          fontSize: 40,
          lineHeight: 1.3,
          overflow: "hidden",
        } as React.CSSProperties}
      >
        {children}
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: string; k: number }> = ({ label, value, k }) => (
  <div style={{ display: "flex", gap: 22, fontSize: 34, lineHeight: "60px", opacity: k, transform: `translateX(${(1 - k) * -26}px)` }}>
    <span style={{ color: WA.meta, width: 150, flex: "none" }}>{label}</span>
    <span style={{ color: WA.text, fontWeight: 500 }}>{value}</span>
  </div>
);

export const Chat: React.FC<{ t: number }> = ({ t }) => {
  if (t < 5.2 || t > CHAT_END + 0.45) return null;

  // ---------------------------------------------------------- card phase
  const cardIn = ease.settle(range(t, 5.36, 5.7));
  const toBubble = ease.inOutCubic(range(t, SE.release + 0.02, SE.release + 0.4));
  const req = MSGS[0];
  const pos = layout(t);
  const reqTop = pos.request ? pos.request.top : TOP;
  const bubbleBox = { x: X_OUT_R - req.w, y: reqTop, w: req.w, h: req.h };
  const box = {
    x: lerp(CARD.x, bubbleBox.x, toBubble),
    y: lerp(CARD.y, bubbleBox.y, toBubble),
    w: lerp(CARD.w, bubbleBox.w, toBubble),
    h: lerp(CARD.h, bubbleBox.h, toBubble),
  };
  const cardContent = 1 - range(toBubble, 0.15, 0.45);
  const bubbleContent = range(toBubble, 0.45, 0.85);
  const bg = `rgb(${Math.round(lerp(21, 0, toBubble))},${Math.round(lerp(21, 92, toBubble))},${Math.round(lerp(23, 75, toBubble))})`;

  // ---------------------------------------------------------- WhatsApp hand-off
  const chatBg = ease.inOutCubic(range(t, SE.release + 0.05, SE.release + 0.4));
  const fab = { x: 384, y: 720 }; // the real floating WhatsApp button (viewport)
  const fabScreen = toScreen(fab.x, fab.y, quoteCam(SE.release));
  const fly = ease.inOutCubic(range(t, SE.release + 0.04, SE.release + 0.42));
  const lift = ease.outCubic(range(t, SE.release - 0.02, SE.release + 0.1));
  const headX = 132, headY = 334;
  const iconX = lerp(fabScreen.x, headX, fly) - 40 * Math.sin(Math.PI * fly);
  const iconY = lerp(fabScreen.y, headY, fly) - 160 * Math.sin(Math.PI * fly);
  const iconD = lerp(56 * K, 84, fly) * (1 + 0.14 * lift * (1 - fly));
  const headText = ease.settle(range(t, SE.release + 0.3, SE.release + 0.55));

  // ---------------------------------------------------------- exit into the route
  const exit = ease.inOutCubic(range(t, CHAT_END - 0.04, CHAT_END + 0.3));
  const doneK = (m: number) => range(t, MSGS[6].a + 0.06 + m, MSGS[6].a + 0.3 + m);

  // camera nudges toward the newest message
  const latest = [...MSGS].reverse().find((m) => t >= m.a);
  const nudge = latest && latest.id !== "request" ? 1 - glide(range(t, latest.a, latest.a + 0.5)) : 0;
  const camShift = latest ? (latest.side === "in" ? 14 : -14) * nudge : 0;

  const chatVisible = t >= SE.release;

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      {/* the chat surface */}
      {chatVisible && (
        <AbsoluteFill style={{ backgroundColor: WA.bg, opacity: chatBg * (1 - exit) }}>
          {/* a faint pattern so it reads as a chat wallpaper, not a flat slab */}
          <AbsoluteFill style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.035) 1.5px, transparent 1.6px)", backgroundSize: "34px 34px" }} />
        </AbsoluteFill>
      )}

      <AbsoluteFill
        style={{
          transformOrigin: "540px 1000px",
          transform: `translateX(${camShift}px) scale(${(1 + 0.012 * nudge) * (1 - 0.1 * exit)})`,
          opacity: 1 - exit,
          filter: exit > 0.01 ? `blur(${10 * exit}px)` : undefined,
        }}
      >
        {/* conversation (clipped under the header) */}
        {chatVisible && (
          <AbsoluteFill style={{ clipPath: "inset(410px 0 0 0)" }}>
            {MSGS.slice(1).map((m) => {
              const p = pos[m.id];
              if (!p) return null;
              const local = t - m.a;
              let body: React.ReactNode = null;
              if (m.id === "quote") {
                body = (
                  <>
                    <div style={{ fontSize: 26, letterSpacing: 5, fontWeight: 700, color: BRAND.yellow, marginBottom: 6 }}>QUOTATION</div>
                    <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 46, lineHeight: 1.15, marginBottom: 14 }}>Ryzen 7 9800X3D / RTX 5080</div>
                    <Row label="CPU" value="AMD Ryzen 7 9800X3D" k={glide(range(local, 0.12, 0.3))} />
                    <Row label="GPU" value="NVIDIA RTX 5080 16GB" k={glide(range(local, 0.18, 0.36))} />
                    <Row label="RAM" value="32GB 6000MHz" k={glide(range(local, 0.24, 0.42))} />
                    <Row label="Storage" value="2TB M.2 SSD" k={glide(range(local, 0.3, 0.48))} />
                  </>
                );
              } else if (m.id === "proceed") {
                body = (
                  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", height: "100%" }}>
                    <span>I'd like to proceed with this build.</span>
                    <Ticks blue={range(local, 0.25, 0.3)} />
                  </div>
                );
              } else if (m.id === "confirm") {
                const typing = local < 0.22;
                const done = range(local, 0.54, 0.7);
                body = typing ? (
                  <div style={{ display: "flex", gap: 14, height: "100%", alignItems: "center" }}>
                    {[0, 1, 2].map((d) => (
                      <div key={d} style={{ width: 18, height: 18, borderRadius: 9, background: WA.meta, opacity: 0.4 + 0.6 * Math.max(0, Math.sin((local * 9 - d * 0.9) * Math.PI)) }} />
                    ))}
                  </div>
                ) : (
                  <div style={{ position: "relative", height: "100%" }}>
                    <div style={{ position: "absolute", inset: 0, opacity: 1 - done, display: "flex", alignItems: "center", gap: 18 }}>
                      <svg width={40} height={40} viewBox="0 0 40 40" style={{ flex: "none", transform: `rotate(${local * 540}deg)` }}>
                        <circle cx={20} cy={20} r={15} fill="none" stroke={WA.meta} strokeOpacity={0.35} strokeWidth={5} />
                        <path d="M20 5 a15 15 0 0 1 15 15" fill="none" stroke={WA.green} strokeWidth={5} strokeLinecap="round" />
                      </svg>
                      <span style={{ color: WA.meta }}>Checking price & availability…</span>
                    </div>
                    <div style={{ position: "absolute", inset: 0, opacity: done, display: "flex", alignItems: "center", gap: 18, transform: `translateY(${(1 - done) * 18}px)` }}>
                      <Check size={44} k={range(local, 0.58, 0.8)} />
                      <span style={{ fontWeight: 600, fontSize: 38 }}>Price & availability confirmed</span>
                    </div>
                  </div>
                );
              } else if (m.id === "order") {
                body = (
                  <>
                    <div style={{ fontSize: 26, letterSpacing: 5, fontWeight: 700, color: BRAND.yellow, marginBottom: 12 }}>ORDER CONFIRMATION</div>
                    <div style={{ fontWeight: 600, fontSize: 44, opacity: glide(range(local, 0.1, 0.26)) }}>Deposit required</div>
                    <div style={{ display: "flex", gap: 14, marginTop: 16, opacity: glide(range(local, 0.18, 0.34)) }}>
                      {["Cash", "Fawran"].map((p, i) => (
                        <div key={p} style={{ border: `2px solid ${WA.meta}`, borderRadius: 40, padding: "4px 26px", fontSize: 34, transform: `translateY(${(1 - glide(range(local, 0.18 + i * 0.05, 0.36 + i * 0.05))) * 16}px)` }}>
                          {p}
                        </div>
                      ))}
                    </div>
                  </>
                );
              } else if (m.id === "paid") {
                body = (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 18, background: "rgba(0,0,0,0.22)", borderRadius: 14, padding: "14px 20px", fontSize: 32 }}>
                      <svg width={40} height={46} viewBox="0 0 20 23">
                        <path d="M2 1h11l5 5v16H2z" fill="none" stroke={WA.text} strokeWidth={1.6} strokeLinejoin="round" />
                        <path d="M6 12l3 3 5-6" fill="none" stroke={WA.green} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span style={{ color: WA.text }}>Payment confirmation</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 10 }}>
                      <span>Payment sent.</span>
                      <Ticks blue={range(local, 0.22, 0.27)} />
                    </div>
                  </>
                );
              } else if (m.id === "done") {
                body = (
                  <div style={{ display: "flex", alignItems: "center", height: "100%", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: 700, fontSize: 44 }}>Order confirmed</span>
                    <div style={{ opacity: 1 - range(t, CHAT_END - 0.06, CHAT_END) }}>
                      <Check size={60} k={doneK(0)} />
                    </div>
                  </div>
                );
              }
              return (
                <Bubble key={m.id} m={m} top={p.top} k={p.k}>
                  {body}
                </Bubble>
              );
            })}
          </AbsoluteFill>
        )}

        {/* the request: a card on the page, then the first message sent */}
        {t >= 5.36 && (
          <AbsoluteFill style={{ clipPath: toBubble > 0.6 ? "inset(410px 0 0 0)" : undefined }}>
            <div
              style={{
                position: "absolute",
                left: box.x,
                top: box.y + (1 - cardIn) * 40,
                width: box.w,
                height: box.h,
                borderRadius: lerp(30, 24, toBubble),
                borderTopRightRadius: lerp(30, 4, toBubble),
                background: bg,
                border: `2px solid rgba(255,255,255,${0.09 * (1 - toBubble)})`,
                boxShadow: `0 30px 80px rgba(0,0,0,${0.55 * (1 - toBubble)})`,
                opacity: cardIn,
                transform: `scale(${0.96 + 0.04 * cardIn})`,
                overflow: "hidden",
                fontFamily: FONT.ui,
              }}
            >
              {/* card content (site styling) */}
              <div style={{ position: "absolute", left: 52, top: 52, opacity: cardContent }}>
                <div style={{ fontSize: 27, letterSpacing: 7, fontWeight: 600, color: BRAND.yellow }}>NEW M1 QUOTE REQUEST</div>
                <div style={{ fontFamily: FONT.display, fontWeight: 700, fontSize: 60, color: BRAND.white, marginTop: 14, letterSpacing: -1 }}>PC Build Requirements</div>
              </div>
              {PILLS.map((p, i) => (
                <div
                  key={p.key}
                  style={{
                    position: "absolute",
                    left: 52,
                    top: ROW0 - CARD.y + i * ROW_H,
                    height: ROW_H,
                    display: "flex",
                    alignItems: "center",
                    fontSize: 38,
                    color: BRAND.muted,
                    opacity: cardContent * glide(range(t, p.start + FLY - 0.14, p.start + FLY + 0.06)),
                    transform: `translateX(${(1 - glide(range(t, p.start + FLY - 0.14, p.start + FLY + 0.06))) * -24}px)`,
                  }}
                >
                  {p.label}
                </div>
              ))}
              {PILLS.map((_, i) => (
                <div key={i} style={{ position: "absolute", left: 52, right: 52, top: ROW0 - CARD.y + i * ROW_H, height: 1.5, background: "rgba(255,255,255,0.08)", opacity: cardContent * cardIn }} />
              ))}
              {/* the same request as the WhatsApp message text */}
              <div style={{ position: "absolute", left: 30, top: 22, right: 30, opacity: bubbleContent, color: WA.text, fontSize: 36, lineHeight: 1.36 }}>
                <div style={{ fontWeight: 700, fontSize: 38 }}>New M1 Quote Request</div>
                <div style={{ color: "#a7d3c9", fontSize: 32, marginTop: 4 }}>Quote For: Complete Custom PC</div>
                <div style={{ marginTop: 14 }}>
                  {PILLS.map((p) => (
                    <div key={p.key}>
                      <span style={{ color: "#a7d3c9" }}>{p.label}:</span> {p.value}
                    </div>
                  ))}
                </div>
                <div style={{ position: "absolute", right: 0, top: 360 }}>
                  <Ticks blue={range(t, SE.release + 0.5, SE.release + 0.55)} />
                </div>
              </div>
            </div>
          </AbsoluteFill>
        )}

        {/* the real selected pills flying from the page into the request */}
        {t >= 5.2 && toBubble < 0.5 &&
          PILLS.map((p, i) => {
            const r = JLOG[p.frame].meta[p.key] as { x: number; y: number; w: number; h: number };
            const nowIdx = Math.min(358, Math.round((5.2 - 0.55) * 60));
            const dy = JLOG[nowIdx].scrollY - JLOG[p.frame].scrollY;
            const c0 = quoteCam(5.2);
            const s0 = toScreen(r.x + r.w / 2, r.y + r.h / 2 - dy, c0);
            const endW = r.w * K * PILL_S;
            const s1 = { x: CARD.x + CARD.w - 52 - endW / 2, y: ROW0 + i * ROW_H + ROW_H / 2 };
            const k = glide(range(t, p.start, p.start + FLY));
            const x = lerp(s0.x, s1.x, k) + Math.sin(Math.PI * k) * (i % 2 ? 60 : -60);
            const y = lerp(s0.y, s1.y, k) + (1 - cardIn) * 40 * k;
            const sc = lerp(c0.s, PILL_S, k) * (1 + 0.1 * Math.sin(Math.PI * k));
            const land = snap(range(t, p.start + FLY - 0.04, p.start + FLY + 0.14));
            return (
              <Cut
                key={p.key}
                index={p.frame}
                cam={camAt(r.x + r.w / 2, r.y + r.h / 2, x, y, sc)}
                r={r}
                scale={1 + 0.06 * Math.sin(Math.PI * land)}
                style={{ opacity: 1 - range(toBubble, 0.15, 0.4) }}
              />
            );
          })}

        {/* header: the site's WhatsApp glyph arrives and the chat names M1 */}
        {chatVisible && (
          <>
            <AbsoluteFill style={{ opacity: chatBg }}>
              <div style={{ position: "absolute", left: 0, top: 0, width: 1080, height: 410, background: WA.header, boxShadow: "0 2px 0 rgba(255,255,255,0.04)" }} />
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

export const chatSamples = (t: number) => {
  if (t >= 5.24 && t < 5.86) return 12; // pills flying
  if (t >= SE.release && t < SE.release + 0.42) return 6; // hand-off
  if (t >= CHAT_END - 0.04 && t < CHAT_END + 0.3) return 6;
  return 1;
};
