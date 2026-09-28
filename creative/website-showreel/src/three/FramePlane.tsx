import React, { useMemo } from "react";
import * as THREE from "three";
import { useLoader } from "@react-three/fiber";
import { staticFile } from "remotion";

const cache = new Map<string, THREE.Texture>();

export interface FramePlaneProps {
  /** e.g. "frames/buildmypc-form" — files are "f-0001.jpg" .. */
  dir: string;
  frameCount: number;
  /** Source clip's own capture fps (it was extracted at this rate). */
  clipFps: number;
  /** Elapsed real seconds since this clip started playing (can exceed the
   * clip's length — it holds on the last frame). */
  elapsedSeconds: number;
  position: [number, number, number];
  rotation?: [number, number, number];
  height: number;
  opacity: number;
}

/** A real screen-recorded interaction (typing, scrolling, selecting),
 * played back as a deterministic image-sequence texture so every rendered
 * output frame is reproducible. */
export function FramePlane({ dir, frameCount, clipFps, elapsedSeconds, position, rotation = [0, 0, 0], height, opacity }: FramePlaneProps) {
  const idx = Math.min(frameCount - 1, Math.max(0, Math.floor(elapsedSeconds * clipFps)));
  const path = staticFile(`${dir}/f-${String(idx + 1).padStart(4, "0")}.jpg`);
  const texture = useLoader(THREE.TextureLoader, path);
  useMemo(() => {
    if (!cache.has(path)) {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      cache.set(path, texture);
    }
  }, [path, texture]);
  const aspect = (texture.image?.width ?? 16) / (texture.image?.height ?? 9);
  const width = height * aspect;
  if (opacity <= 0.001) return null;
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} transparent opacity={opacity} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}
