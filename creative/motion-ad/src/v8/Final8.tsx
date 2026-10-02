import React from "react";
import { AbsoluteFill, Audio, Img, staticFile, useCurrentFrame } from "remotion";
import { MotionBlur } from "../lib/MotionBlur";
import { Fonts } from "../final/fonts";
import { BRAND } from "../final/shared";
import { clamp01, ease, lerp, range } from "../lib/ease";
import { Camera, MON, PHONE, V3, add, fullFrameCam, homography, lerp3, monScreenCorners, phonePoint, project, toCam, v3 } from "../v7/world";
import { CamKey, keyCam, lookAt, mixCam, monCam } from "../v7/cams";
import { Environment, Monitor, Phone, monScreenPoint } from "../v7/Devices";
import { Intro8, IntroQuestion, introSamples } from "./Intro8";
import { LIFTS, MonitorScreen8, frameSrc, pillRect } from "./MonitorScreen8";
import { DONE_CHECK_PHONE, PH, PW, PhoneChat, WA, WA_GLYPH } from "./PhoneChat8";
import { Route8, routeSamples8 } from "./Route8";
import { Gallery8, GalleryText, gallerySamples } from "./Gallery8";
import { HERO, PC8, heroPlace, pcSamples8 } from "./PC8";
import { End8, endSamples8 } from "./End8";
import { Line, arrive } from "./Kinetic";
import { makeSplineCam, smoothCam } from "./spline";
import { CLOG, D, DURATION, FPS, SH, SW, TAP, V, cIndex } from "./time";

/**
 * M1 Gaming PCs — the final campaign cut (v8), built around the narration.
 * Three layers: the narrator; kinetic type that lifts only the words that
 * matter; a physical device world (monitor + phone + one camera) that shows
 * how a customer actually uses M1 — on the REAL site, captured
 * deterministically and mapped razor-sharp onto the glass.
 *
 * `vo` = true: the voiceover version. `vo` = false: same picture and pacing,
 * no narration — a few kinetic lines are extended so the story still reads.
 */
export { DURATION };

const I = V.intro, HM = V.home, Q = V.quote, TP = V.toPhone, CH = V.chat, RT = V.route, RET = V.ret, FLY = V.fly, ST = V.starts, GA = V.gallery, PT = V.parts;
const settle = arrive;

// ------------------------------------------------------------------ helpers
/** camera-space ray through a frame point, intersected with the plane z = zp (world) */
function unproject(c: Camera, sx: number, sy: number, zp: number): V3 {
  const x1 = (sx - 540) / c.f, y2 = (sy - 960) / c.f, z2 = 1;
  const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch), cy = Math.cos(c.yaw), sy_ = Math.sin(c.yaw);
  const z1 = -y2 * sp + z2 * cp;
  const dy = y2 * cp + z2 * sp;
  const dx = x1 * cy + z1 * sy_;
  const dz = -x1 * sy_ + z1 * cy;
  const l = (zp - c.pos.z) / dz;
  return v3(c.pos.x + dx * l, c.pos.y + dy * l, zp);
}
/** the camera framing a point of the site (viewport css px) on the monitor's glass */
const onScreen = (cssX: number, cssY: number, d: number, yawDeg: number, dy = 0) => monCam(d, yawDeg, dy, monScreenPoint(cssX * D, cssY * D, SW, SH));
/** above the phone: distance, elevation (deg from the desk) and azimuth (deg, + = from the right) */
function phoneCamA(dist: number, elevDeg: number, azDeg: number, f = 1500): Camera {
  const target = phonePoint(PHONE.w / 2, PHONE.h / 2, PHONE.thick);
  const far = phonePoint(PHONE.w / 2, 0, 0), near = phonePoint(PHONE.w / 2, PHONE.h, 0);
  const L = Math.hypot(near.x - far.x, near.z - far.z);
  let dir = { x: (near.x - far.x) / L, z: (near.z - far.z) / L };
  const a = (azDeg * Math.PI) / 180;
  dir = { x: dir.x * Math.cos(a) - dir.z * Math.sin(a), z: dir.x * Math.sin(a) + dir.z * Math.cos(a) };
  const e = (elevDeg * Math.PI) / 180;
  const pos = v3(target.x + dir.x * dist * Math.cos(e), target.y - dist * Math.sin(e), target.z + dir.z * dist * Math.cos(e));
  return lookAt(pos, target, f);
}

