import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

/**
 * Shared, lazily-created geometries / materials / canvas textures. Every
 * prop in the story is built from these primitives, so the whole experience
 * ships with zero model or image files and a handful of GPU buffers.
 */

export const COLORS = {
  red: "#e73225",
  redDark: "#9d2e16",
  gold: "#f9c204",
  white: "#f5f5f7",
  offWhite: "#e9e6e0",
  ink: "#0a0a0b",
  surface: "#151517",
  charcoal: "#1d1d20",
  graphite: "#2a2a2e",
  steel: "#9a9aa3",
  muted: "#75757c",
  pcb: "#15181c",
  cardboard: "#b98a57",
  skinRep: "#c68b64",
  skinCustomer: "#e2ae88",
  hairRep: "#1f1a18",
  hairCustomer: "#3a2419",
  pants: "#1b1c21",
  denim: "#2b3140",
  warm: "#ffc46b",
} as const;

// ---------------------------------------------------------------- materials

const materialCache = new Map<string, THREE.Material>();

interface StdOptions {
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
}

export function std(color: string, o: StdOptions = {}): THREE.MeshStandardMaterial {
  const key = `std|${color}|${JSON.stringify(o)}`;
  let m = materialCache.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: o.roughness ?? 0.55,
      metalness: o.metalness ?? 0.05,
      emissive: o.emissive ?? "#000000",
      emissiveIntensity: o.emissiveIntensity ?? 1,
      transparent: o.transparent ?? false,
      opacity: o.opacity ?? 1,
      side: o.side ?? THREE.FrontSide,
    });
    materialCache.set(key, m);
  }
  return m;
}

/** Unlit, tone-map-free colour — for neon, LEDs, glows and UI accents. */
export function glow(color: string, opacity = 1): THREE.MeshBasicMaterial {
  const key = `glow|${color}|${opacity}`;
  let m = materialCache.get(key) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      toneMapped: false,
      depthWrite: opacity >= 1,
    });
    materialCache.set(key, m);
  }
  return m;
}

// ---------------------------------------------------------------- geometries

const geometryCache = new Map<string, THREE.BufferGeometry>();

function cached<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geometryCache.get(key) as T | undefined;
  if (!g) {
    g = make();
    geometryCache.set(key, g);
  }
  return g;
}

export const geo = {
  box: () => cached("box", () => new THREE.BoxGeometry(1, 1, 1)),
  sphere: (detail: "lo" | "hi" = "hi") =>
    cached(`sphere|${detail}`, () =>
      detail === "hi" ? new THREE.SphereGeometry(1, 28, 20) : new THREE.SphereGeometry(1, 14, 10),
    ),
  hemisphere: () =>
    cached("hemi", () => new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)),
  capsule: (radius: number, length: number) =>
    cached(`cap|${radius}|${length}`, () => new THREE.CapsuleGeometry(radius, length, 6, 14)),
  roundBox: (w: number, h: number, d: number, r = 0.02) =>
    cached(`rb|${w}|${h}|${d}|${r}`, () => new RoundedBoxGeometry(w, h, d, 3, r)),
  cylinder: (top = 1, bottom = 1, segments = 28) =>
    cached(`cyl|${top}|${bottom}|${segments}`, () => new THREE.CylinderGeometry(top, bottom, 1, segments)),
  torus: (radius: number, tube: number, arc = Math.PI * 2) =>
    cached(`tor|${radius}|${tube}|${arc}`, () => new THREE.TorusGeometry(radius, tube, 8, 40, arc)),
  ring: (inner: number, outer: number) =>
    cached(`ring|${inner}|${outer}`, () => new THREE.RingGeometry(inner, outer, 48)),
  circle: (segments = 40) => cached(`circle|${segments}`, () => new THREE.CircleGeometry(1, segments)),
  plane: () => cached("plane", () => new THREE.PlaneGeometry(1, 1)),
  cone: () => cached("cone", () => new THREE.ConeGeometry(1, 1, 20)),
};

// ---------------------------------------------------------------- fonts

let fontCache: { display: string; sans: string } | null = null;

/** Resolves the next/font family names so canvas text matches the site. */
export function fonts() {
  if (fontCache) return fontCache;
  const root = getComputedStyle(document.documentElement);
  const display = root.getPropertyValue("--font-space-grotesk").trim();
  const sans = root.getPropertyValue("--font-inter").trim();
  fontCache = {
    display: `${display ? display + ", " : ""}ui-sans-serif, system-ui, sans-serif`,
    sans: `${sans ? sans + ", " : ""}ui-sans-serif, system-ui, sans-serif`,
  };
  return fontCache;
}

// ---------------------------------------------------------------- canvas textures

const textureCache = new Map<string, THREE.CanvasTexture>();

export function canvasTexture(
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
): THREE.CanvasTexture {
  let tex = textureCache.get(key);
  if (tex) return tex;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  draw(ctx, width, height);
  tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textureCache.set(key, tex);
  return tex;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawCheck(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string, width: number) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.5, cy + size * 0.02);
  ctx.lineTo(cx - size * 0.14, cy + size * 0.36);
  ctx.lineTo(cx + size * 0.52, cy - size * 0.34);
  ctx.stroke();
  ctx.restore();
}

export type LabelStyle = "dark" | "gold" | "red" | "white";

const LABEL_STYLES: Record<LabelStyle, { bg: string; fg: string; border: string }> = {
  dark: { bg: "rgba(21,21,23,0.92)", fg: COLORS.white, border: "rgba(255,255,255,0.14)" },
  gold: { bg: COLORS.gold, fg: "#111111", border: COLORS.gold },
  red: { bg: COLORS.red, fg: "#ffffff", border: COLORS.red },
  white: { bg: COLORS.white, fg: "#111111", border: COLORS.white },
};

/** Pill label (optionally with a leading check mark). Returns texture + aspect. */
export function labelTexture(text: string, style: LabelStyle = "dark", check = false) {
  const f = fonts();
  const h = 96;
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.font = `700 44px ${f.display}`;
  const textW = probe.measureText(text).width;
  const pad = 40;
  const checkW = check ? 56 : 0;
  const w = Math.ceil(textW + pad * 2 + checkW);
  const tex = canvasTexture(`label|${text}|${style}|${check}`, w, h, (ctx) => {
    const s = LABEL_STYLES[style];
    roundRect(ctx, 3, 3, w - 6, h - 6, (h - 6) / 2);
    ctx.fillStyle = s.bg;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = s.border;
    ctx.stroke();
    if (check) drawCheck(ctx, pad + 18, h / 2, 34, s.fg, 7);
    ctx.font = `700 44px ${f.display}`;
    ctx.fillStyle = s.fg;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(text, pad + checkW, h / 2 + 2);
  });
  return { texture: tex, aspect: w / h };
}

/** Soft radial glow sprite texture. */
export function glowTexture(color: string) {
  return canvasTexture(`glow|${color}`, 128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, color);
    g.addColorStop(0.35, color + "88");
    g.addColorStop(1, color + "00");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}
