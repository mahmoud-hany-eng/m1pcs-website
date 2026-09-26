import type { RefObject } from "react";
import * as THREE from "three";
import type { AnchorStore } from "../anchors";
import type { Timeline } from "../timeline";
import type { CharacterApi } from "./Character";
import { POSE_KEYS } from "./poses";

/**
 * Development-only probes (never bundled in production) used by the
 * automated scroll-scrub tests:
 *
 *  __hiwState()          what is on screen now: story position, camera, a
 *                        fingerprint of every transform, both character poses
 *  __hiwEval(s)          evaluates the world at story position s (no scroll)
 *  __hiwSweep(a, b, h)   walks s from a to b in steps of h and reports every
 *                        discontinuity (a value that jumps instead of moving)
 */
interface ProbeDeps {
  scene: THREE.Scene;
  camera: THREE.Camera;
  evaluate: (s: number, settled: boolean) => void;
  timeline: Timeline;
  rep: RefObject<CharacterApi | null>;
  customer: RefObject<CharacterApi | null>;
  anchors: AnchorStore;
  invalidate: () => void;
}


export function installProbes({ scene, camera, evaluate, timeline, rep, customer, anchors, invalidate }: ProbeDeps) {
  // Stable list of every object (the graph does not change while scrubbing).
  const objects: THREE.Object3D[] = [];
  const paths: string[] = [];
  const index = () => {
    objects.length = 0;
    paths.length = 0;
    const walk = (o: THREE.Object3D, path: string) => {
      objects.push(o);
      paths.push(path);
      o.children.forEach((c, i) => walk(c, `${path}/${c.name || c.type}[${i}]`));
    };
    walk(scene, "scene");
  };

  // Per object: world position xyz, world quaternion xyzw, effective world scale
  // (0 when the object or any ancestor is hidden).
  const PER_OBJECT = 8;
  const wp = new THREE.Vector3();
  const wq = new THREE.Quaternion();
  const ws = new THREE.Vector3();
  const shown = (o: THREE.Object3D) => {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
  const collect = () => {
    if (!objects.length) index();
    scene.updateMatrixWorld(true);
    const poseKeys = POSE_KEYS.length;
    const out = new Float64Array(objects.length * PER_OBJECT + 2 * (poseKeys + 3) + 12 + anchors.size() * 4);
    let k = 0;
    for (const o of objects) {
      // Hidden objects have no visual state: record them as zeros.
      if (!shown(o)) {
        for (let j = 0; j < PER_OBJECT; j++) out[k++] = 0;
        continue;
      }
      o.matrixWorld.decompose(wp, wq, ws);
      if (wq.w < 0) wq.set(-wq.x, -wq.y, -wq.z, -wq.w);
      out[k++] = wp.x;
      out[k++] = wp.y;
      out[k++] = wp.z;
      out[k++] = wq.x;
      out[k++] = wq.y;
      out[k++] = wq.z;
      out[k++] = wq.w;
      // Effective size: world scale, times material opacity for faded transparents
      // (a pop at opacity 0 is invisible), zero when hidden. Only drawable objects count.
      const mat = (o as THREE.Mesh).material as THREE.Material | undefined;
      const fadeK = mat && !Array.isArray(mat) && mat.transparent ? mat.opacity : 1;
      const drawable = (o as THREE.Mesh).isMesh || (o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Line).isLine;
      out[k++] = drawable && shown(o) ? Math.max(Math.abs(ws.x), Math.abs(ws.y), Math.abs(ws.z)) * fadeK : 0;
    }
    for (const c of [rep.current, customer.current]) {
      const on = !!c && c.root.visible;
      for (const key of POSE_KEYS) out[k++] = on ? c.target[key] : 0;
      out[k++] = on ? c.root.position.x : 0;
      out[k++] = on ? c.root.position.z : 0;
      out[k++] = on ? c.root.rotation.y : 0;
    }
    camera.updateMatrixWorld();
    for (let i = 0; i < 12; i++) out[k++] = camera.matrixWorld.elements[i < 3 ? i : i + 1];
    // Anchors: opacity always; position only matters while the label is visible.
    anchors.debugEach((_, a) => {
      const on = a.opacity > 0.01;
      out[k++] = a.opacity;
      out[k++] = on ? a.pos.x : 0;
      out[k++] = on ? a.pos.y : 0;
      out[k++] = on ? a.pos.z : 0;
    });
    return out;
  };

  const label = (i: number) => {
    const objCount = objects.length * PER_OBJECT;
    if (i < objCount) {
      const o = Math.floor(i / PER_OBJECT);
      return `${paths[o]} :: ${["x", "y", "z", "rot", "rot", "rot", "rot", "scale"][i % PER_OBJECT]}`;
    }
    let j = i - objCount;
    const per = POSE_KEYS.length + 3;
    if (j < per * 2) {
      const who = j < per ? "rep" : "customer";
      j %= per;
      return `${who}.${j < POSE_KEYS.length ? POSE_KEYS[j] : ["x", "z", "yaw"][j - POSE_KEYS.length]}`;
    }
    j -= per * 2;
    if (j < 12) return `camera.m${j}`;
    j -= 12;
    const ids: string[] = [];
    anchors.debugEach((id) => ids.push(id));
    return `anchor ${ids[Math.floor(j / 4)]}.${["opacity", "x", "y", "z"][j % 4]}`;
  };

  const snapshot = (s: number) => {
    evaluate(s, true);
    return collect();
  };

  /** Rotations compare as the angle between quaternions; everything else directly. */
  let cmpA: Float64Array | null = null;
  let cmpB: Float64Array | null = null;
  const delta = (a: number, b: number, i: number) => {
    if (i < objects.length * PER_OBJECT) {
      const comp = i % PER_OBJECT;
      // Hidden / non-drawable objects: only their (zero) size counts.
      const base = i - comp + 7;
      if (comp !== 7 && cmpA && cmpB && (cmpA[base] === 0 || cmpB[base] === 0)) return 0;
      if (comp >= 4 && comp <= 6) return 0;
      if (comp === 3 && cmpA && cmpB) {
        const dot = Math.abs(cmpA[i] * cmpB[i] + cmpA[i + 1] * cmpB[i + 1] + cmpA[i + 2] * cmpB[i + 2] + cmpA[i + 3] * cmpB[i + 3]);
        return 2 * Math.acos(Math.min(1, dot));
      }
    }
    // Anchor positions only count while the label is visible on both sides.
    const anchorBase = objects.length * PER_OBJECT + 2 * (POSE_KEYS.length + 3) + 12;
    if (i >= anchorBase && cmpA && cmpB) {
      const comp = (i - anchorBase) % 4;
      const o = i - comp;
      if (comp !== 0 && (cmpA[o] <= 0.01 || cmpB[o] <= 0.01)) return 0;
    }
    return Math.abs(a - b);
  };
  const w = window as unknown as Record<string, unknown>;
  w.__hiwState = () => {
    const snap = collect();
    let hash = 0;
    for (let i = 0; i < snap.length; i++) hash = (hash + snap[i] * ((i % 97) + 1)) % 1e9;
    return { s: timeline.s, progress: timeline.progress, target: timeline.target, settled: timeline.settled, hash, values: Array.from(snap) };
  };
  w.__hiwEval = (s: number) => {
    const snap = snapshot(s);
    invalidate();
    return Array.from(snap);
  };
  w.__hiwLabel = (i: number) => label(i);
  w.__hiwSweep = (a: number, b: number, h: number, tol = 0.004) => {
    index();
    const found: { s: number; what: string; jump: number }[] = [];
    const seen = new Set<string>();
    let s0 = a;
    let v0 = snapshot(s0);
    let s1 = a + h;
    let v1 = snapshot(s1);
    const n = v0.length;
    for (let s2 = a + 2 * h; s2 <= b + 1e-9; s2 += h) {
      const v2 = snapshot(s2);
      for (let i = 0; i < n; i++) {
        cmpA = v1;
        cmpB = v0;
        const d1 = delta(v1[i], v0[i], i);
        cmpA = v2;
        cmpB = v1;
        const d2 = delta(v2[i], v1[i], i);
        // A jump shows up as one step far larger than its neighbours.
        if (d2 > tol && d2 > 5 * d1) {
          // Confirm by bisection: a continuous value stops changing as the interval shrinks.
          let lo = s1;
          let hi = s2;
          let aLo = v1;
          let aHi = v2;
          const d = (x: Float64Array, y: Float64Array) => {
            cmpA = x;
            cmpB = y;
            return delta(x[i], y[i], i);
          };
          for (let r = 0; r < 22; r++) {
            const mid = (lo + hi) / 2;
            const vm = snapshot(mid);
            if (d(vm, aLo) >= d(aHi, vm)) {
              hi = mid;
              aHi = vm;
            } else {
              lo = mid;
              aLo = vm;
            }
          }
          const jump = d(aHi, aLo);
          const what = label(i);
          const key = `${what}@${lo.toFixed(3)}`;
          if (jump > tol / 2 && !seen.has(key)) {
            seen.add(key);
            found.push({ s: +lo.toFixed(5), what, jump: +jump.toFixed(4) });
          }
        }
      }
      s0 = s1;
      v0 = v1;
      s1 = s2;
      v1 = v2;
    }
    invalidate();
    return found;
  };

  return () => {
    for (const k of ["__hiwState", "__hiwEval", "__hiwLabel", "__hiwSweep"]) delete w[k];
  };
}
