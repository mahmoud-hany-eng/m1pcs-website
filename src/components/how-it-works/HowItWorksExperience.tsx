"use client";

import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { motion, useInView, useScroll, useSpring, useTransform } from "framer-motion";
import { SCENE_RANGES, STORY_SCROLL_VH, STORY_SCROLL_VH_MOBILE, focusAt } from "./story";
import { ProgressRail, TextStack, type StackLayout } from "./TextStack";
import { StaticSteps } from "./StaticSteps";

const StoryCanvas = dynamic(() => import("./three/StoryCanvas"), { ssr: false });

type Mode = "pending" | "3d" | "static";
type Quality = "high" | "low";

const WIDE_QUERY = "(min-width: 1024px) and (min-aspect-ratio: 11/10)";

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Falls back to the static story if the 3D canvas throws (e.g. lost WebGL context on init). */
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
 * /how-it-works — a pinned, full-screen 3D story. Scroll drives one
 * continuous timeline (camera, characters, props and text) through six
 * scenes. Reduced-motion users and devices without WebGL get StaticSteps.
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

function useLayoutMode(): StackLayout {
  const [layout, setLayout] = useState<StackLayout>("wide");
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const update = () => setLayout(mq.matches ? "wide" : "tall");
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return layout;
}

function detectQuality(layout: StackLayout): Quality {
  if (layout === "tall") return "low";
  const nav = navigator as Navigator & { deviceMemory?: number };
  if ((nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4) return "low";
  return "high";
}

function Story3D({ enabled, onFail }: { enabled: boolean; onFail: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const layout = useLayoutMode();
  const [quality, setQuality] = useState<Quality>("low");
  const [fontsReady, setFontsReady] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setQuality(detectQuality(layout));
  }, [layout]);

  useEffect(() => {
    let alive = true;
    document.fonts.ready.then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const { scrollYProgress } = useScroll({ target: container, offset: ["start start", "end end"] });
  const progress = useSpring(scrollYProgress, { stiffness: 110, damping: 28, mass: 0.35, restDelta: 0.00002 });
  const focus = useTransform(progress, focusAt);
  const stepLabel = useTransform(focus, (f) => `${String(Math.round(f) + 1).padStart(2, "0")} / ${String(SCENE_RANGES.length).padStart(2, "0")}`);
  const cueOpacity = useTransform(progress, [0, 0.012], [1, 0]);
  const inView = useInView(container, { margin: "10% 0px 10% 0px" });

  const jump = useCallback((index: number) => {
    const el = container.current;
    if (!el) return;
    const [a, b] = SCENE_RANGES[index];
    const target = a + (b - a) * (index === SCENE_RANGES.length - 1 ? 0.92 : 0.55);
    const top = el.getBoundingClientRect().top + window.scrollY;
    const range = el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + target * range, behavior: "smooth" });
  }, []);

  const wide = layout === "wide";
  const scrollVh = wide ? STORY_SCROLL_VH : STORY_SCROLL_VH_MOBILE;

  return (
    <section aria-labelledby="how-it-works-title" className="relative bg-background">
      <div ref={container} className="relative" style={{ height: `${scrollVh}vh` }}>
        <div className="sticky top-16 h-[calc(100svh-4rem)] overflow-hidden sm:top-20 sm:h-[calc(100svh-5rem)]">
          {/* 3D stage */}
          <div className={`absolute inset-0 transition-opacity duration-1000 ${ready ? "opacity-100" : "opacity-0"}`} aria-hidden="true">
            {enabled && fontsReady && (
              <CanvasBoundary onError={onFail}>
                <StoryCanvas progress={progress} layout={layout} quality={quality} active={inView} onReady={() => setReady(true)} />
              </CanvasBoundary>
            )}
          </div>
          {!ready && (
            <div
              className={`pointer-events-none absolute flex items-center justify-center ${wide ? "inset-y-0 left-0 w-[62%]" : "inset-x-0 top-0 h-[54%]"}`}
              aria-hidden="true"
            >
              <span className="h-16 w-16 animate-pulse rounded-full bg-primary/20 blur-xl" />
            </div>
          )}

          {/* legibility scrims */}
          {!wide && <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-background via-background/75 to-transparent" />}
          <div
            className={`pointer-events-none absolute ${
              wide
                ? "inset-y-0 right-0 w-[48%] bg-gradient-to-l from-background via-background/85 to-transparent"
                : "inset-x-0 bottom-0 h-[52%] bg-gradient-to-t from-background via-background/90 to-transparent"
            }`}
          />

          {/* story text: active step centred, neighbours faded above/below */}
          <div className={`absolute ${wide ? "inset-y-0 right-0 w-[38%] px-6 xl:px-10" : "inset-x-0 bottom-0 h-[46%] px-5"}`}>
            <div className="relative mx-auto h-full w-full max-w-xl">
              <TextStack focus={focus} progress={progress} layout={layout} />
            </div>
          </div>
          <header
            className={`absolute flex flex-col items-center gap-2 ${wide ? "right-0 top-8 w-[38%] xl:top-10" : "inset-x-0 top-3"}`}
          >
            <h1 id="how-it-works-title" className="font-display text-xs font-bold uppercase tracking-[0.32em] text-text-secondary sm:text-sm">
              How It Works
            </h1>
            <div className="flex items-center gap-3">
              <motion.span className="w-14 font-display text-xs font-bold tabular-nums text-accent">{stepLabel}</motion.span>
              <ProgressRail progress={progress} onJump={jump} />
            </div>
          </header>

          {/* scroll cue */}
          <motion.div
            style={{ opacity: cueOpacity }}
            className={`pointer-events-none absolute flex flex-col items-center gap-1 text-text-muted ${
              wide ? "bottom-6 left-[31%] -translate-x-1/2" : "left-1/2 top-[50%] -translate-x-1/2"
            }`}
            aria-hidden="true"
          >
            <span className="font-display text-[0.7rem] font-bold uppercase tracking-[0.3em]">Scroll</span>
            <motion.span
              animate={{ y: [0, 6, 0] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
              className="block h-5 w-px bg-gradient-to-b from-accent to-transparent"
            />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
