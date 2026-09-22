import Image from "next/image";

/**
 * Consistent "showroom" frame for a completed build's transparent-background
 * product photo. Fixed aspect ratio + object-contain means the PC is never
 * cropped or stretched, but object-contain alone still isn't enough for a
 * *visually* consistent set of cards: every source photo has a different
 * amount of empty transparent padding around the case and isn't always
 * centered within its own canvas, so two PCs of similar real size can still
 * render at noticeably different sizes/positions once fit into the same box.
 *
 * `scale`/`translateX`/`translateY` correct for that per photo. They're a
 * CSS transform layered on top of the object-contain box — `translate` is
 * listed before `scale` so its percentages resolve against the box's own
 * (untransformed) size and stay a fixed recentering shift regardless of the
 * scale factor, while `scale` grows/shrinks around the box's own center.
 * Values come from measuring each photo's actual visible bounding box, not
 * eyeballing (see the imageScale/imageTranslateX/imageTranslateY comment on
 * CompletedBuild); the default (1, 0, 0) leaves object-contain untouched.
 */
export function BuildImageFrame({
  src,
  alt,
  scale = 1,
  translateX = 0,
  translateY = 0,
}: {
  src: string;
  alt: string;
  scale?: number;
  translateX?: number;
  translateY?: number;
}) {
  return (
    <div className="relative aspect-[4/5] w-full overflow-hidden border-b border-border bg-gradient-to-br from-surface-elevated to-background">
      <div aria-hidden="true" className="build-photo-vignette pointer-events-none absolute inset-0" />
      <Image
        src={src}
        alt={alt}
        fill
        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
        className="object-contain p-8 drop-shadow-[0_20px_24px_rgba(0,0,0,0.55)] sm:p-10"
        style={{ transform: `translate(${translateX}%, ${translateY}%) scale(${scale})` }}
      />
    </div>
  );
}
