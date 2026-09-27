import * as THREE from "three";

/**
 * Crisp UI for a 3D scene: every label, chip and card in the story is a
 * real DOM/SVG element (sharp at any pixel density), pinned to a point in
 * the 3D world. Scenes write positions/opacity/state into anchors each
 * frame; `project` then moves the elements with compositor-only style
 * writes — no React re-renders and no text baked into textures.
 *
 * Text is never scaled by a transform (a scaled layer is a resampled
 * bitmap, i.e. soft text): elements only translate, snap to whole pixels
 * once the scroll settles, and — when a card could not fit a small screen —
 * shrink through CSS `zoom`, which lays the text out again at its new size.
 */

export type AnchorAlign = "above" | "center" | "below";

const ALIGN: Record<AnchorAlign, string> = {
  above: "translate(-50%, -100%)",
  center: "translate(-50%, -50%)",
  below: "translate(-50%, 0)",
};

/**
 * The part of the overlay anchored UI may use, in CSS px from its edges:
 * below the progress bar, above the caption, off the screen edges.
 */
export interface SafeArea {
  top: number;
  bottom: number;
  edge: number;
}

const v = new THREE.Vector3();
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export class Anchor {
  el: HTMLElement | null = null;
  /** World-space position the element is pinned to. */
  readonly pos = new THREE.Vector3();
  opacity = 0;
  /** Extra screen-space offset in CSS px (e.g. lay out a cluster around one point, or an entrance lift). */
  offsetX = 0;
  offsetY = 0;
  /**
   * Optional screen slot, as fractions of the safe area. With `slotMix` > 0
   * the element blends from its 3D point towards the slot — for HUD-style
   * clusters that must sit in a set place on narrow screens.
   */
  slotX = 0.5;
  slotY = 0.5;
  slotMix = 0;
  align: AnchorAlign = "above";
  /** Size of the element at fit 1 (from the store's ResizeObserver). */
  w = 0;
  h = 0;
  /** Zoom applied so the element fits the safe area (1 almost always). */
  fit = 1;

  private x = NaN;
  private y = NaN;
  private lastTransform = "";
  private lastOpacity = -1;
  private attrs = new Map<string, string | null>();
  private vars = new Map<string, number>();
  private texts = new Map<string, string>();

  /** Toggle a data-* attribute (only touches the DOM when it changes). */
  flag(name: string, on: boolean) {
    this.attr(name, on ? "" : null);
  }

  attr(name: string, value: string | null) {
    if (this.attrs.get(name) === value) return;
    this.attrs.set(name, value);
    if (!this.el) return;
    if (value === null) this.el.removeAttribute(`data-${name}`);
    else this.el.setAttribute(`data-${name}`, value);
  }

  /** Set a CSS custom property (0..1 values drive fills and reveals in CSS). */
  cssVar(name: string, value: number) {
    // Quantise, then compare: the shown value depends only on the current one (never on history).
    const q = Math.round(value * 1000) / 1000;
    if (this.vars.get(name) === q) return;
    this.vars.set(name, q);
    this.el?.style.setProperty(`--${name}`, q.toFixed(3));
  }

  /** Replace the text of a descendant marked with data-slot="name". */
  text(slot: string, value: string) {
    if (this.texts.get(slot) === value) return;
    this.texts.set(slot, value);
    const node = this.el?.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
    if (node) node.textContent = value;
  }

  hide() {
    if (!this.el || this.lastOpacity === 0) return;
    this.lastOpacity = 0;
    this.el.style.opacity = "0";
    this.el.style.visibility = "hidden";
  }

  setFit(fit: number) {
    if (fit === this.fit) return;
    this.fit = fit;
    this.el?.style.setProperty("--fit", String(fit));
  }

  place(rawX: number, rawY: number, settled: boolean) {
    const el = this.el;
    if (!el) return;
    // Snap to whole pixels when (nearly) still so text lands on exact pixels
    // and stays razor-sharp; keep sub-pixel precision while moving so motion
    // stays smooth.
    const moving = !settled && !(Math.abs(rawX - this.x) < 0.6 && Math.abs(rawY - this.y) < 0.6);
    this.x = rawX;
    this.y = rawY;
    const x = moving ? rawX.toFixed(2) : Math.round(rawX);
    const y = moving ? rawY.toFixed(2) : Math.round(rawY);
    const transform = `translate3d(${x}px, ${y}px, 0) ${ALIGN[this.align]}`;
    if (transform !== this.lastTransform) {
      this.lastTransform = transform;
      el.style.transform = transform;
    }
    const o = Math.round(Math.min(1, this.opacity) * 1000) / 1000;
    if (o !== this.lastOpacity) {
      this.lastOpacity = o;
      el.style.opacity = String(o);
      el.style.visibility = "visible";
    }
  }

  /** Re-apply cached state after (re)binding an element. */
  rebind(el: HTMLElement | null) {
    this.el = el;
    this.lastTransform = "";
    this.lastOpacity = -1;
    this.x = NaN;
    this.y = NaN;
    if (!el) return;
    el.style.setProperty("--fit", String(this.fit));
    this.w = el.offsetWidth / this.fit;
    this.h = el.offsetHeight / this.fit;
    this.attrs.forEach((value, name) => {
      if (value === null) el.removeAttribute(`data-${name}`);
      else el.setAttribute(`data-${name}`, value);
    });
    this.vars.forEach((value, name) => el.style.setProperty(`--${name}`, value.toFixed(3)));
    this.texts.forEach((value, slot) => {
      const node = el.querySelector<HTMLElement>(`[data-slot="${slot}"]`);
      if (node) node.textContent = value;
    });
  }
}

