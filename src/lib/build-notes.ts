/**
 * Build-specific write-ups for /completed-builds/<slug>.
 *
 * Every sentence here comes from one of three places, and nothing else:
 *   1. the build's own spec fields in builds.ts (parts, fan counts, cables, extras);
 *   2. platform facts that follow directly from those parts (e.g. a Ryzen 5000-series
 *      CPU is an AM4 part and AM4 only takes DDR4; LGA1851 and AM5 only take DDR5;
 *      the "M" in B550M means Micro-ATX; "G"/"GT" Ryzen chips have integrated graphics);
 *   3. details that are plainly visible (or legible) in that build's own photograph.
 * No benchmarks, FPS figures, prices, dates, customer requirements or availability.
 *
 * When a new build is added to builds.ts, add its entry here too — a build without an
 * entry still gets its spec list and the auto-generated "same graphics card" section,
 * just not this write-up.
 */

export interface BuildNotes {
  /** CPU platform, memory and storage. */
  platform: string;
  /** Cooler and fans. */
  cooling: string;
  /** What the photograph shows: case, lighting, cabling, visible parts. */
  look: string;
  /** Extra software/accessories that distinguish this build (optional). */
  extras?: string;
}

export const buildNotes: Record<string, BuildNotes> = {
  "ryzen-7-9850x3d-rtx-5080": {
    platform:
      "The Ryzen 7 9850X3D is an X3D model, the extra-cache line AMD designs with gaming in mind. It sits on the AM5 platform in a GIGABYTE B850 AORUS Elite, and AM5 only takes DDR5, so the memory is 32GB of Patriot DDR5 at 6000MHz. A 2TB KingSpec M.2 Gen 4 SSD provides storage, and the graphics card is an MSI Gaming GeForce RTX 5080 16GB, powered by an ASRock White SL-850GW.",
    cooling:
      "Processor cooling is a Lian Li HydroShift II LCD 360mm liquid cooler, which has a screen in its pump head. Ten ARGB fans are fitted, six intake and four exhaust; in the photo three are stacked down the right-hand side of the case and three run along the base.",
    look:
      "A white case with panoramic glass on the front and side, lit in white and blue. The cabling is white as well, and the MSI graphics card is clearly visible behind the glass.",
  },
  "intel-core-ultra-270k-plus-rtx-5060-ti": {
    platform:
      "An Intel build: the Core Ultra 270K Plus sits on LGA1851 in an ASRock B860M WiFi, a Micro-ATX board, and LGA1851 only takes DDR5: 32GB running at 7600MHz. Storage is a 1TB M.2 SSD rated at 7400MB/s, graphics is an NVIDIA RTX 5060 Ti 8GB, and the power supply is a 650W 80+ Gold unit.",
    cooling:
      "An NZXT Kraken Plus 240 liquid cooler looks after the processor, with seven ARGB fans: four intake and three exhaust.",
    look:
      "A white glass-cube case lit in purple. The 24-pin and 8-pin power cables wear ARGB sleeves, which show up as bright light strips across the interior, and a Thermalright Trofeo Vision LCD white sub-display is mounted on the side of the case; in the photo it is showing CPU and GPU usage.",
  },
  "ryzen-5-9600x-rx-9060-xt": {
    platform:
      "An all-AMD build: a Ryzen 5 9600X on AM5 (so DDR5, here 16GB at 6000MHz) in an ASRock B850M Pro RS WiFi Micro-ATX board, with an AMD Radeon RX 9060 XT 16GB. Storage is a 512GB SSD and the power supply is a 650W 80+ Gold unit.",
    cooling:
      "A Xigmatek AK4 air cooler handles the processor; in the photo it carries a small digital temperature display on its side. Three ARGB fans are fitted, two intake and one exhaust.",
    look:
      "A light-coloured case with a panoramic glass corner and a ventilated base with front ports, lit in blue. The Radeon card sits just below the cooler.",
  },
  "ryzen-7-9800x3d-rtx-5080": {
    platform:
      "A Ryzen 7 9800X3D, another X3D model, on AM5 in an MSI B850-V EVO WiFi, with 32GB of memory at 6000MHz (AM5 means DDR5) and a 2TB M.2 SSD. Graphics is an NVIDIA RTX 5080 16GB and the power supply is an 850W 80+ Gold unit.",
    cooling:
      "Here the processor is cooled by a Thermalright air cooler rather than a liquid cooler. Its side carries a small screen that, in the photo, shows the M1 Gaming PCs logo with CPU, GPU and memory temperatures. Ten ARGB fans are fitted, six intake and four exhaust.",
    look:
      "A white panoramic-glass case lit entirely in red. A white sleeved cable kit runs to the ASUS-branded GeForce RTX card, which is visible in the photo.",
  },
  "ryzen-5-rtx-5060-ti": {
    platform:
      "A Ryzen 5 7600X on AM5 with a B650 board, so the memory is DDR5: 32GB at 5200MHz. Storage is a 1TB SSD, graphics is an NVIDIA RTX 5060 Ti and the power supply is 650W.",
    cooling:
      "A Cooler Master 240mm cooler. In the photo two ARGB fans sit at the top of the case with the cooler's tubing running down to the processor, and six ARGB fans are fitted in total.",
    look:
      "A black case with a mesh front and tinted glass side, lit in shifting pink, orange and purple. Three fans are visible along the front edge, and the GeForce RTX card is visible low in the case.",
  },
  "ryzen-5-rtx-4060": {
    platform:
      "A Ryzen 5 8600G on AM5 in a B650 ATX board, with 32GB of DDR5 at 5200MHz and a 512GB SSD. The 8600G is a G-series processor with graphics built in; here it is paired with a dedicated NVIDIA RTX 4060 and a 650W power supply.",
    cooling:
      "AMD's Wraith Stealth cooler and six PWM ARGB fans; in the photo three are visible behind the mesh front and two on the top panel.",
    look:
      "A black case with a hexagonal mesh front, its fans glowing in rainbow colours. A white RGB memory module stands out against the dark interior.",
  },
  "ryzen-5-rtx-3060-white": {
    platform:
      "A Ryzen 5 5600X on AM4 in a B550M Micro-ATX board. AM4 takes DDR4, so the memory is 16GB at 3600MHz, alongside a 512GB SSD, an NVIDIA RTX 3060 and a 650W power supply.",
    cooling:
      "AMD's Wraith Stealth cooler and six PWM ARGB fans; in the photo two sit on the top panel and a large fan beside the processor.",
    look:
      "A compact white tower with a honeycomb-mesh front panel edged by a light strip, lit in violet and blue, with white memory modules to match.",
    extras:
      "The B550M board has no built-in Wi-Fi, so the spec includes a Wi-Fi and Bluetooth USB adapter.",
  },
  "ryzen-5-rtx-5060-b550m": {
    platform:
      "A Ryzen 5 5600 on AM4 in a B550m-HDV Micro-ATX board, with 16GB of DDR4 at 3200MHz and a 1TB SSD. Graphics is an NVIDIA RTX 5060 8GB (a PNY card in the photo) and the power supply is 650W.",
    cooling: "AMD's Wraith Stealth cooler and three RGB fans.",
    look:
      "A compact white tower with a honeycomb front panel edged by a lit strip, glowing violet. A large white fan with a honeycomb grille sits beside the processor cooler.",
    extras:
      "The spec lists Windows 11 Pro with a Microsoft Office activation, plus a Wi-Fi and Bluetooth USB adapter.",
  },
  "ryzen-5-rtx-5060-a520m": {
    platform:
      "A Ryzen 5 5600 on AM4 in an A520M board, which is AMD's entry-level AM4 chipset in a Micro-ATX size. Memory is DDR4: 16GB at 3200MHz. Storage is a 1TB SSD, graphics is an NVIDIA RTX 5060 8GB and the power supply is 650W.",
    cooling: "AMD's Wraith Stealth cooler and four ARGB fans.",
    look:
      "A white case with a large clear side window and a honeycomb front edge lit in violet. In the photo you can see a rainbow-lit ARGB fan, rainbow-lit memory and a GIGABYTE GeForce RTX card.",
  },
  "ryzen-7-rtx-3070": {
    platform:
      "A Ryzen 7 5800X on AM4 in a B550 Aorus Pro AC, with 32GB of DDR4 at 3600MHz and two M.2 SSDs, 1TB and 512GB. Graphics is an NVIDIA RTX 3070, powered by a 750W fully modular power supply (a modular unit lets you connect only the cables a build needs).",
    cooling:
      "An NZXT Kraken 240mm liquid cooler, with two pink-lit fans at the top of the case in the photo and the cooler's tubing beside them, and six PWM ARGB fans in total. The pump head has a round screen, which shows an image in the photo.",
    look:
      "A black case with a mesh front, lit in pink. Asia Horse sleeved cables in white and black run through the interior, and an EVGA GeForce RTX card is visible near the bottom.",
  },
  "ryzen-5-5600gt-rtx-3060": {
    platform:
      "A Ryzen 5 5600GT on AM4 in a B550M board, with 32GB of DDR4 at 3600MHz and a 1TB M.2 SSD. The 5600GT is a G-series processor with integrated graphics, and here it is paired with an NVIDIA RTX 3060 and a 650W power supply.",
    cooling: "AMD's Wraith Stealth cooler and six ARGB fans.",
    look:
      "A compact white tower with a honeycomb front edge and a lit strip. The fan and the memory glow amber-yellow, and a GIGABYTE GeForce RTX card is visible.",
  },
  "ryzen-7-rtx-2070": {
    platform:
      "A Ryzen 7 5700X on AM4 in a B550 board, with 16GB of DDR4 at 3200MHz and a 1TB SSD. Graphics is an NVIDIA RTX 2070 8GB and the power supply is 750W.",
    cooling:
      "AMD's Wraith Stealth cooler and six ARGB fans: in the photo, three are stacked on the right-hand side and three run along the top.",
    look:
      "A white panoramic-glass case. The fan lighting is off in this photo, which makes the black-and-white sleeved cables around the board and graphics card easy to see.",
  },
  "ryzen-7-rtx-4060": {
    platform:
      "A Ryzen 7 5700 on AM4 in an MSI B550M board, with 32GB of DDR4 at 3600MHz and a 1TB SSD. Graphics is an NVIDIA RTX 4060 and the power supply is 700W.",
    cooling:
      "AMD's Wraith Stealth cooler and six PWM ARGB fans; in the photo two sit on the top panel and a white fan at the rear glows blue.",
    look:
      "A white Montech case with a mesh front panel and a glass side panel with a latch, lit by blue-white fans. An ASUS-branded GeForce RTX card is visible inside.",
  },
  "ryzen-5-rtx-2060-b550": {
    platform:
      "A Ryzen 5 5600X on AM4 in an MSI B550 board, with 16GB of DDR4 at 3600MHz and a 1TB M.2 SSD. Graphics is an NVIDIA RTX 2060 and the power supply is 650W.",
    cooling:
      "AMD's Wraith Stealth cooler and nine PWM ARGB fans: in the photo, three orange-lit fans run down the right-hand side and three colour-shifting fans along the top.",
    look:
      "A black-framed panoramic-glass case with a white interior and LIAN LI branding. Asia Horse sleeved white cables, green-lit memory and an EVGA GeForce RTX 2060 are visible.",
  },
  "ryzen-5-gtx-1660-ti": {
    platform:
      "A Ryzen 5 3600 (Ryzen 3000 series) on AM4 in a B450 board, with 16GB of DDR4 at 3200MHz and a 1TB SSD. Graphics is an NVIDIA GTX 1660 Ti 6GB, a GTX-series card rather than RTX, and the power supply is 600W.",
    cooling:
      "AMD's Wraith Stealth cooler and nine ARGB fans: in the photo, three are lit blue-white on the right, three blue-violet along the top and three green, cyan and blue along the base.",
    look:
      "A black panoramic-glass case with a thin copper-coloured edge strip at the front corner, cyan-lit memory, and black-and-white sleeved cables.",
  },
  "ryzen-5-rtx-2060-b450": {
    platform:
      "A Ryzen 5 5600X on AM4 in a B450M Micro-ATX board, with 16GB of DDR4 at 3600MHz and a 512GB SSD. Ryzen 5000-series processors run on B450 boards with a BIOS version that supports them. Graphics is an NVIDIA RTX 2060 and the power supply is 600W.",
    cooling: "AMD's Wraith Stealth cooler and four fans, which are not ARGB.",
    look:
      "A compact white case with a dark tinted side window and a blue-lit vent strip along the front edge. The interior is dark in this photo, so the specifications above are the best guide to what is inside.",
  },
};

export function getBuildNotes(slug: string): BuildNotes | undefined {
  return buildNotes[slug];
}
