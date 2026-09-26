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

/** Caption crossfade half-width, in chapters (≈ 5 % of a chapter's scroll). */
const CAPTION_FADE = 0.045;

/** How visible chapter i's caption is at story position s (0..1), plus which way it moves. */
function captionState(s: number, i: number) {
  const fadeIn = i === 0 ? 1 : smooth((s - i - 0.004) / CAPTION_FADE);
  const fadeOut = i === CHAPTER_COUNT - 1 ? 1 : 1 - smooth((s - (i + 1) + CAPTION_FADE + 0.004) / CAPTION_FADE);
  return { v: fadeIn * fadeOut, dir: s < i + 0.5 ? 1 : -1 };
}

function Story3D({ enabled, onFail }: { enabled: boolean; onFail: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const captions = useRef<(HTMLDivElement | null)[]>([]);
  const hint = useRef<HTMLDivElement>(null);
  const cta = useRef<HTMLDivElement>(null);

  const timeline = useMemo(() => new Timeline(), []);
  const anchors = useMemo(() => new AnchorStore(), []);

  const [metrics, setMetrics] = useState<StageMetrics>(() => stageMetrics(1440, 820));
  const [quality, setQuality] = useState<Quality | null>(null);
  const [ready, setReady] = useState(false);
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

  // ---- the single scroll listener: every scroll asks the timeline for one frame
  useEffect(() => {
    const onScroll = () => timeline.request();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [timeline]);

  useEffect(() => () => timeline.dispose(), [timeline]);

  // ---- DOM layer: progress bar, captions, hint and CTA, written straight from the timeline
  useEffect(() => {
    const last = { bar: -1, hint: -1, cta: -1, caps: captions.current.map(() => -1) };
    const setVisible = (el: HTMLElement, v: number) => {
      el.style.opacity = v.toFixed(3);
      el.style.visibility = v < 0.002 ? "hidden" : "visible";
    };
    return timeline.subscribe((t) => {
      const p = Math.round(t.progress * 10000) / 10000;
      if (p !== last.bar && bar.current) {
        last.bar = p;
        // Translate (never scale) so the compositor keeps one raster of the
        // gradient: the fill slides in, the gradient inside it stays put.
        const x = (p - 1) * 100;
        bar.current.style.transform = `translate3d(${x.toFixed(2)}%, 0, 0)`;
        (bar.current.firstElementChild as HTMLElement).style.transform = `translate3d(${(-x).toFixed(2)}%, 0, 0)`;
      }
      captions.current.forEach((el, i) => {
        if (!el) return;
        const { v, dir } = captionState(t.s, i);
        const q = Math.round(v * 1000) / 1000;
        if (q === last.caps[i]) return;
        last.caps[i] = q;
        setVisible(el, q);
        el.style.transform = `translate3d(0, ${((1 - q) * 12 * dir).toFixed(2)}px, 0)`;
      });
      const h = Math.round((1 - smooth(t.progress / 0.012)) * 1000) / 1000;
      if (h !== last.hint && hint.current) {
        last.hint = h;
        setVisible(hint.current, h);
      }
      const c = Math.round(smooth((t.s - (CHAPTER_COUNT - 0.16)) / 0.08) * 1000) / 1000;
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

          {/* progress — the same timeline value as the scene */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center" style={{ height: metrics.top }}>
            <div className="mt-5 h-[3px] w-[140px] overflow-hidden rounded-full bg-white/[0.12] sm:mt-6 sm:w-[220px]">
              <div ref={bar} className="h-full w-full overflow-hidden rounded-full" style={{ transform: "translate3d(-100%, 0, 0)" }}>
                <div className="h-full w-full bg-gradient-to-r from-accent to-primary" style={{ transform: "translate3d(100%, 0, 0)" }} />
              </div>
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
              {/* first-screen affordance; fades away as soon as the visitor starts scrolling */}
              <div ref={hint} className="pointer-events-none absolute inset-x-0 flex justify-center" aria-hidden="true">
                <span className="flex items-center gap-2.5 rounded-full border border-white/15 bg-white/[0.06] py-2 pl-2 pr-4 text-[13px] font-semibold text-white shadow-[0_10px_40px_-15px_rgba(0,0,0,0.9)]">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-black">
                    <svg viewBox="0 0 24 24" className="h-4 w-4 animate-bounce" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </span>
                  Scroll to explore
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
