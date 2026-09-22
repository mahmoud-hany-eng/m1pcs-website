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
}
