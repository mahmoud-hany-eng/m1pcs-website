"use client";

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { AnimatePresence, motion, useAnimationFrame, useInView } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { AnchorStore } from "./anchors";
import { Playhead } from "./playhead";
import { StaticSteps } from "./StaticSteps";
import { StoryOverlay } from "./StoryOverlay";
import { stageMetrics, uiScale, type StageMetrics } from "./stage-layout";
import { BAND_VH, CHAPTERS, CHAPTER_COUNT, RUNWAY_VH, chapterAt, chapterLocal } from "./story";
import { useGuidedScroll } from "./useGuidedScroll";
import type { StoryClock } from "./three/director";

const StoryCanvas = dynamic(() => import("./three/StoryCanvas"), { ssr: false });

type Mode = "pending" | "3d" | "static";
type Quality = "high" | "low";

const PIN_VH = CHAPTER_COUNT * BAND_VH + RUNWAY_VH;

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Falls back to the static story if the 3D canvas throws (e.g. WebGL context failure). */
class CanvasBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * /how-it-works — a pinned, full-screen 3D story in five chapters. Scroll
 * (or arrow keys) moves chapter by chapter; each chapter plays at a designed
 * pace. Reduced-motion users and devices without WebGL get StaticSteps.
 */
export function HowItWorksExperience() {
  const [mode, setMode] = useState<Mode>("pending");

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setMode(reduce || !supportsWebGL() ? "static" : "3d");
  }, []);

  const fail = useCallback(() => setMode("static"), []);

  if (mode === "static") return <StaticSteps />;
  return <Story3D enabled={mode === "3d"} onFail={fail} />;
}

