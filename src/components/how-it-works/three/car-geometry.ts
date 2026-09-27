import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { monotone } from "./curve";

/**
 * Procedural geometry for the delivery car: a dark-blue luxury sports coupe
 * with the proportions of a modern two-door grand tourer (long bonnet, low
 * fastback roof, large vertical grille, frameless doors).
 *
 * The body is two parametric surfaces — the lower body S(z, θ) and the
 * glasshouse G(z, φ) — cut into panels ("cells") along parameter lines.
 * Every panel is sampled from the same surface with analytic normals, so
 * neighbouring panels (paint, trim, glass, the opening door, the boot lid)
 * meet without cracks and shade as one continuous surface.
 *
 * Car-local frame: forward +Z, up +Y, the driver's (left) side +X, origin on
 * the ground at the centre of the car. Units match the characters (≈1.8 tall).
 */
export const CAR = {
  front: 2.9,
  rear: -2.9,
  halfWidth: 1.12,
  frontAxle: 1.84,
  rearAxle: -1.62,
  wheelR: 0.4,
  wheelX: 0.94,
  archR: 0.47,
  /** Windshield base (cowl) — also the door's front edge / hinge line. */
  glassFront: 1.12,
  /** Rear window base — also the boot lid hinge. */
  glassRear: -1.86,
  roofFront: 0.18,
  roofRear: -0.72,
  doorRear: -0.52,
  trunkRear: -2.72,
} as const;

// ---------------------------------------------------------------- profiles (side view)

/** Top of the lower body: nose, bonnet, beltline, boot deck, tail. */
const TOP = monotone([
  [-2.9, 0.8],
  [-2.85, 0.95],
  [-2.79, 1.04],
  [-2.7, 1.075],
  [-2.3, 1.085],
  [-1.86, 1.075],
  [-1.3, 1.05],
  [0.0, 1.035],
  [0.9, 1.03],
  [1.12, 1.02],
  [1.5, 0.985],
  [2.0, 0.94],
  [2.45, 0.9],
  [2.7, 0.865],
  [2.8, 0.84],
  [2.86, 0.8],
  [2.9, 0.7],
]);

/** Underside (before the wheel arches are cut in). */
const BOTTOM = monotone([
  [-2.9, 0.42],
  [-2.84, 0.33],
  [-2.7, 0.24],
  [-2.3, 0.17],
  [-1.2, 0.145],
  [1.2, 0.145],
  [2.3, 0.2],
  [2.7, 0.27],
  [2.84, 0.3],
  [2.9, 0.33],
]);

/** Roofline of the glasshouse (windshield rake → roof → fastback). */
const ROOF = monotone([
  [-1.86, 1.07],
  [-1.6, 1.2],
  [-1.3, 1.37],
  [-1.0, 1.515],
  [-0.7, 1.605],
  [-0.4, 1.645],
  [-0.1, 1.655],
  [0.18, 1.625],
  [0.45, 1.5],
  [0.8, 1.27],
  [1.12, 1.0],
]);

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const gauss = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2));

/** Bonnet and boot are gently crowned; flat where the glass meets them. */
function crown(z: number) {
  return 0.028 * smoothstep(CAR.glassFront, CAR.glassFront + 0.55, z) + 0.018 * (1 - smoothstep(CAR.glassRear - 0.5, CAR.glassRear, z));
}

/** Plan-view half width: squared-off superellipse ends, rear haunches, a slight waist. */
export function halfWidth(z: number) {
  const u = z >= 0 ? z / CAR.front : z / CAR.rear;
  const p = z >= 0 ? 6 : 6.5;
  const plan = Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, u), p)), 1 / p);
  const shape = 1 + 0.024 * gauss(z, CAR.rearAxle, 0.75) + 0.01 * gauss(z, CAR.frontAxle, 0.6) - 0.01 * gauss(z, 0.1, 0.9);
  return CAR.halfWidth * plan * shape;
}

