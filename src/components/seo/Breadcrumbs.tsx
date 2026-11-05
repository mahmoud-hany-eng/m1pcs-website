import Link from "next/link";
import { JsonLd } from "@/components/seo/JsonLd";
import { breadcrumbJsonLd } from "@/lib/seo";

export interface Crumb {
  name: string;
  /** Site-relative path. Omit on the current (last) page. */
  href?: string;
}

/**
 * Visible breadcrumb trail + matching BreadcrumbList JSON-LD. The markup only
 * ever describes the trail that is actually shown to visitors.
 */
export function Breadcrumbs({ trail, path }: { trail: Crumb[]; path: string }) {
  const full: Crumb[] = [{ name: "Home", href: "/" }, ...trail];
  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-text-muted">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {full.map((crumb, i) => {
            const last = i === full.length - 1;
            return (
              <li key={`${crumb.name}-${i}`} className="flex items-center gap-2">
                {crumb.href && !last ? (
                  <Link href={crumb.href} className="transition-colors hover:text-white">
                    {crumb.name}
                  </Link>
                ) : (
                  <span aria-current={last ? "page" : undefined} className={last ? "text-text-secondary" : undefined}>
                    {crumb.name}
                  </span>
                )}
                {!last && (
                  <span aria-hidden="true" className="text-text-muted/60">
                    /
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <JsonLd
        data={breadcrumbJsonLd(
          full.map((c, i) => ({ name: c.name, path: i === full.length - 1 ? path : c.href ?? path }))
        )}
      />
    </>
  );
}
