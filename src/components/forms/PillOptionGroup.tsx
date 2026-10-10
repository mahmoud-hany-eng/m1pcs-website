"use client";

/** Glass segment pill: clear glass when idle, lit gold when selected. */
export const PILL_IDLE =
  "bg-white/[0.035] text-text-secondary shadow-[inset_0_1px_0_rgb(255_255_255/0.06),inset_0_0_0_1px_rgb(255_255_255/0.1)] hover:text-white hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.08),inset_0_0_0_1px_rgb(249_194_4/0.45)]";
export const PILL_SELECTED =
  "btn-gold font-semibold";

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
            className={`min-h-[2.75rem] rounded-full px-4 py-2.5 text-sm font-medium transition-[color,background-color,box-shadow] duration-200 ${
              selected ? PILL_SELECTED : PILL_IDLE
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
