import type { CompletedBuild } from "@/types";

/**
 * Real completed builds, as supplied by the business owner, paired with real
 * photos of each build (see /public/builds/). Ordered newest first — this
 * array order is what /completed-builds and the homepage "Built by M1."
 * gallery both render in, so do not reorder without also updating that
 * intent. Do not add builds beyond these 13 or invent pricing.
 *
 * `imageScale`/`imageTranslateX`/`imageTranslateY` correct for each photo's
 * transparent canvas having a different amount of empty padding around the
 * case (and not always being centered within it, and in a few cases having
 * a canvas aspect ratio very different from the 4:5 display stage) — see
 * BuildImageFrame. They were derived by measuring each photo's actual
 * visible bounding box, not eyeballed; re-measure and update them if a
 * photo is ever replaced.
 */
export const completedBuilds: CompletedBuild[] = [
  {
    slug: "ryzen-7-9800x3d-rtx-5080",
    name: "Ryzen 7 9800X3D / RTX 5080 Build",
    cpu: "AMD Ryzen 7 9800X3D",
    cpuCooler: "Thermalright Air Cooler",
    gpu: "NVIDIA RTX 5080 16GB",
    ram: "32GB 6000MHz",
    storage: "2TB M.2 SSD",
    motherboard: "MSI B850-V EVO WiFi",
    psu: "850W 80+ Gold",
    accessories: ["10x ARGB fans (6 intake, 4 exhaust)", "White sleeved cable kit"],
    description:
      "M1's current flagship build, pairing a Ryzen 7 9800X3D with an RTX 5080 for high-end gaming, finished with a 10-fan ARGB layout and a matching white sleeved cable kit.",
    imageAlt:
      "M1 completed gaming PC build with an AMD Ryzen 7 9800X3D and NVIDIA RTX 5080, white case with red ARGB lighting and white sleeved cables.",
    imageSrc: "/builds/ryzen-7-9800x3d-rtx-5080.webp",
    imageScale: 0.91,
    imageTranslateX: 0,
    imageTranslateY: 0,
  },
  {
    slug: "ryzen-5-rtx-5060-ti",
    name: "Ryzen 5 / RTX 5060 Ti Build",
    cpu: "AMD Ryzen 5 7600X",
    cpuCooler: "Cooler Master 240mm",
    gpu: "NVIDIA RTX 5060 Ti",
    ram: "32GB 5200MHz",
    storage: "1TB SSD",
    motherboard: "B650",
    psu: "650W",
    accessories: ["6x ARGB fans"],
    description:
      "A modern, current-generation build balancing strong 1080p/1440p gaming performance with efficient power draw.",
    imageAlt:
      "M1 completed gaming PC build with an AMD Ryzen 5 7600X and NVIDIA RTX 5060 Ti, black case with purple ARGB fan lighting.",
    imageSrc: "/builds/ryzen-5-rtx-5060-ti.webp",
    imageScale: 1.02,
    imageTranslateX: -0.8,
    imageTranslateY: 2.7,
  },
  {
    slug: "ryzen-5-rtx-4060",
    name: "Ryzen 5 / RTX 4060 Build",
    cpu: "AMD Ryzen 5 8600G",
    cpuCooler: "Wraith Stealth cooler",
    gpu: "NVIDIA RTX 4060",
    ram: "32GB 5200MHz",
    storage: "512GB SSD",
    motherboard: "B650 ATX",
    psu: "650W",
    accessories: ["6x PWM ARGB fans"],
    description:
      "A well-rounded everyday gaming build with plenty of RAM headroom for multitasking alongside gaming.",
    imageAlt:
      "M1 completed gaming PC build with an AMD Ryzen 5 8600G and NVIDIA RTX 4060, black case with multicolor ARGB fan lighting.",
    imageSrc: "/builds/ryzen-5-rtx-4060.webp",
    imageScale: 1.14,
    imageTranslateX: 2.6,
    imageTranslateY: -2.0,
  },
  {
    slug: "ryzen-5-rtx-3060-white",
    name: "Ryzen 5 / RTX 3060 White Build",
    cpu: "AMD Ryzen 5 5600X",
    cpuCooler: "Wraith Stealth cooler",
    gpu: "NVIDIA RTX 3060",
    ram: "16GB 3600MHz",
    storage: "512GB SSD",
    motherboard: "B550M (no Wi-Fi)",
    psu: "650W",
    accessories: ["6x PWM ARGB fans", "Wi-Fi and Bluetooth USB adapter"],
    description:
      "A clean all-white themed build, finished with an added Wi-Fi/Bluetooth adapter for wireless connectivity.",
    imageAlt:
      "M1 completed gaming PC build with an AMD Ryzen 5 5600X and NVIDIA RTX 3060, all-white case with blue-purple ARGB fan lighting.",
    imageSrc: "/builds/ryzen-5-rtx-3060-white.webp",
    imageScale: 1.08,
    imageTranslateX: 4.2,
    imageTranslateY: 1.4,
  },
  {
    slug: "ryzen-5-rtx-5060-b550m",
    name: "Ryzen 5 / RTX 5060 Build",
    cpu: "AMD Ryzen 5 5600",
    cpuCooler: "AMD Wraith Stealth",
    gpu: "NVIDIA RTX 5060 8GB",
    ram: "16GB 3200MHz",
    storage: "1TB SSD",
    motherboard: "B550m-HDV",
    psu: "650W",
    accessories: [
      "3x RGB fans",
      "Wi-Fi and Bluetooth USB adapter",
      "Windows 11 Pro + Microsoft Office activation",
    ],
    description:
      "A ready-to-use build finished with a Wi-Fi/Bluetooth adapter and pre-activated Windows 11 Pro and Microsoft Office.",
    imageAlt:
      "M1 completed gaming PC build with an AMD Ryzen 5 5600 and NVIDIA RTX 5060, white case with purple ARGB lighting.",
    imageSrc: "/builds/ryzen-5-rtx-5060-b550m.webp",
    imageScale: 1.02,
    imageTranslateX: 2.0,
    imageTranslateY: 1.8,
  },
  {
    slug: "ryzen-5-rtx-5060-a520m",
    name: "Ryzen 5 / RTX 5060 A520M Build",
    cpu: "AMD Ryzen 5 5600",
    cpuCooler: "AMD Wraith Stealth",
    gpu: "NVIDIA RTX 5060 8GB",
    ram: "16GB 3200MHz",
    storage: "1TB SSD",
    motherboard: "A520m",
    psu: "650W",
    accessories: ["4x ARGB fans"],
    description: "A compact, budget-focused 1080p gaming build on an A520m motherboard.",
    imageAlt:
      "M1 completed gaming PC build with an AMD Ryzen 5 5600 and NVIDIA RTX 5060, white case with purple-rainbow ARGB lighting.",
    imageSrc: "/builds/ryzen-5-rtx-5060-a520m.webp",
    imageScale: 0.93,
    imageTranslateX: 1.4,
    imageTranslateY: -1.9,
  },
  {
    slug: "ryzen-7-rtx-3070",
    name: "Ryzen 7 / RTX 3070 Build",
    cpu: "AMD Ryzen 7 5800X",
    cpuCooler: "NZXT Kraken 240mm",
    gpu: "NVIDIA RTX 3070",
    ram: "32GB 3600MHz",
    storage: "1TB + 512GB M.2 SSD",
    motherboard: "B550 Aorus Pro AC",
    psu: "750W Fully Modular",
    accessories: ["Asia Horse sleeved white-black cables", "6x PWM ARGB fans"],
    description:
      "A high-performance 1440p-ready build with a fully modular PSU and a clean white-and-black cable theme.",
    imageAlt:
      "M1 completed gaming PC build with an AMD Ryzen 7 5800X and NVIDIA RTX 3070, white-and-black themed case with pink-purple ARGB lighting.",
    imageSrc: "/builds/ryzen-7-rtx-3070.webp",
    imageScale: 0.92,
    imageTranslateX: -5.3,
    imageTranslateY: 3.2,
  },
  {
    slug: "ryzen-5-5600gt-rtx-3060",
    name: "Ryzen 5 5600GT / RTX 3060 Build",
    cpu: "AMD Ryzen 5 5600GT",
    cpuCooler: "Wraith Stealth cooler",
    gpu: "NVIDIA RTX 3060",
    ram: "32GB 3600MHz",
    storage: "1TB M.2 SSD",
    motherboard: "B550m",
    psu: "650W",
    accessories: ["6x ARGB fans"],
    description:
      "A balanced 1080p/1440p gaming build with 32GB of RAM for smooth multitasking alongside gaming.",
    imageAlt:
      "M1 completed gaming PC build with an AMD Ryzen 5 5600GT and NVIDIA RTX 3060, white case with amber ARGB lighting.",
    imageSrc: "/builds/ryzen-5-5600gt-rtx-3060.webp",
    imageScale: 1.29,
    imageTranslateX: 1.8,
    imageTranslateY: 0.3,
  },
  {
    slug: "ryzen-7-rtx-2070",
    name: "Ryzen 7 / RTX 2070 Build",
    cpu: "AMD Ryzen 7 5700X",
    cpuCooler: "AMD Wraith Stealth",
    gpu: "NVIDIA RTX 2070 8GB",
    ram: "16GB 3200MHz",
    storage: "1TB SSD",
    motherboard: "B550",
    psu: "750W",
    accessories: ["6x ARGB fans", "Black and white sleeved cables"],
    description: "A strong 1440p gaming build finished with black-and-white sleeved cables.",
    imageAlt:
      "M1 completed gaming PC build with an AMD Ryzen 7 5700X and NVIDIA RTX 2070, white case, shown unlit.",
    imageSrc: "/builds/ryzen-7-rtx-2070.webp",
    imageScale: 1.24,
    imageTranslateX: -4.6,
    imageTranslateY: 8.3,
  },
  {
    slug: "ryzen-7-rtx-4060",
    name: "Ryzen 7 / RTX 4060 Build",
    cpu: "AMD Ryzen 7 5700",
    cpuCooler: "Wraith Stealth cooler",
    gpu: "NVIDIA RTX 4060",
    ram: "32GB 3600MHz",
    storage: "1TB SSD",
    motherboard: "B550m MSI",
    psu: "700W",
    accessories: ["6x PWM ARGB fans"],
    description:
      "A well-rounded 1080p/1440p gaming build with 32GB of RAM and a 700W power supply for headroom.",
    imageAlt:
      "M1 completed gaming PC build with an AMD Ryzen 7 5700 and NVIDIA RTX 4060, white case with blue ARGB lighting.",
    imageSrc: "/builds/ryzen-7-rtx-4060.webp",
    imageScale: 1.2,
    imageTranslateX: 0,
    imageTranslateY: -5.1,
  },
  {
    slug: "ryzen-5-rtx-2060-b550",
    name: "Ryzen 5 / RTX 2060 B550 Build",
    cpu: "AMD Ryzen 5 5600X",
    cpuCooler: "Wraith Stealth cooler",
    gpu: "NVIDIA RTX 2060",
    ram: "16GB 3600MHz",
    storage: "1TB M.2 SSD",
    motherboard: "B550 MSI",
    psu: "650W",
    accessories: ["Asia Horse sleeved white cables", "9x PWM ARGB fans"],
    description: "A 1080p gaming build with heavy RGB fan presence and matching white sleeved cables.",
    imageAlt:
      "M1 completed gaming PC build with an AMD Ryzen 5 5600X and NVIDIA RTX 2060, black case with rainbow ARGB fan lighting.",
    imageSrc: "/builds/ryzen-5-rtx-2060-b550.webp",
    imageScale: 1.29,
    imageTranslateX: 2.4,
    imageTranslateY: 2.1,
  },
  {
    slug: "ryzen-5-gtx-1660-ti",
    name: "Ryzen 5 / GTX 1660 Ti Build",
    cpu: "AMD Ryzen 5 3600",
    cpuCooler: "AMD Wraith Stealth",
    gpu: "NVIDIA GTX 1660 Ti 6GB",
    ram: "16GB 3200MHz",
    storage: "1TB SSD",
    motherboard: "B450",
    psu: "600W",
    accessories: ["9x ARGB fans", "Black and white sleeved cables"],
    description:
      "A value-focused 1080p gaming build with heavy RGB fan presence and matching sleeved cables.",
    imageAlt:
      "M1 completed gaming PC build with an AMD Ryzen 5 3600 and NVIDIA GTX 1660 Ti, black-and-white case with multicolor ARGB fan lighting.",
    imageSrc: "/builds/ryzen-5-gtx-1660-ti.webp",
    imageScale: 0.88,
    imageTranslateX: 0.8,
    imageTranslateY: 1.6,
  },
  {
    slug: "ryzen-5-rtx-2060-b450",
    name: "Ryzen 5 / RTX 2060 B450 Build",
    cpu: "AMD Ryzen 5 5600X",
    cpuCooler: "Wraith Stealth cooler",
    gpu: "NVIDIA RTX 2060",
    ram: "16GB 3600MHz",
    storage: "512GB SSD",
    motherboard: "B450m",
    psu: "600W",
    accessories: ["4x fans (non-ARGB)"],
    description: "A straightforward 1080p gaming build without RGB fan lighting.",
    imageAlt:
      "M1 completed gaming PC build with an AMD Ryzen 5 5600X and NVIDIA RTX 2060, dark case with blue front panel lighting.",
    imageSrc: "/builds/ryzen-5-rtx-2060-b450.png",
    imageScale: 2.3,
    imageTranslateX: 8,
    imageTranslateY: -3,
  },
];
