import * as THREE from "three";

/**
 * The whole story lives on one globe. The M1 studio (scenes 1–3, 5–6) is
 * attached to the globe's surface at Qatar, so "zooming out to the world"
 * and "diving back into Qatar" are real, continuous camera moves.
 *
 * Globe-local frame: +Y = north pole, lon 0 at +Z, east towards +X.
 * The globe group sits at GLOBE_CENTER and is rotated so that the current
 * "view centre" (lat/lon) points straight up (+Y) with north towards −Z —
 * which, at the Qatar view centre, leaves the studio upright at the world
 * origin.
 */
export const GLOBE_RADIUS = 10;
export const GLOBE_CENTER = new THREE.Vector3(0, -GLOBE_RADIUS, 0);

export interface LatLon {
  lat: number;
  lon: number;
}

export const QATAR: LatLon = { lat: 25.3, lon: 51.2 };
export const USA: LatLon = { lat: 39.2, lon: -97.5 };

export function geoVector(p: LatLon, out = new THREE.Vector3()): THREE.Vector3 {
  const phi = THREE.MathUtils.degToRad(p.lat);
  const lambda = THREE.MathUtils.degToRad(p.lon);
  return out.set(Math.cos(phi) * Math.sin(lambda), Math.sin(phi), Math.cos(phi) * Math.cos(lambda));
}

const up = new THREE.Vector3(0, 1, 0);
const east = new THREE.Vector3();
const north = new THREE.Vector3();
const m = new THREE.Matrix4();

/** Rotation taking unit vector `v` to +Y and its local north to −Z. */
export function viewQuaternion(v: THREE.Vector3, out = new THREE.Quaternion()): THREE.Quaternion {
  east.crossVectors(up, v);
  if (east.lengthSq() < 1e-8) east.set(1, 0, 0);
  east.normalize();
  north.crossVectors(v, east).normalize();
  // Rows (east, v, −north) — maps those vectors onto X, Y, Z.
  m.set(east.x, east.y, east.z, 0, v.x, v.y, v.z, 0, -north.x, -north.y, -north.z, 0, 0, 0, 0, 1);
  return out.setFromRotationMatrix(m);
}

export const V_QATAR = geoVector(QATAR);
export const V_USA = geoVector(USA);
/** Great-circle midpoint — the "overview" view centre for the route. */
export const V_MID = V_QATAR.clone().add(V_USA).normalize();

export function slerpVectors(a: THREE.Vector3, b: THREE.Vector3, t: number, out = new THREE.Vector3()) {
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  const omega = Math.acos(dot);
  if (omega < 1e-5) return out.copy(a);
  const s = Math.sin(omega);
  return out
    .copy(a)
    .multiplyScalar(Math.sin((1 - t) * omega) / s)
    .addScaledVector(b, Math.sin(t * omega) / s);
}

/** Point on the raised U.S. → Qatar shipping arc, in globe-local space. */
export function routePoint(u: number, out = new THREE.Vector3()) {
  slerpVectors(V_USA, V_QATAR, u, out);
  const lift = GLOBE_RADIUS * (1 + 0.32 * Math.sin(Math.PI * u));
  return out.multiplyScalar(lift);
}