// ------------------------------------------------------------------ the return: the site's PC photo lands on the hero
const CTA_IMG = CLOG[0].meta.img;
function returnCloseCam(): Camera {
  const hp = heroPlace(RET.glow[0]);
  const imgPxH = HERO.h * hp.pps;
  const center = monScreenPoint((CTA_IMG.x + CTA_IMG.w / 2) * D, (CTA_IMG.y + CTA_IMG.h / 2) * D, SW, SH);
  const worldH = (CTA_IMG.h * D * MON.screen.h) / SH;
  const f = 1500;
  const d = (f * worldH) / imgPxH;
  const cx = hp.x + (HERO.w / 2 - hp.sx) * hp.pps, cy = hp.y + (HERO.h / 2 - hp.sy) * hp.pps;
  return { pos: v3(center.x - ((cx - 540) * d) / f, center.y - ((cy - 960) * d) / f, -d), yaw: 0, pitch: 0, f };
}

// ------------------------------------------------------------------ camera path (anticipate → accelerate → glide → settle)
const E0 = monCam(2250, 14, -100);
const KEYS: CamKey[] = [
  { t: 0, cam: E0 },
  { t: I.pullBack[0], cam: E0 },
  // the monitor in 3/4, then the camera eases round toward the front while "it starts with you"
  { t: I.pullBack[1], cam: monCam(2650, 24, -230), e: settle },
  // one steady approach to the screen under "Let us show you how it's properly done…" — never parked
  { t: (I.pullBack[1] + HM.cursorIn[0]) / 2 + 0.2, cam: onScreen(335, 760, 2150, 15, -70), e: ease.inOutCubic },
  { t: HM.cursorIn[0] + 0.5, cam: onScreen(320, 800, 1700, 9, -40), e: ease.inOutCubic },
  { t: HM.press, cam: onScreen(300, 820, 1480, 5, -10), e: ease.inOutCubic },
  { t: Q.settle[1], cam: onScreen(330, 560, 1420, 2, -10), e: settle },
  // choice 1 — "what you play": slight left → centre
  { t: Q.gaming.path[0], cam: onScreen(360, 470, 1260, -6, 0), e: ease.inOutCubic },
  // choice 2 — "the performance": the monitor turns a few degrees
  { t: Q.res.press, cam: onScreen(300, 715, 1170, 5, 40), e: ease.inOutCubic },
  { t: Q.fps.release + 0.25, cam: onScreen(300, 740, 1150, 4, 30), e: ease.inOutCubic },
  // choice 3 — "your budget": a little closer
  { t: Q.budget.press, cam: onScreen(250, 210, 1090, 1.5, -10), e: ease.inOutCubic },
  { t: Q.budget.type[1] + 0.1, cam: onScreen(245, 200, 1020, 1, -10), e: ease.inOutCubic },
  // choice 4 — "the look": recentre
  { t: Q.colour.press, cam: onScreen(320, 960, 1300, 0, 0), e: ease.inOutCubic },
  { t: Q.consolidate[0], cam: onScreen(360, 700, 1500, 0, 0), e: ease.inOutCubic },
  // the quotation rises off the glass — a slight orbit shows its depth
  { t: Q.card + 0.2, cam: onScreen(360, 470, 1480, -7, -30), e: ease.inOutCubic },
  { t: Q.lift[1], cam: onScreen(360, 480, 1420, -3, -10), e: ease.inOutCubic },
  { t: Q.scroll3[1], cam: onScreen(360, 760, 1460, -1, 0), e: ease.inOutCubic },
  { t: Q.send.press, cam: onScreen(370, 900, 1380, 0, 0), e: ease.inOutCubic },
  { t: TP.camera[0], cam: onScreen(380, 920, 1400, 0.5, 0), e: ease.inOutCubic },
  // pull away; the phone comes into view; follow the WhatsApp object down to it
  { t: TP.camera[0] + 0.6, cam: lookAt(v3(560, -1450, -2500), v3(360, -520, -380)), e: ease.inOutCubic },
  { t: TP.wake + 0.15, cam: phoneCamA(1150, 56, 22), e: ease.inOutCubic },
  // the phone turns to face us as the conversation matters
  { t: CH.front[1], cam: phoneCamA(800, 84, 0), e: settle },
  { t: CH.push, cam: phoneCamA(790, 85, 0), e: (x: number) => x },
];
export const KEYS_EXPORT = KEYS;
export const splineCam = smoothCam(makeSplineCam(KEYS), 0.22);
/** small physical responses to the important messages */
const BUMPS = [CH.proceed, CH.reply, CH.collapse[1], CH.order, CH.paid, CH.done];
const bump = (t: number) => BUMPS.reduce((s, a) => s + Math.sin(Math.PI * range(t, a, a + 0.6)) ** 2, 0); // sin²: starts and ends at rest
const PUSH = [CH.payoff[1], RT.stroke[0] + 0.3];
function pushIntoCheck(t: number, base: Camera): Camera {
  const k = ease.inCubic(range(t, PUSH[0], PUSH[1]));
  if (k <= 0) return base;
  const c = DONE_CHECK_PHONE(CH.push);
  const target = phonePoint(c.x / 3, c.y / 3, PHONE.thick + 0.4);
  const fwd = v3(Math.cos(base.pitch) * Math.sin(base.yaw), Math.sin(base.pitch), Math.cos(base.pitch) * Math.cos(base.yaw));
  const dist = Math.hypot(target.x - base.pos.x, target.y - base.pos.y, target.z - base.pos.z);
  const end = add(target, v3(-fwd.x * dist * 0.45, -fwd.y * dist * 0.45, -fwd.z * dist * 0.45));
  return { ...base, pos: lerp3(base.pos, end, k) };
}
export function camAt(t: number): Camera {
  if (t < RT.stroke[0] + 0.45) {
    let base = splineCam(Math.min(t, CH.push));
    if (t > TP.wake && t < CH.push) {
      // message bumps: a few px of push toward the glass
      const b = bump(t);
      const fwd = v3(Math.cos(base.pitch) * Math.sin(base.yaw), Math.sin(base.pitch), Math.cos(base.pitch) * Math.cos(base.yaw));
      base = { ...base, pos: add(base.pos, v3(fwd.x * 14 * b, fwd.y * 14 * b, fwd.z * 14 * b)) };
    }
    return pushIntoCheck(t, base);
  }
  const close = returnCloseCam();
  const wide = monCam(3100, 14, -260);
  const near = monCam(1700, 2, -20);
  if (t < RET.pull[0]) return close;
  if (t < RET.pull[1]) return mixCam(close, wide, ease.inOutCubic(range(t, RET.pull[0], RET.pull[1])));
  if (t < RET.approach[1]) return mixCam(wide, near, ease.inOutCubic(range(t, RET.approach[0], RET.approach[1])));
  return mixCam(near, fullFrameCam(), ease.inCubic(range(t, FLY[0], FLY[1])));
}
const checkAt = (t: number) => {
  const cam = camAt(Math.min(t, PUSH[1]));
  const c = DONE_CHECK_PHONE(CH.push);
  const p = project(cam, phonePoint(c.x / 3, c.y / 3, PHONE.thick + 0.4));
  return { x: p.x, y: p.y, size: (c.size / 3) * p.s };
};