/** Underside with the wheel arches cut in. */
function bottomY(z: number) {
  let b = BOTTOM(z);
  for (const axle of [CAR.frontAxle, CAR.rearAxle]) {
    const dz = z - axle;
    if (Math.abs(dz) < CAR.archR) b = Math.max(b, CAR.wheelR + Math.sqrt(CAR.archR * CAR.archR - dz * dz));
  }
  return b;
}

interface Section {
  z: number;
  hw: number;
  yc: number;
  hh: number;
  crown: number;
}

function makeSection(z: number, out: Section): Section {
  const T = TOP(z);
  const B = Math.min(bottomY(z), T - 0.01);
  out.z = z;
  out.hw = halfWidth(z);
  out.yc = (T + B) / 2;
  out.hh = (T - B) / 2;
  out.crown = crown(z);
  return out;
}

// Small cache: patches evaluate many points on the same few stations.
const SECTIONS: Section[] = Array.from({ length: 8 }, () => ({ z: NaN, hw: 0, yc: 0, hh: 0, crown: 0 }));
let nextSection = 0;
function section(z: number): Section {
  for (const s of SECTIONS) if (s.z === z) return s;
  const s = makeSection(z, SECTIONS[nextSection]);
  nextSection = (nextSection + 1) % SECTIONS.length;
  return s;
}

/**
 * Lower body S(z, θ). θ runs round the section: −π/2 underneath, 0 on the
 * driver's side (+X), π/2 on top, π on the passenger side.
 */
export function bodyPoint(z: number, theta: number, out: THREE.Vector3) {
  return sectionPoint(section(z), theta, out);
}

function sectionPoint(sec: Section, theta: number, out: THREE.Vector3) {
  const { z, hw, yc, hh } = sec;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const upper = s >= 0;
  const e = upper ? 2 / 6 : 2 / 5;
  const ux = Math.sign(c) * Math.pow(Math.abs(c), e);
  const uy = Math.sign(s) * Math.pow(Math.abs(s), e);
  const tumble = upper ? 1 - 0.07 * uy * uy : 1 - 0.05 * uy * uy;
  let x = hw * ux * tumble;
  let y = yc + hh * uy;
  if (upper) y += sec.crown * (1 - ux * ux) * uy;
  // Character lines catch the reflections: a crisp shoulder just under the
  // glass line and a soft swage low on the doors (sides only).
  const side = Math.pow(Math.abs(ux), 10) * Math.min(1, hw / 0.9);
  x += Math.sign(ux) * side * (0.012 * gauss(y, 0.86, 0.035) - 0.009 * gauss(y, 0.47, 0.07));
  return out.set(x, y, z);
}

// Section angles of the panel lines.
export const THETA = {
  skirt: -1.1,
  sill: -0.36,
  ledge: 0.66,
  glass: 0.81,
  trunk: 1.0,
} as const;

const base = new THREE.Vector3();

/**
 * Glasshouse G(z, φ): φ ∈ [0,1] the driver's-side glass line → roof rail,
 * [1,2] across the roof, [2,3] down the passenger side. It sits exactly on
 * the lower body's glass line, so the two surfaces meet without a seam.
 */
export function glassPoint(z: number, phi: number, out: THREE.Vector3) {
  bodyPoint(z, THETA.glass, base);
  const xb = base.x;
  const yb = base.y;
  const R = Math.max(yb, ROOF(z));
  const h = R - yb;
  const rise = Math.min(0.075, h * 0.16);
  const yr = R - rise;
  const xr = xb - 0.3 * (yr - yb);
  if (phi <= 1 || phi >= 2) {
    const t = phi <= 1 ? phi : 3 - phi;
    const bow = 0.012 * Math.sin(Math.PI * t) * Math.min(1, h / 0.3);
    const x = xb + (xr - xb) * t + bow;
    out.set(phi <= 1 ? x : -x, yb + (yr - yb) * t, z);
    return out;
  }
  const psi = (phi - 1) * Math.PI;
  const c = Math.cos(psi);
  const s = Math.sin(psi);
  const e = 2 / 3.4;
  out.set(xr * Math.sign(c) * Math.pow(Math.abs(c), e), yr + rise * Math.pow(Math.abs(s), e), z);
  return out;
}

