"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { AnchorStore, SafeArea } from "../anchors";
import { stageMetrics } from "../stage-layout";
import { CH, CHAPTER_COUNT, chapterAt, chapterLocal, clockAt } from "../story";
import type { Timeline } from "../timeline";
import { COLORS } from "./assets";
import { FOV, focusPoint, sampleCamera, type CameraSample } from "./camera";
import { Character, type CharacterApi } from "./Character";
import { WorldContext, type FrameState, type Quality, type SceneEntry, type StoryWorld } from "./director";
import { GlobeWorld } from "./GlobeWorld";
import { PORCH_LIGHT } from "./home";
import { Stage } from "./Stage";
import { ChapterParts } from "./scenes/ChapterParts";
import { ChapterQuote } from "./scenes/ChapterQuote";
import { ChapterConfirm } from "./scenes/ChapterConfirm";
import { ChapterSource } from "./scenes/ChapterSource";
import { ChapterBuild } from "./scenes/ChapterBuild";
import { ChapterDeliver } from "./scenes/ChapterDeliver";

export interface StoryCanvasProps {
  timeline: Timeline;
  anchors: AnchorStore;
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
      // Frames are rendered only when the scroll position changes (see timeline.ts).
      frameloop={active ? "demand" : "never"}
      dpr={dpr}
      shadows={quality === "high"}
      flat
      gl={{ antialias: true, powerPreference: "high-performance", alpha: false, stencil: false }}
      camera={{ fov: FOV, near: 0.05, far: 500, position: [0, 2.6, 8] }}
      onCreated={({ gl, scene }) => {
        gl.setClearColor(COLORS.ink);
        scene.fog = new THREE.Fog(COLORS.ink, 8, 24);
        // Soft studio reflections for every lit material: generated once from a
        // procedural room (no HDR download), then shared by the whole world.
        const pmrem = new THREE.PMREMGenerator(gl);
        const room = new RoomEnvironment();
        scene.environment = pmrem.fromScene(room, 0.04).texture;
        scene.environmentIntensity = 0.55;
        room.dispose();
        pmrem.dispose();
        onReady?.();
      }}
    >
      <World {...props} initialDpr={dpr} />
    </Canvas>
  );
}

