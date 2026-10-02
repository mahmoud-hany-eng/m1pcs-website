import React from "react";
import { AbsoluteFill, Audio, Img, staticFile, useCurrentFrame } from "remotion";
import { MotionBlur } from "../lib/MotionBlur";
import { Fonts } from "../final/fonts";
import { bezier, clamp01, ease, lerp, range } from "../lib/ease";
import { Camera, MON, PHONE, V3, add, fullFrameCam, phonePoint, project, toCam, v3 } from "./world";
import { CamKey, keyCam, lookAt, mixCam, monCam, phoneCam } from "./cams";
import { Environment, Monitor, Phone, monScreenPoint } from "./Devices";
import { Intro7, introSamples } from "./Intro7";
import { FAB_CSS, MonitorScreen } from "./MonitorScreen";
import { DONE_CHECK_PHONE, PH, PW, PhoneChat, WA, WA_GLYPH } from "./PhoneChat";
import { Route7, routeSamples7 } from "./Route7";
import { HERO, PC7, heroPlace, pcSamples7 } from "./PC7";
import { End7, endSamples } from "./End7";
import { CLOG, D, DURATION, FPS, SH, SW, TAP, V, cIndex } from "./time";

/**
 * M1 Gaming PCs — "Build Yours", v7: the device world (≈43 s).
 * One camera, one world: the logo unfolds into a monitor showing the real
 * site; the build is configured on it; the WhatsApp icon physically crosses
 * the desk to the phone; the confirmation launches the U.S. → Qatar route;
 * Qatar's light becomes a real PC's fan; the PC hands back into the site on
 * the monitor; we fly through the glass into the full-frame site, and the
 * site becomes the M1 logo.
 */
export { DURATION };

const I = V.intro, HM = V.home, Q = V.quote, TP = V.toPhone, CH = V.chat, RT = V.route, RET = V.ret, FLY = V.fly;
const settle = ease.settle;
const glideE = bezier(0.45, 0, 0.1, 1);

// ------------------------------------------------------------------ the return: align the camera so the site's PC lands on the hero
const CTA_IMG = CLOG[0].meta.img; // the photo's box on the site (css px)
function returnCloseCam(): Camera {
  const hp = heroPlace(RET.glow[0]);
  const imgPxH = HERO.h * hp.pps; // the hero image's full box height on screen
  const center = monScreenPoint((CTA_IMG.x + CTA_IMG.w / 2) * D, (CTA_IMG.y + CTA_IMG.h / 2) * D, SW, SH);
  const worldH = (CTA_IMG.h * D * MON.screen.h) / SH;
  const f = 1500;
  const d = (f * worldH) / imgPxH;
  // the hero's image-box centre on screen
  const cx = hp.x + (HERO.w / 2 - hp.sx) * hp.pps, cy = hp.y + (HERO.h / 2 - hp.sy) * hp.pps;
  return { pos: v3(center.x - ((cx - 540) * d) / f, center.y - ((cy - 960) * d) / f, -d), yaw: 0, pitch: 0, f };
}