/** Rear edge of the side window (C-pillar, with a forward kink at its foot), as a function of the side fraction t. */
export const cPillar = monotone([
  [0, -1.33],
  [0.12, -1.4],
  [0.35, -1.25],
  [0.7, -1.03],
  [1, -0.85],
]);

// ---------------------------------------------------------------- patch builder

type Surface = (a: number, z: number, out: THREE.Vector3) => THREE.Vector3;

const pA = new THREE.Vector3();
const pB = new THREE.Vector3();
const pC = new THREE.Vector3();
const pD = new THREE.Vector3();
const du = new THREE.Vector3();
const dv = new THREE.Vector3();
const nrm = new THREE.Vector3();

function normalAt(surface: Surface, a: number, z: number, out: THREE.Vector3) {
  const ea = 1e-3;
  const ez = 1e-3;
  for (let k = 0; k < 4; k++) {
    // Nudge off degenerate points (the pinched nose/tail, the glass ends).
    const zz = z + (k === 0 ? 0 : (k % 2 ? -1 : 1) * k * 4e-3);
    surface(a + ea, zz, pA);
    surface(a - ea, zz, pB);
    surface(a, zz + ez, pC);
    surface(a, zz - ez, pD);
    du.subVectors(pA, pB);
    dv.subVectors(pC, pD);
    out.crossVectors(du, dv);
    if (out.lengthSq() > 1e-14) return out.normalize();
  }
  return out.set(0, 1, 0);
}

export interface PatchOptions {
  /** Lift along the normal (trims, decals, lamps sit just proud of the paint). */
  offset?: number;
  /** The parametrisation's natural normal points inwards: turn it round. */
  flip?: boolean;
  /** Normals from the sampled grid instead of the surface (for surfaces that are costly to evaluate). */
  gridNormals?: boolean;
  /** Texture coordinates from the grid position (0..1 each way). */
  uv?: boolean;
}

/**
 * Samples a surface over a grid. `param(i, j)` maps grid indices (i along
 * the section, j along the car) to surface parameters (a, z); the grid can
 * therefore follow curved boundaries exactly (e.g. the C-pillar edge).
 */
