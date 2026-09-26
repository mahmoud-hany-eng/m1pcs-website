"use client";

import { useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { MotionValue } from "framer-motion";
import { sceneIndexAt, sceneLocal, SCENE_RANGES } from "../story";
import { COLORS } from "./assets";
import { clamp01 } from "./anim";
import { sampleCamera, type CameraSample } from "./camera";
import { Character, type CharacterApi } from "./Character";
import { WorldContext, type FrameState, type Quality, type SceneEntry, type StoryWorld } from "./director";
import { GlobeWorld } from "./GlobeWorld";
import { Stage } from "./Stage";
import { SceneParts } from "./scenes/SceneParts";
import { SceneQuote } from "./scenes/SceneQuote";
import { SceneConfirm } from "./scenes/SceneConfirm";
import { SceneBuild } from "./scenes/SceneBuild";
import { SceneDeliver } from "./scenes/SceneDeliver";

export type StoryLayout = "wide" | "tall";

export interface StoryCanvasProps {
  progress: MotionValue<number>;
  layout: StoryLayout;
  quality: Quality;
  active: boolean;
  onReady?: () => void;
}

/**
 * How much of the canvas the 3D action should occupy. On wide screens the
 * text stack takes the right-hand column, so the action is framed in the
 * left part of the frame; on tall screens the text sits underneath.
 */
export const FRAMING = {
  wide: { sceneFraction: 0.62 },
  tall: { sceneFraction: 0.54 },
  /** Width/height of the action region the camera keys were composed for (1440×820 desktop). */
  designRatio: 1.09,
} as const;

export default function StoryCanvas(props: StoryCanvasProps) {
  const { active, quality, onReady } = props;
  return (
    <Canvas
      frameloop={active ? "always" : "never"}
      dpr={quality === "high" ? [1, 2] : [1, 1.5]}
      shadows={quality === "high"}
      flat
      gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
      camera={{ fov: 32, near: 0.05, far: 500, position: [0, 2.6, 7.4] }}
      onCreated={({ gl, scene }) => {
        gl.setClearColor(COLORS.ink);
        scene.fog = new THREE.Fog(COLORS.ink, 8, 24);
        onReady?.();
      }}
    >
      <World {...props} />
    </Canvas>
  );
}

const DRIFT = new THREE.Vector3();

function World({ progress, layout, quality }: StoryCanvasProps) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const scene = useThree((s) => s.scene);

  const entries = useRef<SceneEntry[]>([]);
  const rep = useRef<CharacterApi>(null);
  const customer = useRef<CharacterApi>(null);
  const keyLight = useRef<THREE.DirectionalLight>(null!);

  const world = useMemo<StoryWorld>(
    () => ({
      rep,
      customer,
      quality,
      register(entry) {
        entries.current = [...entries.current, entry].sort((a, b) => a.order - b.order);
        return () => {
          entries.current = entries.current.filter((e) => e !== entry);
        };
      },
    }),
    [quality],
  );

  const sample = useMemo<CameraSample>(() => ({ target: new THREE.Vector3(), position: new THREE.Vector3(), fov: 32, dist: 7 }), []);
  const local = useMemo(() => SCENE_RANGES.map(() => 0), []);
  const frame = useMemo<FrameState>(() => ({ p: 0, dt: 0, time: 0, active: 0, local, quality }), [local, quality]);

  useFrame((state, delta) => {
    const p = clamp01(progress.get());
    frame.p = p;
    frame.dt = Math.min(delta, 1 / 20);
    frame.time = state.clock.elapsedTime;
    frame.active = sceneIndexAt(p);
    for (let i = 0; i < local.length; i++) local[i] = sceneLocal(p, i);

    // ---- camera: framing depends on how much room the layout leaves the action.
    const W = size.width;
    const H = size.height;
    // Pull the camera back when the action region is narrower than the
    // composition was designed for, so nothing gets cropped at the sides.
    const regionRatio = (layout === "wide" ? W * FRAMING.wide.sceneFraction : W) / H;
    const distScale = Math.max(1, Math.pow(FRAMING.designRatio / regionRatio, 0.92));
    sampleCamera(p, sample, distScale);

    const t = frame.time;
    DRIFT.set(Math.sin(t * 0.31) * 0.05, Math.sin(t * 0.43) * 0.035, 0).multiplyScalar(sample.dist / 7);
    camera.position.copy(sample.position).add(DRIFT);
    camera.lookAt(sample.target);
    camera.fov = sample.fov;
    camera.near = Math.max(0.05, sample.dist * 0.02);
    camera.far = sample.dist * 5 + 80;
    if (layout === "wide") {
      const focusX = FRAMING.wide.sceneFraction / 2;
      camera.setViewOffset(W, H, W * (0.5 - focusX), 0, W, H);
    } else {
      const focusY = FRAMING.tall.sceneFraction / 2 + 0.06;
      camera.setViewOffset(W, H, 0, H * (0.5 - focusY), W, H);
    }
    camera.updateProjectionMatrix();

    const fog = scene.fog as THREE.Fog;
    fog.near = sample.dist * 0.95;
    fog.far = sample.dist * 3.1;

    // Key light (and its shadow frustum) follows the action.
    const light = keyLight.current;
    light.position.set(sample.target.x + 3.5, sample.target.y + 6.5, sample.target.z + 5);
    light.target.position.copy(sample.target);
    light.target.updateMatrixWorld();

    for (const e of entries.current) e.update(frame);
    rep.current?.step(frame.dt, t);
    customer.current?.step(frame.dt, t);
    for (const e of entries.current) e.post?.(frame);
  });

  const shadows = quality === "high";

  return (
    <WorldContext.Provider value={world}>
      <hemisphereLight args={["#fff1e3", "#1b100e", 1.15]} />
      <ambientLight intensity={0.22} />
      <directionalLight
        ref={keyLight}
        intensity={2.3}
        color="#fff4e8"
        castShadow={shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-4.5}
        shadow-camera-right={4.5}
        shadow-camera-top={4.5}
        shadow-camera-bottom={-4.5}
        shadow-camera-near={0.5}
        shadow-camera-far={20}
        shadow-bias={-0.0005}
        shadow-normalBias={0.03}
      />
      <pointLight position={[-4, 3.2, -2.4]} color={COLORS.red} intensity={34} distance={14} decay={2} />
      <pointLight position={[4, 2.8, -2.2]} color={COLORS.gold} intensity={24} distance={14} decay={2} />
      <pointLight position={[0.5, 3.2, 4.5]} color="#ffffff" intensity={10} distance={14} decay={2} />

      <GlobeWorld>
        <Stage receiveShadow={shadows} />
        <Character ref={rep} variant="rep" castShadow={shadows} />
        <Character ref={customer} variant="customer" castShadow={shadows} />
        <SceneParts />
        <SceneQuote />
        <SceneConfirm />
        <SceneBuild />
        <SceneDeliver />
      </GlobeWorld>
    </WorldContext.Provider>
  );
}
