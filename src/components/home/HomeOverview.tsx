import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { Eyebrow } from "@/components/ui/SectionHeading";
import { categoryPages } from "@/lib/category-pages";
import { guides } from "@/lib/guides";

/**
 * Plain, server-rendered overview that names what M1 does in words and links to
 * every main section (builds, process, component pages, guides) with
 * descriptive anchors. It sits below the animated sections so the hero and
 * scroll choreography are untouched, and exists so the homepage has real,
 * crawlable text and internal links that do not depend on any animation.
 */
export function HomeOverview() {
  const linkClass = "text-accent transition-colors hover:text-accent-hover";

  return (
    <section aria-labelledby="home-overview-title" className="relative py-20 sm:py-24 lg:py-28">
      <Container>
        <div className="flex max-w-3xl flex-col items-start gap-5">
          <Eyebrow>M1 Gaming PCs &middot; Qatar</Eyebrow>
          <h2
            id="home-overview-title"
            className="font-display text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl"
          >
            Custom gaming PCs &amp; computer components in Qatar
          </h2>
          <p className="text-base text-text-secondary sm:text-lg">
            M1 designs custom gaming PCs around your budget and performance goals, sources the components, builds and sets up the
            system, and delivers across Qatar. There is no fixed catalogue: every build starts with a conversation and ends with a
            quotation that confirms current pricing and availability.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="glass glass-flat flex flex-col gap-4 p-6 sm:p-7">
            <h3 className="font-display text-xl font-semibold text-white">Custom gaming PCs</h3>
            <p className="text-sm leading-relaxed text-text-secondary">
              See what M1 has already built, understand the process from quotation to delivery, then tell us what you want.
            </p>
            <ul className="flex flex-col gap-2 text-sm">
              <li>
                <Link href="/completed-builds" className={linkClass}>
                  Completed custom gaming PC builds
                </Link>
              </li>
              <li>
                <Link href="/how-it-works" className={linkClass}>
                  How a custom PC order works
                </Link>
              </li>
              <li>
                <Link href="/build-my-pc" className={linkClass}>
                  Request a custom PC quote
                </Link>
              </li>
            </ul>
          </div>

          <div className="glass glass-flat flex flex-col gap-4 p-6 sm:p-7">
            <h3 className="font-display text-xl font-semibold text-white">Computer components</h3>
            <p className="text-sm leading-relaxed text-text-secondary">
              Graphics cards, processors, memory and more, quoted with current pricing and availability rather than a fixed price list.
            </p>
            <ul className="flex flex-col gap-2 text-sm">
              {categoryPages.map((c) => (
                <li key={c.slug}>
                  <Link href={`/products/${c.slug}`} className={linkClass}>
                    {c.h1}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/products" className={linkClass}>
                  All PC component categories
                </Link>
              </li>
            </ul>
          </div>

          <div className="glass glass-flat flex flex-col gap-4 p-6 sm:p-7">
            <h3 className="font-display text-xl font-semibold text-white">Guides</h3>
            <p className="text-sm leading-relaxed text-text-secondary">
              Practical advice on ordering, cooling and compatibility before you decide.
            </p>
            <ul className="flex flex-col gap-2 text-sm">
              {guides.map((g) => (
                <li key={g.slug}>
                  <Link href={`/guides/${g.slug}`} className={linkClass}>
                    {g.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Container>
    </section>
  );
}
