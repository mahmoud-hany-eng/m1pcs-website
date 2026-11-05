import { renderOgCard } from "@/lib/og-image";

// Static: rendered once at build time, served as a cacheable PNG.
export const dynamic = "force-static";

export async function GET() {
  return renderOgCard({
    kicker: "Built Different.",
    headline: "Custom Gaming PCs & Computer Components",
    lines: ["Tell us your budget and goals.", "Request a current quotation."],
    picture: "logo.png",
    pictureBox: { width: 380, height: 475 },
  });
}
