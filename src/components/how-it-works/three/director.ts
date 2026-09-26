"use client";

import { createContext, useContext, useEffect, useRef, type RefObject } from "react";
import type { CharacterApi } from "./Character";

export type Quality = "high" | "low";

export interface FrameState {
  /** Smoothed global scroll progress, 0..1. */
  p: number;
  dt: number;
  time: number;
  /** Index of the scene that currently owns the characters. */
  active: number;
  /** Local 0..1 progress of every scene. */
  local: readonly number[];
  quality: Quality;
}

export interface SceneEntry {
  order: number;
  /** Sets character targets and prop transforms. */
  update(f: FrameState): void;
  /** Runs after characters have stepped — for props that follow hands. */
  post?(f: FrameState): void;
}

export interface StoryWorld {
  rep: RefObject<CharacterApi | null>;
  customer: RefObject<CharacterApi | null>;
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
