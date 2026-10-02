import React from "react";
import { AbsoluteFill } from "remotion";
import { Camera, MON, P2, PHONE, V3, homography, monScreenCorners, phonePoint, polyPath, project, toCam, v3 } from "./world";

/**
 * The physical set: a dark desk, a pivoted (portrait) monitor on a slim stand,
 * a phone resting beside it. Every face is projected through the same
 * camera; screens carry real UI through an exact homography. Kept plain on
 * purpose — graphite, no logos, soft light — so the website stays the hero.
 */

const NEAR = 20;
/** project a planar 3D polygon, clipped against the near plane */
export function projectPoly(cam: Camera, pts: V3[]): P2[] {
  const cs = pts.map((p) => toCam(cam, p));
  const out: V3[] = [];
  for (let i = 0; i < cs.length; i++) {
    const a = cs[i], b = cs[(i + 1) % cs.length];
    const ia = a.z >= NEAR, ib = b.z >= NEAR;
    if (ia) out.push(a);
    if (ia !== ib) {
      const u = (NEAR - a.z) / (b.z - a.z);
      out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: NEAR });
    }
  }
  return out.map((q) => ({ x: 540 + (q.x * cam.f) / q.z, y: 960 + (q.y * cam.f) / q.z }));
}
const roundedRect = (cx: number, cy: number, w: number, h: number, r: number, map: (x: number, y: number) => V3, seg = 6): V3[] => {
  const pts: V3[] = [];
  const corner = (x: number, y: number, a0: number) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (Math.PI / 2) * (i / seg);
      pts.push(map(x + r * Math.cos(a), y + r * Math.sin(a)));
    }
  };
  corner(cx + w / 2 - r, cy - h / 2 + r, -Math.PI / 2);
  corner(cx + w / 2 - r, cy + h / 2 - r, 0);
  corner(cx - w / 2 + r, cy + h / 2 - r, Math.PI / 2);
  corner(cx - w / 2 + r, cy - h / 2 + r, Math.PI);
  return pts;
};