// ------------------------------------------------------------------ the WhatsApp object: from the Send button to the phone
const SEND_PT = { x: TAP.send.x, y: TAP.send.y }; // where the real Send button was pressed (css)
function iconPath(u: number): V3 {
  const a = monScreenPoint(SEND_PT.x * D, SEND_PT.y * D, SW, SH, 60);
  const b = add(a, v3(60, -160, -460));
  const end = phonePoint(PHONE.w / 2, PHONE.h * 0.42, PHONE.thick + 4);
  const c = add(end, v3(-80, -950, -60));
  const q = (p0: number, p1: number, p2: number, p3: number) => (1 - u) ** 3 * p0 + 3 * (1 - u) ** 2 * u * p1 + 3 * (1 - u) * u * u * p2 + u ** 3 * p3;
  return v3(q(a.x, b.x, c.x, end.x), q(a.y, b.y, c.y, end.y), q(a.z, b.z, c.z, end.z));
}

// ------------------------------------------------------------------ kinetic words anchored in the world (parallax with the camera)
type WK = { at: number; out: number; sx: number; sy: number; z: number; size: number; lines: { words: { w: string; dt: number; color?: string }[]; size?: number; dy: number; weight?: number; track?: number }[] };
const WorldWords: React.FC<{ t: number; k: WK }> = ({ t, k }) => {
  if (t < k.at - 0.05 || t > k.out + 0.45) return null;
  const c0 = camAt(k.at);
  const anchor = unproject(c0, k.sx, k.sy, k.z);
  const d0 = toCam(c0, anchor).z;
  const worldSize = (k.size * d0) / c0.f;
  const c = camAt(t);
  const p = project(c, anchor);
  if (p.z < 60) return null;
  const sz = worldSize * p.s;
  // depth, but damped: the words keep a sense of parallax without leaving the frame
  const PAR = 0.22;
  const scale = Math.pow(sz / k.size, PAR);
  const dx = (p.x - k.sx) * PAR, dy = (p.y - k.sy) * PAR;
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: 1080, height: 1920, transformOrigin: `${k.sx}px ${k.sy}px`, transform: `translate(${dx}px, ${dy}px) scale(${scale})` }}>
      {k.lines.map((ln, i) => (
        <Line key={i} t={t} x={k.sx} y={k.sy + ln.dy} size={ln.size ?? k.size} weight={ln.weight} track={ln.track} align="center" out={k.out + i * 0.04} outDur={0.36} outMode="blur" words={ln.words.map((w, j) => ({ w: w.w, at: k.at + w.dt, color: w.color, gap: j === ln.words.length - 1 ? 0 : undefined }))} />
      ))}
    </div>
  );
};
const Y = BRAND.yellow;
function worldWords(vo: boolean): WK[] {
  const tl = V.vo.tell.kw as Record<string, number>;
  const s1 = vo
    ? [{ words: [{ w: "STARTS", dt: 0 }, { w: "WITH", dt: ST.words.with - ST.words.starts }, { w: "YOU.", dt: ST.words.you - ST.words.starts, color: Y }], dy: 0 }]
    : [
        { words: [{ w: "AT M1,", dt: -0.75 }], dy: -88, size: 62, weight: 600, track: 0.06 },
        { words: [{ w: "IT", dt: -0.15 }, { w: "STARTS", dt: 0 }, { w: "WITH", dt: ST.words.with - ST.words.starts }, { w: "YOU.", dt: ST.words.you - ST.words.starts, color: Y }], dy: 0, size: 80 },
      ];
  const one = (big: string, small: string | null, color = BRAND.white) =>
    vo ? [{ words: [{ w: big, dt: 0, color }], dy: 0 }] : [{ words: [{ w: small ?? "YOUR", dt: 0 }], dy: -84, size: 60, weight: 600, track: 0.08 }, { words: [{ w: big, dt: 0.08, color }], dy: 0 }];
  const TU = V.vo.turn.kw, SE = V.vo.send.kw;
  const out: WK[] = [
    { at: ST.words.starts, out: ST.out, sx: 540, sy: 330, z: 0, size: 100, lines: s1 },
    { at: tl.performance, out: tl.budget - 0.3, sx: 540, sy: 330, z: -320, size: 118, lines: one("PERFORMANCE.", null).map((l) => ({ ...l, words: l.words.map((w) => (w.w === "PERFORMANCE." && vo ? { ...w, w: "PERFORMANCE" } : w)) })) },
    { at: tl.budget, out: tl.style - 0.28, sx: 540, sy: 1250, z: -320, size: 150, lines: one(vo ? "BUDGET" : "BUDGET.", null, Y) },
    { at: tl.style, out: V.vo.tell.end + 0.1, sx: 540, sy: 330, z: -320, size: 118, lines: [{ words: [{ w: "YOUR", dt: 0 }, { w: vo ? "STYLE" : "STYLE.", dt: 0.12, color: Y }], dy: 0 }] },
    { at: TU.custom - 0.04, out: Q.attach[0] + 0.05, sx: 540, sy: 250, z: -360, size: 112, lines: [{ words: [{ w: "CUSTOM", dt: 0 }, { w: "QUOTE.", dt: TU.quote - TU.custom, color: Y }], dy: 0 }] },
    { at: SE.WhatsApp - 0.03, out: TP.wake - 0.05, sx: 540, sy: 270, z: -360, size: 104, lines: [{ words: [{ w: "WHATSAPP", dt: 0, color: WA.green }], dy: 0 }] },
  ];
  if (!vo) {
    out.push({ at: tl.play - 0.08, out: tl.performance - 0.3, sx: 540, sy: 300, z: -320, size: 112, lines: one("GAMES.", null, Y) });
  }
  return out;
}

