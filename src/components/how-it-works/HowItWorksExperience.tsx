"use client";

import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useInView } from "framer-motion";
import { Button } from "@/components/ui/Button";
import { AnchorStore } from "./anchors";
import { StaticSteps } from "./StaticSteps";
import { StoryOverlay } from "./StoryOverlay";
import { stageMetrics, uiScale, type StageMetrics } from "./stage-layout";
import { CHAPTERS, CHAPTER_COUNT, TRACK_VH, storyToProgress } from "./story";
import { Timeline } from "./timeline";
import { IconMouse, IconSwipe } from "./ui-icons";

const StoryCanvas = dynamic(() => import("./three/StoryCanvas"), { ssr: false });

type Mode = "pending" | "3d" | "static";
type Quality = "high" | "low";

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
 * /how-it-works — a pinned, full-screen 3D story scrubbed directly by the
 * page scroll (see timeline.ts). Reduced-motion visitors and devices
 * without WebGL get StaticSteps.
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

const smooth = (x: number) => {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
};

/** Caption crossfade half-width, in chapters (≈ 4 % of a chapter's scroll). */
const CAPTION_FADE = 0.04;
/** The scroll hint fades out over the first ~2 % of the story. */
const HINT_FADE = 0.02;

/** How visible chapter i's caption is at story position s (0..1), plus which way it moves. */
function captionState(s: number, i: number) {
  const fadeIn = i === 0 ? 1 : smooth((s - i - 0.004) / CAPTION_FADE);
  const fadeOut = i === CHAPTER_COUNT - 1 ? 1 : 1 - smooth((s - (i + 1) + CAPTION_FADE + 0.004) / CAPTION_FADE);
  return { v: fadeIn * fadeOut, dir: s < i + 0.5 ? 1 : -1 };
}

/** The hint's one looping cue (the only time-based motion on the page, and only before the story starts). */
const HINT_CSS = `
@keyframes hiw-wheel { 0% { transform: translateY(0); opacity: 1 } 70% { transform: translateY(4px); opacity: 0 } 100% { transform: translateY(0); opacity: 0 } }
@keyframes hiw-swipe { 0% { transform: translateY(3px); opacity: 0 } 30% { opacity: 1 } 100% { transform: translateY(-3px); opacity: 0 } }
.hiw-wheel { animation: hiw-wheel 1.6s ease-in-out infinite; }
.hiw-swipe { animation: hiw-swipe 1.5s ease-out infinite; }
@media (prefers-reduced-motion: reduce) { .hiw-wheel, .hiw-swipe { animation: none; } }
`;