// ------------------------------------------------------------------ environment
export const Environment: React.FC<{ cam: Camera; o: number; rim?: number }> = ({ cam, o, rim = 1 }) => {
  if (o <= 0.001) return null;
  const desk = projectPoly(cam, [v3(-3200, 0, -2600), v3(3200, 0, -2600), v3(3200, 0, 5200), v3(-3200, 0, 5200)]);
  const back = project(cam, v3(0, -1150, 600));
  const pool = projectPoly(cam, Array.from({ length: 40 }, (_, i) => {
    const a = (i / 40) * Math.PI * 2;
    return v3(Math.cos(a) * 1200, 0, 250 + Math.sin(a) * 700);
  }));
  const horizon = project(cam, v3(0, 0, 5200));
  return (
    <AbsoluteFill style={{ opacity: o }}>
      {/* depth: black, with the M1 red rim light behind the monitor */}
      <AbsoluteFill style={{ background: "#030304" }} />
      <div style={{ position: "absolute", left: back.x - 1100 * back.s, top: back.y - 1300 * back.s, width: 2200 * back.s, height: 2600 * back.s, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(200,36,24,0.34), rgba(150,24,18,0.12) 55%, rgba(0,0,0,0) 100%)", opacity: rim }} />
      <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0 }}>
        <defs>
          <linearGradient id="deskg" gradientUnits="userSpaceOnUse" x1={0} y1={horizon.y} x2={0} y2={1920}>
            <stop offset="0" stopColor="#060607" />
            <stop offset="1" stopColor="#101012" />
          </linearGradient>
          <radialGradient id="poolg">
            <stop offset="0" stopColor="rgba(120,120,135,0.16)" />
            <stop offset="0.6" stopColor="rgba(200,40,28,0.06)" />
            <stop offset="1" stopColor="rgba(0,0,0,0)" />
          </radialGradient>
        </defs>
        {desk.length > 2 && <path d={polyPath(desk)} fill="url(#deskg)" />}
        {pool.length > 2 && <path d={polyPath(pool)} fill="url(#poolg)" />}
        {/* a faint yellow accent line along the desk's front edge, far away */}
      </svg>
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ monitor
export type MonitorLook = {
  body: number; // 0..1 graphite body materialised
  stand: number; // 0..1 stand grown down to the desk
  rimRed: number; // red edge light on the bezel
  led: number; // the small yellow power light
  blur?: number; // physical-world depth of field (body only)
};
export const Monitor: React.FC<{ cam: Camera; look: MonitorLook; screen: React.ReactNode; screenW: number; screenH: number; screenOn: number }> = ({ cam, look, screen, screenW, screenH, screenOn }) => {
  const { w, h } = MON.screen;
  const b = MON.bezel, D = MON.depth, c = MON.center;
  const xL = c.x - w / 2 - b, xR = c.x + w / 2 + b, yT = c.y - h / 2 - b, yB = c.y + h / 2 + b;
  const P = (pts: V3[]) => projectPoly(cam, pts);
  const front = P(roundedRect(c.x, c.y, w + 2 * b, h + 2 * b, 14, (x, y) => v3(x, y, 0)));
  const backFace = P(roundedRect(c.x, c.y, w + 2 * b - 30, h + 2 * b - 30, 30, (x, y) => v3(x, y, D)));
  const faces: { d: string; fill: string }[] = [];
  const side = (pts: V3[], fill: string) => faces.push({ d: polyPath(P(pts)), fill });
  if (cam.pos.x < xL) side([v3(xL, yT, 0), v3(xL, yB, 0), v3(xL + 15, yB - 15, D), v3(xL + 15, yT + 15, D)], "#0d0d10");
  if (cam.pos.x > xR) side([v3(xR, yT, 0), v3(xR, yB, 0), v3(xR - 15, yB - 15, D), v3(xR - 15, yT + 15, D)], "#0d0d10");
  if (cam.pos.y < yT) side([v3(xL, yT, 0), v3(xR, yT, 0), v3(xR - 15, yT + 15, D), v3(xL + 15, yT + 15, D)], "#16161a");
  if (cam.pos.y > yB) side([v3(xL, yB, 0), v3(xR, yB, 0), v3(xR - 15, yB - 15, D), v3(xL + 15, yB - 15, D)], "#09090b");
  // stand: neck from behind the monitor down to a low base plate
  const neckBottom = 0;
  const neckTop = yB - 40 + (1 - look.stand) * (neckBottom - yB);
  const nz0 = D + 40, nz1 = D + 80, nw = MON.neck.w / 2;
  const neckFront = P([v3(-nw, neckTop, nz0), v3(nw, neckTop, nz0), v3(nw, neckBottom - 14, nz0 - 30), v3(-nw, neckBottom - 14, nz0 - 30)]);
  const neckSide = P([v3(cam.pos.x < 0 ? -nw : nw, neckTop, nz0), v3(cam.pos.x < 0 ? -nw : nw, neckTop, nz1), v3(cam.pos.x < 0 ? -nw : nw, neckBottom - 14, nz1 - 30), v3(cam.pos.x < 0 ? -nw : nw, neckBottom - 14, nz0 - 30)]);
  const baseTop = P(roundedRect(0, 60, MON.base.w, MON.base.d, 60, (x, z) => v3(x, -14, z)));
  const baseBot = P(roundedRect(0, 60, MON.base.w, MON.base.d, 60, (x, z) => v3(x, 0, z)));
  const scr = monScreenCorners().map((p) => project(cam, p));
  const glass = P([v3(c.x - w / 2, c.y - h / 2, -0.5), v3(c.x + w / 2, c.y - h / 2, -0.5), v3(c.x + w / 2, c.y + h / 2, -0.5), v3(c.x - w / 2, c.y + h / 2, -0.5)]);
  const led = project(cam, v3(c.x, yB - b / 2, -0.6));
  const bodyO = look.body;
  const blur = look.blur ?? 0;
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ filter: blur > 0.3 ? `blur(${blur.toFixed(1)}px)` : undefined }}>
        <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          <defs>
            <linearGradient id="bezelg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#1b1b20" />
              <stop offset="1" stopColor="#0e0e11" />
            </linearGradient>
          </defs>
          <g opacity={bodyO}>
            {baseBot.length > 2 && look.stand > 0 && <path d={polyPath(baseBot)} fill="#060607" opacity={look.stand} />}
            {baseTop.length > 2 && look.stand > 0 && <path d={polyPath(baseTop)} fill="#141418" opacity={look.stand} />}
            {look.stand > 0 && <path d={polyPath(neckSide)} fill="#0a0a0c" />}
            {look.stand > 0 && <path d={polyPath(neckFront)} fill="#131316" />}
            {backFace.length > 2 && <path d={polyPath(backFace)} fill="#0b0b0d" />}
            {faces.map((f, i) => (
              <path key={i} d={f.d} fill={f.fill} />
            ))}
            {front.length > 2 && <path d={polyPath(front)} fill="url(#bezelg)" />}
          </g>
          {/* M1 red edge light on the bezel (from the backlight) */}
          {front.length > 2 && look.rimRed > 0.001 && <path d={polyPath(front)} fill="none" stroke="rgba(231,60,40,0.9)" strokeWidth={2.2} opacity={look.rimRed} />}
        </svg>
      </AbsoluteFill>
      {/* the screen: real UI, mapped exactly onto the glass */}
      <div style={{ position: "absolute", left: 0, top: 0, width: screenW, height: screenH, transformOrigin: "0 0", transform: homography(screenW, screenH, scr[0], scr[1], scr[2], scr[3]), background: "#050506", overflow: "hidden", filter: blur > 0.3 ? `blur(${(blur * 0.7).toFixed(1)}px)` : undefined }}>
        <div style={{ position: "absolute", inset: 0, opacity: screenOn }}>{screen}</div>
      </div>
      {/* the glass: one faint diagonal sheen, nothing that hurts legibility */}
      {glass.length > 2 && (
        <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}>
          <defs>
            <linearGradient id="sheen" gradientUnits="userSpaceOnUse" x1={glass[0].x} y1={glass[0].y} x2={glass[2].x} y2={glass[2].y}>
              <stop offset="0" stopColor="rgba(255,255,255,0.05)" />
              <stop offset="0.35" stopColor="rgba(255,255,255,0.0)" />
              <stop offset="1" stopColor="rgba(255,255,255,0.0)" />
            </linearGradient>
          </defs>
          <path d={polyPath(glass)} fill="url(#sheen)" opacity={bodyO} />
          {look.led > 0 && <circle cx={led.x} cy={led.y} r={Math.max(1.5, 3.2 * led.s)} fill="#f9c204" opacity={look.led} />}
        </svg>
      )}
    </AbsoluteFill>
  );
};

