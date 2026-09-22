export type MainUse =
  | "Gaming"
  | "Gaming + Streaming"
  | "Work"
  | "Editing"
  | "Mixed use";

export type Resolution = "1080p" | "1440p" | "4K" | "Not sure";

export type TargetFps = "60 FPS" | "120+ FPS" | "144+ FPS" | "240+ FPS" | "Not sure";

export type CpuPreference = "AMD" | "Intel" | "No preference";

export type GpuPreference = "NVIDIA" | "AMD" | "No preference";

export type StorageOption = "1TB" | "2TB" | "More than 2TB" | "Not sure";

export type BuildColor = "Black" | "White" | "Other" | "No preference";

export type RgbPreference = "Yes" | "No" | "Minimal";

export type WifiPreference = "Required" | "Not required" | "Not sure";

export type MonitorPreference = "I already have one" | "I need a monitor";

export type Accessory = "Keyboard" | "Mouse" | "Headset";

export interface QuoteFormData {
  fullName: string;
  mobile: string;
  email: string;
  budgetQar: string;
  mainUse: MainUse | "";
  games: string;
  resolution: Resolution | "";
  targetFps: TargetFps | "";
  cpuPreference: CpuPreference | "";
  gpuPreference: GpuPreference | "";
  storage: StorageOption | "";
  buildColor: BuildColor | "";
  rgb: RgbPreference | "";
  wifi: WifiPreference | "";
  monitor: MonitorPreference | "";
  accessories: Accessory[];
  additionalRequirements: string;
  /** Optional: pre-fills the enquiry when arriving from a "Request similar build" link. */
  referenceBuild?: string;
}

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