export function patch(
  surface: Surface,
  ni: number,
  nj: number,
  param: (i: number, j: number, out: { a: number; z: number }) => void,
  opts: PatchOptions = {},
): THREE.BufferGeometry {
  const offset = opts.offset ?? 0;
  const count = (ni + 1) * (nj + 1);
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uvs = opts.uv ? new Float32Array(count * 2) : null;
  const p = new THREE.Vector3();
  const q = { a: 0, z: 0 };
  for (let j = 0; j <= nj; j++) {
    for (let i = 0; i <= ni; i++) {
      param(i, j, q);
      surface(q.a, q.z, p);
      const k = j * (ni + 1) + i;
      pos.set([p.x, p.y, p.z], k * 3);
      if (!opts.gridNormals) {
        normalAt(surface, q.a, q.z, nrm);
        nor.set([nrm.x, nrm.y, nrm.z], k * 3);
      }
      if (uvs) uvs.set([i / ni, j / nj], k * 2);
    }
  }
  if (opts.gridNormals) {
    for (let j = 0; j <= nj; j++) {
      for (let i = 0; i <= ni; i++) {
        const at = (ii: number, jj: number, out: THREE.Vector3) => out.fromArray(pos, (jj * (ni + 1) + ii) * 3);
        du.subVectors(at(Math.min(ni, i + 1), j, pA), at(Math.max(0, i - 1), j, pB));
        dv.subVectors(at(i, Math.min(nj, j + 1), pC), at(i, Math.max(0, j - 1), pD));
        nrm.crossVectors(du, dv);
        if (nrm.lengthSq() < 1e-14) nrm.set(0, 1, 0);
        nrm.normalize();
        nor.set([nrm.x, nrm.y, nrm.z], (j * (ni + 1) + i) * 3);
      }
    }
  }
  for (let k = 0; k < count; k++) {
    nrm.fromArray(nor, k * 3);
    if (opts.flip) nrm.negate();
    nor.set([nrm.x, nrm.y, nrm.z], k * 3);
    if (offset) {
      p.fromArray(pos, k * 3).addScaledVector(nrm, offset);
      pos.set([p.x, p.y, p.z], k * 3);
    }
  }
  const index: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  for (let j = 0; j < nj; j++) {
    for (let i = 0; i < ni; i++) {
      const k00 = j * (ni + 1) + i;
      const k10 = k00 + 1;
      const k01 = k00 + ni + 1;
      const k11 = k01 + 1;
      // Wind every quad so its front face agrees with the surface normal.
      a.fromArray(pos, k00 * 3);
      b.fromArray(pos, k10 * 3);
      c.fromArray(pos, k01 * 3);
      e1.subVectors(b, a);
      e2.subVectors(c, a);
      n.fromArray(nor, k00 * 3).add(pA.fromArray(nor, k11 * 3));
      const flip = e1.cross(e2).dot(n) < 0;
      if (flip) index.push(k00, k01, k10, k10, k01, k11);
      else index.push(k00, k10, k01, k10, k11, k01);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  if (uvs) g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  g.setIndex(index);
  return g;
}

/** Sample count for a parameter span at a target spacing. */
const steps = (span: number, spacing: number) => Math.max(1, Math.ceil(Math.abs(span) / spacing));

// ---------------------------------------------------------------- stations along the car

function stationList() {
  const zs: number[] = [];
  for (let z = CAR.rear; z <= CAR.front + 1e-9; z += 0.05) zs.push(z);
  for (const d of [0.002, 0.006, 0.012, 0.02, 0.03, 0.045, 0.06, 0.08, 0.1, 0.13, 0.16, 0.2, 0.25]) {
    zs.push(CAR.front - d, CAR.rear + d);
  }
  for (const axle of [CAR.frontAxle, CAR.rearAxle]) {
    for (let k = -12; k <= 12; k++) zs.push(axle + CAR.archR * Math.sin((k / 12) * (Math.PI / 2)) * 0.998);
    zs.push(axle - CAR.archR - 0.0015, axle + CAR.archR + 0.0015);
  }
  zs.push(CAR.glassFront, CAR.glassFront + 0.01, CAR.doorRear, CAR.doorRear - 0.01, CAR.glassRear, CAR.trunkRear, CAR.trunkRear - 0.01);
  zs.sort((a, b) => a - b);
  const out: number[] = [];
  for (const z of zs) if (!out.length || z - out[out.length - 1] > 4e-4) out.push(z);
  out[0] = CAR.rear;
  out[out.length - 1] = CAR.front;
  return out;
}

// ---------------------------------------------------------------- the model

export type CarMaterial =
  | "paint"
  | "trim"
  | "under"
  | "glass"
  | "darkGlass"
  | "lens"
  | "chrome"
  | "ledWhite"
  | "ledRed"
  | "tailLens";

export type CarPart = "body" | "door" | "trunk";

export interface CarGeometry {
  /** Outside surfaces per part and material. */
  outer: Record<CarPart, Partial<Record<CarMaterial, THREE.BufferGeometry>>>;
  /** Inside faces (rendered back-side in a dark interior colour). */
  inner: Record<CarPart, THREE.BufferGeometry | null>;
  /** M1 decals on both doors (driver's one rides on the door). */
  decal: Record<"door" | "body", THREE.BufferGeometry>;
  /** Hinge of the driver's door (x, z) and of the boot lid (y, z). */
  doorHinge: THREE.Vector2;
  trunkHinge: THREE.Vector2;
}

let cached: CarGeometry | null = null;

export function carGeometry(): CarGeometry {
  if (cached) return cached;
  const buckets: Record<CarPart, Partial<Record<CarMaterial, THREE.BufferGeometry[]>>> = { body: {}, door: {}, trunk: {} };
  const innerBuckets: Record<CarPart, THREE.BufferGeometry[]> = { body: [], door: [], trunk: [] };
  const add = (part: CarPart, mat: CarMaterial, g: THREE.BufferGeometry, inner = true) => {
    (buckets[part][mat] ??= []).push(g);
    if (inner && mat !== "glass") innerBuckets[part].push(g);
  };

  const body: Surface = (a, z, out) => bodyPoint(z, a, out);
  const glass: Surface = (a, z, out) => glassPoint(z, a, out);
  const stations = stationList();
  const between = (z0: number, z1: number) => stations.filter((z) => z >= z0 - 1e-9 && z <= z1 + 1e-9);

  // ---- lower body: cells between panel lines
  const T = THETA;
  const PI = Math.PI;
  const tBreaks = [
    -PI / 2,
    T.skirt,
    T.sill,
    T.ledge,
    T.glass,
    T.trunk - 0.014,
    T.trunk,
    PI - T.trunk,
    PI - T.trunk + 0.014,
    PI - T.glass,
    PI - T.ledge,
    PI - T.sill,
    PI - T.skirt,
    (3 * PI) / 2,
  ];
  const Z = CAR;
  const zBreaks = [Z.rear, Z.trunkRear - 0.01, Z.trunkRear, Z.glassRear, Z.doorRear - 0.01, Z.doorRear, Z.glassFront, Z.glassFront + 0.01, Z.front];

  for (let zi = 0; zi < zBreaks.length - 1; zi++) {
    const z0 = zBreaks[zi];
    const z1 = zBreaks[zi + 1];
    const zm = (z0 + z1) / 2;
    const zs = between(z0, z1);
    const cabin = zm > Z.glassRear && zm < Z.glassFront;
    const door = zm > Z.doorRear && zm < Z.glassFront;
    const seam = z1 - z0 < 0.02;
    const bootZone = zm > Z.trunkRear && zm < Z.glassRear;
    for (let ti = 0; ti < tBreaks.length - 1; ti++) {
      const t0 = tBreaks[ti];
      const t1 = tBreaks[ti + 1];
      const tm = (t0 + t1) / 2;
      const driverSide = Math.cos(tm) > 0;
      const top = tm > T.glass && tm < PI - T.glass;
      const topCentre = tm > T.trunk && tm < PI - T.trunk;
      const ledge = (tm > T.ledge && tm < T.glass) || (tm > PI - T.glass && tm < PI - T.ledge);
      const side = (tm > T.sill && tm < T.ledge) || (tm > PI - T.ledge && tm < PI - T.sill);
      const under = tm < T.skirt || tm > PI - T.skirt;
      const skirt = !under && (tm < T.sill || tm > PI - T.sill);
      const trunkSeam = t1 - t0 < 0.02;

      let part: CarPart = "body";
      let mat: CarMaterial = "paint";
      if (under) mat = "under";
      else if (skirt) mat = "trim";
      else if (top) {
        if (cabin) continue; // open to the glasshouse
        if (bootZone && topCentre) part = "trunk";
        else if (bootZone && trunkSeam) mat = "trim";
        else if (seam && zm < Z.glassRear && Math.abs(tm - PI / 2) < PI / 2 - T.trunk + 0.02) mat = "trim";
      } else if (ledge) {
        if (cabin) mat = "trim";
        if (door && driverSide) part = "door";
      } else if (side) {
        if (door && driverSide) part = "door";
        // Shut lines either side of the doors (both sides of the car read as two-door).
        if (seam && zm > Z.doorRear - 0.02 && zm < Z.glassFront + 0.02) mat = "trim";
      }
      const span = t1 - t0;
      const ni = steps(span, mat === "paint" ? 0.034 : 0.05);
      const nj = zs.length - 1;
      add(part, mat, patch(body, ni, nj, (i, j, o) => {
        o.a = t0 + (span * i) / ni;
        o.z = zs[j];
      }));
    }
  }

  // ---- glasshouse
  const gStations = (z0: number, z1: number, spacing = 0.035) => {
    const n = steps(z1 - z0, spacing);
    return Array.from({ length: n + 1 }, (_, k) => z0 + ((z1 - z0) * k) / n);
  };
  const G1 = Z.glassRear;
  const G0 = Z.glassFront;
  const D1 = Z.doorRear;
  const trimT = 0.06;
  const cTrim = 0.05;
  const bTrim = 0.025;

  /** A side-glass band: rows of the side fraction t, each from zFrom(t) to zTo(t). */
  const sideBand = (
    driver: boolean,
    t0: number,
    t1: number,
    zFrom: (t: number) => number,
    zTo: (t: number) => number,
    part: CarPart,
    mat: CarMaterial,
    zSpacing = 0.04,
  ) => {
    const ni = steps(t1 - t0, 0.08);
    const zSpan = Math.max(zTo(t0) - zFrom(t0), zTo(t1) - zFrom(t1));
    const nj = steps(zSpan, zSpacing);
    add(part, mat, patch(glass, ni, nj, (i, j, o) => {
      const t = t0 + ((t1 - t0) * i) / ni;
      const a = zFrom(t);
      const b = zTo(t);
      o.a = driver ? t : 3 - t;
      o.z = a + ((b - a) * j) / nj;
    }));
  };

  for (const driver of [true, false]) {
    const rest: CarPart = "body";
    const doorPart: CarPart = driver ? "door" : "body";
    const cz = (t: number) => cPillar(t);
    const k = (v: number) => () => v;
    // C-pillar (paint) under every row.
    sideBand(driver, 0, 1, k(G1), cz, rest, "paint");
    // Beltline trim (on the door along the door's length).
    sideBand(driver, 0, trimT, cz, k(D1), rest, "trim");
    sideBand(driver, 0, trimT, k(D1), k(G0), doorPart, "trim");
    // Roof-rail trim.
    sideBand(driver, 1 - trimT, 1, cz, k(G0), rest, "trim");
    // Glass rows: C trim, quarter glass, B trim, door glass.
    sideBand(driver, trimT, 1 - trimT, cz, (t) => cz(t) + cTrim, rest, "trim");
    sideBand(driver, trimT, 1 - trimT, (t) => cz(t) + cTrim, k(D1 - bTrim), rest, "glass");
    sideBand(driver, trimT, 1 - trimT, k(D1 - bTrim), k(D1 + bTrim), rest, "trim");
    sideBand(driver, trimT, 1 - trimT, k(D1 + bTrim), k(G0), doorPart, "glass");
  }

  // Roof, windshield (+ A-pillars), rear window (+ C-pillar tops).
  const topBand = (a0: number, a1: number, z0: number, z1: number, mat: CarMaterial, spacing = 0.035) => {
    const zs = gStations(z0, z1, spacing);
    const ni = steps(a1 - a0, 0.03);
    add("body", mat, patch(glass, ni, zs.length - 1, (i, j, o) => {
      o.a = a0 + ((a1 - a0) * i) / ni;
      o.z = zs[j];
    }));
  };
  const aPillar = 0.085;
  const cTop = 0.07;
  topBand(1, 2, Z.roofRear, Z.roofFront, "paint");
  topBand(1, 1 + aPillar, Z.roofFront, G0, "trim");
  topBand(2 - aPillar, 2, Z.roofFront, G0, "trim");
  topBand(1 + aPillar, 2 - aPillar, Z.roofFront, G0, "darkGlass");
  topBand(1, 1 + cTop, G1, Z.roofRear, "paint");
  topBand(2 - cTop, 2, G1, Z.roofRear, "paint");
  topBand(1 + cTop, 2 - cTop, G1, Z.roofRear, "darkGlass");

  // ---- lamps and intakes: patches on the nose and tail, projected along Z
  const faceSurface = (front: boolean): Surface => (xx, yy, out) => out.set(xx, yy, faceZ(front, Math.abs(xx), yy));
  const facePatch = (front: boolean, x0: number, x1: number, y0: (x: number) => number, y1: (x: number) => number, _mat: CarMaterial, offset: number) => {
    const surf = faceSurface(front);
    const ni = steps(x1 - x0, 0.03);
    const nj = steps(Math.max(y1(x0) - y0(x0), y1(x1) - y0(x1)), 0.02);
    return patch(surf, ni, nj, (i, j, o) => {
      const x = x0 + ((x1 - x0) * i) / ni;
      o.a = x;
      o.z = y0(x) + ((y1(x) - y0(x)) * j) / nj;
    }, { offset, flip: !front, gridNormals: true });
  };
  const k = (v: number) => () => v;
  for (const sx of [1, -1]) {
    const m = (a: number, b: number): [number, number] => (sx > 0 ? [a, b] : [-b, -a]);
    // Headlights: slim, sharply cut lenses at the top corners of the nose, with two LED light bars.
    const hl = (x: number) => 0.705 + 0.035 * smoothstep(0.44, 0.62, Math.abs(x));
    const [h0, h1] = m(0.44, 0.97);
    add("body", "lens", facePatch(true, h0, h1, hl, (x) => 0.8 - 0.012 * smoothstep(0.8, 0.97, Math.abs(x)), "lens", 0.003), false);
    const [l0, l1] = m(0.5, 0.93);
    add("body", "ledWhite", facePatch(true, l0, l1, (x) => hl(x) + 0.055, (x) => hl(x) + 0.066, "ledWhite", 0.006), false);
    const [l2, l3] = m(0.58, 0.9);
    add("body", "ledWhite", facePatch(true, l2, l3, (x) => hl(x) + 0.018, (x) => hl(x) + 0.027, "ledWhite", 0.006), false);
    // Lower intakes.
    const [i0, i1] = m(0.5, 0.96);
    add("body", "trim", facePatch(true, i0, i1, k(0.36), (x) => 0.52 - 0.06 * smoothstep(0.5, 0.96, Math.abs(x)), "trim", 0.003), false);
    // Tail lamps: a slim L that wraps the rear corners, with a red light bar.
    const [r0, r1] = m(0.38, 1.02);
    add("body", "tailLens", facePatch(false, r0, r1, k(0.9), k(0.985), "tailLens", 0.003), false);
    const [r2, r3] = m(0.86, 1.02);
    add("body", "tailLens", facePatch(false, r2, r3, k(0.78), k(0.9), "tailLens", 0.003), false);
    const [q0, q1] = m(0.42, 1.0);
    add("body", "ledRed", facePatch(false, q0, q1, k(0.935), k(0.945), "ledRed", 0.006), false);
    const [q2, q3] = m(0.9, 0.915);
    add("body", "ledRed", facePatch(false, q2, q3, k(0.8), k(0.945), "ledRed", 0.006), false);
    // Rear diffuser.
    const [d0, d1] = m(0.05, 0.98);
    add("body", "trim", facePatch(false, d0, d1, k(0.43), k(0.52), "trim", 0.003), false);
  }

  // ---- side details, projected along X: fender vents, door handles
  const sideSurface = (driver: boolean): Surface => (zz, yy, out) => {
    const t = thetaAt(zz, yy);
    bodyPoint(zz, driver ? t : Math.PI - t, out);
    return out;
  };
  const sidePatch = (driver: boolean, z0: number, z1: number, y0: number, y1: number, offset: number, uv = false) => {
    const surf = sideSurface(driver);
    const ni = steps(z1 - z0, 0.025);
    const nj = steps(y1 - y0, 0.025);
    return patch(surf, ni, nj, (i, j, o) => {
      o.a = z0 + ((z1 - z0) * i) / ni;
      o.z = y0 + ((y1 - y0) * j) / nj;
    }, { offset, uv, flip: driver });
  };
  for (const driver of [true, false]) {
    add("body", "trim", sidePatch(driver, 1.3, 1.36, 0.66, 0.84, 0.004), false);
    add(driver ? "door" : "body", "chrome", sidePatch(driver, -0.34, -0.12, 0.905, 0.93, 0.008), false);
  }

  // M1 logo on both doors (UVs set so the logo reads the right way round on each side).
  const decalZ0 = 0.04;
  const decalZ1 = 0.5;
  const decalY0 = 0.34;
  const decalY1 = decalY0 + (decalZ1 - decalZ0) * 1.17;
  const decal = (driver: boolean) => {
    const g = sidePatch(driver, decalZ0, decalZ1, decalY0, decalY1, 0.004, true);
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    // Grid u runs along +z; flip on the driver's side, where the car's front is to the viewer's left.
    if (driver) for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    return g;
  };

  const merge = (list: THREE.BufferGeometry[] | undefined) => (list && list.length ? mergeGeometries(list, false) : null);
  const outer = { body: {}, door: {}, trunk: {} } as CarGeometry["outer"];
  for (const part of ["body", "door", "trunk"] as CarPart[]) {
    for (const [mat, list] of Object.entries(buckets[part]) as [CarMaterial, THREE.BufferGeometry[]][]) {
      const g = merge(list);
      if (g) outer[part][mat] = g;
    }
  }
  const inner = {
    body: merge(innerBuckets.body),
    door: merge(innerBuckets.door),
    trunk: merge(innerBuckets.trunk),
  };

  bodyPoint(CAR.glassFront, 0, base);
  const doorHinge = new THREE.Vector2(base.x - 0.02, CAR.glassFront);
  const trunkHinge = new THREE.Vector2(TOP(CAR.glassRear), CAR.glassRear);

  cached = { outer, inner, decal: { door: decal(true), body: decal(false) }, doorHinge, trunkHinge };
  return cached;
}

// ---------------------------------------------------------------- inverse lookups (for projected details)

const probe = new THREE.Vector3();

/** θ on the driver's side at which the section at z reaches height y. */
export function thetaAt(z: number, y: number) {
  const sec = section(z);
  let lo = -Math.PI / 2;
  let hi = Math.PI / 2;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (sectionPoint(sec, mid, probe).y < y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Half width of the body section at z and height y (0 outside the section). */
export function widthAt(z: number, y: number) {
  const sec = section(z);
  const b = sectionPoint(sec, -Math.PI / 2, probe).y;
  const t = sectionPoint(sec, Math.PI / 2, probe).y;
  if (y <= b || y >= t) return 0;
  return sectionPoint(sec, thetaAt(z, y), probe).x;
}

/**
 * The nose/tail surface as z(x, y): for each height, the section half-width
 * is tabulated from just past the wheel arch to the end of the car and
 * inverted by interpolation.
 */
const FACE_STEPS = 160;
const FACE_SPAN = { front: CAR.front - (CAR.frontAxle + CAR.archR + 0.03), rear: CAR.rearAxle - CAR.archR - 0.03 - CAR.rear };
const faceTables = new Map<string, Float64Array>();
const faceStart = (front: boolean) => (front ? CAR.front - FACE_SPAN.front : CAR.rear + FACE_SPAN.rear);
const faceStep = (front: boolean) => (front ? FACE_SPAN.front : FACE_SPAN.rear) / FACE_STEPS;
function faceTable(front: boolean, y: number) {
  const key = `${front ? "f" : "r"}${y.toFixed(5)}`;
  let table = faceTables.get(key);
  if (!table) {
    table = new Float64Array(FACE_STEPS + 1);
    for (let k = 0; k <= FACE_STEPS; k++) table[k] = widthAt(faceStart(front) + (front ? 1 : -1) * faceStep(front) * k, y);
    faceTables.set(key, table);
  }
  return table;
}
export function faceZ(front: boolean, x: number, y: number) {
  const table = faceTable(front, y);
  // From the tip back: the first sample wide enough, then interpolate towards the tip.
  let k = FACE_STEPS;
  while (k > 0 && table[k] < x) k--;
  const w0 = table[k];
  const w1 = table[Math.min(FACE_STEPS, k + 1)];
  const f = k === FACE_STEPS || w0 === w1 ? 0 : clamp01((w0 - x) / (w0 - w1));
  return faceStart(front) + (front ? 1 : -1) * faceStep(front) * (k + f);
}

/** Height of the body's top surface at (x, z) — for things resting on the bonnet/boot. */
export function topAt(z: number) {
  return bodyPoint(z, Math.PI / 2, probe).y;
}

/** Height of the roof's centre line at z. */
export function roofAt(z: number) {
  return glassPoint(z, 1.5, probe).y;
}
