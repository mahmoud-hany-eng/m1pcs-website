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
    <div className={`flex flex-col gap-3 ${alignment}`}>
      {eyebrow && (
        <span className="text-xs sm:text-sm font-semibold uppercase tracking-[0.2em] text-accent">
          {eyebrow}
        </span>
      )}
      <Heading className="font-display text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-text-primary max-w-3xl">
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
