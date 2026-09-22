"use client";

/**
 * Multi-select variant of PillOptionGroup (used for Accessories).
 */
export function MultiPillOptionGroup<T extends string>({
  name,
  options,
  values,
  onToggle,
}: {
  name: string;
  options: readonly T[];
  values: T[];
  onToggle: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={name} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const selected = values.includes(option);
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            onClick={() => onToggle(option)}
            className={`rounded-full border px-4 py-2.5 text-sm font-medium transition-colors ${
              selected
                ? "border-accent bg-accent text-black"
                : "border-border-strong bg-surface text-text-secondary hover:border-accent/60 hover:text-text-primary"
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
