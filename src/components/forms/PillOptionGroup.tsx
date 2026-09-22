"use client";

/**
 * Single-select group of tappable pill buttons. Large tap targets, works
 * well on mobile, and avoids native <select> dropdowns for short option
 * lists so the form feels quick to fill on a phone.
 */
export function PillOptionGroup<T extends string>({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: readonly T[];
  value: T | "";
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const selected = value === option;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option)}
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
