"use client";

import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { COLORS, geo } from "./assets";
import { mulberry32 } from "./anim";

export interface ConfettiApi {
  /** t: seconds-equivalent since the burst (derived from the story position, so it rewinds too). */
  set(t: number, visible: boolean): void;
}

const PALETTES = {
  brand: [COLORS.red, COLORS.gold, COLORS.white, COLORS.gold, COLORS.red],
  gold: [COLORS.gold, "#fff1b8", COLORS.gold, COLORS.white],
} as const;

/**
 * Deterministic confetti: every flake's path is a closed-form ballistic
 * curve of `t`, so scrolling backwards un-bursts it exactly.
 */
export const Confetti = forwardRef<
  ConfettiApi,
  { count?: number; spread?: number; power?: number; position?: [number, number, number]; palette?: keyof typeof PALETTES }
>(function Confetti({ count = 90, spread = 1.4, power = 2.6, position, palette = "brand" }, ref) {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const flakes = useMemo(() => {
    const rand = mulberry32(count * 7 + 11);
    return Array.from({ length: count }, () => {
      const a = rand() * Math.PI * 2;
      const up = 0.55 + rand() * 0.6;
      const out = rand() * spread;
      return {
        v: new THREE.Vector3(Math.cos(a) * out, up * power, Math.sin(a) * out * 0.7 + 0.25),
        spin: new THREE.Vector3(rand() * 9, rand() * 9, rand() * 9),
        size: 0.03 + rand() * 0.025,
      };
    });
  }, [count, spread, power]);

  useLayoutEffect(() => {
    const colors = PALETTES[palette];
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      c.set(colors[i % colors.length]);
      mesh.current.setColorAt(i, c);
    }
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
  }, [count, palette]);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  useImperativeHandle(
    ref,
    () => ({
      set(t, visible) {
        mesh.current.visible = visible && t > 0;
        if (!mesh.current.visible) return;
        const g = -3.2;
        flakes.forEach((fl, i) => {
          const drag = 1 - Math.exp(-t * 1.6);
          dummy.position.set(fl.v.x * drag * 0.9, fl.v.y * t + 0.5 * g * t * t, fl.v.z * drag * 0.9);
          dummy.rotation.set(fl.spin.x * t, fl.spin.y * t, fl.spin.z * t);
          const fade = Math.max(0, 1 - t / 1.6);
          dummy.scale.set(fl.size * fade, fl.size * 1.6 * fade, 1);
          dummy.updateMatrix();
          mesh.current.setMatrixAt(i, dummy.matrix);
        });
        mesh.current.instanceMatrix.needsUpdate = true;
      },
    }),
    [flakes, dummy],
  );

  return (
    <instancedMesh ref={mesh} args={[geo.plane(), undefined, count]} position={position} frustumCulled={false} visible={false}>
      <meshBasicMaterial toneMapped={false} side={THREE.DoubleSide} />
    </instancedMesh>
  );
});
