"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { BAND_VH, CHAPTER_COUNT, RUNWAY_VH } from "./story";
import type { Playhead } from "./playhead";

/** Wheel events closer together than this belong to the same gesture (incl. trackpad momentum). */
const GESTURE_GAP_MS = 240;
/** Minimum time between two chapter steps, however the wheel events arrive. */
const STEP_LOCK_MS = 650;
/** Ignore feather-light trackpad touches. */
const MIN_GESTURE_DELTA = 10;

interface Track {
  pinStart: number;
  band: number;
  pinEnd: number;
}

/**
 * Guided scrolling for the pinned story:
 *  - The scroll position inside the pinned track selects a chapter (works
 *    with touch, scrollbar drags and native keyboard scrolling).
 *  - While the stage is pinned, one wheel/trackpad gesture or one key press
 *    moves exactly one chapter, so a single flick can never race through
 *    the story. At the first/last chapter the page scrolls normally, so the
 *    visitor is never trapped.
 */
export function useGuidedScroll({
  container,
  stage,
  playhead,
  enabled,
}: {
  container: RefObject<HTMLElement | null>;
  stage: RefObject<HTMLElement | null>;
  playhead: Playhead;
  enabled: boolean;
}) {
  const requested = useRef(0);

  const measure = useCallback((): Track | null => {
    const el = container.current;
    const pin = stage.current;
    if (!el || !pin) return null;
    const stickyTop = parseFloat(getComputedStyle(pin).top) || 0;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const pinStart = top - stickyTop;
    const pinEnd = pinStart + el.offsetHeight - pin.offsetHeight;
    // Pinned length = CHAPTER_COUNT bands + a short runway after the last one.
    const band = ((pinEnd - pinStart) * BAND_VH) / (CHAPTER_COUNT * BAND_VH + RUNWAY_VH);
    return { pinStart, band, pinEnd };
  }, [container, stage]);

  const request = useCallback(
    (index: number) => {
      const i = Math.max(0, Math.min(CHAPTER_COUNT - 1, index));
      requested.current = i;
      playhead.setTargetChapter(i);
    },
    [playhead],
  );

  const goTo = useCallback(
    (index: number) => {
      const t = measure();
      if (!t) return;
      const i = Math.max(0, Math.min(CHAPTER_COUNT - 1, index));
      request(i);
      window.scrollTo({ top: t.pinStart + (i + 0.5) * t.band, behavior: "instant" });
    },
    [measure, request],
  );

  useEffect(() => {
    if (!enabled) return;

    let frame = 0;
    const sync = () => {
      frame = 0;
      const t = measure();
      if (!t || t.band <= 0) return;
      const y = window.scrollY;
      request(Math.floor((y - t.pinStart) / t.band));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };

    const pinned = () => {
      const t = measure();
      if (!t) return null;
      const y = window.scrollY;
      return y >= t.pinStart - 2 && y <= t.pinEnd + 2 ? t : null;
    };

    let lastWheel = -Infinity;
    let lockedUntil = 0;
    let accum = 0;
    let locked = false;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return; // pinch-zoom / sideways
      if (!pinned()) return;
      // The event's own timestamp, so a busy main thread can't split one gesture into several.
      const now = e.timeStamp || performance.now();
      if (now - lastWheel > GESTURE_GAP_MS && now >= lockedUntil) {
        accum = 0;
        locked = false;
      }
      lastWheel = now;
      const dir = Math.sign(e.deltaY);
      const current = requested.current;
      const atEdge = (dir < 0 && current === 0) || (dir > 0 && current === CHAPTER_COUNT - 1);
      if (atEdge && !locked) return; // let the page scroll on past the story
      e.preventDefault();
      if (locked) return; // swallow the rest of this gesture (e.g. trackpad momentum)
      const unit = e.deltaMode === 1 ? 32 : e.deltaMode === 2 ? window.innerHeight : 1;
      accum += e.deltaY * unit;
      if (Math.abs(accum) < MIN_GESTURE_DELTA) return;
      locked = true;
      lockedUntil = now + STEP_LOCK_MS;
      goTo(current + dir);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      let dir = 0;
      if (e.key === "ArrowDown" || e.key === "PageDown" || (e.key === " " && !e.shiftKey)) dir = 1;
      else if (e.key === "ArrowUp" || e.key === "PageUp" || (e.key === " " && e.shiftKey)) dir = -1;
      if (!dir || !pinned()) return;
      const next = requested.current + dir;
      if (next < 0 || next > CHAPTER_COUNT - 1) return;
      e.preventDefault();
      goTo(next);
    };

    sync();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, [enabled, measure, request, goTo]);

  return { goTo };
}
