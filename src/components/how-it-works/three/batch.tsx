"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Draw-call batching for static set pieces. Once mounted, every opaque mesh
 * under this group that never moves relative to it is baked into one mesh
 * per material (and shadow setting); the originals are taken out of the
 * render (layer 0 off — they stay in the scene graph, untouched). A house of
 * eighty boxes becomes a dozen draws.
 *
 * Subtrees that a script moves, spins or toggles (doors, wheels, fan blades,
 * parts that fly in) must be marked `userData={{ dynamic: true }}`: they are
 * left exactly as they are. A nested Batch handles its own subtree.
 */
export function Batch({ children, name }: { children?: ReactNode; name?: string }) {
  const root = useRef<THREE.Group>(null!);

  useLayoutEffect(() => {
    const group = root.current;
    group.updateWorldMatrix(true, true);
    const toLocal = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const rel = new THREE.Matrix4();
    const buckets = new Map<string, { sample: THREE.Mesh; parts: THREE.BufferGeometry[]; sources: THREE.Mesh[] }>();

    const visit = (o: THREE.Object3D) => {
      if (!o.visible || o.userData.dynamic || o.userData.batchRoot) return;
      const mesh = o as THREE.Mesh;
      const material = mesh.material as THREE.Material;
      if (mesh.isMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(mesh.material) && !material.transparent && !mesh.morphTargetInfluences) {
        const g = mesh.geometry;
        // Untextured materials only need positions and normals, so boxes, spheres and custom
        // surfaces of one material can share a draw.
        const textured = Object.values(material).some((v) => (v as THREE.Texture | null)?.isTexture);
        const names = Object.keys(g.attributes).filter((k) => textured || k === "position" || k === "normal" || k === "color");
        const sig = names.sort().map((k) => `${k}${g.attributes[k].itemSize}`).join(",");
        const key = `${material.uuid}|${+mesh.castShadow}${+mesh.receiveShadow}|${mesh.renderOrder}|${sig}|${g.index ? 1 : 0}`;
        let bucket = buckets.get(key);
        if (!bucket) buckets.set(key, (bucket = { sample: mesh, parts: [], sources: [] }));
        const part = new THREE.BufferGeometry();
        for (const k of names) part.setAttribute(k, g.attributes[k].clone());
        if (g.index) part.setIndex(g.index.clone());
        part.applyMatrix4(rel.multiplyMatrices(toLocal, mesh.matrixWorld));
        if (rel.determinant() < 0) flipWinding(part);
        bucket.parts.push(part);
        bucket.sources.push(mesh);
      }
      for (const c of o.children) visit(c);
    };
    for (const c of group.children) visit(c);

    const merged: THREE.Mesh[] = [];
    const hidden: THREE.Mesh[] = [];
    for (const { sample, parts, sources } of buckets.values()) {
      const geometry = parts.length > 1 ? mergeGeometries(parts, false) : null;
      for (const p of parts) p.dispose();
      if (!geometry) continue;
      const mesh = new THREE.Mesh(geometry, sample.material);
      mesh.castShadow = sample.castShadow;
      mesh.receiveShadow = sample.receiveShadow;
      mesh.renderOrder = sample.renderOrder;
      mesh.name = "batched";
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      merged.push(mesh);
      for (const s of sources) {
        s.layers.disable(0);
        hidden.push(s);
      }
    }

    return () => {
      for (const m of merged) {
        group.remove(m);
        m.geometry.dispose();
      }
      for (const s of hidden) s.layers.enable(0);
    };
  }, []);

  return <group ref={root} name={name} userData={{ batchRoot: true }}>{children}</group>;
}

/** Reverses triangle winding (for parts baked through a mirroring transform). */
function flipWinding(g: THREE.BufferGeometry) {
  if (g.index) {
    const idx = g.index.array;
    for (let i = 0; i + 2 < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    return;
  }
  for (const a of Object.values(g.attributes)) {
    const arr = a.array;
    const n = a.itemSize;
    for (let v = 0; v + 2 < a.count; v += 3) {
      for (let k = 0; k < n; k++) {
        const i1 = (v + 1) * n + k;
        const i2 = (v + 2) * n + k;
        const t = arr[i1];
        arr[i1] = arr[i2];
        arr[i2] = t;
      }
    }
  }
}
