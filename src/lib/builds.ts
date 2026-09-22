import type { CompletedBuild } from "@/types";

/**
 * Real initial completed builds, as supplied by the business owner, now
 * paired with real photos of each build (see /public/builds/). Each
 * `imageSrc` points at the corresponding image supplied by the business
 * owner — do not add builds beyond these five or invent pricing.
 */
export const completedBuilds: CompletedBuild[] = [
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
    imageSrc: "/builds/ryzen-7-rtx-3070.png",
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
    imageSrc: "/builds/ryzen-5-rtx-5060-ti.png",
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
    imageSrc: "/builds/ryzen-5-rtx-4060.png",
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
    imageSrc: "/builds/ryzen-5-rtx-3060-white.png",
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
    imageSrc: "/builds/ryzen-5-gtx-1660-ti.png",
  },
];
