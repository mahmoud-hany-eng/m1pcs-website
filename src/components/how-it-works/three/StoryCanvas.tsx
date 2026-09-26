"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { AnchorStore, SafeArea } from "../anchors";
import type { Playhead } from "../playhead";
import { stageMetrics } from "../stage-layout";
import { CHAPTER_COUNT, chapterAt, chapterLocal } from "../story";
import { COLORS } from "./assets";
import { FOV, focusPoint, sampleCamera, type CameraSample } from "./camera";
import { Character, type CharacterApi } from "./Character";
import { WorldContext, type FrameState, type Quality, type SceneEntry, type StoryClock, type StoryWorld } from "./director";
import { GlobeWorld } from "./GlobeWorld";
import { Stage } from "./Stage";
import { ChapterParts } from "./scenes/ChapterParts";
import { ChapterQuote } from "./scenes/ChapterQuote";
import { ChapterConfirm } from "./scenes/ChapterConfirm";
import { ChapterBuild } from "./scenes/ChapterBuild";

export interface StoryCanvasProps {
  playhead: Playhead;
  anchors: AnchorStore;
  clock: StoryClock;
  quality: Quality;
  active: boolean;
  onReady?: () => void;
}

export default function StoryCanvas(props: StoryCanvasProps) {
  const { active, quality, onReady } = props;
  // Crisp on high-density screens, but never more pixels than the GPU can
  // push smoothly (the adaptive monitor below steps down further if needed).
  const dpr = useMemo(() => Math.min(window.devicePixelRatio || 1, quality === "high" ? 2 : 1.75), [quality]);
  return (
    <Canvas
      frameloop={active ? "always" : "never"}
      dpr={dpr}
      shadows={quality === "high"}
      flat
      gl={{ antialias: true, powerPreference: "high-performance", alpha: false, stencil: false }}
      camera={{ fov: FOV, near: 0.05, far: 500, position: [0, 2.6, 8] }}
      onCreated={({ gl, scene }) => {
        gl.setClearColor(COLORS.ink);
        scene.fog = new THREE.Fog(COLORS.ink, 8, 24);
        onReady?.();
      }}
    >
      <World {...props} initialDpr={dpr} />
    </Canvas>
  );
}

