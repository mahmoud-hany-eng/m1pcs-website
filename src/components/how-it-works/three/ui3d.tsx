"use client";

import { forwardRef, useImperativeHandle, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { COLORS, geo, labelTexture, type LabelStyle } from "./assets";
import { mulberry32 } from "./anim";

/** Camera-facing text pill. Height is in world units; width follows the text. */
export const LabelSprite = forwardRef<
  THREE.Sprite,
  { text: string; style?: LabelStyle; check?: boolean; height?: number; position?: [number, number, number]; onTop?: boolean }
>(function LabelSprite({ text, style = "dark", check = false, height = 0.12, position, onTop = false }, ref) {
  const tex = useMemo(() => labelTexture(text, style, check), [text, style, check]);
  return (
    <sprite ref={ref} position={position} scale={[height * tex.aspect, height, 1]} renderOrder={onTop ? 10 : 0}>
      <spriteMaterial map={tex.texture} transparent depthWrite={false} depthTest={!onTop} toneMapped={false} opacity={0} />
    </sprite>
  );
});

/** Camera-facing sprite for an arbitrary texture. */
export const TextureSprite = forwardRef<
  THREE.Sprite,
  { texture: THREE.Texture; width: number; height: number; position?: [number, number, number]; additive?: boolean }
>(function TextureSprite({ texture, width, height, position, additive = false }, ref) {
  return (
    <sprite ref={ref} position={position} scale={[width, height, 1]}>
      <spriteMaterial
        map={texture}
        transparent
        depthWrite={false}
        toneMapped={false}
        opacity={0}
        blending={additive ? THREE.AdditiveBlending : THREE.NormalBlending}
      />
    </sprite>
  );
});

export interface ConfettiApi {
  /** t: seconds-equivalent since the burst (scroll-derived, so fully reversible). */
  set(t: number, visible: boolean): void;
}

/**
 * Deterministic confetti: every flake's path is a closed-form ballistic
 * curve of `t`, so scrolling backwards un-bursts it exactly.
 */
export const Confetti = forwardRef<ConfettiApi, { count?: number; spread?: number; power?: number; position?: [number, number, number] }>(
  function Confetti({ count = 90, spread = 1.4, power = 2.6, position }, ref) {
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
          size: 0.035 + rand() * 0.03,
        };
      });
    }, [count, spread, power]);

    useLayoutEffect(() => {
      const palette = [COLORS.red, COLORS.gold, COLORS.white, COLORS.gold, COLORS.red];
      const c = new THREE.Color();
      for (let i = 0; i < count; i++) {
        c.set(palette[i % palette.length]);
        mesh.current.setColorAt(i, c);
      }
      if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
    }, [count]);

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
  },
);