// ------------------------------------------------------------------ phone
export const Phone: React.FC<{ cam: Camera; o: number; screen: React.ReactNode; screenW: number; screenH: number; wake: number; blur?: number }> = ({ cam, o, screen, screenW, screenH, wake, blur = 0 }) => {
  if (o <= 0.001) return null;
  const { w, h, bezel, thick } = PHONE;
  const top = roundedRect(w / 2, h / 2, w + 2 * bezel, h + 2 * bezel, 58, (u, v) => phonePoint(u, v, thick), 8);
  const bot = roundedRect(w / 2, h / 2, w + 2 * bezel, h + 2 * bezel, 58, (u, v) => phonePoint(u, v, 0), 8);
  const T = projectPoly(cam, top), Bt = projectPoly(cam, bot);
  // side walls, far to near
  const walls = top.map((p, i) => {
    const j = (i + 1) % top.length;
    const quad = [top[i], top[j], bot[j], bot[i]];
    const depth = toCam(cam, { x: (p.x + top[j].x) / 2, y: 0, z: (p.z + top[j].z) / 2 }).z;
    return { d: polyPath(projectPoly(cam, quad)), depth };
  }).sort((a, b) => b.depth - a.depth);
  const sc = [phonePoint(0, 0, thick + 0.4), phonePoint(w, 0, thick + 0.4), phonePoint(w, h, thick + 0.4), phonePoint(0, h, thick + 0.4)].map((p) => project(cam, p));
  const edge = projectPoly(cam, roundedRect(w / 2, h / 2, w + 2 * bezel - 3, h + 2 * bezel - 3, 56, (u, v) => phonePoint(u, v, thick + 0.2), 8));
  return (
    <AbsoluteFill style={{ opacity: o }}>
      <AbsoluteFill style={{ filter: blur > 0.3 ? `blur(${blur.toFixed(1)}px)` : undefined }}>
        <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
          {Bt.length > 2 && <path d={polyPath(Bt)} fill="#050506" />}
          {walls.map((wl, i) => (
            <path key={i} d={wl.d} fill="#1a1a1e" />
          ))}
          {T.length > 2 && <path d={polyPath(T)} fill="#0c0c0e" />}
          {edge.length > 2 && <path d={polyPath(edge)} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth={1.4} />}
        </svg>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 0, top: 0, width: screenW, height: screenH, transformOrigin: "0 0", transform: homography(screenW, screenH, sc[0], sc[1], sc[2], sc[3]), borderRadius: 120, overflow: "hidden", background: "#020203", filter: blur > 0.3 ? `blur(${(blur * 0.7).toFixed(1)}px)` : undefined }}>
        <div style={{ position: "absolute", inset: 0, opacity: wake }}>{screen}</div>
      </div>
    </AbsoluteFill>
  );
};

/** world point on the monitor screen from capture-pixel coordinates (cx, cy) of a sw×sh capture */
export const monScreenPoint = (cx: number, cy: number, sw: number, sh: number, lift = 0): V3 => {
  const { w, h } = MON.screen;
  return v3(MON.center.x - w / 2 + (cx / sw) * w, MON.center.y - h / 2 + (cy / sh) * h, -lift);
};
export { PHONE };
