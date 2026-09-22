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
    <div className="flex flex-col overflow-hidden rounded-card border border-border bg-surface shadow-card transition-all duration-200 hover:border-primary/60 hover:shadow-card-hover">
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
          className="flex aspect-[4/5] w-full items-center justify-center border-b border-border bg-gradient-to-br from-surface-elevated to-background"
        >
          <span className="text-xs font-medium uppercase tracking-widest text-text-muted">
            Photo coming soon
          </span>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-4 p-6">
        <h3 className="font-display text-lg font-semibold text-text-primary">
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
        <details className="group rounded-lg border border-border bg-background/60 open:pb-3">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold uppercase tracking-wide text-text-secondary hover:text-accent">
            Full specifications
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
          className="mt-auto inline-flex items-center justify-center rounded-full bg-primary px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
        >
          Request a Similar Build
        </Link>
      </div>
    </div>
  );
}
