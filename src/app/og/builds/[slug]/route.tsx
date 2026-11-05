import { notFound } from "next/navigation";
import { completedBuilds } from "@/lib/builds";
import { renderOgCard } from "@/lib/og-image";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return completedBuilds.filter((b) => b.imageSrc).map((b) => ({ slug: b.slug }));
}

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const build = completedBuilds.find((b) => b.slug === slug);
  if (!build?.imageSrc) notFound();

  return renderOgCard({
    kicker: "Completed build",
    headline: build.name.replace(/ Build$/, ""),
    lines: [build.cpu, build.gpu],
    picture: build.imageSrc.replace(/^\//, ""),
    pictureBox: { width: 420, height: 500 },
  });
}
