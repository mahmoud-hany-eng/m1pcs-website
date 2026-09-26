"use client";

import { createContext, useContext, useEffect, useRef, type RefObject } from "react";
import type * as THREE from "three";
import type { AnchorStore } from "../anchors";
import type { StageLayout } from "../stage-layout";
import type { CharacterApi } from "./Character";

export type Quality = "high" | "low";

/**
 * Everything a scene may read. It is derived from the scroll position only —
 * there is deliberately no elapsed time here, so no scene can animate on its
 * own: stop scrolling and every transform stays exactly where it is.
 */
export interface FrameState {
  /** Story position, 0..CHAPTER_COUNT (see story.ts). */
  s: number;
  /** Story seconds at `s` — the phase for repeating gestures (waves, typing, walk cycles). */
  clock: number;
  /** Chapter that currently owns the characters. */
  active: number;
  /** Local 0..1 progress of every chapter. */
  local: readonly number[];
  /** "tall" on portrait/phone screens: labels switch to compact behaviour. */
  layout: StageLayout;
  /** Stage size in CSS px. */
  width: number;
  height: number;
  /** World-space camera position this frame (for facing tests). */
  cameraPos: THREE.Vector3;
  quality: Quality;
}

export interface SceneEntry {
  order: number;
  /** Sets character targets, prop transforms and label anchors. */
  update(f: FrameState): void;
  /** Runs after characters have stepped — for props/labels that follow hands. */
  post?(f: FrameState): void;
}

export interface StoryWorld {
  rep: RefObject<CharacterApi | null>;
  customer: RefObject<CharacterApi | null>;
  anchors: AnchorStore;
  /** Objects two scenes hand to each other (e.g. the finished PC: built in 5, delivered in 6). */
  props: Map<string, THREE.Object3D>;
  quality: Quality;
  register(entry: SceneEntry): () => void;
}

export const WorldContext = createContext<StoryWorld | null>(null);

export function useWorld(): StoryWorld {
  const w = useContext(WorldContext);
  if (!w) throw new Error("useWorld must be used inside the story canvas");
  return w;
}

/**
 * Registers a scene's per-frame callbacks with the director. Callbacks are
 * read through refs, so they can close over fresh props without
 * re-registering.
 */
export function useScene(order: number, update: (f: FrameState) => void, post?: (f: FrameState) => void) {
  const world = useWorld();
  const updateRef = useRef(update);
  const postRef = useRef(post);
  updateRef.current = update;
  postRef.current = post;

  useEffect(
    () =>
      world.register({
        order,
        update: (f) => updateRef.current(f),
        post: (f) => postRef.current?.(f),
      }),
    [world, order],
  );
}