function World({ timeline, anchors, quality, active, initialDpr }: StoryCanvasProps & { initialDpr: number }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const scene = useThree((s) => s.scene);
  const setDpr = useThree((s) => s.setDpr);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  const entries = useRef<SceneEntry[]>([]);
  const rep = useRef<CharacterApi>(null);
  const customer = useRef<CharacterApi>(null);
  const keyLight = useRef<THREE.DirectionalLight>(null!);
  const rimLight = useRef<THREE.DirectionalLight>(null!);
  const logoIntensity = useRef(1);
  const shadowHalf = useRef(4.5);

  const world = useMemo<StoryWorld>(
    () => ({
      rep,
      customer,
      anchors,
      quality,
      props: new Map(),
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
  const sample = useMemo<CameraSample>(() => ({ target: new THREE.Vector3(), position: new THREE.Vector3(), dist: 7, frameW: 5 }), []);
  const local = useMemo(() => Array.from({ length: CHAPTER_COUNT }, () => 0), []);
  const frame = useMemo<FrameState>(
    () => ({ s: 0, clock: 0, active: 0, local, layout: "wide", width: 0, height: 0, cameraPos: new THREE.Vector3(), quality }),
    [local, quality],
  );

  /**
   * Puts the whole world into the state for story position `s`: camera,
   * props, characters and pinned labels. A pure function of `s` — calling it
   * twice with the same value produces the same scene, whatever came before.
   */
  const evaluate = useCallback(
    (s: number, settled: boolean) => {
      frame.s = s;
      frame.clock = clockAt(s);
      frame.active = chapterAt(s);
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

      // Key light (and its shadow frustum) follows the action; the frustum
      // grows with wide shots (the drive) so shadows never cut off.
      const light = keyLight.current;
      light.position.set(sample.target.x + 3.5, sample.target.y + 6.5, sample.target.z + 5);
      light.target.position.copy(sample.target);
      light.target.updateMatrixWorld();
      const half = Math.round(Math.min(12, Math.max(4.5, sample.frameW * 0.62)) * 2) / 2;
      if (half !== shadowHalf.current) {
        shadowHalf.current = half;
        const cam = light.shadow.camera;
        cam.left = -half;
        cam.right = half;
        cam.top = half;
        cam.bottom = -half;
        cam.far = 20 + half;
        cam.updateProjectionMatrix();
      }
      // A cool rim from behind separates the figures from the dark set.
      const rim = rimLight.current;
      rim.position.set(sample.target.x - 2, sample.target.y + 4, sample.target.z - 7);
      rim.target.position.copy(sample.target);
      rim.target.updateMatrixWorld();
      logoIntensity.current = 1 + chapterLocal(s, CH.build) * 0.2;

      for (const e of entries.current) e.update(frame);
      rep.current?.apply(frame.clock);
      customer.current?.apply(frame.clock);
      for (const e of entries.current) e.post?.(frame);
      anchors.project(camera, size.width, size.height, safe, settled);
    },
    [anchors, camera, frame, local, metrics, safe, sample, scene, size.height, size.width],
  );

  // While the canvas is live it renders the timeline's frames.
  useEffect(() => {
    if (!active) return;
    timeline.setRenderer(invalidate);
    timeline.request();
    return () => timeline.setRenderer(null);
  }, [active, invalidate, timeline]);

  // Compile every material up front — including props that stay hidden until
  // later chapters — so no shader compiles (and stutters) mid-story.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      // Off the main thread where the driver allows it; otherwise once, during the fade-in.
      if (gl.extensions.has("KHR_parallel_shader_compile")) gl.compileAsync(scene, camera).catch(() => {});
      else gl.compile(scene, camera);
    });
    return () => cancelAnimationFrame(id);
  }, [gl, scene, camera]);

  // Development-only probes for the automated scroll-scrub tests.
  useEffect(() => {
    let cleanup = () => {};
    // Compile-time condition: the probe module is not even emitted in production builds.
    if (process.env.NODE_ENV !== "production") {
      import("./debug").then((m) => {
        cleanup = m.installProbes({ scene, camera, evaluate, timeline, rep, customer, anchors, invalidate, gl });
      });
    }
    return () => cleanup();
  }, [anchors, camera, evaluate, gl, invalidate, scene, timeline]);

  const perf = useRef({ acc: 0, frames: 0, dpr: initialDpr, last: 0, cooldown: 0 });

  // priority -1: the world is evaluated before any child useFrame reads it.
  useFrame((_, delta) => {
    timeline.tick(performance.now());
    evaluate(timeline.s, timeline.settled);

    // ---- adaptive resolution: frames only exist while scrolling, so only
    // consecutive frames count. Steps down if they stay slow; never back up
    // mid-story (no visible resolution pumping).
    const p = perf.current;
    if (delta > 0 && delta < 0.1) {
      p.acc += delta;
      p.frames++;
      if (p.frames >= 45) {
        const avg = p.acc / p.frames;
        if (p.cooldown > 0) p.cooldown--;
        else if (avg > 1 / 45 && p.dpr > 1) {
          p.dpr = Math.max(1, Math.round((p.dpr - 0.25) * 4) / 4);
          setDpr(p.dpr);
          p.cooldown = 2;
        }
        p.acc = 0;
        p.frames = 0;
      }
    }
  }, -1);

  const shadows = quality === "high";

  return (
    <WorldContext.Provider value={world}>
      <hemisphereLight args={["#fff1e3", "#1b100e", 0.8]} />
      <ambientLight intensity={0.12} />
      <directionalLight
        ref={keyLight}
        intensity={2.2}
        color="#fff4e8"
        castShadow={shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-4.5}
        shadow-camera-right={4.5}
        shadow-camera-top={4.5}
        shadow-camera-bottom={-4.5}
        shadow-camera-near={0.5}
        shadow-camera-far={24.5}
        shadow-bias={-0.0005}
        shadow-normalBias={0.03}
      />
      <directionalLight ref={rimLight} intensity={1.1} color="#cfe0ff" />
      <pointLight position={[-4, 3.2, -2.0]} color={COLORS.red} intensity={22} distance={14} decay={2} />
      <pointLight position={[4, 2.8, -1.8]} color={COLORS.gold} intensity={14} distance={14} decay={2} />
      <pointLight position={[0.5, 3.2, 4.5]} color="#ffffff" intensity={9} distance={14} decay={2} />
      {/* porch light at the customer's home (the delivery) */}
      <pointLight position={PORCH_LIGHT} color={COLORS.warm} intensity={16} distance={9} decay={2} />

      <GlobeWorld>
        <Stage receiveShadow={shadows} logoIntensity={logoIntensity} />
        <Character ref={rep} variant="rep" castShadow={shadows} />
        <Character ref={customer} variant="customer" castShadow={shadows} />
        <ChapterParts />
        <ChapterQuote />
        <ChapterConfirm />
        <ChapterSource />
        <ChapterBuild />
        <ChapterDeliver />
      </GlobeWorld>
    </WorldContext.Provider>
  );
}
