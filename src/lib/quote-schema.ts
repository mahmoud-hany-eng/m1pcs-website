import type { QuoteAnswers, QuoteCategory, QuoteFieldConfig } from "@/types/quote";
import { QUOTE_CATEGORIES } from "@/types/quote";

/**
 * Config-driven question sets for every quote category. Adding or changing
 * a category's questions means editing the arrays below — never the form
 * component itself, which renders whatever schema the selected category
 * points to via <DynamicField>.
 */
export const categoryFieldSchemas: Record<QuoteCategory, QuoteFieldConfig[]> = {
  "Complete Custom PC": [
    {
      id: "primaryUse",
      label: "Primary use",
      type: "select",
      required: true,
      options: [
        "Gaming",
        "Gaming + Streaming",
        "Work",
        "Video Editing / Content Creation",
        "Productivity",
        "Mixed Use",
      ],
    },
    { id: "gamesSoftware", label: "Games / software used", waLabel: "Games/software", type: "text" },
    {
      id: "targetResolution",
      label: "Target resolution",
      waLabel: "Resolution",
      type: "select",
      options: ["1080p", "1440p", "4K", "Not sure"],
    },
    {
      id: "targetFps",
      label: "Target FPS",
      type: "select",
      options: [
        "60 FPS",
        "120+ FPS",
        "144+ FPS",
        "240+ FPS",
        "Maximum performance within budget",
        "Not sure",
      ],
    },
    { id: "cpuPreference", label: "CPU preference", type: "select", options: ["AMD", "Intel", "No preference"] },
    { id: "gpuPreference", label: "GPU preference", type: "select", options: ["NVIDIA", "AMD", "No preference"] },
    {
      id: "ramCapacity",
      label: "RAM capacity",
      type: "select",
      options: ["16GB", "32GB", "64GB", "More", "Not sure"],
    },
    {
      id: "storageRequirement",
      label: "Storage requirement",
      waLabel: "Storage",
      type: "select",
      options: ["1TB", "2TB", "4TB+", "Not sure"],
    },
    {
      id: "buildColour",
      label: "Build colour",
      waLabel: "Colour",
      type: "select",
      options: ["Black", "White", "Other", "No preference"],
    },
    { id: "rgb", label: "RGB", type: "select", options: ["Yes", "No", "Minimal", "No preference"] },
    {
      id: "wifiRequired",
      label: "Wi-Fi / Bluetooth required",
      waLabel: "Wi-Fi/Bluetooth",
      type: "select",
      options: ["Yes", "No", "Not sure"],
    },
    { id: "needMonitor", label: "Need a monitor?", waLabel: "Monitor needed", type: "select", options: ["Yes", "No"] },
    {
      id: "needAccessories",
      label: "Need accessories?",
      waLabel: "Accessories needed",
      type: "multiselect",
      options: ["Keyboard", "Mouse", "Headset", "Mouse Pad", "None"],
      exclusiveOption: "None",
    },
  ],

  "Graphics Card (GPU)": [
    {
      id: "gpuBrand",
      label: "Preferred GPU brand",
      waLabel: "Brand",
      type: "select",
      required: true,
      options: ["NVIDIA", "AMD", "No preference"],
    },
    {
      id: "targetResolution",
      label: "Target resolution",
      waLabel: "Resolution",
      type: "select",
      options: ["1080p", "1440p", "4K", "Not sure"],
    },
    { id: "mainGames", label: "Main games / applications", waLabel: "Games", type: "text" },
    {
      id: "targetFps",
      label: "Target FPS / performance",
      waLabel: "Target FPS",
      type: "select",
      options: ["60 FPS", "120+", "144+", "240+", "Best possible within budget", "Not sure"],
    },
    { id: "currentCpu", label: "Current CPU", type: "text" },
    {
      id: "currentPsuWattage",
      label: "Current power supply wattage",
      waLabel: "PSU",
      type: "text",
      placeholder: "e.g. 750W or Not sure",
    },
    {
      id: "currentCase",
      label: "Current case model",
      waLabel: "Case",
      type: "text",
      placeholder: "e.g. NZXT H5 Flow or Not sure",
    },
  ],

  "Processor (CPU)": [
    {
      id: "preferredBrand",
      label: "Preferred brand",
      waLabel: "Brand",
      type: "select",
      required: true,
      options: ["AMD", "Intel", "No preference"],
    },
    {
      id: "mainUse",
      label: "Main use",
      type: "select",
      options: ["Gaming", "Productivity", "Editing", "Streaming", "Mixed use"],
    },
    { id: "currentMotherboard", label: "Current motherboard model", waLabel: "Current motherboard", type: "text" },
    {
      id: "currentRamType",
      label: "Current RAM type",
      waLabel: "RAM type",
      type: "select",
      options: ["DDR4", "DDR5", "Not sure"],
    },
    {
      id: "needNewMotherboard",
      label: "Do you need a new motherboard as well?",
      waLabel: "New motherboard needed",
      type: "select",
      options: ["Yes", "No", "Not sure"],
    },
    {
      id: "needCooler",
      label: "Do you need a CPU cooler?",
      waLabel: "Cooler needed",
      type: "select",
      options: ["Yes", "No", "Not sure"],
    },
  ],

  Motherboard: [
    { id: "cpuUsed", label: "CPU / processor you will use", waLabel: "CPU", type: "text" },
    {
      id: "cpuSocket",
      label: "CPU socket / platform",
      waLabel: "Socket",
      type: "select",
      required: true,
      options: ["AM4", "AM5", "Intel LGA1700", "Intel newer platform", "Not sure"],
    },
    { id: "ramGeneration", label: "RAM generation", type: "select", options: ["DDR4", "DDR5", "Not sure"] },
    {
      id: "boardSize",
      label: "Motherboard size",
      waLabel: "Size",
      type: "select",
      options: ["ATX", "Micro-ATX", "Mini-ITX", "No preference"],
    },
    { id: "wifiRequired", label: "Wi-Fi required", waLabel: "Wi-Fi", type: "select", options: ["Yes", "No", "No preference"] },
    {
      id: "bluetoothRequired",
      label: "Bluetooth required",
      waLabel: "Bluetooth",
      type: "select",
      options: ["Yes", "No", "No preference"],
    },
    {
      id: "preferredChipset",
      label: "Preferred chipset",
      waLabel: "Chipset",
      type: "text",
      placeholder: "Free text or Not sure",
    },
    {
      id: "importantFeatures",
      label: "Important features",
      waLabel: "Features",
      type: "multiselect",
      options: [
        "Extra M.2 slots",
        "Extra USB ports",
        "USB-C",
        "PCIe 5 support",
        "Strong VRM",
        "RGB",
        "No specific requirement",
      ],
      exclusiveOption: "No specific requirement",
    },
  ],

  "RAM / Memory": [
    { id: "ramType", label: "RAM type", waLabel: "Type", type: "select", required: true, options: ["DDR4", "DDR5", "Not sure"] },
    { id: "capacity", label: "Capacity", type: "select", options: ["16GB", "32GB", "64GB", "128GB", "Other"] },
    {
      id: "configuration",
      label: "Preferred configuration",
      waLabel: "Configuration",
      type: "select",
      options: ["2 sticks", "4 sticks", "No preference"],
    },
    {
      id: "preferredSpeed",
      label: "Preferred speed",
      waLabel: "Speed",
      type: "text",
      placeholder: "e.g. 6000MHz or Best compatible option",
    },
    { id: "rgb", label: "RGB", type: "select", options: ["Yes", "No", "No preference"] },
    { id: "currentMotherboard", label: "Current motherboard", type: "text", placeholder: "Free text or Not sure" },
    { id: "currentCpu", label: "Current CPU", type: "text", placeholder: "Free text or Not sure" },
  ],

  "SSD / Storage": [
    {
      id: "storageType",
      label: "Storage type",
      waLabel: "Type",
      type: "select",
      required: true,
      options: ["NVMe M.2 SSD", "SATA SSD", "HDD", "Not sure"],
    },
    { id: "capacity", label: "Capacity", type: "select", options: ["500GB", "1TB", "2TB", "4TB", "8TB+"] },
    {
      id: "preferredPerformance",
      label: "Preferred performance",
      waLabel: "Performance",
      type: "select",
      options: ["Best value", "High performance", "Maximum performance", "No preference"],
    },
    {
      id: "deviceModel",
      label: "Device / motherboard model",
      waLabel: "Device/motherboard",
      type: "text",
      placeholder: "Free text or Not sure",
    },
  ],

  "Power Supply": [
    {
      id: "requiredWattage",
      label: "Required wattage",
      waLabel: "Wattage",
      type: "select",
      required: true,
      options: ["550W", "650W", "750W", "850W", "1000W", "1200W+", "Not sure"],
    },
    { id: "currentCpu", label: "Current CPU", type: "text" },
    { id: "currentGpu", label: "Current GPU", type: "text" },
    { id: "psuFormat", label: "PSU format", waLabel: "Format", type: "select", options: ["ATX", "SFX", "Not sure"] },
    {
      id: "modularity",
      label: "Modularity",
      type: "select",
      options: ["Fully modular", "Semi-modular", "No preference"],
    },
    {
      id: "modernGpuSupport",
      label: "Need modern GPU power support",
      waLabel: "Modern GPU power support",
      type: "select",
      options: ["Yes / ATX 3.x / 12V-2x6", "No", "Not sure"],
    },
  ],

  "CPU Cooling": [
    {
      id: "coolingType",
      label: "Cooling type",
      waLabel: "Type",
      type: "select",
      required: true,
      options: ["Air cooler", "AIO liquid cooler", "No preference"],
    },
    { id: "cpuModel", label: "CPU model", type: "text" },
    { id: "cpuSocket", label: "CPU socket", type: "text", placeholder: "Free text or Not sure" },
    {
      id: "radiatorSize",
      label: "Radiator size",
      type: "select",
      options: ["120mm", "240mm", "280mm", "360mm", "420mm", "Best compatible option"],
      showIf: (answers: QuoteAnswers) => answers.coolingType === "AIO liquid cooler",
    },
    { id: "caseModel", label: "Case model", type: "text", placeholder: "Free text or Not sure" },
    { id: "rgb", label: "RGB", type: "select", options: ["Yes", "No", "No preference"] },
    { id: "colour", label: "Colour", type: "select", options: ["Black", "White", "No preference"] },
  ],

  "PC Case": [
    {
      id: "motherboardSize",
      label: "Motherboard size",
      type: "select",
      required: true,
      options: ["ATX", "Micro-ATX", "Mini-ITX", "Not sure"],
    },
    {
      id: "caseSize",
      label: "Preferred case size",
      waLabel: "Case size",
      type: "select",
      options: ["Full Tower", "Mid Tower", "Compact", "No preference"],
    },
    { id: "colour", label: "Colour", type: "select", options: ["Black", "White", "Other", "No preference"] },
    {
      id: "style",
      label: "Style",
      type: "select",
      options: ["Glass / showcase", "Airflow focused", "Minimal", "RGB", "No preference"],
    },
    { id: "currentGpu", label: "Current GPU model", waLabel: "Current GPU", type: "text", placeholder: "Free text or Not sure" },
    { id: "coolingSetup", label: "Cooling setup", type: "text", placeholder: "Free text or Not sure" },
  ],

  "Case Fans / RGB Fans": [
    {
      id: "fanCount",
      label: "Number of fans required",
      waLabel: "Fans needed",
      type: "select",
      required: true,
      options: ["1", "3", "6", "9", "Other"],
    },
    { id: "fanSize", label: "Fan size", type: "select", options: ["120mm", "140mm", "Not sure"] },
    { id: "rgb", label: "RGB", type: "select", options: ["ARGB", "RGB", "No RGB", "Not sure"] },
    { id: "colour", label: "Colour", type: "select", options: ["Black", "White", "No preference"] },
    { id: "currentCase", label: "Current case model", waLabel: "Case", type: "text", placeholder: "Free text or Not sure" },
  ],

  Monitor: [
    {
      id: "screenSize",
      label: "Screen size",
      waLabel: "Size",
      type: "select",
      required: true,
      options: ["24 inch", "27 inch", "32 inch", "Ultrawide", "No preference"],
    },
    { id: "resolution", label: "Resolution", type: "select", options: ["1080p", "1440p", "4K", "No preference"] },
    {
      id: "refreshRate",
      label: "Refresh rate",
      type: "select",
      options: ["60–75Hz", "120–165Hz", "180–240Hz", "240Hz+", "No preference"],
    },
    { id: "panel", label: "Panel preference", waLabel: "Panel", type: "select", options: ["IPS", "VA", "OLED", "No preference"] },
    { id: "flatCurved", label: "Flat or curved", type: "select", options: ["Flat", "Curved", "No preference"] },
    {
      id: "mainUse",
      label: "Main use",
      type: "select",
      options: ["Competitive gaming", "General gaming", "Productivity", "Content creation", "Mixed use"],
    },
    { id: "currentGpu", label: "Current GPU", type: "text", placeholder: "Free text or Not sure" },
  ],

  Keyboard: [
    {
      id: "size",
      label: "Size",
      type: "select",
      required: true,
      options: ["Full size", "TKL", "75%", "65%", "60%", "No preference"],
    },
    { id: "connection", label: "Connection", type: "select", options: ["Wired", "Wireless", "Either"] },
    {
      id: "switchPreference",
      label: "Switch preference",
      waLabel: "Switches",
      type: "select",
      options: ["Linear", "Tactile", "Clicky", "No preference"],
    },
    { id: "rgb", label: "RGB", type: "select", options: ["Yes", "No", "No preference"] },
    {
      id: "layout",
      label: "Language/layout",
      waLabel: "Layout",
      type: "select",
      options: ["English", "Arabic/English", "No preference"],
    },
  ],

  Mouse: [
    {
      id: "mainUse",
      label: "Main use",
      type: "select",
      required: true,
      options: ["FPS gaming", "MOBA", "General gaming", "Productivity", "Mixed use"],
    },
    { id: "connection", label: "Connection", type: "select", options: ["Wired", "Wireless", "Either"] },
    {
      id: "weightPreference",
      label: "Weight preference",
      waLabel: "Weight",
      type: "select",
      options: ["Lightweight", "Medium", "Heavy", "No preference"],
    },
    { id: "gripStyle", label: "Grip style", waLabel: "Grip", type: "select", options: ["Palm", "Claw", "Fingertip", "Not sure"] },
    { id: "handSize", label: "Hand size", type: "select", options: ["Small", "Medium", "Large", "Not sure"] },
  ],

  Headset: [
    { id: "connection", label: "Connection", type: "select", required: true, options: ["Wired", "Wireless", "Either"] },
    {
      id: "mainUse",
      label: "Main use",
      type: "select",
      options: ["Gaming", "Gaming + Discord", "Music", "Mixed use"],
    },
    { id: "microphoneRequired", label: "Microphone required", waLabel: "Microphone", type: "select", options: ["Yes", "No"] },
    { id: "platform", label: "Platform", type: "select", options: ["PC", "PlayStation", "Xbox", "Multiple"] },
    { id: "style", label: "Preferred style", waLabel: "Style", type: "select", options: ["Closed back", "Open back", "No preference"] },
  ],

  "Mouse Pad": [
    {
      id: "size",
      label: "Size",
      type: "select",
      required: true,
      options: ["Standard", "Large", "XL / Desk mat", "Not sure"],
    },
    {
      id: "surface",
      label: "Surface preference",
      waLabel: "Surface",
      type: "select",
      options: ["Speed", "Control", "Balanced", "No preference"],
    },
    { id: "rgb", label: "RGB", type: "select", options: ["Yes", "No", "No preference"] },
  ],

  "Wi-Fi / Bluetooth Adapter": [
    {
      id: "connectionType",
      label: "Connection type",
      waLabel: "Connection",
      type: "select",
      required: true,
      options: ["USB", "PCIe", "No preference"],
    },
    { id: "needWifi", label: "Need Wi-Fi", waLabel: "Wi-Fi", type: "select", options: ["Yes", "No"] },
    { id: "needBluetooth", label: "Need Bluetooth", waLabel: "Bluetooth", type: "select", options: ["Yes", "No"] },
    { id: "deviceType", label: "Desktop / laptop", waLabel: "Device", type: "select", options: ["Desktop", "Laptop"] },
    {
      id: "deviceModel",
      label: "Motherboard/device model",
      waLabel: "Device model",
      type: "text",
      placeholder: "Free text or Not sure",
    },
  ],

  "Cables / PC Accessories": [
    { id: "accessoryRequired", label: "Accessory required", type: "text", required: true },
    { id: "colour", label: "Colour", type: "text", placeholder: "Free text or No preference" },
    { id: "deviceCompatibility", label: "Device / PC it must work with", waLabel: "Compatible with", type: "text" },
    {
      id: "specificModel",
      label: "Specific brand/model",
      type: "text",
      placeholder: "Free text or Best suitable option",
    },
  ],

  "Other Tech Product": [
    {
      id: "productDescription",
      label: "What product are you looking for?",
      waLabel: "Product",
      type: "textarea",
      rows: 4,
      required: true,
    },
    { id: "specificModel", label: "Specific brand/model if known", waLabel: "Brand/model", type: "text" },
    { id: "productLink", label: "Product link", waLabel: "Link", type: "url", placeholder: "https://… (optional)" },
    { id: "purpose", label: "What do you need it for?", waLabel: "Purpose", type: "text" },
    {
      id: "specifications",
      label: "Any required specifications",
      waLabel: "Specifications",
      type: "textarea",
      rows: 4,
    },
  ],
};

