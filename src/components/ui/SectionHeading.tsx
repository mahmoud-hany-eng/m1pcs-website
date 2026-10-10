interface SectionHeadingProps {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
  as?: "h1" | "h2" | "h3";
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "center",
  as = "h2",
}: SectionHeadingProps) {
  const Heading = as;
  const alignment = align === "center" ? "text-center items-center" : "text-left items-start";

  return (
    <div className={`flex flex-col gap-4 ${alignment}`}>
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <Heading className="font-display text-[2.1rem] leading-[1.05] sm:text-5xl lg:text-6xl font-bold tracking-tight text-white max-w-3xl">
        {title}
      </Heading>
      {description && (
        <p className="text-base sm:text-lg text-text-secondary max-w-2xl">
          {description}
        </p>
      )}
    </div>
  );
}

/** Small frosted label with a lit gold pip — the site's eyebrow treatment. */
export function Eyebrow({ children, tone = "gold" }: { children: React.ReactNode; tone?: "gold" | "red" }) {
  return (
    <span className="glass-chip text-[11px] font-semibold uppercase tracking-[0.22em] text-text-primary/90 sm:text-xs">
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${
          tone === "red"
            ? "bg-primary shadow-[0_0_10px_rgb(231_50_37/0.9)]"
            : "bg-accent shadow-[0_0_10px_rgb(249_194_4/0.8)]"
        }`}
      />
      {children}
    </span>
  );
}
