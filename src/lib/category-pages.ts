import type { CompletedBuild } from "@/types";

/**
 * Content for the component landing pages at /products/<slug>.
 *
 * Only the seven core PC-part categories get a page: they are the ones where a
 * buyer needs real compatibility guidance, and where M1's completed builds
 * give genuine, specific examples. Peripheral categories (monitors, mice, …)
 * stay on the /products hub rather than becoming thin pages.
 *
 * Accuracy rules: no prices, no stock claims, no brand partnerships. The
 * "used in completed builds" table is computed from src/lib/builds.ts, so it
 * can only ever show parts M1 has genuinely used.
 */

export interface Consideration {
  title: string;
  body: string;
}

export interface CategoryPage {
  /** Matches `slug` in src/lib/categories.ts. */
  slug: string;
  /** Short name used in links and breadcrumbs. */
  short: string;
  h1: string;
  title: string;
  description: string;
  intro: string[];
  considerationsHeading: string;
  considerations: Consideration[];
  /** Column heading + selector for the "used in completed builds" table. */
  usedLabel: string;
  pick: (build: CompletedBuild) => string;
  /** Other category-page slugs worth linking to. */
  related: string[];
  /** Guide slugs worth linking to. */
  guides: string[];
}

export const categoryPages: CategoryPage[] = [
  {
    slug: "gpus",
    short: "GPUs",
    h1: "Graphics Cards (GPUs) in Qatar",
    title: "Graphics Cards (GPUs) in Qatar",
    description:
      "Request current pricing and availability for NVIDIA GeForce and AMD Radeon graphics cards in Qatar from M1, with compatibility notes and the GPUs used in real completed builds.",
    intro: [
      "The graphics card does most of the heavy lifting in games, so it is usually the part that decides how smooth a gaming PC feels at a given resolution and quality setting — and it is often the largest single line in the budget.",
      "M1 sources NVIDIA GeForce and AMD Radeon graphics cards for custom builds and for standalone requests in Qatar. Prices and availability move quickly and many cards are sourced from the U.S. per order, so there is no fixed price list on this site: tell us what you play and which monitor you use, and we will quote current options.",
    ],
    considerationsHeading: "What to check before you choose a graphics card",
    considerations: [
      {
        title: "Match the card to your monitor",
        body: "Resolution (1080p, 1440p or 4K) and refresh rate decide how hard the GPU has to work. A card that suits a 1080p high-refresh screen is a different purchase from one aimed at a 4K display.",
      },
      {
        title: "Power supply wattage and connectors",
        body: "Every card lists a recommended PSU wattage and the power connectors it needs — typically 8-pin PCIe cables, or a 12VHPWR / 12V-2x6 connector on some newer high-end cards. When M1 configures a build, the power supply is chosen with the graphics card's requirements in mind.",
      },
      {
        title: "Physical fit in the case",
        body: "Cards differ a lot in length and thickness (many occupy 2.5 to 3 slots or more). Check the case's GPU clearance, and whether a front radiator or cable layout gets in the way.",
      },
      {
        title: "Video memory (VRAM)",
        body: "Cards in the same family can come with different amounts of VRAM, for example 8GB and 16GB versions. More VRAM can help at higher resolutions and texture settings.",
      },
      {
        title: "Keep the platform balanced",
        body: "A very fast graphics card paired with a much weaker processor or slow memory can leave performance on the table. A balanced configuration is part of what we help you decide.",
      },
    ],
    usedLabel: "Graphics card",
    pick: (b) => b.gpu,
    related: ["cpus", "power-supplies", "cooling"],
    guides: ["gaming-pc-compatibility-checklist", "how-to-order-a-custom-gaming-pc-in-qatar"],
  },
  {
    slug: "cpus",
    short: "CPUs",
    h1: "Processors (CPUs) in Qatar",
    title: "Processors (CPUs) in Qatar",
    description:
      "Request current pricing and availability for AMD Ryzen and Intel Core processors in Qatar from M1, with socket and platform guidance and the CPUs used in real completed builds.",
    intro: [
      "The processor affects frame rates in many games, how well a PC handles multitasking, streaming and creative work, and which motherboard and memory type you can use with it.",
      "M1 sources AMD Ryzen and Intel Core processors for custom builds and standalone requests in Qatar. Pricing and availability change often and some models are sourced per order, so we confirm both in your quotation rather than publishing a price list.",
    ],
    considerationsHeading: "What to check before you choose a processor",
    considerations: [
      {
        title: "Socket and chipset must match",
        body: "A CPU only fits motherboards with the same socket — for example Ryzen 5000-series on AM4, Ryzen 7000 and 9000-series on AM5, and Intel Core Ultra 200S-series on LGA1851. A newer CPU on an older board of the same socket may need a BIOS update first.",
      },
      {
        title: "The platform decides your memory type",
        body: "AM5 and LGA1851 platforms use DDR5, while AM4 uses DDR4. Choosing the CPU therefore also narrows the motherboard and RAM choices.",
      },
      {
        title: "Gaming focus versus multi-core work",
        body: "Processors with extra cache, such as AMD's X3D models, are designed with gaming in mind, while more cores help with rendering, encoding and heavy multitasking. Tell us how you split your time between gaming and other work.",
      },
      {
        title: "Cooler included or not",
        body: "Some processors ship with a stock cooler and many do not, so the cooler is planned as part of the build. See the cooling page for air and liquid options.",
      },
      {
        title: "Integrated graphics",
        body: "Some processors (for example AMD's G-series) include integrated graphics, which can be a useful fallback or a way to start a build without a discrete graphics card.",
      },
    ],
    usedLabel: "Processor",
    pick: (b) => b.cpu,
    related: ["motherboards", "ram", "cooling"],
    guides: ["gaming-pc-compatibility-checklist", "how-to-order-a-custom-gaming-pc-in-qatar"],
  },
  {
    slug: "motherboards",
    short: "Motherboards",
    h1: "Motherboards in Qatar",
    title: "Motherboards in Qatar",
    description:
      "Request current pricing and availability for AMD and Intel motherboards in Qatar from M1, with chipset, form factor and memory guidance and the boards used in real completed builds.",
    intro: [
      "The motherboard decides which processor, memory and storage you can use, how many drives and USB devices you can connect, and which case it fits. It is the part everything else plugs into, so it is chosen first when we configure a build.",
      "M1 sources motherboards matched to the platform you choose, for custom builds and standalone requests in Qatar. As with every component, we confirm current pricing and availability in your quotation.",
    ],
    considerationsHeading: "What to check before you choose a motherboard",
    considerations: [
      {
        title: "Socket and chipset",
        body: "The board's socket must match the CPU (AM4, AM5, LGA1851 and so on). Chipsets within a socket differ in features such as USB ports, PCIe lanes and overclocking support.",
      },
      {
        title: "Form factor",
        body: "ATX, Micro-ATX and Mini-ITX boards need cases that support them. Several of M1's completed builds use Micro-ATX boards (the \"M\" in names like B550M or B850M) to suit compact cases.",
      },
      {
        title: "Memory type and slots",
        body: "Boards support either DDR4 or DDR5 (on some Intel sockets, depending on the specific board). Slot count and the maximum supported memory speed also vary.",
      },
      {
        title: "M.2 slots and PCIe generation",
        body: "Check how many M.2 slots the board has and which PCIe generation they run, especially if you plan more than one NVMe drive.",
      },
      {
        title: "Wi-Fi and Bluetooth",
        body: "Some boards include Wi-Fi and Bluetooth and others do not. A few past M1 builds used boards without it and added a USB Wi-Fi and Bluetooth adapter instead.",
      },
    ],
    usedLabel: "Motherboard",
    pick: (b) => b.motherboard,
    related: ["cpus", "ram", "ssd-storage"],
    guides: ["gaming-pc-compatibility-checklist"],
  },
  {
    slug: "ram",
    short: "RAM",
    h1: "RAM (Memory) in Qatar",
    title: "RAM (Memory) in Qatar",
    description:
      "Request current pricing and availability for DDR4 and DDR5 memory kits in Qatar from M1, with capacity and compatibility guidance and the RAM used in real completed builds.",
    intro: [
      "Memory affects how smoothly a PC multitasks and how much headroom it has for large games, streaming and creative work. The right kit depends on your platform, so it is matched to the CPU and motherboard rather than chosen on its own.",
      "M1 sources DDR4 and DDR5 memory kits for custom builds and standalone requests in Qatar, with current pricing and availability confirmed in your quotation.",
    ],
    considerationsHeading: "What to check before you choose RAM",
    considerations: [
      {
        title: "DDR4 and DDR5 are not interchangeable",
        body: "A motherboard supports one type or the other (depending on the specific board on some Intel sockets). The module physically will not fit the wrong slot.",
      },
      {
        title: "Capacity",
        body: "16GB is a common starting point for gaming PCs, and 32GB gives more headroom for multitasking, streaming and heavier workloads. M1's completed builds range from 16GB to 32GB.",
      },
      {
        title: "Speed and memory profiles",
        body: "A kit's rated speed (for example DDR5-6000) normally requires switching on an XMP (Intel) or EXPO (AMD) profile in the BIOS, and the CPU and board determine which speeds run reliably.",
      },
      {
        title: "Two modules usually beat one",
        body: "Running two matched modules enables dual-channel mode, which generally gives better memory performance than a single module of the same total size.",
      },
      {
        title: "Clearance under the cooler",
        body: "Tall memory heatsinks can collide with large air coolers. This is checked when the cooler and RAM are chosen together.",
      },
    ],
    usedLabel: "Memory",
    pick: (b) => b.ram,
    related: ["motherboards", "cpus", "ssd-storage"],
    guides: ["gaming-pc-compatibility-checklist"],
  },
  {
    slug: "ssd-storage",
    short: "SSD / Storage",
    h1: "SSDs & Storage in Qatar",
    title: "SSDs & Storage in Qatar",
    description:
      "Request current pricing and availability for NVMe SSDs and storage drives in Qatar from M1, with capacity and compatibility guidance and the drives used in real completed builds.",
    intro: [
      "Storage determines how quickly Windows and your games load and how many games you can keep installed. An NVMe SSD is the usual choice for the main drive in a modern gaming PC, with extra capacity added as needed.",
      "M1 sources NVMe SSDs and additional storage for custom builds and standalone requests in Qatar, with current pricing and availability confirmed in your quotation.",
    ],
    considerationsHeading: "What to check before you choose storage",
    considerations: [
      {
        title: "NVMe (M.2) or SATA",
        body: "NVMe drives plug directly into an M.2 slot and are much faster than SATA drives. SATA SSDs still make sense as an inexpensive secondary drive when the board has spare SATA ports.",
      },
      {
        title: "M.2 slots and PCIe generation",
        body: "The motherboard and CPU decide how many M.2 slots you have and which PCIe generation they run at. A faster drive on a slower slot simply runs at the slot's speed.",
      },
      {
        title: "Capacity",
        body: "Modern games can be very large, so many buyers choose 1TB or more. M1's completed builds range from 512GB to 2TB of main storage, and some add a second drive.",
      },
      {
        title: "Heat",
        body: "Fast NVMe drives can get warm under sustained load. Many boards include M.2 heatsinks, and good case airflow helps.",
      },
    ],
    usedLabel: "Storage",
    pick: (b) => b.storage,
    related: ["motherboards", "ram", "cpus"],
    guides: ["gaming-pc-compatibility-checklist"],
  },
  {
    slug: "cooling",
    short: "Cooling",
    h1: "PC Cooling in Qatar: Air Coolers & Liquid Coolers",
    title: "PC Cooling in Qatar: Air & Liquid Coolers",
    description:
      "Request current pricing and availability for CPU air coolers and liquid (AIO) coolers in Qatar from M1, with fit and airflow guidance and the coolers used in real completed builds.",
    intro: [
      "The cooler keeps the processor within a safe temperature so it can sustain its performance. Air coolers and all-in-one (AIO) liquid coolers can both do this well; the right choice depends on the processor, the case and how the PC should look and sound.",
      "M1 sources air and liquid coolers for custom builds and standalone requests in Qatar, with current pricing and availability confirmed in your quotation.",
    ],
    considerationsHeading: "What to check before you choose a cooler",
    considerations: [
      {
        title: "Air or liquid",
        body: "Air coolers are simple and have no pump; AIO coolers move heat to a radiator that mounts in the case (commonly 240mm, 280mm or 360mm) and often look cleaner around the socket. Some AIO pump heads include an LCD screen, as in a few M1 builds.",
      },
      {
        title: "Case and radiator support",
        body: "The case must have room and mounting points for the radiator size you want, and enough height for a tall air cooler. Memory heatsink clearance matters too.",
      },
      {
        title: "Socket compatibility",
        body: "The cooler must include or support the mounting hardware for your CPU socket (AM4, AM5, LGA1851 and so on).",
      },
      {
        title: "Airflow and the climate",
        body: "Ambient temperatures in Qatar are high for much of the year, so airflow and cooling headroom are worth planning early. Our guide to cooling a gaming PC in Qatar covers intake and exhaust fans, filters and cooler choice in more detail.",
      },
    ],
    usedLabel: "CPU cooler",
    pick: (b) => b.cpuCooler,
    related: ["cpus", "power-supplies", "gpus"],
    guides: ["gaming-pc-cooling-in-qatar", "gaming-pc-compatibility-checklist"],
  },
  {
    slug: "power-supplies",
    short: "Power Supplies",
    h1: "PC Power Supplies (PSUs) in Qatar",
    title: "PC Power Supplies (PSUs) in Qatar",
    description:
      "Request current pricing and availability for gaming PC power supplies in Qatar from M1, with wattage, connector and efficiency guidance and the PSUs used in real completed builds.",
    intro: [
      "The power supply feeds every other part in the PC, so it needs enough capacity for the graphics card and processor, the right cables, and good build quality. It is not the place to cut corners.",
      "M1 sources power supplies sized for your build, for custom builds and standalone requests in Qatar, with current pricing and availability confirmed in your quotation.",
    ],
    considerationsHeading: "What to check before you choose a power supply",
    considerations: [
      {
        title: "Wattage with headroom",
        body: "Add up the graphics card's and processor's requirements and leave headroom for the rest of the system and for future upgrades. The graphics card's recommended PSU wattage is the best starting point.",
      },
      {
        title: "Connectors",
        body: "Make sure the PSU has the cables the parts need: 8-pin PCIe for many graphics cards, a 12VHPWR / 12V-2x6 cable for some newer high-end cards, and the CPU power connectors the motherboard requires.",
      },
      {
        title: "Efficiency rating",
        body: "80 PLUS ratings (Bronze, Gold and so on) describe efficiency at typical loads. Several M1 builds use 80+ Gold units.",
      },
      {
        title: "Modular cables and size",
        body: "Modular or semi-modular PSUs let you connect only the cables you need, which helps cable management. Small cases may need an SFX unit instead of a standard ATX one.",
      },
    ],
    usedLabel: "Power supply",
    pick: (b) => b.psu,
    related: ["gpus", "cpus", "cooling"],
    guides: ["gaming-pc-compatibility-checklist"],
  },
];

export function getCategoryPage(slug: string): CategoryPage | undefined {
  return categoryPages.find((c) => c.slug === slug);
}

/** True when a category has its own landing page. */
export function hasCategoryPage(slug: string): boolean {
  return categoryPages.some((c) => c.slug === slug);
}
