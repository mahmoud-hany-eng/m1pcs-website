"use client";

import { PILL_IDLE, PILL_SELECTED } from "@/components/forms/PillOptionGroup";

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
