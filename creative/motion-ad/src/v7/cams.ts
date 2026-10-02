import { Camera, V3, v3, MON, PHONE, phonePoint, fullFrameCam } from "./world";
import { ease, lerp, range } from "../lib/ease";

/** a camera at `pos` looking at `target` */
export function lookAt(pos: V3, target: V3, f = 1500): Camera {
  const dx = target.x - pos.x, dy = target.y - pos.y, dz = target.z - pos.z;
  const yaw = Math.atan2(dx, dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  return { pos, yaw, pitch, f };
}
export const MON_TARGET = v3(MON.center.x, MON.center.y + 40, 0);
/** a camera orbiting the monitor: distance d, yaw angle (deg, + = from the right), height offset */
export function monCam(d: number, yawDeg: number, dy = 0, target: V3 = MON_TARGET, f = 1500): Camera {
  const a = (yawDeg * Math.PI) / 180;
  return lookAt(v3(target.x + Math.sin(a) * d, target.y + dy, target.z - Math.cos(a) * d), target, f);
}
/** the hero camera above the phone: elevation (deg from the desk), distance */
export function phoneCam(dist: number, elevDeg: number, f = 1500): Camera {
  const target = phonePoint(PHONE.w / 2, PHONE.h / 2, PHONE.thick);
  const far = phonePoint(PHONE.w / 2, 0, 0), near = phonePoint(PHONE.w / 2, PHONE.h, 0);
  const L = Math.hypot(near.x - far.x, near.z - far.z);
  const dir = { x: (near.x - far.x) / L, z: (near.z - far.z) / L }; // toward the viewer along the phone
  const e = (elevDeg * Math.PI) / 180;
  const pos = v3(target.x + dir.x * dist * Math.cos(e), target.y - dist * Math.sin(e), target.z + dir.z * dist * Math.cos(e));
  return lookAt(pos, target, f);
}
export { fullFrameCam };
/** blend two cameras (position + angles) */
export function mixCam(a: Camera, b: Camera, k: number): Camera {
  // shortest way round
  let dy = b.yaw - a.yaw;
  while (dy > Math.PI) dy -= 2 * Math.PI;
  while (dy < -Math.PI) dy += 2 * Math.PI;
  return {
    pos: v3(lerp(a.pos.x, b.pos.x, k), lerp(a.pos.y, b.pos.y, k), lerp(a.pos.z, b.pos.z, k)),
    yaw: a.yaw + dy * k,
    pitch: lerp(a.pitch, b.pitch, k),
    f: lerp(a.f, b.f, k),
  };
}
export type CamKey = { t: number; cam: Camera; e?: (x: number) => number };
export function keyCam(keys: CamKey[], t: number): Camera {
  if (t <= keys[0].t) return keys[0].cam;
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i].t) return mixCam(keys[i - 1].cam, keys[i].cam, (keys[i].e ?? ease.swift)(range(t, keys[i - 1].t, keys[i].t)));
  }
  return keys[keys.length - 1].cam;
}
