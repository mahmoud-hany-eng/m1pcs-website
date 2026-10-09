"use client";

import { useLayoutEffect, useRef, type ComponentType, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import type { AnchorStore } from "./anchors";
import {
  IconBolt,
  IconBoard,
  IconBox,
  IconCase,
  IconCheck,
  IconCpu,
  IconGamepad,
  IconGpu,
  IconPalette,
  IconPhone,
  IconPin,
  IconRam,
  IconStorage,
  IconTruck,
  IconWallet,
  IconWrench,
} from "./ui-icons";

/**
 * Every piece of text or iconography inside the 3D story lives here as real
 * DOM + SVG, so it renders at native resolution on any screen. Elements are
 * positioned by the 3D director through the AnchorStore (see anchors.ts);
 * their states (selected, paid, row reveals, progress) are driven through
 * data-* attributes and CSS custom properties set on the anchor.
 */

export const REQUIREMENTS: { id: string; label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { id: "chip-budget", label: "Budget", Icon: IconWallet },
  { id: "chip-games", label: "Games", Icon: IconGamepad },
  { id: "chip-performance", label: "Performance", Icon: IconBolt },
  { id: "chip-design", label: "Design", Icon: IconPalette },
];

export const PART_UI: { id: string; tag: string; name: string; Icon: ComponentType<{ className?: string }> }[] = [
  { id: "cpu", tag: "CPU", name: "Processor", Icon: IconCpu },
  { id: "gpu", tag: "GPU", name: "Graphics card", Icon: IconGpu },
  { id: "ram", tag: "RAM", name: "Memory", Icon: IconRam },
  { id: "storage", tag: "SSD", name: "Storage", Icon: IconStorage },
  { id: "board", tag: "Motherboard", name: "Motherboard", Icon: IconBoard },
  { id: "case", tag: "Case", name: "Case", Icon: IconCase },
];

export const SETUP_ITEMS = ["Windows 11 Pro", "Drivers", "Updates"] as const;
const ORDER_LINES = ["Deposit received", "Payment confirmation sent", "Order officially placed"] as const;

const CARD =
  "rounded-2xl border border-white/[0.12] bg-[#0f0f11]/95 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.95)] ring-1 ring-black/40";
const PILL =
  "flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 font-display text-[12px] font-semibold leading-none shadow-[0_10px_28px_-12px_rgba(0,0,0,0.9)] sm:text-[13px]";

/** Row reveal driven by a 0..1 CSS variable written from the 3D timeline. */
const reveal = (name: string): CSSProperties => ({
  opacity: `var(--${name}, 0)`,
  transform: `translateY(calc((1 - var(--${name}, 0)) * 6px))`,
});
/** A row that waits as a dim placeholder, then lights up when its part arrives. */
const fill = (name: string): CSSProperties => ({ opacity: `calc(0.2 + var(--${name}, 0) * 0.8)` });

/** A pinned element. State flags (data-*) land on the outer node, so `group-data-*` styles work inside. */
function Anchored({ id, className = "", children }: { id: string; className?: string; children: ReactNode }) {
  return (
    <div data-anchor={id} className="group absolute left-0 top-0 select-none will-change-transform" style={{ opacity: 0, visibility: "hidden" }}>
      <div className={className} style={{ zoom: "var(--hiw-ui, 1)" }}>
        {children}
      </div>
    </div>
  );
}

export function StoryOverlay({ store, ui = 1 }: { store: AnchorStore; ui?: number }) {
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const els = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-anchor]") ?? []);
    els.forEach((el) => store.bind(el.dataset.anchor!, el));
    return () => els.forEach((el) => store.bind(el.dataset.anchor!, null));
  }, [store]);

  return (
    <div
      ref={root}
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ "--hiw-ui": ui } as CSSProperties}
      aria-hidden="true"
    >
      {/* who's who */}
      <Anchored id="tag-rep">
        <span className={`${PILL} border-primary/50 bg-[#141416]/95 text-white`}>
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          M1 team
        </span>
      </Anchored>
      <Anchored id="tag-customer">
        <span className={`${PILL} border-white/20 bg-[#141416]/95 text-white`}>
          <span className="h-1.5 w-1.5 rounded-full bg-white" />
          You
        </span>
      </Anchored>

      {/* 1 — requirements */}
      {REQUIREMENTS.map(({ id, label, Icon }) => (
        <Anchored key={id} id={id}>
          <span className={`${PILL} border-white/[0.14] bg-[#141416]/95 py-1 pl-1 pr-3 text-white`}>
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-accent sm:h-7 sm:w-7">
              <Icon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            </span>
            {label}
          </span>
        </Anchored>
      ))}

      {/* 1 — part labels (turn gold with a check once chosen) */}
      {PART_UI.map(({ id, tag }) => (
        <Anchored key={id} id={`part-${id}`}>
          <span className="flex items-center gap-1 whitespace-nowrap rounded-full border border-white/[0.14] bg-[#141416]/95 px-2.5 py-1 font-display text-[10px] font-bold uppercase leading-none tracking-[0.12em] text-white transition-colors duration-300 group-data-[selected]:border-accent group-data-[selected]:bg-accent group-data-[selected]:text-black sm:text-[11px]">
            <IconCheck className="-ml-0.5 hidden h-3 w-3 group-data-[selected]:block" />
            {tag}
          </span>
        </Anchored>
      ))}

      {/* 2 — quotation */}
      <Anchored id="quote" className="w-[236px] sm:w-[292px]">
        <div className={`overflow-hidden ${CARD}`}>
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] bg-gradient-to-r from-primary/25 via-primary/5 to-transparent px-3.5 py-2.5 sm:px-4 sm:py-3">
            <div className="flex items-center gap-2.5">
              <Image src="/how-it-works/m1-emblem.png" alt="" width={26} height={22} className="h-[18px] w-auto sm:h-5" />
              <div>
                <div className="font-display text-[13px] font-bold leading-none text-white sm:text-[14px]">Quotation</div>
                <div className="mt-1 text-[10px] leading-none text-white/50">Your custom build</div>
              </div>
            </div>
            <span
              className="flex items-center gap-1 rounded-full bg-accent px-2 py-1 font-display text-[10px] font-bold uppercase leading-none tracking-[0.1em] text-black"
              style={{ opacity: "var(--approved, 0)", transform: "scale(calc(0.7 + var(--approved, 0) * 0.3))" }}
            >
              <IconCheck className="h-3 w-3" />
              Approved
            </span>
          </div>
          <ul className="px-3.5 py-1.5 sm:px-4 sm:py-2">
            {PART_UI.map(({ id, name, Icon }, i) => (
              <li key={id} className="flex items-center gap-2.5 py-[4px] sm:py-[5px]" style={fill(`r${i}`)}>
                <Icon className="h-3.5 w-3.5 shrink-0 text-accent sm:h-4 sm:w-4" />
                <span className="flex-1 text-[11px] text-white/90 sm:text-[12px]">{name}</span>
                <span className="text-[9px] font-semibold tracking-wide text-white/40 sm:text-[10px]">QAR</span>
                <span className="h-[6px] w-9 rounded-full bg-white/[0.16] sm:w-11" />
              </li>
            ))}
          </ul>
          <div className="border-t border-dashed border-white/[0.1] px-3.5 py-1.5 sm:px-4 sm:py-2">
            <div className="flex items-center gap-2.5 py-[4px] sm:py-[5px]" style={reveal("r6")}>
              <IconTruck className="h-3.5 w-3.5 shrink-0 text-accent sm:h-4 sm:w-4" />
              <span className="flex-1 text-[11px] text-white/90 sm:text-[12px]">Est. shipping timeframe</span>
              <span className="rounded-full border border-accent/40 px-1.5 py-0.5 text-[9px] font-semibold text-accent sm:text-[10px]">Included</span>
            </div>
            <div className="flex items-center justify-between py-[5px]" style={reveal("r7")}>
              <span className="font-display text-[12px] font-bold text-white sm:text-[13px]">Total</span>
              <span className="flex items-center gap-1.5">
                <span className="text-[9px] font-semibold tracking-wide text-white/40 sm:text-[10px]">QAR</span>
                <span className="h-[7px] w-14 rounded-full bg-gradient-to-r from-accent to-primary sm:w-16" />
              </span>
            </div>
          </div>
        </div>
      </Anchored>

      {/* 3 — deposit on the customer's phone */}
      <Anchored id="pay" className="w-[150px] sm:w-[168px]">
        <div className={`${CARD} p-3`}>
          <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-white/55 sm:text-[10px]">
            <IconPhone className="h-3.5 w-3.5" />
            Deposit
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-white/45">QAR</span>
            <span className="h-2 w-14 rounded-full bg-white/20" />
          </div>
          <div className="mt-2.5 flex h-7 items-center justify-center rounded-full bg-accent text-[11px] font-bold text-black transition-[transform,background-color] duration-200 group-data-[paid]:bg-white group-data-[press]:scale-95 sm:text-[12px]">
            <span className="group-data-[paid]:hidden">Pay deposit</span>
            <span className="hidden items-center gap-1 group-data-[paid]:flex">
              <IconCheck className="h-3.5 w-3.5" />
              Payment sent
            </span>
          </div>
        </div>
      </Anchored>
      <Anchored id="received">
        <span className={`${PILL} border-accent/40 bg-[#141416]/95 text-white`}>
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-black">
            <IconCheck className="h-3 w-3" />
          </span>
          Payment received
        </span>
      </Anchored>
      <Anchored id="order" className="w-[228px] sm:w-[260px]">
        <div className={`${CARD} border-accent/30 px-4 py-4 text-center sm:px-5`}>
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-accent text-black shadow-[0_0_32px_rgba(249,194,4,0.45)] sm:h-11 sm:w-11">
            <IconCheck className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
          <div className="mt-2.5 font-display text-[16px] font-bold leading-tight text-white sm:text-[17px]">Order confirmed</div>
          <ul className="mt-3 space-y-1.5 text-left">
            {ORDER_LINES.map((line, i) => (
              <li key={line} className="flex items-center gap-2 text-[11px] text-white/80 sm:text-[12px]" style={reveal(`o${i}`)}>
                <IconCheck className="h-3.5 w-3.5 shrink-0 text-accent" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </Anchored>

      {/* 4 — sourcing */}
      <Anchored id="geo-usa">
        <span className={`${PILL} border-white bg-white text-black`}>
          <IconPin className="h-3.5 w-3.5" />
          United States
        </span>
      </Anchored>
      <Anchored id="geo-qatar">
        <span className={`${PILL} border-primary bg-primary text-white`}>
          <IconPin className="h-3.5 w-3.5" />
          Qatar
        </span>
      </Anchored>
      <Anchored id="geo-parcel">
        <span className={`${PILL} border-accent bg-accent text-black`}>
          <IconBox className="h-3.5 w-3.5" />
          <span data-slot="label">Your parts</span>
        </span>
      </Anchored>

      {/* 5 — build, setup, hand-over */}
      <Anchored id="build" className="w-[176px] sm:w-[196px]">
        <div className={`${CARD} rounded-xl px-3 py-2.5`}>
          <div className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-white/55 sm:text-[10px]">
            <IconWrench className="h-3.5 w-3.5 text-accent" />
            <span data-slot="stage">Assembling</span>
          </div>
          <div data-slot="part" className="mt-1 font-display text-[13px] font-bold leading-tight text-white sm:text-[14px]">
            Motherboard
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full origin-left rounded-full bg-gradient-to-r from-accent to-primary" style={{ transform: "scaleX(var(--p, 0))" }} />
          </div>
        </div>
      </Anchored>
      <Anchored id="setup" className="w-[188px] sm:w-[212px]">
        <div className={`${CARD} p-3 sm:p-3.5`}>
          <div className="flex items-center gap-2">
            <Image src="/how-it-works/m1-emblem.png" alt="" width={22} height={19} className="h-4 w-auto" />
            <span className="font-display text-[13px] font-bold text-white sm:text-[14px]">PC setup</span>
          </div>
          {SETUP_ITEMS.map((item, i) => (
            <div key={item} className="mt-2.5">
              <div className="flex items-center justify-between text-[11px] text-white/85 sm:text-[12px]">
                <span>{item}</span>
                <span style={{ opacity: `var(--c${i}, 0)` }}>
                  <IconCheck className="h-3.5 w-3.5 text-accent" />
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                <div className="h-full origin-left rounded-full bg-accent" style={{ transform: `scaleX(var(--s${i}, 0))` }} />
              </div>
            </div>
          ))}
          <div
            className="mt-3 flex h-7 items-center justify-center gap-1.5 rounded-full bg-accent text-[11px] font-bold text-black sm:text-[12px]"
            style={{ opacity: "var(--ready, 0)", transform: "scale(calc(0.85 + var(--ready, 0) * 0.15))" }}
          >
            <IconCheck className="h-3.5 w-3.5" />
            Ready to use
          </div>
        </div>
      </Anchored>
      <Anchored id="handoff">
        <span className={`${PILL} border-accent bg-accent text-black`}>
          <IconCheck className="h-3.5 w-3.5" />
          Ready for pickup or delivery
        </span>
      </Anchored>
    </div>
  );
}