function Story3D({ enabled, onFail }: { enabled: boolean; onFail: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const segments = useRef<(HTMLDivElement | null)[]>([]);
  const captions = useRef<(HTMLDivElement | null)[]>([]);
  const hint = useRef<HTMLDivElement>(null);
  const cta = useRef<HTMLDivElement>(null);

  const timeline = useMemo(() => new Timeline(), []);
  const anchors = useMemo(() => new AnchorStore(), []);

  const [metrics, setMetrics] = useState<StageMetrics>(() => stageMetrics(1440, 820));
  const [quality, setQuality] = useState<Quality | null>(null);
  const [ready, setReady] = useState(false);
  const [touch, setTouch] = useState(false);
  const inView = useInView(container, { margin: "10% 0px 10% 0px" });

  // ---- layout: stage metrics + the pixel range of the pinned track (never measured per frame)
  useEffect(() => {
    const el = container.current;
    const pin = stage.current;
    if (!el || !pin) return;
    const measure = () => {
      setMetrics(stageMetrics(pin.clientWidth, pin.clientHeight));
      const stickyTop = parseFloat(getComputedStyle(pin).top) || 0;
      const top = el.getBoundingClientRect().top + window.scrollY;
      timeline.setTrack(top - stickyTop, el.offsetHeight - pin.offsetHeight);
      timeline.jump();
      timeline.request();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(pin);
    window.addEventListener("load", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("load", measure);
    };
  }, [timeline]);

  useEffect(() => {
    setQuality((q) => q ?? detectQuality(metrics));
  }, [metrics]);

  // The hint speaks the visitor's language: "scroll" with a mouse, "swipe" on touch screens.
  useEffect(() => {
    setTouch(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  // ---- the single scroll listener: every scroll asks the timeline for one frame
  useEffect(() => {
    const onScroll = () => timeline.request();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [timeline]);

  useEffect(() => () => timeline.dispose(), [timeline]);

  // ---- DOM layer: progress bar, captions, hint and CTA, written straight from the timeline
  useEffect(() => {
    const last = { segs: segments.current.map(() => -1), hint: -1, cta: -1, caps: captions.current.map(() => -1) };
    const setVisible = (el: HTMLElement, v: number) => {
      el.style.opacity = v.toFixed(3);
      el.style.visibility = v < 0.002 ? "hidden" : "visible";
    };
    return timeline.subscribe((t) => {
      // One segment per chapter, each filling with that chapter's progress.
      // The fill slides in (translate, never scale), so its edge stays crisp.
      segments.current.forEach((el, i) => {
        if (!el) return;
        const f = Math.round(Math.min(1, Math.max(0, t.s - i)) * 2000) / 2000;
        if (f === last.segs[i]) return;
        last.segs[i] = f;
        el.style.transform = `translate3d(${((f - 1) * 100).toFixed(2)}%, 0, 0)`;
      });
      captions.current.forEach((el, i) => {
        if (!el) return;
        const { v, dir } = captionState(t.s, i);
        const q = Math.round(v * 1000) / 1000;
        if (q === last.caps[i]) return;
        last.caps[i] = q;
        setVisible(el, q);
        el.style.transform = `translate3d(0, ${((1 - q) * 12 * dir).toFixed(2)}px, 0)`;
      });
      const h = Math.round((1 - smooth(t.progress / HINT_FADE)) * 1000) / 1000;
      if (h !== last.hint && hint.current) {
        last.hint = h;
        setVisible(hint.current, h);
      }
      // The call to action arrives with the final hold, after the hand-over.
      const c = Math.round(smooth((t.s - (CHAPTER_COUNT - 0.05)) / 0.03) * 1000) / 1000;
      if (c !== last.cta && cta.current) {
        last.cta = c;
        setVisible(cta.current, c);
        cta.current.style.transform = `translate3d(0, ${((1 - c) * 10).toFixed(2)}px, 0)`;
      }
    });
  }, [timeline]);

  // Development-only hook for visual QA: scroll to any story position (a real scroll).
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __hiwSeek?: (s: number) => void };
    w.__hiwSeek = (s: number) => {
      const el = container.current;
      const pin = stage.current;
      if (!el || !pin) return;
      const stickyTop = parseFloat(getComputedStyle(pin).top) || 0;
      const top = el.getBoundingClientRect().top + window.scrollY - stickyTop;
      window.scrollTo({ top: top + storyToProgress(s) * (el.offsetHeight - pin.offsetHeight), behavior: "instant" });
    };
    return () => {
      delete w.__hiwSeek;
    };
  }, []);

  const wide = metrics.layout === "wide";

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
        style={{ height: `calc(100svh - var(--hiw-header) + ${TRACK_VH}vh)` }}
      >
        <div
          ref={stage}
          className="sticky top-16 h-[calc(100svh-4rem)] overflow-hidden bg-background sm:top-20 sm:h-[calc(100svh-5rem)]"
        >
          {/* 3D world */}
          <div className={`absolute inset-0 transition-opacity duration-700 ${ready ? "opacity-100" : "opacity-0"}`} aria-hidden="true">
            {enabled && quality && (
              <CanvasBoundary onError={onFail}>
                <StoryCanvas timeline={timeline} anchors={anchors} quality={quality} active={inView} onReady={() => setReady(true)} />
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

          {/* progress — one slim segment per step, centred, driven by the same timeline value as the scene */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" style={{ height: metrics.top }} aria-hidden="true">
            <div className="mt-5 flex items-center gap-1.5 sm:mt-6 sm:gap-2">
              {CHAPTERS.map((c, i) => (
                <div key={c.id} className="h-[3px] w-[26px] overflow-hidden rounded-full bg-white/[0.14] sm:w-[38px]">
                  <div
                    ref={(el) => {
                      segments.current[i] = el;
                    }}
                    className="h-full w-full bg-accent"
                    style={{ transform: "translate3d(-100%, 0, 0)" }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* captions, scrubbed with the scene */}
          <div className="absolute inset-x-0 bottom-0 flex flex-col items-center px-5" style={{ height: metrics.bottom }}>
            <div className="relative w-full max-w-2xl flex-1" aria-hidden="true">
              {CHAPTERS.map((step, i) => (
                <div
                  key={step.id}
                  ref={(el) => {
                    captions.current[i] = el;
                  }}
                  className="absolute inset-0 flex flex-col items-center justify-center text-center"
                  style={{ opacity: i === 0 ? 1 : 0, visibility: i === 0 ? "visible" : "hidden" }}
                >
                  <p
                    className={`font-display font-bold leading-[1.05] tracking-tight text-text-primary ${
                      wide ? "text-[clamp(2rem,3.3vw,3.1rem)]" : "text-[clamp(1.6rem,7vw,2.1rem)]"
                    }`}
                  >
                    {step.headline}
                  </p>
                  <p className={`mt-2.5 text-text-secondary ${wide ? "max-w-[36rem] text-[1.05rem] leading-relaxed" : "max-w-[22rem] text-[0.95rem] leading-snug"}`}>
                    {step.body}
                  </p>
                </div>
              ))}
            </div>

            <div className={`relative flex w-full items-center justify-center ${wide ? "h-[76px] pb-5" : "h-[84px] pb-[max(1rem,env(safe-area-inset-bottom))]"}`}>
              {/* first-screen affordance: says this is an interactive, scroll-driven story; fades as soon as scrolling starts */}
              <div ref={hint} className="pointer-events-none absolute inset-x-0 flex justify-center" aria-hidden="true">
                <style>{HINT_CSS}</style>
                <span className="flex items-center gap-3 rounded-full border border-accent/35 bg-[#131315]/95 py-2 pl-2 pr-5 shadow-[0_14px_44px_-14px_rgba(0,0,0,0.95),0_0_0_4px_rgba(249,194,4,0.06)]">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-black">
                    {touch ? <IconSwipe className="h-6 w-6" /> : <IconMouse className="h-7 w-6" />}
                  </span>
                  <span className="flex flex-col text-left leading-tight">
                    <span className="font-display text-[14.5px] font-bold text-white">{touch ? "Swipe up to explore" : "Scroll to explore"}</span>
                    <span className="mt-0.5 text-[12px] text-white/60">The story moves with you</span>
                  </span>
                </span>
              </div>
              <div ref={cta} className="absolute inset-x-0 flex items-center justify-center gap-3" style={{ opacity: 0, visibility: "hidden" }}>
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
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
