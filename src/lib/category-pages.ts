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

export interface QuoteTip {
  /** The question the M1 quote form asks (taken from src/lib/quote-schema.ts). */
  label: string;
  /** Why the answer matters for this kind of part. */
  why: string;
}

export interface CategoryPage {
  /** Matches `slug` in src/lib/categories.ts. */
  slug: string;
  /** Short name used in links and breadcrumbs. */
  short: string;
  /** Anchor text used when other pages link here, e.g. "Choosing a graphics card". */
  guideLabel: string;
  h1: string;
  title: string;
  description: string;
  intro: string[];
  considerationsHeading: string;
  considerations: Consideration[];
  /** What to tell M1 when requesting this category — mirrors the real quote-form fields. */
  quoteTips: QuoteTip[];
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
    guideLabel: "Choosing a graphics card",
    h1: "Graphics Cards (GPUs) in Qatar",
    title: "Graphics Cards (GPUs) in Qatar",
    description:
      "Request current pricing and availability for NVIDIA GeForce and AMD Radeon graphics cards in Qatar from M1, with compatibility notes and the GPUs used in real completed builds.",
    intro: [
      "A graphics card is chosen from the screen outwards: your monitor's resolution and refresh rate, and the games you play, narrow the field far more than a model name does. Cards of the same family can also differ in memory, cooling and length, so two quotes for \"the same GPU\" are not always the same product.",
      "M1's completed builds pair graphics cards from the GTX 1660 Ti up to the RTX 5080 with processors and cases of very different sizes. Many cards are sourced from the U.S. once an order is confirmed, which is why there is no price list here; the quote form asks for your case model and power supply wattage so the recommendation can account for fit and connectors.",
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
    quoteTips: [
      { label: "Target resolution and FPS", why: "A 1080p high-refresh monitor and a 4K display call for very different cards, so this is the first thing that narrows the choice." },
      { label: "Main games / applications", why: "Demanding or memory-hungry titles, or work that uses the GPU, change how much video memory and performance is worth paying for." },
      { label: "Preferred GPU brand", why: "NVIDIA, AMD or no preference. Leaving it open lets M1 compare both families for your budget." },
      { label: "Current power supply wattage and case model", why: "They decide whether a card's power connectors and physical size will work, or whether a new PSU or case belongs in the quotation." },
      { label: "Current CPU", why: "Keeps the graphics card and processor in a sensible balance." },
    ],
    usedLabel: "Graphics card",
    pick: (b) => b.gpu,
    related: ["cpus", "power-supplies", "cooling"],
    guides: ["gaming-pc-compatibility-checklist", "how-to-order-a-custom-gaming-pc-in-qatar"],
  },
  {
    slug: "cpus",
    short: "CPUs",
    guideLabel: "Choosing a processor",
    h1: "Processors (CPUs) in Qatar",
    title: "Processors (CPUs) in Qatar",
    description:
      "Request current pricing and availability for AMD Ryzen and Intel Core processors in Qatar from M1, with socket and platform guidance and the CPUs used in real completed builds.",
    intro: [
      "Choosing a processor is really choosing a platform: the CPU decides the socket, the socket decides which motherboards fit, and the platform decides whether you buy DDR4 or DDR5 memory. Gaming speed, multitasking and creative work then depend on which model sits on that platform.",
      "M1's completed builds include Ryzen processors on both AM4 and AM5 and an Intel Core Ultra build on LGA1851, from Ryzen 5 builds with AMD's stock Wraith Stealth cooler to X3D processors with a 360mm liquid cooler. The quote form asks whether you also need a new motherboard and a cooler, so the whole platform is quoted together when it should be.",
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
    quoteTips: [
      { label: "Preferred brand", why: "AMD, Intel or no preference. It sets the socket family, and therefore the motherboards and memory type that come with it." },
      { label: "Main use", why: "Gaming, productivity, editing, streaming or mixed use. A gaming-first build and a rendering-first build weigh clock speed, cache and core count differently." },
      { label: "Current motherboard model and RAM type", why: "If you are upgrading, they show whether the new CPU fits the socket and whether it works with your DDR4 or DDR5." },
      { label: "Do you need a new motherboard? A CPU cooler?", why: "Answering yes adds them to the quotation. If you already own them, give the model so the new processor can be matched to it." },
    ],
    usedLabel: "Processor",
    pick: (b) => b.cpu,
    related: ["motherboards", "ram", "cooling"],
    guides: ["gaming-pc-compatibility-checklist", "how-to-order-a-custom-gaming-pc-in-qatar"],
  },
  {
    slug: "motherboards",
    short: "Motherboards",
    guideLabel: "Choosing a motherboard",
    h1: "Motherboards in Qatar",
    title: "Motherboards in Qatar",
    description:
      "Request current pricing and availability for AMD and Intel motherboards in Qatar from M1, with chipset, form factor and memory guidance and the boards used in real completed builds.",
    intro: [
      "The motherboard is the part everything else has to agree with: socket, memory type, size, storage slots and connectivity all come from the board. It is normally chosen at the same time as the CPU rather than afterwards.",
      "M1's completed builds include boards from entry-level A520M and B450M models up to B850 and B860 boards, in Micro-ATX and larger sizes. The quote form asks which socket or platform you are building on, which RAM generation you want, the board size and whether you need Wi-Fi and Bluetooth.",
    ],
    considerationsHeading: "What to check before you choose a motherboard",
    considerations: [
      {
        title: "Socket and chipset",
        body: "The board's socket must match the CPU (AM4, AM5, LGA1851 and so on). Chipsets within a socket differ in features such as USB ports, PCIe lanes and overclocking support.",
      },
      {
        title: "Form factor",
        body: "ATX, Micro-ATX and Mini-ITX boards need cases that support them. Many of M1's completed builds use Micro-ATX boards, shown by the \"M\" in names like B550M or B850M, which fit smaller cases.",
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
        body: "Some boards include Wi-Fi and Bluetooth and others do not. Two of M1's completed builds list a USB Wi-Fi and Bluetooth adapter instead of built-in wireless on their B550M boards.",
      },
    ],
    quoteTips: [
      { label: "CPU socket / platform", why: "AM4, AM5, Intel LGA1700 or a newer Intel platform. The board has to match the processor's socket exactly." },
      { label: "RAM generation", why: "DDR4 or DDR5. The board accepts one type, and it follows from the platform." },
      { label: "Motherboard size", why: "ATX, Micro-ATX or Mini-ITX must be supported by your case, and it also changes how many slots and ports you get." },
      { label: "Wi-Fi and Bluetooth", why: "Decides between a board with built-in wireless and one that needs a USB adapter or add-in card." },
      { label: "Preferred chipset and important features", why: "Lets M1 aim for the ports, M.2 slots and other features you actually care about." },
    ],
    usedLabel: "Motherboard",
    pick: (b) => b.motherboard,
    related: ["cpus", "ram", "ssd-storage"],
    guides: ["gaming-pc-compatibility-checklist"],
  },
  {
    slug: "ram",
    short: "RAM",
    guideLabel: "Choosing RAM",
    h1: "RAM (Memory) in Qatar",
    title: "RAM (Memory) in Qatar",
    description:
      "Request current pricing and availability for DDR4 and DDR5 memory kits in Qatar from M1, with capacity and compatibility guidance and the RAM used in real completed builds.",
    intro: [
      "Memory is the easiest part to order wrongly, because DDR4 and DDR5 are physically incompatible and your platform decides which one you need. Capacity, speed and the number of modules then shape how the kit behaves.",
      "M1's completed builds include 16GB and 32GB DDR4 kits at 3200 to 3600MHz on AM4, 16GB and 32GB DDR5 kits at 5200 to 6000MHz on AM5, and a 32GB kit at 7600MHz on an Intel LGA1851 board. The quote form's one required question is DDR4 or DDR5 (or not sure); capacity, one or two modules, speed and RGB preference follow.",
    ],
    considerationsHeading: "What to check before you choose RAM",
    considerations: [
      {
        title: "DDR4 and DDR5 are not interchangeable",
        body: "A motherboard supports one type or the other (depending on the specific board on some Intel sockets). The module physically will not fit the wrong slot.",
      },
      {
        title: "Capacity",
        body: "16GB is a common starting point for gaming PCs, and 32GB gives more headroom for multitasking, streaming and heavier workloads. The quote form offers 16GB up to 128GB.",
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
        body: "Tall memory heatsinks can collide with large air coolers, so it is worth checking when the cooler and RAM are chosen together.",
      },
    ],
    quoteTips: [
      { label: "RAM type", why: "DDR4 or DDR5 (or not sure). This is the one required answer, because the wrong type will not fit the board." },
      { label: "Capacity", why: "From 16GB up to 128GB. More headroom helps multitasking, streaming and heavy projects but costs more." },
      { label: "Preferred configuration", why: "Two modules or four. Two matched modules are the usual choice for dual-channel operation." },
      { label: "Preferred speed", why: "The kit's rated speed usually needs an XMP or EXPO profile enabled, and your CPU and board limit what runs reliably." },
      { label: "Current motherboard and CPU", why: "So the kit can be matched to the platform's supported memory, and to cooler clearance if you are upgrading." },
    ],
    usedLabel: "Memory",
    pick: (b) => b.ram,
    related: ["motherboards", "cpus", "ssd-storage"],
    guides: ["gaming-pc-compatibility-checklist"],
  },
  {
    slug: "ssd-storage",
    short: "SSD / Storage",
    guideLabel: "Choosing an SSD",
    h1: "SSDs & Storage in Qatar",
    title: "SSDs & Storage in Qatar",
    description:
      "Request current pricing and availability for NVMe SSDs and storage drives in Qatar from M1, with capacity and compatibility guidance and the drives used in real completed builds.",
    intro: [
      "Storage decisions come down to type and capacity: an NVMe M.2 drive plugs straight into the motherboard and is the usual main drive, while SATA SSDs and hard drives suit extra space.",
      "M1's completed builds include main drives from 512GB to 2TB, one build with a 1TB and a 512GB M.2 pair, and a 1TB drive rated at 7400MB/s. The quote form asks for storage type (NVMe, SATA SSD or HDD), a capacity from 500GB to 8TB or more, and a performance tier from best value to maximum performance.",
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
        body: "Modern games can be very large, so many buyers choose 1TB or more. In M1's completed builds, one adds a second M.2 drive alongside its main one.",
      },
      {
        title: "Heat",
        body: "Fast NVMe drives can get warm under sustained load. Many boards include M.2 heatsinks, and good case airflow helps.",
      },
    ],
    quoteTips: [
      { label: "Storage type", why: "NVMe M.2 SSD, SATA SSD, HDD or not sure. It decides which connector the drive uses and how fast it can be." },
      { label: "Capacity", why: "From 500GB to 8TB or more. Think about your game library and whether this is a main drive or extra space." },
      { label: "Preferred performance", why: "Best value, high performance or maximum performance. The fastest drives only help if the board's M.2 slot can use them." },
      { label: "Device / motherboard model", why: "Shows how many M.2 slots and SATA ports are free, and the PCIe generation of the slot." },
    ],
    usedLabel: "Storage",
    pick: (b) => b.storage,
    related: ["motherboards", "ram", "cpus"],
    guides: ["gaming-pc-compatibility-checklist"],
  },
  {
    slug: "cooling",
    short: "Cooling",
    guideLabel: "Choosing a CPU cooler",
    h1: "PC Cooling in Qatar: Air Coolers & Liquid Coolers",
    title: "PC Cooling in Qatar: Air & Liquid Coolers",
    description:
      "Request current pricing and availability for CPU air coolers and liquid (AIO) coolers in Qatar from M1, with fit and airflow guidance and the coolers used in real completed builds.",
    intro: [
      "A CPU cooler has to satisfy four things at once: the processor's heat output, the socket's mounting hardware, the case's clearance and, increasingly, the look of the build. Air coolers and all-in-one (AIO) liquid coolers can both do the job.",
      "M1's completed builds include AMD's Wraith Stealth cooler, tower air coolers, 240mm liquid coolers and a 360mm liquid cooler with an LCD pump head. The quote form asks for air or AIO, your CPU and socket, a radiator size from 120mm to 420mm, your case model, and colour and RGB preferences.",
    ],
    considerationsHeading: "What to check before you choose a cooler",
    considerations: [
      {
        title: "Air or liquid",
        body: "Air coolers are simple and have no pump; AIO coolers move heat to a radiator that mounts in the case (commonly 240mm, 280mm or 360mm) and often look cleaner around the socket. Some AIO pump heads include an LCD screen: M1's Ryzen 7 9850X3D / RTX 5080 build uses a Lian Li HydroShift II LCD 360mm, and another build adds a separate Thermalright LCD sub-display to the case.",
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
    quoteTips: [
      { label: "Cooling type", why: "Air cooler, AIO liquid cooler or no preference. This is the one required answer." },
      { label: "CPU model and socket", why: "The cooler must support your socket, and the CPU's heat output sets how much cooling it needs." },
      { label: "Radiator size", why: "120mm to 420mm for AIO coolers, or best compatible option. Bigger radiators cool more but need a case that supports them." },
      { label: "Case model", why: "Determines the maximum air-cooler height and which radiator sizes and positions fit." },
      { label: "RGB and colour", why: "Black or white and lit or unlit, so the cooler matches the rest of the build." },
    ],
    usedLabel: "CPU cooler",
    pick: (b) => b.cpuCooler,
    related: ["cpus", "power-supplies", "gpus"],
    guides: ["gaming-pc-cooling-in-qatar", "gaming-pc-compatibility-checklist"],
  },
  {
    slug: "power-supplies",
    short: "Power Supplies",
    guideLabel: "Choosing a power supply",
    h1: "PC Power Supplies (PSUs) in Qatar",
    title: "PC Power Supplies (PSUs) in Qatar",
    description:
      "Request current pricing and availability for gaming PC power supplies in Qatar from M1, with wattage, connector and efficiency guidance and the PSUs used in real completed builds.",
    intro: [
      "A power supply is chosen from the graphics card and processor outwards: enough wattage with headroom, the connectors those parts need, a physical size your case accepts, and cables you can route tidily.",
      "M1's completed builds include 600W to 850W units, some listed as 80+ Gold and one fully modular 750W model. The quote form asks for the wattage you need (550W up to 1200W or more), your CPU and GPU, ATX or SFX format, modularity, and whether you need modern GPU power support (ATX 3.x / 12V-2x6).",
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
        body: "80 PLUS ratings (Bronze, Gold and so on) describe efficiency at typical loads. Some of M1's completed builds list 80+ Gold units.",
      },
      {
        title: "Modular cables and size",
        body: "Modular or semi-modular PSUs let you connect only the cables you need, which helps cable management. Small cases may need an SFX unit instead of a standard ATX one.",
      },
    ],
    quoteTips: [
      { label: "Required wattage", why: "550W up to 1200W or more, or not sure. This is the one required answer; the graphics card's recommended PSU is the usual starting point." },
      { label: "Current CPU and GPU", why: "Together they set the load the supply has to carry, with headroom." },
      { label: "PSU format", why: "ATX or SFX. Small cases may only take SFX." },
      { label: "Modularity", why: "Fully modular, semi-modular or no preference. More modular units are easier to keep tidy." },
      { label: "Modern GPU power support", why: "ATX 3.x / 12V-2x6 for newer high-end cards that use that connector, or an 8-pin PCIe supply for cards that do not." },
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