const Scene: React.FC<{ vo: boolean }> = ({ vo }) => {
  const t = useCurrentFrame() / FPS;
  const cam = camAt(t);
  const fullScreen = t >= FLY[1];
  const introEnd = I.pullBack[1];

  const inWorld = t < RT.stroke[0] + 0.45 || (t >= RET.glow[0] - 0.02 && !fullScreen);
  const envO = t < introEnd ? ease.inOutCubic(range(t, I.materialize[0] + 0.05, I.materialize[1] + 0.15)) : t < RET.glow[0] ? 1 - range(t, RT.stroke[0] - 0.1, RT.stroke[0] + 0.3) : ease.inOutCubic(range(t, RET.pull[0] + 0.1, RET.pull[1]));
  const deviceO = t < RET.glow[0] ? 1 - range(t, RT.stroke[0] + 0.2, RT.stroke[0] + 0.42) : 1;
  // the monitor leaves the shot once the phone faces us (out of frame, behind the camera) — not drawn at all until the return
  const monO = t < RET.glow[0] ? 1 - range(t, CH.front[1] - 0.3, CH.front[1]) : 1;
  const look = {
    body: t < introEnd ? ease.inOutCubic(range(t, I.materialize[0], I.materialize[1])) : 1,
    stand: t < introEnd ? ease.inOutCubic(range(t, I.materialize[0] + 0.1, I.materialize[1] + 0.05)) : 1,
    rimRed: t < introEnd ? lerp(1, 0.5, range(t, I.materialize[0], I.materialize[1] + 0.4)) * range(t, I.expand[1] - 0.15, I.expand[1]) : 0.5,
    led: t < introEnd ? range(t, I.materialize[1] - 0.1, I.materialize[1] + 0.1) : 1,
    blur: 5 * range(t, TP.camera[0] + 0.3, TP.wake) * (t < RET.glow[0] ? 1 : 0),
  };
  const power = range(t, I.powerOn[0], I.powerOn[1]);
  const screenOn = t < introEnd ? power : 1;
  const tm = Math.min(t, Q.captureEnd);
  const screen = t < RET.glow[0] - 0.02 ? (
    <>
      <MonitorScreen8 t={tm} />
      {power < 1 && (
        <>
          <div style={{ position: "absolute", inset: 0, background: "#050506", clipPath: `inset(${50 * ease.outCubic(power)}% 0 ${50 * ease.outCubic(power)}% 0)`, opacity: power < 0.02 ? 0 : 1 }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: SH / 2 - 4 - (SH / 2) * ease.outCubic(power), height: 8 + SH * ease.outCubic(power), boxShadow: `0 0 0 3px rgba(255,255,255,${0.7 * (1 - power)})` }} />
        </>
      )}
    </>
  ) : (
    <Img src={staticFile(`cap/cta8/f${String(cIndex(t)).padStart(5, "0")}.png`)} style={{ position: "absolute", left: 0, top: 0, width: SW, height: SH }} />
  );

  // the quotation card on its own plane: it rises off the glass, then settles back before it condenses
  const cardLift = 46 * settle(range(t, Q.lift[0], Q.lift[0] + 0.5)) * (1 - ease.inOutCubic(range(t, Q.lift[1] - 0.55, Q.lift[1])));
  const cardOn = t >= Q.consolidate[0] - 0.05 && t < TP.lift[1] + 0.05 && t < RET.glow[0];
  const cardQuad = monScreenCorners().map((p) => project(cam, v3(p.x, p.y, -0.8 - cardLift)));

  // chosen pills lift 5–15 px off the glass, then lock back
  const lifts = LIFTS.map(({ key, tap }) => {
    const up = settle(range(t, tap.press - 0.02, tap.press + 0.12));
    const down = ease.inOutCubic(range(t, tap.release + 0.18, tap.release + 0.42));
    const L = 13 * up * (1 - down);
    if (L < 0.2 || t > Q.consolidate[0]) return null;
    const r = pillRect(key, tap.release + 0.05);
    const idx = Math.round((tm - HM.captureStart) * FPS);
    const corners = [v3(r.x, r.y, 0), v3(r.x + r.w, r.y, 0), v3(r.x + r.w, r.y + r.h, 0), v3(r.x, r.y + r.h, 0)].map((q) => monScreenPoint(q.x * D, q.y * D, SW, SH, L));
    const shadow = [v3(r.x, r.y, 0), v3(r.x + r.w, r.y, 0), v3(r.x + r.w, r.y + r.h, 0), v3(r.x, r.y + r.h, 0)].map((q) => monScreenPoint((q.x + 4) * D, (q.y + 6) * D, SW, SH, 0.5));
    return { key, r, idx: Math.max(0, idx), c: corners.map((p) => project(cam, p)), s: shadow.map((p) => project(cam, p)), L };
  });

  // phone
  const wake = ease.outCubic(range(t, TP.wake, TP.wake + 0.25));
  const phoneBlur = t < TP.camera[0] ? 3 : t >= RET.glow[0] ? 3 : 0;

  // the WhatsApp object
  const grow = settle(range(t, TP.lift[0], TP.lift[1]));
  const iu = ease.inOutCubic(range(t, TP.icon[0], TP.icon[1]));
  const iconOn = t >= TP.lift[0] && t < TP.icon[1] + 0.12;
  const ip = project(cam, t < TP.icon[0] ? monScreenPoint(SEND_PT.x * D, SEND_PT.y * D, SW, SH, 60 * grow) : iconPath(iu));
  const trail = [0.04, 0.08, 0.12].map((d) => project(cam, iconPath(Math.max(0, iu - d))));
  const iconR = 35 * ip.s * grow * (1 + 0.15 * Math.sin(Math.PI * iu)) * (1 - 0.4 * range(t, TP.icon[1] - 0.05, TP.icon[1] + 0.1));
  const impact = range(t, TP.wake, TP.wake + 0.45);

  // ORDER CONFIRMED. — the big moment, then the check becomes the route
  const oc = CH.orderText;

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {inWorld && (
        <>
          <Environment cam={cam} o={envO} rim={t < introEnd ? range(t, I.materialize[0], I.materialize[1] + 0.3) : 1} />
          {deviceO > 0.001 && t >= I.materialize[0] - 0.05 && (
            <AbsoluteFill style={{ opacity: deviceO }}>
              {monO > 0.001 && (
                <AbsoluteFill style={{ opacity: monO }}>
                  <Monitor cam={cam} look={look} screen={screen} screenW={SW} screenH={SH} screenOn={screenOn} />
                  {cardOn && (
                    <div style={{ position: "absolute", left: 0, top: 0, width: SW, height: SH, transformOrigin: "0 0", transform: homography(SW, SH, cardQuad[0], cardQuad[1], cardQuad[2], cardQuad[3]), pointerEvents: "none" }}>
                      <MonitorScreen8 t={tm} layer="card" />
                    </div>
                  )}
                  {lifts.map((l) =>
                    l ? (
                      <React.Fragment key={l.key}>
                        <div style={{ position: "absolute", left: 0, top: 0, width: l.r.w * D, height: l.r.h * D, transformOrigin: "0 0", transform: homography(l.r.w * D, l.r.h * D, l.s[0], l.s[1], l.s[2], l.s[3]), borderRadius: (l.r.h * D) / 2, background: `rgba(0,0,0,${0.05 * l.L})`, filter: "blur(6px)" }} />
                        <div style={{ position: "absolute", left: 0, top: 0, width: l.r.w * D, height: l.r.h * D, transformOrigin: "0 0", transform: homography(l.r.w * D, l.r.h * D, l.c[0], l.c[1], l.c[2], l.c[3]), borderRadius: (l.r.h * D) / 2, overflow: "hidden", boxShadow: `0 0 ${l.L * 2}px rgba(249,194,4,${0.04 * l.L})` }}>
                          <Img src={frameSrc(l.idx)} style={{ position: "absolute", left: -l.r.x * D, top: -l.r.y * D, width: SW, height: SH }} />
                        </div>
                      </React.Fragment>
                    ) : null
                  )}
                </AbsoluteFill>
              )}
              <Phone cam={cam} o={t < introEnd ? envO : 1} wake={wake} screenW={PW} screenH={PH} blur={phoneBlur} screen={<PhoneChat t={t} />} />
            </AbsoluteFill>
          )}
          {iconOn && (
            <>
              {t >= TP.icon[0] &&
                trail.map((p, i) => (
                  <div key={i} style={{ position: "absolute", left: p.x - iconR * (0.8 - i * 0.2), top: p.y - iconR * (0.8 - i * 0.2), width: 2 * iconR * (0.8 - i * 0.2), height: 2 * iconR * (0.8 - i * 0.2), borderRadius: "50%", background: "rgba(37,211,102,0.25)", filter: "blur(6px)", opacity: 0.6 - i * 0.18 }} />
                ))}
              <div style={{ position: "absolute", left: ip.x - iconR * 2.2, top: ip.y - iconR * 2.2, width: iconR * 4.4, height: iconR * 4.4, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(37,211,102,0.45), rgba(37,211,102,0))" }} />
              <div style={{ position: "absolute", left: ip.x - iconR, top: ip.y - iconR, width: iconR * 2, height: iconR * 2, borderRadius: "50%", background: WA.green, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 ${iconR * 0.3}px ${iconR}px rgba(0,0,0,0.5)` }}>
                <svg viewBox="0 0 32 32" width={iconR} height={iconR}><path d={WA_GLYPH} fill="#000" /></svg>
              </div>
              {/* the quotation rides with it */}
              <svg viewBox="0 0 20 24" width={iconR * 0.62} height={iconR * 0.74} style={{ position: "absolute", left: ip.x + iconR * 0.42, top: ip.y - iconR * 1.05, opacity: range(t, TP.lift[0] + 0.15, TP.lift[1]), filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.6))" }}>
                <path d="M2 1h11l5 5v17H2z" fill="#f5f5f7" />
                <path d="M2 14h16v9H2z" fill="#e2483d" />
              </svg>
            </>
          )}
          {impact > 0 && impact < 1 && (
            <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0 }}>
              <path
                d={"M" + Array.from({ length: 48 }, (_, i) => {
                  const a = (i / 48) * Math.PI * 2;
                  const r = 30 + 150 * ease.outCubic(impact);
                  const p = project(cam, phonePoint(PHONE.w / 2 + Math.cos(a) * r, PHONE.h * 0.42 + Math.sin(a) * r, PHONE.thick + 0.6));
                  return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
                }).join(" L") + " Z"}
                fill="none"
                stroke={`rgba(37,211,102,${0.75 * (1 - impact)})`}
                strokeWidth={3}
              />
            </svg>
          )}
          {t < I.materialize[1] + 0.25 && <Intro8 t={t} cam={E0} />}
          <IntroQuestion t={t} />
          {/* kinetic words in the world */}
          {worldWords(vo).map((k, i) => (
            <WorldWords key={i} t={t} k={k} />
          ))}
          {/* the conversation's key moments: PRICE ✓ / AVAILABILITY ✓ (both versions) */}
          <Line t={t} x={540} y={64} size={84} align="center" out={CH.collapse[1] + 0.45} outDur={0.25} outMode="blur" words={[{ w: "PRICE", at: CH.checks[0] - 0.05 }, { w: "✓", at: CH.checks[0], color: WA.green }]} />
          <Line t={t} x={540} y={166} size={84} align="center" out={CH.collapse[1] + 0.5} outDur={0.25} outMode="blur" words={[{ w: "AVAILABILITY", at: CH.checks[2] - 0.15 }, { w: "✓", at: CH.checks[2], color: WA.green, gap: 0 }]} />
          <Line t={t} x={540} y={230} size={150} align="center" out={RT.stroke[0] + 0.24} outDur={0.25} outMode="scale" words={[{ w: "ORDER", at: oc[0], gap: 0 }]} />
          <Line t={t} x={540} y={392} size={150} align="center" out={RT.stroke[0] + 0.27} outDur={0.25} outMode="scale" words={[{ w: "CONFIRMED.", at: oc[0] + 0.22, color: Y, gap: 0 }]} />
        </>
      )}
      <Route8 t={t} check={checkAt} />
      <Gallery8 t={t} vo={vo} />
      <PC8 t={t} vo={vo} />
      {t >= GA.start && t < GA.textOut + 0.5 && <GalleryText t={t} vo={vo} />}
      {!vo && (
        <>
          <Line t={t} x={86} y={250} size={92} out={PT.closer[0]} outDur={0.3} outMode="up" words={[{ w: "M1", at: PT.rest - 1.1, color: BRAND.red }, { w: "TAKES", at: PT.rest - 0.95 }, { w: "CARE", at: PT.rest - 0.8, gap: 0 }]} />
          <Line t={t} x={86} y={352} size={92} out={PT.closer[0] + 0.04} outDur={0.3} outMode="up" words={[{ w: "OF", at: PT.rest - 0.5 }, { w: "THE", at: PT.rest - 0.38 }, { w: "REST.", at: PT.rest - 0.2, color: Y, gap: 0 }]} />
        </>
      )}
      {fullScreen && <End8 t={t} from={FLY[1]} vo={vo} />}
    </AbsoluteFill>
  );
};

const samplesAt = (frame: number) => {
  const t = frame / FPS;
  let n = Math.max(introSamples(t), routeSamples8(t), gallerySamples(t), pcSamples8(t), endSamples8(t));
  if (t >= TP.camera[0] && t < TP.wake + 0.2) n = Math.max(n, 6);
  if (t >= PUSH[0] && t < RT.stroke[0] + 0.45) n = 3; // the dive: keep it light (huge phone layer)
  if (t >= FLY[0] + 0.3 && t < FLY[1]) n = Math.max(n, 6);
  return n;
};

export const Final8: React.FC<{ vo?: boolean; audio?: boolean }> = ({ vo = true, audio = true }) => (
  <AbsoluteFill>
    <Fonts />
    <MotionBlur samplesAt={samplesAt} shutter={0.5}>
      <Scene vo={vo} />
    </MotionBlur>
    {audio && <Audio src={staticFile(vo ? "audio/final8_vo.wav" : "audio/final8_novo.wav")} />}
  </AbsoluteFill>
);
export { clamp01 };
