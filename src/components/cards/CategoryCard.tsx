import Link from "next/link";
import type { CategoryItem } from "@/types";

export function CategoryCard({ category }: { category: CategoryItem }) {
  return (
    <div className="group flex flex-col justify-between gap-4 rounded-card border border-border bg-surface p-6 shadow-card transition-all duration-200 hover:border-primary/60 hover:shadow-card-hover">
      <div className="flex flex-col gap-2">
        <h3 className="font-display text-lg font-semibold text-text-primary">
          {category.name}
        </h3>
        <p className="text-sm text-text-secondary">{category.description}</p>
      </div>
      <Link
        href={`/build-my-pc?category=${encodeURIComponent(category.name)}`}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:text-accent-hover"
      >
        Request Current Price
        <span aria-hidden="true" className="transition-transform group-hover:translate-x-0.5">
          &rarr;
        </span>
      </Link>
    </div>
  );
}
