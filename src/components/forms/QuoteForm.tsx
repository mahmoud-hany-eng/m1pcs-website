"use client";

import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FieldWrapper } from "@/components/forms/FieldWrapper";
import { TextInput } from "@/components/forms/TextInput";
import { TextArea } from "@/components/forms/TextArea";
import { PillOptionGroup } from "@/components/forms/PillOptionGroup";
import { SelectInput } from "@/components/forms/SelectInput";
import { DynamicField } from "@/components/forms/DynamicField";
import { Button } from "@/components/ui/Button";
import { buildQuoteMessage, buildWhatsAppLink } from "@/lib/whatsapp";
import { getVisibleCategoryFields, resolveQuoteCategoryFromParam } from "@/lib/quote-schema";
import { PRODUCT_PREFERENCES, QUOTE_CATEGORIES } from "@/types/quote";
import type { QuoteAnswers, QuoteCategory, QuoteGeneralData } from "@/types/quote";

const initialGeneral: QuoteGeneralData = {
  fullName: "",
  mobile: "",
  email: "",
  budgetQar: "",
  quantity: "1",
  productPreference: "",
  specificModel: "",
  additionalRequirements: "",
};

export function QuoteForm() {
  const searchParams = useSearchParams();
  const [category, setCategory] = useState<QuoteCategory | "">("");
  const [general, setGeneral] = useState<QuoteGeneralData>(initialGeneral);
  const [categoryData, setCategoryData] = useState<QuoteAnswers>({});
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const reference = searchParams.get("reference");
    const categoryParam = searchParams.get("category");

    if (reference) {
      setCategory("Complete Custom PC");
      setGeneral((prev) => ({
        ...prev,
        additionalRequirements: `Reference build: ${reference}${
          prev.additionalRequirements ? `\n${prev.additionalRequirements}` : ""
        }`,
      }));
      return;
    }

    const resolved = resolveQuoteCategoryFromParam(categoryParam);
    if (resolved) setCategory(resolved);
    // Only run once on mount — intentionally not reacting to further param changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateGeneral<K extends keyof QuoteGeneralData>(key: K, value: QuoteGeneralData[K]) {
    setGeneral((prev) => ({ ...prev, [key]: value }));
  }

  function handleCategoryChange(next: QuoteCategory) {
    setCategory(next);
    // A category change means every field shown a moment ago belonged to a
    // different question set — clear it so nothing stale from the old
    // category can end up in the submitted message.
    setCategoryData({});
  }

  function updateCategoryField(id: string, value: string | string[]) {
    setCategoryData((prev) => ({ ...prev, [id]: value }));
  }

  const visibleFields = getVisibleCategoryFields(category, categoryData);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (!category) {
      setError("Please select what you'd like a quote for.");
      return;
    }
    if (!general.fullName.trim() || !general.mobile.trim()) {
      setError("Please fill in your name and mobile number.");
      return;
    }
    // Product preference and the category questions below are custom pill
    // groups, not native form controls, so the browser's built-in
    // `required` validation can't catch them — check explicitly.
    if (!general.productPreference) {
      setError("Please let us know your product preference.");
      return;
    }
    if (
      general.productPreference === "I want a specific model" &&
      !general.specificModel.trim()
    ) {
      setError("Please tell us the specific brand/model you have in mind.");
      return;
    }

    for (const field of visibleFields) {
      if (!field.required) continue;
      const value = categoryData[field.id];
      const hasValue = Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
      if (!hasValue) {
        setError(`Please answer: ${field.label}`);
        return;
      }
    }

    const message = buildQuoteMessage({ category, general, categoryData });
    const href = buildWhatsAppLink(message);

    if (!href) {
      setError(
        "WhatsApp isn't configured on this site yet — please reach us via Instagram instead."
      );
      return;
    }

    // A synthetic <a> click (rather than window.open) is the most reliable
    // way to hand off to the WhatsApp app across mobile browsers and
    // in-app browsers (e.g. Instagram's), which is where most customers
    // will be. It still counts as a direct result of the user's tap, and
    // — unlike window.location.href — it leaves this tab in place so the
    // confirmation state below stays visible.
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="rounded-card border border-border bg-surface p-8 text-center">
        <h2 className="font-display text-xl font-semibold text-text-primary">
          WhatsApp should now be open
        </h2>
        <p className="mt-3 text-sm text-text-secondary">
          We&rsquo;ve pre-filled your request in WhatsApp — just hit send. If
          it didn&rsquo;t open automatically, your browser may have blocked
          the pop-up.
        </p>
        <Button
          variant="outline"
          size="md"
          className="mt-6"
          onClick={() => setSubmitted(false)}
        >
          Edit my request
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-10">
      {/* What do you want a quote for? */}
      <fieldset className="flex flex-col gap-4">
        <legend className="font-display text-lg font-semibold text-text-primary">
          What would you like a quote for?
        </legend>
        <FieldWrapper label="Quote category" htmlFor="quote-category" required>
          <SelectInput
            id="quote-category"
            required
            value={category}
            onChange={(e) => handleCategoryChange(e.target.value as QuoteCategory)}
          >
            <option value="" disabled>
              Select a category…
            </option>
            {QUOTE_CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </SelectInput>
        </FieldWrapper>
        {category !== "Complete Custom PC" && (
          <Button
            type="button"
            variant="outline"
            size="md"
            className="self-start"
            onClick={() => handleCategoryChange("Complete Custom PC")}
          >
            Build a Complete PC
          </Button>
        )}
      </fieldset>

      {/* Customer details */}
      <fieldset className="flex flex-col gap-5">
        <legend className="font-display text-lg font-semibold text-text-primary">
          Your details
        </legend>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FieldWrapper label="Full name" htmlFor="fullName" required>
            <TextInput
              id="fullName"
              required
              value={general.fullName}
              onChange={(e) => updateGeneral("fullName", e.target.value)}
              autoComplete="name"
            />
          </FieldWrapper>
          <FieldWrapper label="Mobile / WhatsApp" htmlFor="mobile" required>
            <TextInput
              id="mobile"
              type="tel"
              required
              placeholder="e.g. 5xxxxxxx"
              value={general.mobile}
              onChange={(e) => updateGeneral("mobile", e.target.value)}
              autoComplete="tel"
            />
          </FieldWrapper>
        </div>
        <FieldWrapper label="Email" htmlFor="email">
          <TextInput
            id="email"
            type="email"
            value={general.email}
            onChange={(e) => updateGeneral("email", e.target.value)}
            autoComplete="email"
          />
        </FieldWrapper>
      </fieldset>

      {/* Budget, quantity & preference */}
      <fieldset className="flex flex-col gap-5">
        <legend className="font-display text-lg font-semibold text-text-primary">
          Budget &amp; preference
        </legend>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <FieldWrapper
            label="Budget in QAR"
            htmlFor="budget"
            hint="Leave blank if you don't know yet."
          >
            <TextInput
              id="budget"
              inputMode="numeric"
              placeholder="e.g. 5000"
              value={general.budgetQar}
              onChange={(e) => updateGeneral("budgetQar", e.target.value)}
            />
          </FieldWrapper>
          <FieldWrapper label="Quantity" htmlFor="quantity" required>
            <TextInput
              id="quantity"
              type="number"
              min={1}
              required
              value={general.quantity}
              onChange={(e) => updateGeneral("quantity", e.target.value)}
            />
          </FieldWrapper>
        </div>

        <FieldWrapper label="Product preference" required>
          <PillOptionGroup
            name="Product preference"
            options={PRODUCT_PREFERENCES}
            value={general.productPreference}
            onChange={(v) => updateGeneral("productPreference", v)}
          />
        </FieldWrapper>

        {general.productPreference === "I want a specific model" && (
          <FieldWrapper label="Specific brand/model" htmlFor="specificModel" required>
            <TextInput
              id="specificModel"
              required
              value={general.specificModel}
              onChange={(e) => updateGeneral("specificModel", e.target.value)}
            />
          </FieldWrapper>
        )}
      </fieldset>

      {/* Category-specific questions — driven entirely by @/lib/quote-schema */}
      {category && visibleFields.length > 0 && (
        <fieldset className="flex flex-col gap-6">
          <legend className="font-display text-lg font-semibold text-text-primary">
            {category} details
          </legend>
          {visibleFields.map((field) => (
            <DynamicField
              key={field.id}
              field={field}
              value={categoryData[field.id]}
              onChange={updateCategoryField}
            />
          ))}
        </fieldset>
      )}

      {/* Additional requirements */}
      <fieldset className="flex flex-col gap-5">
        <legend className="font-display text-lg font-semibold text-text-primary">
          Anything else?
        </legend>
        <FieldWrapper label="Additional requirements / notes" htmlFor="additional">
          <TextArea
            id="additional"
            rows={5}
            value={general.additionalRequirements}
            onChange={(e) => updateGeneral("additionalRequirements", e.target.value)}
          />
        </FieldWrapper>
      </fieldset>

      <div className="flex flex-col gap-4 border-t border-border pt-6">
        <p className="text-xs text-text-muted">
          Submitting this form does not place an order or require payment. M1
          will review your requirements and contact you with a proposed
          option and current quotation.
        </p>
        {error && (
          <p role="alert" className="text-sm font-medium text-error">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" className="w-full sm:w-auto">
          Send Request via WhatsApp
        </Button>
      </div>
    </form>
  );
}
