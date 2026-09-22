export interface CategoryItem {
  slug: string;
  name: string;
  description: string;
}

export interface CompletedBuild {
  slug: string;
  name: string;
  cpu: string;
  cpuCooler: string;
  gpu: string;
  ram: string;
  storage: string;
  motherboard: string;
  psu: string;
  accessories: string[];
  description: string;
  imageAlt: string;
  /**
   * Path under /public for the real build photo, e.g. "/builds/build-01.jpg".
   * `null` when no photo has been supplied yet — the card then shows a
   * "Photo coming soon" placeholder instead of a broken image.
   */
  imageSrc: string | null;
  /**
   * Per-photo presentation tuning, applied as a CSS transform on top of the
   * shared object-contain image stage (see BuildImageFrame). Each source
   * photo's transparent canvas has a different amount of empty padding
   * around the case and isn't always centered within it, so object-contain
   * alone renders every build at a different visual size/position. These
   * are derived from each photo's actual visible (non-transparent)
   * bounding box, not eyeballed — see public/builds and BuildImageFrame's
   * doc comment. All default to the neutral value (1 / 0 / 0) when omitted.
   */
  imageScale?: number;
  imageTranslateX?: number;
  imageTranslateY?: number;
}
