import Link from "next/link";
import type { CategoryItem } from "@/types";

/**
 * Glass category tile. The whole pane is the link's hit area (the link's
 * ::after stretches over it), its edge warms and a light sweep crosses on
 * hover — no scale, no glow bloom. `featured` gives the lead category a
 * warm red tint so the grid isn't nine identical panes.
 */
export function CategoryCard({
  category,
  index,
  featured = false,
}: {
  category: CategoryItem;
  index?: number;
  featured?: boolean;
}) {
  return (
    <div
      className={`glass glass-flat glass-interactive group flex min-h-[210px] flex-col justify-between gap-6 p-6 sm:p-7 ${
        featured ? "glass-tint-red" : ""
      }`}
    >
      <div className="flex flex-col gap-2.5">
        <div className="flex items-start justify-between gap-4">
          <h3 className="font-display text-xl font-semibold tracking-tight text-white">{category.name}</h3>
          {index !== undefined && (
            <span className="font-display text-xs font-semibold tracking-widest text-text-muted">
              {String(index + 1).padStart(2, "0")}
            </span>
          )}
        </div>
        <p className="text-sm leading-relaxed text-text-secondary">{category.description}</p>
      </div>
      <Link
        href={`/build-my-pc?category=${encodeURIComponent(category.name)}`}
        className="inline-flex items-center gap-2 text-sm font-semibold text-accent transition-colors after:absolute after:inset-0 after:rounded-[inherit] after:content-[''] hover:text-accent-hover"
      >
        Request Current Price
        <span
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/10 text-xs shadow-[inset_0_0_0_1px_rgb(249_194_4/0.3)] transition-transform duration-300 group-hover:translate-x-1"
        >
          &rarr;
        </span>
      </Link>
    </div>
  );
}