function World({ playhead, anchors, clock, quality, initialDpr }: StoryCanvasProps & { initialDpr: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const scene = useThree((s) => s.scene);
  const setDpr = useThree((s) => s.setDpr);
  const gl = useThree((s) => s.gl);

  const entries = useRef<SceneEntry[]>([]);
  const rep = useRef<CharacterApi>(null);
  const customer = useRef<CharacterApi>(null);
  const keyLight = useRef<THREE.DirectionalLight>(null!);
  const logoIntensity = useRef(1);

  const world = useMemo<StoryWorld>(
    () => ({
      rep,
      customer,
      anchors,
      quality,
      register(entry) {
        entries.current = [...entries.current, entry].sort((a, b) => a.order - b.order);
        return () => {
          entries.current = entries.current.filter((e) => e !== entry);
        };
      },
    }),
    [anchors, quality],
  );

  const metrics = useMemo(() => stageMetrics(size.width, size.height), [size.width, size.height]);
  // Pinned UI stays below the progress bar, above the caption and off the screen edges.
  const safe = useMemo<SafeArea>(
    () => ({ top: metrics.top, bottom: metrics.bottom + 4, edge: metrics.layout === "tall" ? 10 : 16 }),
    [metrics],
  );
  const sample = useMemo<CameraSample>(() => ({ target: new THREE.Vector3(), position: new THREE.Vector3(), dist: 7 }), []);
  const local = useMemo(() => Array.from({ length: CHAPTER_COUNT }, () => 0), []);
  const frame = useMemo<FrameState>(
    () => ({ s: 0, dt: 0, time: 0, active: 0, local, resting: false, layout: "wide", width: 0, height: 0, cameraPos: new THREE.Vector3(), quality }),
    [local, quality],
  );
  const perf = useRef({ acc: 0, frames: 0, dpr: initialDpr, cooldownUntil: 3 });

  // Compile every material up front — including props that stay hidden until
  // later chapters — so no shader compiles (and stutters) mid-story.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      gl.compileAsync(scene, camera).catch(() => gl.compile(scene, camera));
    });
    return () => cancelAnimationFrame(id);
  }, [gl, scene, camera]);

  useFrame((state, delta) => {
    clock.canvasTick = performance.now();
    const dt = Math.min(delta, 1 / 20);
    playhead.update(dt);

    const s = playhead.s;
    frame.s = s;
    frame.dt = dt;
    frame.time = state.clock.elapsedTime;
    frame.active = chapterAt(s);
    frame.resting = playhead.resting;
    frame.layout = metrics.layout;
    frame.width = size.width;
    frame.height = size.height;
    for (let i = 0; i < local.length; i++) local[i] = chapterLocal(s, i);

    // ---- camera: frame the shot inside the free area between the UI bands.
    sampleCamera(s, metrics, sample);
    camera.position.copy(sample.position);
    camera.lookAt(sample.target);
    camera.fov = FOV;
    camera.near = Math.max(0.05, sample.dist * 0.02);
    camera.far = sample.dist * 5 + 80;
    const focus = focusPoint(metrics);
    camera.setViewOffset(size.width, size.height, size.width / 2 - focus.x, size.height / 2 - focus.y, size.width, size.height);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    frame.cameraPos.copy(camera.position);

    const fog = scene.fog as THREE.Fog;
    fog.near = sample.dist * 0.95;
    fog.far = sample.dist * 3.1;

    // Key light (and its shadow frustum) follows the action.
    const light = keyLight.current;
    light.position.set(sample.target.x + 3.5, sample.target.y + 6.5, sample.target.z + 5);
    light.target.position.copy(sample.target);
    light.target.updateMatrixWorld();
    // The logo glows a little brighter for the closing shot.
    logoIntensity.current = 1 + chapterLocal(s, CHAPTER_COUNT - 1) * 0.35;

    for (const e of entries.current) e.update(frame);
    rep.current?.step(dt, frame.time);
    customer.current?.step(dt, frame.time);
    for (const e of entries.current) e.post?.(frame);
    anchors.project(camera, size.width, size.height, safe);

    // ---- adaptive resolution: step down if frames stay slow (never back up
    // mid-story, to avoid visible resolution pumping).
    const p = perf.current;
    if (state.clock.elapsedTime > p.cooldownUntil) {
      p.acc += delta;
      p.frames++;
      if (p.acc > 1.5) {
        const avg = p.acc / p.frames;
        if (avg > 1 / 45 && p.dpr > 1) {
          p.dpr = Math.max(1, Math.round((p.dpr - 0.25) * 4) / 4);
          setDpr(p.dpr);
          p.cooldownUntil = state.clock.elapsedTime + 2;
        }
        p.acc = 0;
        p.frames = 0;
      }
    }
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
      <pointLight position={[-4, 3.2, -2.0]} color={COLORS.red} intensity={30} distance={14} decay={2} />
      <pointLight position={[4, 2.8, -1.8]} color={COLORS.gold} intensity={20} distance={14} decay={2} />
      <pointLight position={[0.5, 3.2, 4.5]} color="#ffffff" intensity={10} distance={14} decay={2} />

      <GlobeWorld>
        <Stage receiveShadow={shadows} logoIntensity={logoIntensity} />
        <Character ref={rep} variant="rep" castShadow={shadows} />
        <Character ref={customer} variant="customer" castShadow={shadows} />
        <ChapterParts />
        <ChapterQuote />
        <ChapterConfirm />
        <ChapterBuild />
      </GlobeWorld>
    </WorldContext.Provider>
  );
}
