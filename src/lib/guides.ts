import { contentDates } from "@/lib/content-dates";
import { siteConfig } from "@/lib/site-config";

/**
 * Educational guides (/guides/<slug>).
 *
 * Deliberately few and evergreen. Rules followed here: no benchmark numbers,
 * no "best GPU for $X" style recommendations that go out of date, no prices,
 * no stock or delivery promises beyond what the rest of the site already
 * states (taken from siteConfig / How It Works). Inline links use
 * `[text](/path)` and are rendered as internal <Link>s.
 */

export type Block =
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "table"; caption: string; head: string[]; rows: string[][] }
  | { type: "note"; text: string };

export interface GuideSection {
  id: string;
  heading: string;
  blocks: Block[];
}

export interface Guide {
  slug: string;
  title: string;
  h1: string;
  description: string;
  /** Short line for the hub card. */
  summary: string;
  published: string;
  modified: string;
  intro: string[];
  sections: GuideSection[];
  /** Related guide / category pages shown at the end. */
  related: { href: string; label: string }[];
}

const { operations } = siteConfig;

export const guides: Guide[] = [
  {
    slug: "how-to-order-a-custom-gaming-pc-in-qatar",
    title: "How to Order a Custom Gaming PC in Qatar",
    h1: "How to order a custom gaming PC in Qatar",
    description:
      "A step-by-step guide to ordering a custom gaming PC in Qatar with M1: what to prepare, how quotations work, deposits, U.S. sourcing, build, setup and delivery.",
    summary: "What to prepare, how quotations work, and what happens from order to delivery.",
    published: "2026-11-05",
    modified: contentDates.guides,
    intro: [
      "M1 is consultation-first: there is no fixed catalogue of ready-made PCs. You tell us what you need, we configure a build around it, and you receive a quotation with current pricing before anything is ordered. This guide walks through the process so you know what to prepare and what to expect.",
    ],
    sections: [
      {
        id: "what-to-prepare",
        heading: "Before you ask for a quote: what to prepare",
        blocks: [
          {
            type: "p",
            text: "The more clearly you describe what you want, the better the first configuration will be. It helps to think through:",
          },
          {
            type: "ul",
            items: [
              "What you will use the PC for — which games you play, and whether you also stream, edit video or do other demanding work.",
              "Your monitor: its resolution and refresh rate largely decide how powerful a graphics card makes sense (see our [graphics card guide](/products/gpus)).",
              "A budget range. You do not need an exact number, but a range lets us suggest where the money is best spent.",
              "Look and feel — a white or black build, RGB lighting, a particular case, an LCD on the cooler. Our [completed builds](/completed-builds) show the kinds of builds M1 has already put together.",
              "Anything you already own and want to reuse, such as a monitor, keyboard, mouse or headset.",
            ],
          },
        ],
      },
      {
        id: "request-a-quote",
        heading: "Request a quotation",
        blocks: [
          {
            type: "p",
            text: "Use the [quote request form](/build-my-pc) to send your requirements. It opens a prepared WhatsApp message to M1 so the conversation can continue there; you can also message M1 on Instagram. Submitting a request is not an order and does not commit you to anything.",
          },
        ],
      },
      {
        id: "review-the-quotation",
        heading: "Review your quotation",
        blocks: [
          {
            type: "p",
            text: "You receive a detailed quotation with your selected parts, pricing and an estimated shipping timeframe. Component prices and availability change frequently, which is why M1 quotes each request individually instead of publishing a fixed price list. Ask questions and adjust the configuration until you are happy with it.",
          },
        ],
      },
      {
        id: "confirm-the-order",
        heading: "Confirm your order and pay",
        blocks: [
          {
            type: "p",
            text: `${operations.depositNote} We currently accept ${operations.paymentMethodsActive.join(" and ")}. An order is only confirmed once you have accepted a specific quotation and agreed payment and delivery arrangements with the M1 team; the details are in our [policies](/policies).`,
          },
        ],
      },
      {
        id: "sourcing",
        heading: "Parts are sourced for your order",
        blocks: [
          {
            type: "p",
            text: "Once your order is confirmed, the requested parts are sourced directly from the U.S. and shipped to Qatar. That is why many components are not held as ready stock, and why availability is confirmed in your quotation rather than assumed.",
          },
        ],
      },
      {
        id: "build-and-delivery",
        heading: "Build, setup and delivery",
        blocks: [
          {
            type: "p",
            text: `M1 assembles your PC, installs Windows and drivers, completes setup and gets it ready for delivery or pickup as agreed with the team. Home delivery is available across Qatar. ${operations.deliveryNote}`,
          },
        ],
      },
      {
        id: "after-delivery",
        heading: "After delivery",
        blocks: [
          {
            type: "p",
            text: `Manufacturer warranty is available on products where applicable, and warranty periods vary by product. Return requests may be accepted within ${operations.returnWindowDays} days of delivery, subject to product condition and applicable terms. Read the full [returns, warranty and delivery policies](/policies) before you order.`,
          },
        ],
      },
      {
        id: "questions-to-ask",
        heading: "Questions worth asking any PC builder",
        blocks: [
          {
            type: "ul",
            items: [
              "Which exact models are in the quotation, and what is each part's warranty?",
              "Is pricing and availability confirmed for today, and what happens if a part changes?",
              "Are Windows, drivers and updates installed before delivery?",
              "What is the estimated timeframe, and what could change it?",
              "How are payment, deposit and delivery arranged?",
            ],
          },
          {
            type: "note",
            text: "Ready to start? [Request a PC quote](/build-my-pc) and tell M1 your budget and goals.",
          },
        ],
      },
    ],
    related: [
      { href: "/how-it-works", label: "How M1's process works" },
      { href: "/completed-builds", label: "Completed custom gaming PC builds" },
      { href: "/guides/gaming-pc-compatibility-checklist", label: "Gaming PC compatibility checklist" },
    ],
  },
  {
    slug: "gaming-pc-cooling-in-qatar",
    title: "Cooling a Gaming PC in Qatar: Airflow & Coolers",
    h1: "Cooling a gaming PC in Qatar: airflow, air vs liquid and dust",
    description:
      "How to keep a gaming PC cool in Qatar's climate: how room temperature limits cooling, case airflow, air coolers versus liquid (AIO) coolers, dust filters and placement.",
    summary: "Airflow, air versus liquid coolers, dust and where to put the PC in a warm climate.",
    published: "2026-11-05",
    modified: contentDates.guides,
    intro: [
      "A gaming PC turns most of the electricity it uses into heat, and cooling is what lets the processor and graphics card keep their performance under sustained load. In a warm climate that deserves planning at the start, not after the first summer. This guide covers the principles; it contains no benchmark figures because the right setup depends on your exact parts.",
    ],
    sections: [
      {
        id: "room-temperature",
        heading: "Your room sets the floor",
        blocks: [
          {
            type: "p",
            text: "Fans and coolers move heat into the air around the PC; they cannot make components cooler than the air that enters the case. In Qatar, outdoor temperatures are high for much of the year, so the temperature of the room — and whether it is air-conditioned — has a direct effect on component temperatures. A cooling setup that is comfortable in a cool room has less margin in a warm one.",
          },
        ],
      },
      {
        id: "airflow",
        heading: "Case airflow: intake and exhaust",
        blocks: [
          {
            type: "p",
            text: "Good airflow is a steady path: cool air in through the front or bottom, hot air out through the rear and top. A common approach is slightly more intake than exhaust, which helps dust control when the intake fans have filters. Several M1 builds are listed with their fan layouts for exactly this reason, for example ten fans split six intake and four exhaust.",
          },
          {
            type: "ul",
            items: [
              "Front panels matter: a solid or tightly sealed glass front restricts intake, while a mesh or ventilated front lets fans breathe.",
              "More fans are not automatically better — direction and placement matter more than count.",
              "Keep cables tidy so they do not block the airflow path.",
            ],
          },
        ],
      },
      {
        id: "air-or-liquid",
        heading: "Air cooler or liquid (AIO) cooler?",
        blocks: [
          {
            type: "p",
            text: "Both can cool a modern processor well. Air coolers have no pump to fail and are simple to maintain. All-in-one liquid coolers move the heat to a radiator (commonly 240mm, 280mm or 360mm) that mounts in the case, which suits high-power processors and often looks cleaner; some pump heads include an LCD screen. The case must support the radiator size and the cooler must support your CPU socket.",
          },
          {
            type: "p",
            text: "See the [cooling page](/products/cooling) for what to check before choosing, and our [completed builds](/completed-builds) for air-cooled and liquid-cooled examples.",
          },
        ],
      },
      {
        id: "dust",
        heading: "Dust: filters and cleaning",
        blocks: [
          {
            type: "p",
            text: "Dust is a fact of life in the Gulf. It builds up on fans, filters and heatsinks and gradually reduces airflow. Dust filters on the intake fans catch most of it, and cleaning them regularly — and blowing dust out of the heatsinks every few months — keeps temperatures from creeping up.",
          },
        ],
      },
      {
        id: "placement",
        heading: "Where you put the PC",
        blocks: [
          {
            type: "ul",
            items: [
              "Keep it out of closed cabinets and tight desk cubbies, where the PC re-breathes its own hot exhaust.",
              "Leave a gap behind and beside the case for intake and exhaust.",
              "Avoid direct sunlight and positions next to heaters or other heat sources.",
              "Keep the intake side away from carpets and curtains that shed fibres.",
            ],
          },
        ],
      },
      {
        id: "monitoring",
        heading: "Checking temperatures",
        blocks: [
          {
            type: "p",
            text: "A free monitoring tool such as HWiNFO shows processor and graphics card temperatures while you play. Compare them with the maximum temperatures published by the processor and graphics card manufacturers rather than a rule of thumb: acceptable figures differ between models. If a component sits close to its limit during normal gaming, revisit airflow, filters and placement before spending on parts.",
          },
        ],
      },
      {
        id: "planning-with-m1",
        heading: "Planning cooling with M1",
        blocks: [
          {
            type: "p",
            text: "When M1 configures a build, the cooler, case and fans are chosen together with the processor and graphics card. Tell us where the PC will live and how you use it — [request a quote](/build-my-pc) and mention the room it will be in.",
          },
        ],
      },
    ],
    related: [
      { href: "/products/cooling", label: "PC cooling in Qatar" },
      { href: "/guides/gaming-pc-compatibility-checklist", label: "Gaming PC compatibility checklist" },
      { href: "/completed-builds", label: "Completed custom gaming PC builds" },
    ],
  },
  {
    slug: "gaming-pc-compatibility-checklist",
    title: "Gaming PC Parts Compatibility Checklist",
    h1: "Gaming PC parts compatibility checklist",
    description:
      "A practical checklist for checking that gaming PC parts work together: CPU and motherboard socket, RAM type, M.2 storage, GPU and case fit, cooler clearance and power supply connectors.",
    summary: "Check that your CPU, motherboard, RAM, GPU, cooler, case and PSU actually fit together.",
    published: "2026-11-05",
    modified: contentDates.guides,
    intro: [
      "Most compatibility problems come from a handful of mismatches. Work through the checks below before buying parts. Platform details change as new processors and chipsets are released, so treat the table as a guide and confirm exact support on the manufacturer's specification pages.",
    ],
    sections: [
      {
        id: "cpu-motherboard",
        heading: "1. CPU and motherboard: socket and chipset",
        blocks: [
          {
            type: "p",
            text: "The processor and motherboard must share a socket, and the chipset must support that specific processor. A newer processor on an older board of the same socket may need a BIOS update before it will start.",
          },
          {
            type: "table",
            caption: "Common desktop platforms",
            head: ["Platform", "Typical processors", "Memory", "Common chipsets"],
            rows: [
              ["AMD AM4", "Ryzen 3000 and 5000 series (and some G-series APUs)", "DDR4", "A520, B450, B550, X570"],
              ["AMD AM5", "Ryzen 7000, 8000G and 9000 series", "DDR5", "A620, B650, B850, X670, X870"],
              ["Intel LGA1700", "12th to 14th generation Core", "DDR4 or DDR5, depending on the board", "H610, B660, B760, Z690, Z790"],
              ["Intel LGA1851", "Core Ultra 200S series", "DDR5", "H810, B860, Z890"],
            ],
          },
          {
            type: "p",
            text: "More detail on each part: [processors](/products/cpus) and [motherboards](/products/motherboards).",
          },
        ],
      },
      {
        id: "memory",
        heading: "2. Motherboard and RAM: type, capacity and speed",
        blocks: [
          {
            type: "ul",
            items: [
              "DDR4 and DDR5 are not interchangeable; the board accepts one type.",
              "Use two matched modules for dual-channel operation.",
              "A kit's rated speed usually needs an XMP (Intel) or EXPO (AMD) profile switched on in the BIOS, and the CPU and board decide what runs reliably.",
              "Check that tall memory heatsinks clear your CPU cooler.",
            ],
          },
          { type: "p", text: "See [RAM](/products/ram) for more." },
        ],
      },
      {
        id: "storage",
        heading: "3. Storage: M.2 slots and PCIe generation",
        blocks: [
          {
            type: "p",
            text: "Check how many M.2 slots the board has and which PCIe generation each runs at. An NVMe drive on a slower slot works but is limited to that slot's speed. See [SSDs and storage](/products/ssd-storage).",
          },
        ],
      },
      {
        id: "gpu-case-psu",
        heading: "4. Graphics card, case and power supply",
        blocks: [
          {
            type: "ul",
            items: [
              "Length and thickness: compare the card's dimensions with the case's maximum GPU length and expansion slot count.",
              "Power: use the card maker's recommended PSU wattage as the minimum.",
              "Connectors: confirm the PSU has the right cables — 8-pin PCIe, or a 12VHPWR / 12V-2x6 cable for cards that use it.",
              "Front radiators and cable layouts can restrict space around a long card.",
            ],
          },
          {
            type: "p",
            text: "See [graphics cards](/products/gpus) and [power supplies](/products/power-supplies).",
          },
        ],
      },
      {
        id: "cooler-case",
        heading: "5. Cooler, case and form factor",
        blocks: [
          {
            type: "ul",
            items: [
              "The cooler must support your CPU socket, and an air cooler must be shorter than the case's maximum cooler height.",
              "A liquid cooler's radiator size must be supported by the case at the mounting position you plan to use.",
              "The motherboard's form factor (ATX, Micro-ATX, Mini-ITX) must be supported by the case.",
              "Check the case's front-panel connectors against the board, for example a front USB-C header.",
            ],
          },
          { type: "p", text: "See [cooling](/products/cooling) and the [cooling guide for Qatar](/guides/gaming-pc-cooling-in-qatar)." },
        ],
      },
      {
        id: "final-check",
        heading: "6. Final check and BIOS",
        blocks: [
          {
            type: "p",
            text: "Before assembly, confirm the board's BIOS supports your processor, count the fan and RGB headers you need, and make sure every cable the parts require is in the box. If you would rather not do these checks yourself, that is what a consultation is for: [request a quote](/build-my-pc) and M1 will configure a compatible build around your budget.",
          },
        ],
      },
    ],
    related: [
      { href: "/guides/how-to-order-a-custom-gaming-pc-in-qatar", label: "How to order a custom gaming PC in Qatar" },
      { href: "/products", label: "PC components in Qatar" },
      { href: "/completed-builds", label: "Completed custom gaming PC builds" },
    ],
  },
];

export function getGuide(slug: string): Guide | undefined {
  return guides.find((g) => g.slug === slug);
}
