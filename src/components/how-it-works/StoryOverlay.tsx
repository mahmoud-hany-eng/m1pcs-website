"use client";

import { useLayoutEffect, useRef, type ComponentType, type CSSProperties, type ReactNode } from "react";
import Image from "next/image";
import type { AnchorStore } from "./anchors";
import { SUPPLIERS } from "./three/globe-math";
import {
  IconBoard,
  IconBox,
  IconCar,
  IconCase,
  IconCheck,
  IconCpu,
  IconFan,
  IconGamepad,
  IconGpu,
  IconHome,
  IconPalette,
  IconPhone,
  IconPin,
  IconPlane,
  IconRam,
  IconReceipt,
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
 * data-* attributes and CSS custom properties set on the anchor — with no
 * CSS transitions, so nothing keeps moving once the scroll stops.
 * Labels are kept short; the caption under the scene carries the detail.
 */

export const REQUIREMENTS: { id: string; label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { id: "chip-budget", label: "Budget", Icon: IconWallet },
  { id: "chip-usecase", label: "Use case", Icon: IconGamepad },
  { id: "chip-style", label: "Style", Icon: IconPalette },
];

export const PART_UI: { id: string; tag: string; Icon: ComponentType<{ className?: string }> }[] = [
  { id: "cpu", tag: "CPU", Icon: IconCpu },
  { id: "gpu", tag: "GPU", Icon: IconGpu },
  { id: "ram", tag: "RAM", Icon: IconRam },
  { id: "storage", tag: "Storage", Icon: IconStorage },
  { id: "board", tag: "Motherboard", Icon: IconBoard },
  { id: "case", tag: "Case", Icon: IconCase },
  { id: "cooler", tag: "Cooling", Icon: IconFan },
];

/** Quotation rows (the last groups motherboard, case and cooling). */
const QUOTE_ROWS: { label: string; Icon: ComponentType<{ className?: string }> }[] = [
  { label: "CPU", Icon: IconCpu },
  { label: "GPU", Icon: IconGpu },
  { label: "RAM", Icon: IconRam },
  { label: "Storage", Icon: IconStorage },
  { label: "Board, case & cooling", Icon: IconBoard },
];

export const SETUP_ITEMS = ["Windows 11 Pro", "Drivers", "Updates"] as const;
const ORDER_LINES = ["Deposit received", "Receipt issued", "Order officially placed"] as const;

/*
 * Glass-look labels. These ride the 3D scene every frame, so they carry the
 * showroom glass material (charcoal gradient, lit top edge, hairline) but
 * deliberately no live backdrop-filter — a dozen moving blurred surfaces
 * over a WebGL canvas would cost far more than they'd show.
 */
const CARD =
  "rounded-2xl border border-white/[0.1] bg-[linear-gradient(160deg,rgba(40,40,44,0.95)_0%,rgba(14,14,16,0.96)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.09),0_24px_60px_-24px_rgba(0,0,0,0.95)]";
const PILL =
  "flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 font-display text-[12.5px] font-semibold leading-none shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_10px_28px_-12px_rgba(0,0,0,0.9)] sm:text-[13.5px]";

/** Row reveal driven by a 0..1 CSS variable written from the 3D timeline. */
const reveal = (name: string): CSSProperties => ({
  opacity: `var(--${name}, 0)`,
  transform: `translateY(calc((1 - var(--${name}, 0)) * 6px))`,
});
/** A row that waits as a dim placeholder, then lights up when its part arrives. */
const fill = (name: string): CSSProperties => ({ opacity: `calc(0.22 + var(--${name}, 0) * 0.78)` });

/** A pinned element. State flags (data-*) land on the outer node, so `group-data-*` styles work inside. */
function Anchored({ id, className = "", children }: { id: string; className?: string; children: ReactNode }) {
  return (
    <div data-anchor={id} className="group absolute left-0 top-0 select-none will-change-transform" style={{ opacity: 0, visibility: "hidden" }}>
      <div className={className} style={{ zoom: "calc(var(--hiw-ui, 1) * var(--fit, 1))" }}>
        {children}
      </div>
    </div>
  );
}

function Emblem({ className = "h-4 w-auto" }: { className?: string }) {
  return <Image src="/how-it-works/m1-emblem.png" alt="" width={24} height={20} className={className} />;
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
        <span className={`${PILL} border-primary/50 bg-[linear-gradient(180deg,rgba(40,40,44,0.95),rgba(18,18,20,0.95))] text-white`}>
          <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          M1 team
        </span>
      </Anchored>
      <Anchored id="tag-customer">
        <span className={`${PILL} border-white/20 bg-[linear-gradient(180deg,rgba(40,40,44,0.95),rgba(18,18,20,0.95))] text-white`}>
          <span className="h-1.5 w-1.5 rounded-full bg-white" />
          You
        </span>
      </Anchored>

      {/* 1 — needs */}
      {REQUIREMENTS.map(({ id, label, Icon }) => (
        <Anchored key={id} id={id}>
          <span className={`${PILL} border-white/[0.14] bg-[linear-gradient(180deg,rgba(40,40,44,0.95),rgba(18,18,20,0.95))] py-1 pl-1 pr-3 text-white`}>
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
          <span className="flex items-center gap-1 whitespace-nowrap rounded-full border border-white/[0.16] bg-[linear-gradient(180deg,rgba(40,40,44,0.95),rgba(18,18,20,0.95))] px-2.5 py-1 font-display text-[11px] font-bold uppercase leading-none tracking-[0.1em] text-white group-data-[selected]:border-accent group-data-[selected]:bg-accent group-data-[selected]:text-black sm:text-[12px]">
            <IconCheck className="-ml-0.5 hidden h-3 w-3 group-data-[selected]:block" />
            {tag}
          </span>
        </Anchored>
      ))}

      {/* 2 — quotation */}
      <Anchored id="quote" className="w-[248px] sm:w-[300px]">
        <div className={`overflow-hidden ${CARD}`}>
          <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] bg-gradient-to-r from-primary/25 via-primary/5 to-transparent px-4 py-3">
            <div className="flex items-center gap-2.5">
              <Emblem className="h-[19px] w-auto sm:h-5" />
              <div>
                <div className="font-display text-[14px] font-bold leading-none text-white sm:text-[15px]">Quotation</div>
                <div className="mt-1 text-[11px] leading-none text-white/55">Current pricing</div>
              </div>
            </div>
            <span
              className="flex items-center gap-1 rounded-full bg-accent px-2 py-1 font-display text-[10.5px] font-bold uppercase leading-none tracking-[0.08em] text-black"
              style={{ opacity: "var(--approved, 0)" }}
            >
              <IconCheck className="h-3 w-3" />
              Approved
            </span>
          </div>
          <ul className="px-4 py-2">
            {QUOTE_ROWS.map(({ label, Icon }, i) => (
              <li key={label} className="flex items-center gap-2.5 py-[5px]" style={fill(`r${i}`)}>
                <Icon className="h-4 w-4 shrink-0 text-accent" />
                <span className="flex-1 text-[12.5px] text-white/90 sm:text-[13px]">{label}</span>
                <span className="text-[10px] font-semibold tracking-wide text-white/40">QAR</span>
                <span className="h-[6px] w-10 rounded-full bg-white/[0.18] sm:w-12" />
              </li>
            ))}
          </ul>
          <div className="border-t border-dashed border-white/[0.1] px-4 py-2">
            <div className="flex items-center gap-2.5 py-[5px]" style={reveal("r5")}>
              <IconTruck className="h-4 w-4 shrink-0 text-accent" />
              <span className="flex-1 text-[12.5px] text-white/90 sm:text-[13px]">Shipping estimate</span>
              <span className="rounded-full border border-accent/40 px-1.5 py-0.5 text-[10.5px] font-semibold text-accent">Timeframe</span>
            </div>
            <div className="flex items-center justify-between py-[6px]" style={reveal("r6")}>
              <span className="font-display text-[13px] font-bold text-white sm:text-[14px]">Estimated total</span>
              <span className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold tracking-wide text-white/40">QAR</span>
                <span className="h-[7px] w-14 rounded-full bg-gradient-to-r from-accent to-primary sm:w-16" />
              </span>
            </div>
          </div>
        </div>
      </Anchored>

      {/* 3 — deposit on the customer's phone */}
      <Anchored id="pay" className="w-[156px] sm:w-[172px]">
        <div className={`${CARD} p-3`}>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/60">
            <IconPhone className="h-3.5 w-3.5" />
            Deposit
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-[10.5px] font-semibold text-white/45">QAR</span>
            <span className="h-2 w-14 rounded-full bg-white/20" />
          </div>
          <div className="mt-2.5 flex h-7 items-center justify-center rounded-full bg-accent text-[12px] font-bold text-black group-data-[paid]:bg-white group-data-[press]:bg-accent-hover">
            <span className="group-data-[paid]:hidden">Pay deposit</span>
            <span className="hidden items-center gap-1 group-data-[paid]:flex">
              <IconCheck className="h-3.5 w-3.5" />
              Payment sent
            </span>
          </div>
        </div>
      </Anchored>
      <Anchored id="received">
        <span className={`${PILL} border-accent/40 bg-[linear-gradient(180deg,rgba(40,40,44,0.95),rgba(18,18,20,0.95))] text-white`}>
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-black">
            <IconCheck className="h-3 w-3" />
          </span>
          Payment received
        </span>
      </Anchored>
      <Anchored id="receipt">
        <span className={`${PILL} border-white/20 bg-[linear-gradient(180deg,rgba(40,40,44,0.95),rgba(18,18,20,0.95))] text-white`}>
          <IconReceipt className="h-4 w-4 text-accent" />
          Receipt
          <span className="ml-0.5 flex items-center gap-1 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10.5px] text-accent">
            <IconCheck className="h-3 w-3" />
            Deposit paid
          </span>
        </span>
      </Anchored>
      <Anchored id="order" className="w-[236px] sm:w-[264px]">
        <div className={`${CARD} border-accent/30 px-4 py-4 text-center sm:px-5`}>
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-accent text-black shadow-[0_0_28px_rgba(249,194,4,0.35)] sm:h-11 sm:w-11">
            <IconCheck className="h-5 w-5 sm:h-6 sm:w-6" />
          </div>
          <div className="mt-2.5 font-display text-[17px] font-bold leading-tight text-white">Order confirmed</div>
          <ul className="mt-3 space-y-1.5 text-left">
            {ORDER_LINES.map((line, i) => (
              <li key={line} className="flex items-center gap-2 text-[12.5px] text-white/85" style={reveal(`o${i}`)}>
                <IconCheck className="h-3.5 w-3.5 shrink-0 text-accent" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </Anchored>

      {/* 4 — sourcing */}
      <Anchored id="sourcing" className="w-[200px] sm:w-[220px]">
        <div className={`${CARD} p-3`}>
          <div className="flex items-center gap-2">
            <Emblem />
            <span className="font-display text-[13.5px] font-bold text-white sm:text-[14px]">Parts order</span>
          </div>
          <div className="mt-1.5 text-[11.5px] leading-snug text-white/65">Your exact build list</div>
          <div className="mt-2.5 flex h-7 items-center justify-center gap-1.5 rounded-full bg-accent text-[11.5px] font-bold text-black group-data-[sent]:bg-white">
            <span className="group-data-[sent]:hidden">Order from U.S. suppliers</span>
            <span className="hidden items-center gap-1 group-data-[sent]:flex">
              <IconCheck className="h-3.5 w-3.5" />
              Sent to the U.S.
            </span>
          </div>
        </div>
      </Anchored>
      <Anchored id="geo-usa">
        <span className={`${PILL} border-white bg-white text-black`}>
          <IconPin className="h-3.5 w-3.5" />
          United States
        </span>
      </Anchored>
      {SUPPLIERS.map((p) => (
        <Anchored key={p.id} id={`sup-${p.id}`}>
          <span className={`${PILL} border-accent/60 bg-[linear-gradient(180deg,rgba(40,40,44,0.95),rgba(18,18,20,0.95))] py-1 pl-1.5 pr-2.5 text-white`}>
            <IconBox className="h-3.5 w-3.5 text-accent" />
            {p.label}
          </span>
        </Anchored>
      ))}
      <Anchored id="geo-hub">
        <span className={`${PILL} border-accent bg-accent text-black`}>
          <IconBox className="h-3.5 w-3.5" />
          Packed · ready to ship
        </span>
      </Anchored>
      <Anchored id="geo-qatar">
        <span className={`${PILL} border-primary bg-primary text-white`}>
          <IconPin className="h-3.5 w-3.5" />
          Qatar
        </span>
      </Anchored>

      {/* 5 — shipping */}
      <Anchored id="geo-plane">
        <span className={`${PILL} border-white/20 bg-[linear-gradient(180deg,rgba(40,40,44,0.95),rgba(18,18,20,0.95))] text-white`}>
          <IconPlane className="h-3.5 w-3.5 text-accent" />
          On its way to Qatar
        </span>
      </Anchored>
      <Anchored id="geo-parcel">
        <span className={`${PILL} border-accent bg-accent text-black`}>
          <IconCheck className="h-3.5 w-3.5" />
          Arrived in Qatar
        </span>
      </Anchored>

      {/* 6 — build and setup */}
      <Anchored id="build" className="w-[184px] sm:w-[200px]">
        <div className={`${CARD} rounded-xl px-3 py-2.5`}>
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/60">
            <IconWrench className="h-3.5 w-3.5 text-accent" />
            <span data-slot="stage">Installing</span>
          </div>
          <div data-slot="part" className="mt-1 font-display text-[14px] font-bold leading-tight text-white">
            Motherboard
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-full rounded-full bg-accent" style={{ transform: "translateX(calc((var(--p, 0) - 1) * 100%))" }} />
          </div>
        </div>
      </Anchored>
      <Anchored id="setup" className="w-[196px] sm:w-[216px]">
        <div className={`${CARD} p-3 sm:p-3.5`}>
          <div className="flex items-center gap-2">
            <Emblem />
            <span className="font-display text-[14px] font-bold text-white">PC setup</span>
          </div>
          {SETUP_ITEMS.map((item, i) => (
            <div key={item} className="mt-2.5">
              <div className="flex items-center justify-between text-[12px] text-white/85 sm:text-[12.5px]">
                <span>{item}</span>
                <span style={{ opacity: `var(--c${i}, 0)` }}>
                  <IconCheck className="h-3.5 w-3.5 text-accent" />
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/10">
                <div className="h-full w-full rounded-full bg-accent" style={{ transform: `translateX(calc((var(--s${i}, 0) - 1) * 100%))` }} />
              </div>
            </div>
          ))}
          <div
            className="mt-3 flex h-7 items-center justify-center gap-1.5 rounded-full bg-accent text-[12px] font-bold text-black"
            style={{ opacity: "var(--ready, 0)" }}
          >
            <IconCheck className="h-3.5 w-3.5" />
            Ready to use
          </div>
        </div>
      </Anchored>

      {/* 7 — delivery */}
      <Anchored id="car">
        <span className={`${PILL} border-white/20 bg-[linear-gradient(180deg,rgba(40,40,44,0.95),rgba(18,18,20,0.95))] text-white`}>
          <IconCar className="h-4 w-4 text-accent" />
          On the way to you
        </span>
      </Anchored>
      <Anchored id="home">
        <span className={`${PILL} border-accent/60 bg-[linear-gradient(180deg,rgba(40,40,44,0.95),rgba(18,18,20,0.95))] text-white`}>
          <IconHome className="h-3.5 w-3.5 text-accent" />
          Your home
        </span>
      </Anchored>
      <Anchored id="delivered">
        <span className={`${PILL} border-accent bg-accent text-black`}>
          <IconCheck className="h-3.5 w-3.5" />
          Delivered · ready to use
        </span>
      </Anchored>
    </div>
  );
}
