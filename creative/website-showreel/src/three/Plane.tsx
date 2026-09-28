import React, { useMemo } from "react";
import * as THREE from "three";
import { useLoader } from "@react-three/fiber";
import { staticFile } from "remotion";

/** Cache so identical stills aren't decoded twice across the scene. */
const loaderCache = new Map<string, THREE.Texture>();
function useCachedTexture(src: string): THREE.Texture {
  const tex = useLoader(THREE.TextureLoader, src);
  return useMemo(() => {
    if (!loaderCache.has(src)) {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      loaderCache.set(src, tex);
    }
    return loaderCache.get(src)!;
  }, [src, tex]);
}

export interface UiPlaneProps {
  /** Public-file path to the sharp capture, e.g. "stills/home-hero-clean.png". */
  src: string;
  /** Matching blurred variant (pre-baked) for when this plane is out of focus. */
  srcBlur?: string;
  focused?: boolean;
  position: [number, number, number];
  rotation?: [number, number, number];
  /** Height in world units; width is derived from the image's own aspect ratio. */
  height: number;
  opacity: number;
  /** Extra darkening (0 = normal, 1 = fully black) — used to push receded planes back. */
  dim?: number;
}

/** A single real-website capture, shown as a crisp textured plane in 3D space. */
export function UiPlane({ src, srcBlur, focused = true, position, rotation = [0, 0, 0], height, opacity, dim = 0 }: UiPlaneProps) {
  const path = focused || !srcBlur ? src : srcBlur;
  const texture = useCachedTexture(staticFile(path));
  const aspect = (texture.image?.width ?? 16) / (texture.image?.height ?? 9);
  const width = height * aspect;
  if (opacity <= 0.001) return null;
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={opacity}
        toneMapped={false}
        side={THREE.DoubleSide}
        color={new THREE.Color(1 - dim * 0.55, 1 - dim * 0.55, 1 - dim * 0.55)}
      />
    </mesh>
  );
}

/** A rounded dark card behind a plane, so UI screenshots read as floating
 * panels in space rather than paper cut-outs. */
export function PlaneBacking({ position, width, height, opacity }: { position: [number, number, number]; width: number; height: number; opacity: number }) {
  if (opacity <= 0.001) return null;
  return (
    <mesh position={[position[0], position[1], position[2] - 0.02]}>
      <planeGeometry args={[width + 0.16, height + 0.16]} />
      <meshBasicMaterial color="#0a0a0c" transparent opacity={opacity * 0.9} toneMapped={false} />
    </mesh>
  );
}
