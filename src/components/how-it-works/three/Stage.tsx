"use client";

import { Suspense, useMemo, useRef } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { COLORS, canvasTexture, geo, glow, std } from "./assets";

export const TABLE_TOP_Y = 0.95;
export const TABLE_SIZE = { w: 2.7, d: 1.25 };
export const STAGE_RADIUS = 4.35;

/** Head height, centred between the figures, so every studio shot keeps the whole logo in frame. */
const LOGO_POS = new THREE.Vector3(0, 1.8, -2.3);
const LOGO_HEIGHT = 1.02;

/** Soft red floor glow. Dithered so dark gradients never band on 8-bit screens. */
function floorGlowTexture() {
  return canvasTexture("floor-glow-dithered", 512, 512, (ctx, w, h) => {
    const img = ctx.createImageData(w, h);
    const d = img.data;
    let seed = 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = (x + 0.5) / w - 0.5;
        const dy = (y + 0.5) / h - 0.5;
        const r = Math.sqrt(dx * dx + dy * dy) * 2;
        const f = Math.max(0, 1 - r);
        const k = f * f * (3 - 2 * f);
        seed = (seed * 16807) % 2147483647;
        const noise = (seed / 2147483647 - 0.5) * 1.6;
        const i = (y * w + x) * 4;
        d[i] = Math.max(0, Math.min(255, 231 * 0.24 * k + noise));
        d[i + 1] = Math.max(0, Math.min(255, 36 * 0.24 * k + noise));
        d[i + 2] = Math.max(0, Math.min(255, 30 * 0.24 * k + noise));
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

/** The official M1 logo, lit like a neon sign (the glow comes from the logo itself). */
function LogoSign({ intensity }: { intensity: React.RefObject<number> }) {
  const [sign, halo] = useLoader(THREE.TextureLoader, ["/how-it-works/m1-logo-sign.webp", "/how-it-works/m1-logo-glow.webp"]);
  const haloMat = useRef<THREE.MeshBasicMaterial>(null!);
  useMemo(() => {
    for (const t of [sign, halo]) {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
    }
  }, [sign, halo]);
  const aspect = sign.image.width / sign.image.height;

  useFrame((state) => {
    const breathe = 0.62 + Math.sin(state.clock.elapsedTime * 1.3) * 0.05;
    haloMat.current.opacity = breathe * (intensity.current ?? 1);
  });

  return (
    <group position={LOGO_POS}>
      <mesh geometry={geo.plane()} scale={[LOGO_HEIGHT * aspect, LOGO_HEIGHT, 1]} position={[0, 0, 0.02]}>
        <meshBasicMaterial ref={haloMat} map={halo} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh geometry={geo.plane()} scale={[LOGO_HEIGHT * aspect, LOGO_HEIGHT, 1]} position={[0, 0, 0.03]}>
        <meshBasicMaterial map={sign} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * The M1 studio: round stage with a single neon rim, the consultation /
 * workshop table, and the official logo on the back wall.
 */
export function Stage({ receiveShadow, logoIntensity }: { receiveShadow: boolean; logoIntensity: React.RefObject<number> }) {
  const floorGlow = useMemo(() => floorGlowTexture(), []);
  const tableMat = std(COLORS.charcoal, { roughness: 0.42, metalness: 0.15 });
  const wallMat = std("#0d0d0f", { roughness: 0.75, metalness: 0.1 });

  return (
    <group>
      {/* platform */}
      <mesh geometry={geo.cylinder(STAGE_RADIUS, STAGE_RADIUS + 0.12, 72)} material={std("#0c0c0e", { roughness: 0.6, metalness: 0.25 })} position={[0, -0.09, 0]} scale={[1, 0.18, 1]} receiveShadow={receiveShadow} />
      <mesh geometry={geo.circle(72)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} scale={STAGE_RADIUS}>
        <meshBasicMaterial map={floorGlow} transparent depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh geometry={geo.torus(STAGE_RADIUS + 0.02, 0.03)} material={glow(COLORS.red)} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} />

      {/* back wall with the logo */}
      <mesh geometry={geo.roundBox(4.2, 2.7, 0.12, 0.06)} material={wallMat} position={[0, 2.05, -2.42]} receiveShadow={receiveShadow} />
      <mesh geometry={geo.box()} material={glow(COLORS.red, 0.85)} position={[0, 0.72, -2.35]} scale={[3.9, 0.018, 0.012]} />
      <Suspense fallback={null}>
        <LogoSign intensity={logoIntensity} />
      </Suspense>

      {/* table */}
      <group>
        <mesh geometry={geo.roundBox(TABLE_SIZE.w, 0.09, TABLE_SIZE.d, 0.04)} material={tableMat} position={[0, TABLE_TOP_Y - 0.045, 0]} castShadow={receiveShadow} receiveShadow={receiveShadow} />
        <mesh geometry={geo.box()} material={glow(COLORS.red)} position={[0, TABLE_TOP_Y - 0.06, TABLE_SIZE.d / 2 + 0.004]} scale={[TABLE_SIZE.w - 0.16, 0.02, 0.01]} />
        <mesh geometry={geo.roundBox(0.09, 0.86, 1.02, 0.02)} material={tableMat} position={[-1.12, 0.43, 0]} castShadow={receiveShadow} />
        <mesh geometry={geo.roundBox(0.09, 0.86, 1.02, 0.02)} material={tableMat} position={[1.12, 0.43, 0]} castShadow={receiveShadow} />
        <mesh geometry={geo.box()} material={std(COLORS.surface, { roughness: 0.6 })} position={[0, 0.3, -0.2]} scale={[2.2, 0.04, 0.5]} />
      </group>

    </group>
  );
}
