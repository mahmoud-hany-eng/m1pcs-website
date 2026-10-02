/**
 * A tiny, exact 3D camera for the device world.
 *
 * World units ≈ px. x right, y DOWN, z AWAY from the viewer. The desk top is
 * the plane y = 0. Objects are planar faces (quads / polygons) projected with
 * a pinhole camera; flat UI (the real website capture, the phone's chat) is
 * mapped onto its screen with a CSS matrix3d homography computed from the
 * projected corners — perspective-exact, and the UI keeps its native
 * resolution (it is never re-rendered as a small video).
 */
export type V3 = { x: number; y: number; z: number };
export type P2 = { x: number; y: number };
export type Camera = { pos: V3; yaw: number; pitch: number; f: number };

export const FRAME = { w: 1080, h: 1920 };
const CX = FRAME.w / 2;
const CY = FRAME.h / 2;

export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const lerp3 = (a: V3, b: V3, k: number): V3 => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });

/** camera space: yaw about the y axis (positive = look right), pitch about x (positive = look down) */
export function toCam(c: Camera, p: V3): V3 {
  const dx = p.x - c.pos.x, dy = p.y - c.pos.y, dz = p.z - c.pos.z;
  const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
  const x1 = dx * cy - dz * sy;
  const z1 = dx * sy + dz * cy;
  const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
  const y2 = dy * cp - z1 * sp;
  const z2 = dy * sp + z1 * cp;
  return { x: x1, y: y2, z: z2 };
}
export function project(c: Camera, p: V3): P2 & { z: number; s: number } {
  const q = toCam(c, p);
  const z = Math.max(q.z, 1e-3);
  const s = c.f / z;
  return { x: CX + q.x * s, y: CY + q.y * s, z: q.z, s };
}

/** CSS matrix3d mapping a w×h element (origin top-left) onto the quad p0 (tl), p1 (tr), p2 (br), p3 (bl). */
export function homography(w: number, h: number, p0: P2, p1: P2, p2: P2, p3: P2): string {
  const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, dy3 = p0.y - p1.y + p2.y - p3.y;
  let a, b, c, d, e, f, g, hh;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = p1.x - p0.x; b = p2.x - p1.x; c = p0.x;
    d = p1.y - p0.y; e = p2.y - p1.y; f = p0.y;
    g = 0; hh = 0;
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    hh = (dx1 * dy3 - dx3 * dy1) / den;
    a = p1.x - p0.x + g * p1.x; b = p3.x - p0.x + hh * p3.x; c = p0.x;
    d = p1.y - p0.y + g * p1.y; e = p3.y - p0.y + hh * p3.y; f = p0.y;
  }
  // scale the unit square to the element size
  a /= w; d /= w; g /= w;
  b /= h; e /= h; hh /= h;
  const m = [a, d, 0, g, b, e, 0, hh, 0, 0, 1, 0, c, f, 0, 1];
  return `matrix3d(${m.map((v) => (Math.abs(v) < 1e-12 ? 0 : +v.toPrecision(10))).join(",")})`;
}

export const polyPath = (pts: P2[]) => "M" + pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" L") + " Z";

// ------------------------------------------------------------------ the set
/** Portrait (pivoted) monitor: the screen is exactly 9:16, so flying into it lands on a full 9:16 frame. */
export const MON = {
  screen: { w: 900, h: 1600 },
  bezel: 16,
  depth: 46,
  center: v3(0, -1110, 0), // screen centre; front glass at z = 0
  neck: { w: 90, h: 280, z: 120 },
  base: { w: 520, d: 300 },
};
export const monScreenCorners = (): [V3, V3, V3, V3] => {
  const { w, h } = MON.screen;
  const c = MON.center;
  return [v3(c.x - w / 2, c.y - h / 2, 0), v3(c.x + w / 2, c.y - h / 2, 0), v3(c.x + w / 2, c.y + h / 2, 0), v3(c.x - w / 2, c.y + h / 2, 0)];
};
export const monBottomY = MON.center.y + MON.screen.h / 2 + MON.bezel;

/** Phone lying flat on the desk, screen up, to the right and in front of the monitor. */
export const PHONE = {
  w: 390,
  h: 846,
  bezel: 14,
  thick: 18,
  center: v3(640, -0.5, -520),
  yaw: (-14 * Math.PI) / 180, // rotated on the desk
};
/** a point on the phone's top face, (u, v) in screen px from its top-left (top = far end) */
export function phonePoint(u: number, v: number, lift = 0): V3 {
  const { w, h, center, yaw } = PHONE;
  const lx = u - w / 2;
  const lz = h / 2 - v; // the top of the screen points away from the viewer
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return v3(center.x + lx * c - lz * s, center.y - lift, center.z + lx * s + lz * c);
}
export const phoneScreenCorners = (): [V3, V3, V3, V3] => [phonePoint(0, 0), phonePoint(PHONE.w, 0), phonePoint(PHONE.w, PHONE.h), phonePoint(0, PHONE.h)];

/** the camera that puts the monitor screen exactly full-frame (front-on) */
export function fullFrameCam(): Camera {
  const f = 1500;
  const d = (f * MON.screen.h) / FRAME.h;
  return { pos: v3(MON.center.x, MON.center.y, -d), yaw: 0, pitch: 0, f };
}