/** Short heading used to introduce a category's answers in the WhatsApp message, e.g. "GPU Requirements". */
export const categoryWaHeading: Record<QuoteCategory, string> = {
  "Complete Custom PC": "PC Build",
  "Graphics Card (GPU)": "GPU",
  "Processor (CPU)": "CPU",
  Motherboard: "Motherboard",
  "RAM / Memory": "RAM",
  "SSD / Storage": "Storage",
  "Power Supply": "Power Supply",
  "CPU Cooling": "Cooling",
  "PC Case": "Case",
  "Case Fans / RGB Fans": "Fans",
  Monitor: "Monitor",
  Keyboard: "Keyboard",
  Mouse: "Mouse",
  Headset: "Headset",
  "Mouse Pad": "Mouse Pad",
  "Wi-Fi / Bluetooth Adapter": "Wi-Fi/Bluetooth",
  "Cables / PC Accessories": "Cables/Accessories",
  "Other Tech Product": "Product",
};

/**
 * Maps the category names used by the older, static `/products` category
 * cards (`@/lib/categories`) onto the new dynamic quote categories, so
 * "Request Current Price" links still land on the right question set.
 */
const legacyCategoryMap: Record<string, QuoteCategory> = {
  "Complete Builds": "Complete Custom PC",
  CPUs: "Processor (CPU)",
  GPUs: "Graphics Card (GPU)",
  RAM: "RAM / Memory",
  "SSD / Storage": "SSD / Storage",
  Motherboards: "Motherboard",
  Cooling: "CPU Cooling",
  "Power Supplies": "Power Supply",
  Accessories: "Cables / PC Accessories",
  Headsets: "Headset",
  Mouse: "Mouse",
  Keyboards: "Keyboard",
  Monitors: "Monitor",
  "Mouse Pads": "Mouse Pad",
  "Other Parts": "Other Tech Product",
};

/** Resolves a `?category=` query value (old or new naming) to a known quote category, or null. */
export function resolveQuoteCategoryFromParam(value: string | null): QuoteCategory | null {
  if (!value) return null;
  if ((QUOTE_CATEGORIES as readonly string[]).includes(value)) {
    return value as QuoteCategory;
  }
  return legacyCategoryMap[value] ?? null;
}

/** Fields to render/validate/send for a category, given its current answers (respects `showIf`). */
export function getVisibleCategoryFields(
  category: QuoteCategory | "",
  answers: QuoteAnswers
): QuoteFieldConfig[] {
  if (!category) return [];
  return categoryFieldSchemas[category].filter((field) => !field.showIf || field.showIf(answers));
}