// ------------------------------------------------------------------ camera path
const E0 = monCam(2250, 14, -100);
/** the camera framing a region of the site (css px) on the monitor's glass */
const onScreen = (cssX: number, cssY: number, d: number, yawDeg: number, dy = 0) => monCam(d, yawDeg, dy, monScreenPoint(cssX * D, cssY * D, SW, SH));
const KEYS: CamKey[] = [
  { t: 0, cam: E0 },
  { t: I.pullBack[0], cam: E0 },
  { t: I.pullBack[1], cam: monCam(3050, 20, -260), e: settle },
  { t: HM.approach[0], cam: monCam(3000, 19, -250) },
  { t: HM.approach[1], cam: monCam(1800, 7, -40), e: ease.inOutCubic },
  { t: HM.press - 0.05, cam: onScreen(300, 820, 1400, 3, -10), e: ease.inOutCubic },
  { t: Q.settle[1], cam: onScreen(330, 560, 1380, 1, -10), e: settle },
  { t: Q.scroll1[0] + 0.2, cam: onScreen(340, 520, 1420, 0, -10), e: ease.inOutCubic },
  { t: Q.gaming.path[0], cam: onScreen(330, 360, 1200, -1, 0), e: ease.inOutCubic },
  { t: TAP.gaming.release + 0.15, cam: onScreen(320, 330, 1080, -1.5, 0), e: ease.inOutCubic }, // first choice: push in
  { t: TAP.res.release + 0.15, cam: onScreen(330, 560, 1100, 3.5, 0), e: ease.inOutCubic }, // second: slide 3–4° right
  { t: TAP.fps.release + 0.15, cam: onScreen(320, 640, 1030, 2.5, 10), e: ease.inOutCubic }, // third: push
  { t: TAP.colour.release + 0.2, cam: onScreen(330, 640, 1150, 0, 0), e: ease.inOutCubic }, // fourth: centre again
  { t: Q.card + 0.1, cam: onScreen(360, 560, 1420, 0, 0), e: ease.inOutCubic },
  { t: Q.price + 0.2, cam: onScreen(360, 600, 1360, -1, 0), e: ease.inOutCubic },
  { t: TP.camera[0], cam: onScreen(380, 660, 1380, 0.5, 0), e: ease.inOutCubic },
  // pull away from the monitor; the phone comes into view beside it; follow the icon down to it
  { t: TP.camera[0] + 0.55, cam: lookAt(v3(520, -1500, -2600), v3(330, -560, -380)), e: ease.inOutCubic },
  { t: TP.wake + 0.12, cam: phoneCam(1100, 62), e: ease.inOutCubic },
  { t: CH.attach + 0.5, cam: phoneCam(780, 73), e: settle },
  { t: CH.push, cam: phoneCam(745, 75), e: (x: number) => x },
];
function pushIntoCheck(t: number, base: Camera): Camera {
  // the camera dives straight at the confirmation check on the phone
  const k = ease.inCubic(range(t, CH.push, RT.stroke[0]));
  if (k <= 0) return base;
  const c = DONE_CHECK_PHONE(CH.push);
  const target = phonePoint(c.x / 3, c.y / 3, PHONE.thick + 0.4);
  const aim = lookAt(base.pos, target, base.f);
  const dir = { x: target.x - base.pos.x, y: target.y - base.pos.y, z: target.z - base.pos.z };
  const pos = add(base.pos, { x: dir.x * 0.88 * k, y: dir.y * 0.88 * k, z: dir.z * 0.88 * k });
  return { ...mixCam(base, aim, Math.min(1, k * 2)), pos };
}
function camAt(t: number): Camera {
  if (t < RT.stroke[0] + 0.05) return pushIntoCheck(t, keyCam(KEYS, Math.min(t, CH.push)));
  // the return
  const close = returnCloseCam();
  const wide = monCam(3100, 14, -260);
  const near = monCam(1700, 2, -20);
  if (t < RET.pull[0]) return close;
  if (t < RET.pull[1]) return mixCam(close, wide, ease.inOutCubic(range(t, RET.pull[0], RET.pull[1])));
  if (t < RET.approach[1]) return mixCam(wide, near, ease.inOutCubic(range(t, RET.approach[0], RET.approach[1])));
  // into the glass: accelerate, land exactly on the full-frame camera
  return mixCam(near, fullFrameCam(), ease.inCubic(range(t, FLY[0], FLY[1])));
}

/** the projected confirmation check (the route is born from it) */
const checkAt = (t: number) => {
  const cam = camAt(Math.min(t, RT.stroke[0] + 0.05));
  const c = DONE_CHECK_PHONE(CH.push);
  const p = project(cam, phonePoint(c.x / 3, c.y / 3, PHONE.thick + 0.4));
  return { x: p.x, y: p.y, size: (c.size / 3) * p.s };
};