export class AnchorStore {
  private anchors = new Map<string, Anchor>();
  private byElement = new Map<Element, Anchor>();
  private sizes: ResizeObserver | null = null;

  get(id: string): Anchor {
    let a = this.anchors.get(id);
    if (!a) {
      a = new Anchor();
      this.anchors.set(id, a);
    }
    return a;
  }

  size() {
    return this.anchors.size;
  }

  /** Test-only iteration (stable insertion order). */
  debugEach(fn: (id: string, a: Anchor) => void) {
    this.anchors.forEach((a, id) => fn(id, a));
  }

  bind(id: string, el: HTMLElement | null) {
    const a = this.get(id);
    if (a.el) {
      this.sizes?.unobserve(a.el);
      this.byElement.delete(a.el);
    }
    a.rebind(el);
    if (!el) return;
    this.sizes ??= new ResizeObserver((entries) => {
      for (const entry of entries) {
        const anchor = this.byElement.get(entry.target);
        const box = entry.borderBoxSize?.[0];
        if (!anchor) continue;
        // Measured at the zoom currently applied; keep the size at fit 1.
        anchor.w = (box ? box.inlineSize : (entry.target as HTMLElement).offsetWidth) / anchor.fit;
        anchor.h = (box ? box.blockSize : (entry.target as HTMLElement).offsetHeight) / anchor.fit;
      }
    });
    this.byElement.set(el, a);
    this.sizes.observe(el);
  }

  /**
   * Projects every anchor through the camera into the overlay (which covers
   * the canvas exactly) and writes the resulting transforms. Elements are
   * kept inside the safe area — zoomed down (in 5 % steps) if they could
   * never fit, then nudged in from the edges — so no card or label is ever
   * cut off or covers the caption, on any screen.
   */
  project(camera: THREE.Camera, width: number, height: number, safe: SafeArea, settled = true) {
    const left = safe.edge;
    const right = width - safe.edge;
    const top = safe.top;
    const bottom = height - safe.bottom;
    this.anchors.forEach((a) => {
      if (!a.el) return;
      if (a.opacity <= 0.002) return a.hide();
      v.copy(a.pos).project(camera);
      if (v.z > 1 || v.z < -1) return a.hide();
      let x = (v.x * 0.5 + 0.5) * width;
      let y = (-v.y * 0.5 + 0.5) * height;
      if (a.slotMix > 0) {
        x += (left + (right - left) * a.slotX - x) * a.slotMix;
        y += (top + (bottom - top) * a.slotY - y) * a.slotMix;
      }
      x += a.offsetX;
      y += a.offsetY;
      if (a.w > 0 && a.h > 0 && right > left && bottom > top) {
        const fit = Math.max(0.5, Math.floor(Math.min(1, (right - left) / a.w, (bottom - top) / a.h) * 20) / 20);
        a.setFit(fit);
        const w = a.w * fit;
        const h = a.h * fit;
        const above = a.align === "above" ? h : a.align === "center" ? h / 2 : 0;
        x = clamp(x, left + w / 2, right - w / 2);
        y = clamp(y, top + above, bottom - (h - above));
      }
      a.place(x, y, settled);
    });
  }
}
