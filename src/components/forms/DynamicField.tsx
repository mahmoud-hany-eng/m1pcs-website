"use client";

import { FieldWrapper } from "@/components/forms/FieldWrapper";
import { TextInput } from "@/components/forms/TextInput";
import { TextArea } from "@/components/forms/TextArea";
import { PillOptionGroup } from "@/components/forms/PillOptionGroup";
import { MultiPillOptionGroup } from "@/components/forms/MultiPillOptionGroup";
import type { QuoteFieldConfig } from "@/types/quote";

/**
 * Renders a single category-specific question from its config. This is the
 * only place that turns a `QuoteFieldConfig` into UI — every category in
 * `@/lib/quote-schema` reuses it instead of hand-written JSX per field.
 */
export function DynamicField({
  field,
  value,
  onChange,
}: {
  field: QuoteFieldConfig;
  value: string | string[] | undefined;
  onChange: (id: string, value: string | string[]) => void;
}) {
  const fieldId = `quote-${field.id}`;

  if (field.type === "select") {
    return (
      <FieldWrapper label={field.label} required={field.required} hint={field.hint}>
        <PillOptionGroup
          name={field.label}
          options={field.options ?? []}
          value={(value as string) ?? ""}
          onChange={(v) => onChange(field.id, v)}
        />
      </FieldWrapper>
    );
  }

  if (field.type === "multiselect") {
    const values = Array.isArray(value) ? value : [];
    return (
      <FieldWrapper label={field.label} required={field.required} hint={field.hint}>
        <MultiPillOptionGroup
          name={field.label}
          options={field.options ?? []}
          values={values}
          onToggle={(option) => {
            const exclusive = field.exclusiveOption;
            let next: string[];
            if (exclusive && option === exclusive) {
              next = values.includes(option) ? [] : [option];
            } else {
              const withoutExclusive = values.filter((v) => v !== exclusive);
              next = withoutExclusive.includes(option)
                ? withoutExclusive.filter((v) => v !== option)
                : [...withoutExclusive, option];
            }
            onChange(field.id, next);
          }}
        />
      </FieldWrapper>
    );
  }

  if (field.type === "textarea") {
    return (
      <FieldWrapper label={field.label} htmlFor={fieldId} required={field.required} hint={field.hint}>
        <TextArea
          id={fieldId}
          rows={field.rows ?? 4}
          required={field.required}
          placeholder={field.placeholder}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(field.id, e.target.value)}
        />
      </FieldWrapper>
    );
  }

  // "text" | "url"
  return (
    <FieldWrapper label={field.label} htmlFor={fieldId} required={field.required} hint={field.hint}>
      <TextInput
        id={fieldId}
        type={field.type === "url" ? "url" : "text"}
        required={field.required}
        placeholder={field.placeholder}
        value={(value as string) ?? ""}
        onChange={(e) => onChange(field.id, e.target.value)}
      />
    </FieldWrapper>
  );
}
