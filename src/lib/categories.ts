import type { CategoryItem } from "@/types";

/**
 * M1 is consultation-led and quotation-first, not a fixed-inventory shop —
 * copy here deliberately avoids implying everything is in stock. Many
 * items are sourced specifically per order; "Request Current Price" is the
 * consistent call to action across every category.
 */
export const categories: CategoryItem[] = [
  {
    slug: "complete-builds",
    name: "Complete Builds",
    description:
      "Full custom PCs configured around your budget, games and performance goals.",
  },
  {
    slug: "cpus",
    name: "CPUs",
    description: "AMD and Intel processors sourced for your chosen platform.",
  },
  {
    slug: "gpus",
    name: "GPUs",
    description: "NVIDIA and AMD graphics cards for every resolution and frame-rate target.",
  },
  {
    slug: "ram",
    name: "RAM",
    description: "High-speed memory kits matched to your build and workload.",
  },
  {
    slug: "ssd-storage",
    name: "SSD / Storage",
    description: "NVMe SSDs and additional storage for fast load times and capacity.",
  },
  {
    slug: "motherboards",
    name: "Motherboards",
    description: "Boards matched to your chosen platform and features.",
  },
  {
    slug: "cooling",
    name: "Cooling",
    description: "Air and liquid cooling options for sustained performance.",
  },
  {
    slug: "power-supplies",
    name: "Power Supplies",
    description: "Reliable PSUs sized correctly for your build.",
  },
  {
    slug: "accessories",
    name: "Accessories",
    description: "General PC accessories to round out your setup.",
  },
  {
    slug: "headsets",
    name: "Headsets",
    description: "Gaming headsets for comfort and clear communication.",
  },
  {
    slug: "mouse",
    name: "Mouse",
    description: "Gaming mice across a range of grips and sensor preferences.",
  },
  {
    slug: "keyboards",
    name: "Keyboards",
    description: "Mechanical and membrane keyboards for gaming and everyday use.",
  },
  {
    slug: "monitors",
    name: "Monitors",
    description: "Displays to match your target resolution and refresh rate.",
  },
  {
    slug: "mouse-pads",
    name: "Mouse Pads",
    description: "Desk and gaming mouse pads in a range of sizes.",
  },
  {
    slug: "other-parts",
    name: "Other Parts",
    description: "Other tech parts and components available through sourcing on request.",
  },
];
