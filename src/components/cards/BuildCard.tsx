import Link from "next/link";
import { BuildImageFrame } from "@/components/cards/BuildImageFrame";
import type { CompletedBuild } from "@/types";

const coreSpecRows: { key: keyof CompletedBuild; label: string }[] = [
  { key: "cpu", label: "CPU" },
  { key: "gpu", label: "GPU" },
  { key: "ram", label: "RAM" },
  { key: "storage", label: "Storage" },
];

export function BuildCard({ build }: { build: CompletedBuild }) {
  return (
    <div className="glass glass-flat glass-interactive flex flex-col">
      {build.imageSrc ? (
        <BuildImageFrame
          src={build.imageSrc}
          alt={build.imageAlt}
          scale={build.imageScale}
          translateX={build.imageTranslateX}
          translateY={build.imageTranslateY}
        />
      ) : (
        <div
          role="img"
          aria-label={build.imageAlt}
          className="flex aspect-[4/5] w-full items-center justify-center"
        >
          <span className="text-xs font-medium uppercase tracking-widest text-text-muted">
            Photo coming soon
          </span>
        </div>
      )}

      <div className="hairline mx-6" aria-hidden="true" />

      <div className="flex flex-1 flex-col gap-4 p-6">
        <h3 className="font-display text-lg font-semibold text-white">
          {build.name}
        </h3>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {coreSpecRows.map((row) => (
            <div key={row.key} className="flex flex-col">
              <dt className="text-text-muted">{row.label}</dt>
              <dd className="text-text-primary">{build[row.key] as string}</dd>
            </div>
          ))}
        </dl>

        <p className="text-sm text-text-secondary">{build.description}</p>

        {/* Native <details> — no client JS needed for this simple disclosure. */}
        <details className="group rounded-xl bg-white/[0.03] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)] open:pb-3">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 text-xs font-semibold uppercase tracking-wide text-text-secondary transition-colors hover:text-white [&::-webkit-details-marker]:hidden">
            Full specifications
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="h-4 w-4 text-accent transition-transform duration-300 group-open:rotate-180"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 8l4 4 4-4" />
            </svg>
          </summary>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-3 pt-1 text-sm">
            <div className="flex flex-col">
              <dt className="text-text-muted">Motherboard</dt>
              <dd className="text-text-primary">{build.motherboard}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-text-muted">PSU</dt>
              <dd className="text-text-primary">{build.psu}</dd>
            </div>
            <div className="flex flex-col">
              <dt className="text-text-muted">CPU Cooler</dt>
              <dd className="text-text-primary">{build.cpuCooler}</dd>
            </div>
            <div className="col-span-2 flex flex-col">
              <dt className="text-text-muted">Accessories</dt>
              <dd className="text-text-primary">{build.accessories.join(", ")}</dd>
            </div>
          </dl>
        </details>

        <p className="text-xs text-text-muted">
          This build was completed previously. Component availability and
          pricing may have changed. Contact us for current specifications and
          pricing.
        </p>

        <Link
          href={`/build-my-pc?reference=${encodeURIComponent(build.name)}`}
          className="btn-sheen btn-red mt-auto inline-flex items-center justify-center rounded-full px-5 py-3 text-sm font-semibold"
        >
          Request a Similar Build
        </Link>
      </div>
    </div>
  );
}