function detectQuality(metrics: StageMetrics): Quality {
  if (metrics.layout === "tall") return "low";
  const nav = navigator as Navigator & { deviceMemory?: number };
  if ((nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4) return "low";
  return "high";
}

function Story3D({ enabled, onFail }: { enabled: boolean; onFail: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);

  const playhead = useMemo(() => new Playhead(), []);
  const anchors = useMemo(() => new AnchorStore(), []);
  const clock = useMemo<StoryClock>(() => ({ canvasTick: 0 }), []);

  const [metrics, setMetrics] = useState<StageMetrics>(() => stageMetrics(1440, 820));
  const [quality, setQuality] = useState<Quality | null>(null);
  const [ready, setReady] = useState(false);
  const [chapter, setChapter] = useState(0);
  const [hint, setHint] = useState(false);
  const [cta, setCta] = useState(false);
  const [touch, setTouch] = useState(false);
  const inView = useInView(container, { margin: "10% 0px 10% 0px" });

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const update = () => setMetrics(stageMetrics(el.clientWidth, el.clientHeight));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    setTouch(window.matchMedia("(pointer: coarse)").matches);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setQuality((q) => q ?? detectQuality(metrics));
  }, [metrics]);

  const { goTo } = useGuidedScroll({ container, stage, playhead, enabled });

  // Development-only hook for visual QA (jump to any story position); stripped from production builds.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __hiwSeek?: (s: number, target?: number) => void };
    w.__hiwSeek = (s: number, target = s) => {
      playhead.s = s;
      playhead.target = target;
      playhead.v = 0;
    };
    return () => {
      delete w.__hiwSeek;
    };
  }, [playhead]);

  // Reads the playhead every frame for the DOM parts of the story. The 3D
  // canvas advances the playhead in its own frame loop (so camera, props and
  // pinned labels stay in perfect sync); if the canvas isn't running yet this
  // loop advances it instead.
  const ui = useRef({ chapter: -1, hint: false, cta: false, fill: -1 });
  useAnimationFrame((_, delta) => {
    if (!inView) return;
    if (performance.now() - clock.canvasTick > 120) playhead.update(delta / 1000);
    const s = playhead.s;
    const c = chapterAt(s);
    const local = chapterLocal(s, c);
    const last = c === CHAPTER_COUNT - 1;
    const nextHint = !last && (playhead.resting || local > 0.6) && playhead.target <= c + 1;
    const nextCta = last && local > 0.82;
    const u = ui.current;
    if (c !== u.chapter) setChapter((u.chapter = c));
    if (nextHint !== u.hint) setHint((u.hint = nextHint));
    if (nextCta !== u.cta) setCta((u.cta = nextCta));
    const fill = Math.round((s / CHAPTER_COUNT) * 1000) / 1000;
    if (fill !== u.fill && bar.current) {
      u.fill = fill;
      bar.current.style.transform = `scaleX(${fill})`;
    }
  });

  const wide = metrics.layout === "wide";
  const step = CHAPTERS[chapter];
  const next = CHAPTERS[chapter + 1];

  return (
    <section aria-labelledby="how-it-works-title" className="relative bg-background">
      <h1 id="how-it-works-title" className="sr-only">
        How It Works
      </h1>
      <ol className="sr-only">
        {CHAPTERS.map((c) => (
          <li key={c.id}>
            <h2>{c.headline}</h2>
            <p>{c.body}</p>
          </li>
        ))}
      </ol>

      <div
        ref={container}
        className="relative [--hiw-header:4rem] sm:[--hiw-header:5rem]"
        style={{ height: `calc(100svh - var(--hiw-header) + ${PIN_VH}vh)` }}
      >
        <div
          ref={stage}
          className="sticky top-16 h-[calc(100svh-4rem)] overflow-hidden bg-background sm:top-20 sm:h-[calc(100svh-5rem)]"
        >
          {/* 3D world */}
          <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`} aria-hidden="true">
            {enabled && quality && (
              <CanvasBoundary onError={onFail}>
                <StoryCanvas
                  playhead={playhead}
                  anchors={anchors}
                  clock={clock}
                  quality={quality}
                  active={inView}
                  onReady={() => setReady(true)}
                />
              </CanvasBoundary>
            )}
          </div>
          {!ready && (
            <div
              className="pointer-events-none absolute inset-x-0 flex items-center justify-center"
              style={{ top: metrics.top, bottom: metrics.bottom }}
              aria-hidden="true"
            >
              <span className="h-20 w-20 animate-pulse rounded-full bg-primary/25 blur-2xl" />
            </div>
          )}

          {/* soft fade under the progress bar, so the top edge of the frame reads as a vignette, never a crop */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-background/90 via-background/40 to-transparent"
            style={{ height: metrics.top + 28 }}
          />

          {/* legibility: soft fade behind the caption zone */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background via-background/80 to-transparent"
            style={{ height: metrics.bottom + (wide ? 70 : 90) }}
          />

          {/* crisp DOM labels pinned to the 3D scene */}
          <StoryOverlay store={anchors} ui={uiScale(metrics)} />

          {/* progress */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" style={{ height: metrics.top }}>
            <div className="mt-5 h-[3px] w-[140px] overflow-hidden rounded-full bg-white/[0.12] sm:mt-6 sm:w-[220px]">
              <div ref={bar} className="h-full w-full origin-left rounded-full bg-gradient-to-r from-accent to-primary" style={{ transform: "scaleX(0)" }} />
            </div>
          </div>

          {/* caption + hint / CTA */}
          <div className="absolute inset-x-0 bottom-0 flex flex-col items-center px-5" style={{ height: metrics.bottom }}>
            <div className="relative flex w-full max-w-2xl flex-1 items-center justify-center">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={step.id}
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                  className="flex flex-col items-center text-center"
                >
                  <h2
                    className={`font-display font-bold leading-[1.05] tracking-tight text-text-primary ${
                      wide ? "text-[clamp(2rem,3.3vw,3.1rem)]" : "text-[clamp(1.6rem,7vw,2.1rem)]"
                    }`}
                  >
                    {step.headline}
                  </h2>
                  <p className={`mt-2.5 text-text-secondary ${wide ? "max-w-[36rem] text-[1.05rem] leading-relaxed" : "max-w-[22rem] text-[0.95rem] leading-snug"}`}>
                    {step.body}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>

            <div className={`flex w-full items-center justify-center ${wide ? "h-[76px] pb-5" : "h-[84px] pb-[max(1rem,env(safe-area-inset-bottom))]"}`}>
              <AnimatePresence mode="wait" initial={false}>
                {cta ? (
                  <motion.div
                    key="cta"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                    className="flex items-center gap-3"
                  >
                    <Button
                      href="/build-my-pc"
                      size={wide ? "lg" : "md"}
                      className="whitespace-nowrap shadow-[0_12px_40px_-12px_rgba(231,50,37,0.8)]"
                    >
                      Request a PC Quote
                    </Button>
                    <Link
                      href="/completed-builds"
                      className="whitespace-nowrap text-sm font-semibold text-text-secondary underline-offset-4 transition-colors hover:text-accent hover:underline"
                    >
                      See completed builds
                    </Link>
                  </motion.div>
                ) : hint && next ? (
                  <motion.button
                    key={`hint-${chapter}`}
                    type="button"
                    onClick={() => goTo(chapter + 1)}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    transition={{ duration: 0.35 }}
                    className="flex items-center gap-3 rounded-full border border-white/15 bg-white/[0.06] py-2 pl-2 pr-4 text-left shadow-[0_10px_40px_-15px_rgba(0,0,0,0.9)] transition-colors hover:border-accent/50 hover:bg-white/[0.1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    aria-label={`Continue to the next step: ${next.headline}`}
                  >
                    <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-accent text-black">
                      <motion.svg
                        viewBox="0 0 24 24"
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        animate={{ y: [-2, 2, -2] }}
                        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                      >
                        <path d="M6 9l6 6 6-6" />
                      </motion.svg>
                      <span className="absolute inset-0 animate-ping rounded-full bg-accent/40 [animation-duration:2s]" />
                    </span>
                    <span className="flex flex-col leading-tight">
                      <span className="text-[13px] font-semibold text-white">{touch ? "Swipe up to continue" : "Scroll to continue"}</span>
                      <span className="text-[11px] text-white/55">Next: {next.headline}</span>
                    </span>
                  </motion.button>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
