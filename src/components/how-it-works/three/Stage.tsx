"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { COLORS, canvasTexture, fonts, geo, glow, std } from "./assets";

export const TABLE_TOP_Y = 0.95;
export const TABLE_SIZE = { w: 2.7, d: 1.25 };
export const STAGE_RADIUS = 4.35;

function floorGlowTexture() {
  return canvasTexture("floor-glow", 512, 512, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, "rgba(231,50,37,0.30)");
    g.addColorStop(0.45, "rgba(231,50,37,0.10)");
    g.addColorStop(0.8, "rgba(249,194,4,0.04)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Fine concentric rings for a subtle "stage" texture.
    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.lineWidth = 2;
    for (let r = 40; r < w / 2; r += 34) {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  });
}

function neonTexture() {
  const f = fonts();
  return canvasTexture("neon-m1", 1024, 512, (ctx, w, h) => {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `800 300px ${f.display}`;
    ctx.shadowColor = COLORS.red;
    ctx.shadowBlur = 48;
    ctx.fillStyle = "#ff5a45";
    ctx.fillText("M1", w / 2, h * 0.42);
    ctx.shadowBlur = 16;
    ctx.fillStyle = "#ffd9d2";
    ctx.fillText("M1", w / 2, h * 0.42);
    ctx.shadowColor = COLORS.gold;
    ctx.shadowBlur = 20;
    ctx.fillStyle = COLORS.gold;
    ctx.font = `700 64px ${f.display}`;
    ctx.fillText("G A M I N G   P C S", w / 2, h * 0.84);
  });
}

/** The M1 studio: round stage, neon rim, consultation/work table, neon sign. */
export function Stage({ receiveShadow }: { receiveShadow: boolean }) {
  const floorGlow = useMemo(() => floorGlowTexture(), []);
  const neon = useMemo(() => neonTexture(), []);
  const tableMat = std(COLORS.charcoal, { roughness: 0.42, metalness: 0.15 });

  return (
    <group>
      {/* platform */}
      <mesh geometry={geo.cylinder(STAGE_RADIUS, STAGE_RADIUS + 0.12, 72)} material={std("#101012", { roughness: 0.8 })} position={[0, -0.09, 0]} scale={[1, 0.18, 1]} receiveShadow={receiveShadow} />
      <mesh geometry={geo.circle(72)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.003, 0]} scale={STAGE_RADIUS}>
        <meshBasicMaterial map={floorGlow} transparent depthWrite={false} toneMapped={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh geometry={geo.torus(STAGE_RADIUS + 0.02, 0.022)} material={glow(COLORS.red)} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} />
      <mesh geometry={geo.torus(STAGE_RADIUS - 0.35, 0.006)} material={glow(COLORS.gold, 0.35)} rotation={[Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} />

      {/* table */}
      <group>
        <mesh geometry={geo.roundBox(TABLE_SIZE.w, 0.09, TABLE_SIZE.d, 0.04)} material={tableMat} position={[0, TABLE_TOP_Y - 0.045, 0]} castShadow={receiveShadow} receiveShadow={receiveShadow} />
        <mesh geometry={geo.box()} material={glow(COLORS.red)} position={[0, TABLE_TOP_Y - 0.06, TABLE_SIZE.d / 2 + 0.004]} scale={[TABLE_SIZE.w - 0.16, 0.018, 0.01]} />
        <mesh geometry={geo.roundBox(0.09, 0.86, 1.02, 0.02)} material={tableMat} position={[-1.12, 0.43, 0]} castShadow={receiveShadow} />
        <mesh geometry={geo.roundBox(0.09, 0.86, 1.02, 0.02)} material={tableMat} position={[1.12, 0.43, 0]} castShadow={receiveShadow} />
        <mesh geometry={geo.box()} material={std(COLORS.surface, { roughness: 0.6 })} position={[0, 0.3, -0.2]} scale={[2.2, 0.04, 0.5]} />
      </group>

      {/* neon M1 sign on a dark backplate */}
      {/* Low and close enough to stay in frame under the downward-looking studio camera. */}
      <group position={[0, 2.3, -2.4]} scale={0.72}>
        <mesh geometry={geo.roundBox(2.5, 1.35, 0.08, 0.05)} material={std("#0e0e10", { roughness: 0.5 })} />
        <mesh geometry={geo.plane()} position={[0, 0, 0.05]} scale={[2.3, 1.15, 1]}>
          <meshBasicMaterial map={neon} transparent toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
      {/* light bars */}
      {[-3.1, 3.1].map((x) => (
        <group key={x} position={[x, 0, -2.2]}>
          <mesh geometry={geo.box()} material={std("#0e0e10")} position={[0, 1.6, 0]} scale={[0.12, 3.2, 0.12]} />
          <mesh geometry={geo.box()} material={glow(x < 0 ? COLORS.red : COLORS.gold)} position={[0, 1.6, 0.065]} scale={[0.04, 3.0, 0.01]} />
        </group>
      ))}
    </group>
  );
}
