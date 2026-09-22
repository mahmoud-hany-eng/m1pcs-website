import Image from "next/image";

/**
 * Consistent "showroom" frame for a completed build's transparent-background
 * product photo. Fixed aspect ratio + object-contain means the PC is never
 * cropped or stretched and reads at the same visual size across builds
 * whatever the source canvas dimensions are; the dark panel, soft ambient
 * glow and a drop shadow that hugs the case silhouette keep it from looking
 * like a cutout floating on nothing.
 */
export function BuildImageFrame({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="relative aspect-[4/5] w-full overflow-hidden border-b border-border bg-gradient-to-br from-surface-elevated to-background">
      <div aria-hidden="true" className="build-photo-glow pointer-events-none absolute inset-0" />
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
        className="object-contain p-8 drop-shadow-[0_20px_24px_rgba(0,0,0,0.55)] sm:p-10"
      />
    </div>
  );
}