// ------------------------------------------------------------------ the WhatsApp icon crossing the desk
function iconPath(u: number): V3 {
  const a = monScreenPoint(FAB_CSS.x * D, FAB_CSS.y * D, SW, SH);
  const b = add(a, v3(-40, -120, -420));
  const end = phonePoint(PHONE.w / 2, PHONE.h * 0.42, PHONE.thick + 4);
  const c = add(end, v3(-60, -900, -60));
  const q = (p0: number, p1: number, p2: number, p3: number) => (1 - u) ** 3 * p0 + 3 * (1 - u) ** 2 * u * p1 + 3 * (1 - u) * u * u * p2 + u ** 3 * p3;
  return v3(q(a.x, b.x, c.x, end.x), q(a.y, b.y, c.y, end.y), q(a.z, b.z, c.z, end.z));
}

const Scene: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  const cam = camAt(t);
  const fullScreen = t >= FLY[1];

  // world visibility by section
  const inWorld = t < RT.stroke[0] + 0.35 || (t >= RET.glow[0] - 0.02 && !fullScreen);
  const envO = t < 4 ? ease.inOutCubic(range(t, I.materialize[0] + 0.05, I.materialize[1] + 0.15)) : t < RET.glow[0] ? 1 - range(t, RT.stroke[0] - 0.1, RT.stroke[0] + 0.3) : ease.inOutCubic(range(t, RET.pull[0] + 0.1, RET.pull[1]));
  const deviceO = t < RET.glow[0] ? 1 - range(t, RT.stroke[0], RT.stroke[0] + 0.3) : 1;

  // monitor
  const look = {
    body: t < 4 ? ease.inOutCubic(range(t, I.materialize[0], I.materialize[1])) : 1,
    stand: t < 4 ? ease.inOutCubic(range(t, I.materialize[0] + 0.1, I.materialize[1] + 0.05)) : 1,
    rimRed: t < 4 ? lerp(1, 0.5, range(t, I.materialize[0], I.materialize[1] + 0.4)) * range(t, I.expand[1] - 0.15, I.expand[1]) : 0.5,
    led: t < 4 ? range(t, I.materialize[1] - 0.1, I.materialize[1] + 0.1) : 1,
    blur: 5 * range(t, TP.camera[0] + 0.3, TP.wake) * (t < RET.glow[0] ? 1 : 0),
  };
  const power = range(t, I.powerOn[0], I.powerOn[1]);
  const screenOn = t < 4 ? power : 1;
  const screen = t < RET.glow[0] - 0.02 ? (
    <>
      <MonitorScreen t={Math.min(t, Q.captureEnd)} />
      {power < 1 && (
        // power-on: a thin line of light opens into the picture
        <>
          <div style={{ position: "absolute", inset: 0, background: "#050506", clipPath: `inset(${50 * ease.outCubic(power)}% 0 ${50 * ease.outCubic(power)}% 0)`, opacity: power < 0.02 ? 0 : 1 }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: SH / 2 - 4 - (SH / 2) * ease.outCubic(power), height: 8 + SH * ease.outCubic(power), background: "rgba(255,255,255,0.0)", boxShadow: `0 0 0 3px rgba(255,255,255,${0.7 * (1 - power)})` }} />
        </>
      )}
    </>
  ) : (
    <Img src={staticFile(`cap/cta7/f${String(cIndex(t)).padStart(5, "0")}.png`)} style={{ position: "absolute", left: 0, top: 0, width: SW, height: SH }} />
  );

  // phone
  const wake = ease.outCubic(range(t, TP.wake, TP.wake + 0.25));
  const phoneBlur = t < TP.camera[0] ? 3 : t >= RET.glow[0] ? 3 : 0;

  // icon
  const iu = ease.inOutCubic(range(t, TP.icon[0], TP.icon[1]));
  const iconOn = t >= TP.icon[0] && t < TP.icon[1] + 0.12;
  const ip = project(cam, iconPath(iu));
  const trail = [0.04, 0.08, 0.12].map((d) => project(cam, iconPath(Math.max(0, iu - d))));
  const iconR = 35 * ip.s * (1 + 0.15 * Math.sin(Math.PI * iu)) * (1 - 0.4 * range(t, TP.icon[1] - 0.05, TP.icon[1] + 0.1));
  const impact = range(t, TP.wake, TP.wake + 0.45);

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {inWorld && (
        <>
          <Environment cam={cam} o={envO} rim={t < 4 ? range(t, I.materialize[0], I.materialize[1] + 0.3) : 1} />
          {deviceO > 0.001 && (t >= I.materialize[0] - 0.05) && (
            <AbsoluteFill style={{ opacity: deviceO }}>
              <Monitor cam={cam} look={look} screen={screen} screenW={SW} screenH={SH} screenOn={screenOn} />
              <Phone cam={cam} o={t < 4 ? envO : 1} wake={wake} screenW={PW} screenH={PH} blur={phoneBlur} screen={<PhoneChat t={t} />} />
            </AbsoluteFill>
          )}
          {/* the green object crossing from the monitor to the phone */}
          {iconOn && (
            <>
              {trail.map((p, i) => (
                <div key={i} style={{ position: "absolute", left: p.x - iconR * (0.8 - i * 0.2), top: p.y - iconR * (0.8 - i * 0.2), width: 2 * iconR * (0.8 - i * 0.2), height: 2 * iconR * (0.8 - i * 0.2), borderRadius: "50%", background: "rgba(37,211,102,0.25)", filter: "blur(6px)", opacity: 0.6 - i * 0.18 }} />
              ))}
              <div style={{ position: "absolute", left: ip.x - iconR * 2.2, top: ip.y - iconR * 2.2, width: iconR * 4.4, height: iconR * 4.4, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(37,211,102,0.45), rgba(37,211,102,0))" }} />
              <div style={{ position: "absolute", left: ip.x - iconR, top: ip.y - iconR, width: iconR * 2, height: iconR * 2, borderRadius: "50%", background: WA.green, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 ${iconR * 0.3}px ${iconR}px rgba(0,0,0,0.5)` }}>
                <svg viewBox="0 0 32 32" width={iconR} height={iconR}><path d={WA_GLYPH} fill="#000" /></svg>
              </div>
            </>
          )}
          {impact > 0 && impact < 1 && (
            // the landing ripple, lying on the phone's glass
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
          {t < 4 && <Intro7 t={t} cam={E0} />}
        </>
      )}
      {!inWorld && !fullScreen && null}
      <Route7 t={t} check={checkAt} />
      <PC7 t={t} />
      {fullScreen && <End7 t={t} from={FLY[1]} />}
    </AbsoluteFill>
  );
};

const samplesAt = (frame: number) => {
  const t = frame / FPS;
  let n = Math.max(introSamples(t), routeSamples7(t), pcSamples7(t), endSamples(t));
  // fast camera moves in the world
  if (t >= TP.camera[0] && t < TP.wake + 0.2) n = Math.max(n, 6);
  if (t >= CH.push && t < RT.stroke[0] + 0.05) n = Math.max(n, 8);
  if (t >= FLY[0] + 0.3 && t < FLY[1]) n = Math.max(n, 6);
  return n;
};

export const Final7: React.FC<{ audio?: boolean }> = ({ audio = true }) => (
  <AbsoluteFill>
    <Fonts />
    <MotionBlur samplesAt={samplesAt} shutter={0.5}>
      <Scene />
    </MotionBlur>
    {audio && <Audio src={staticFile("audio/v7.wav")} />}
  </AbsoluteFill>
);
export { clamp01, toCam };
