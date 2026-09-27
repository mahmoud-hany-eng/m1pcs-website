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
/** East-coast consolidation hub where the parts are packed together. */
export const HUB: LatLon = { lat: 40.7, lon: -74.2 };

/** U.S. suppliers the parts are sourced from (one per part group). */
export const SUPPLIERS = [
  { id: "gpu", label: "GPU", lat: 37.35, lon: -121.95 },
  { id: "ram", label: "RAM", lat: 43.6, lon: -116.2 },
  { id: "cpu", label: "CPU", lat: 30.27, lon: -97.74 },
  { id: "storage", label: "Storage", lat: 41.88, lon: -87.63 },
  { id: "case", label: "Case & cooling", lat: 33.75, lon: -84.39 },
] as const;

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
export const V_HUB = geoVector(HUB);
export const V_SUPPLIERS = SUPPLIERS.map((p) => geoVector(p));
/** Great-circle midpoint — the "overview" view centre for the route. */
export const V_MID = V_QATAR.clone().add(V_HUB).normalize();

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

/** Height of the shipping arc above the surface at u (globe units). */
export const ROUTE_LIFT = 0.16;

/** Point on the raised U.S. hub → Qatar shipping arc, in globe-local space. */
export function routePoint(u: number, out = new THREE.Vector3()) {
  slerpVectors(V_HUB, V_QATAR, u, out);
  const lift = GLOBE_RADIUS * (1 + ROUTE_LIFT * Math.sin(Math.PI * u));
  return out.multiplyScalar(lift);
}

/** Ground point (unit vector) under the route at u. */
export function routeGround(u: number, out = new THREE.Vector3()) {
  return slerpVectors(V_HUB, V_QATAR, u, out);
}

const ta = new THREE.Vector3();
const tb = new THREE.Vector3();
/** Unit direction of travel along the route at u, tangent to the sphere under it. */
export function routeHeading(u: number, out = new THREE.Vector3()) {
  const e = 1e-3;
  routeGround(Math.min(1, u + e), ta);
  routeGround(Math.max(0, u - e), tb);
  out.subVectors(ta, tb);
  routeGround(u, tb);
  out.addScaledVector(tb, -out.dot(tb));
  return out.normalize();
}

const right = new THREE.Vector3();
/**
 * Rotation taking unit vector `v` to +Y with the direction `heading` (tangent
 * at v) pointing to −Z — a "course-up" view for following the plane.
 */
export function viewQuaternionHeading(v: THREE.Vector3, heading: THREE.Vector3, out = new THREE.Quaternion()): THREE.Quaternion {
  right.crossVectors(heading, v).normalize();
  m.set(right.x, right.y, right.z, 0, v.x, v.y, v.z, 0, -heading.x, -heading.y, -heading.z, 0, 0, 0, 0, 1);
  return out.setFromRotationMatrix(m);
}
