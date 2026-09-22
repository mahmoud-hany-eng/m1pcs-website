"use client";

import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FieldWrapper } from "@/components/forms/FieldWrapper";
import { TextInput } from "@/components/forms/TextInput";
import { TextArea } from "@/components/forms/TextArea";
import { PillOptionGroup } from "@/components/forms/PillOptionGroup";
import { MultiPillOptionGroup } from "@/components/forms/MultiPillOptionGroup";
import { Button } from "@/components/ui/Button";
import { buildQuoteMessage, buildWhatsAppLink } from "@/lib/whatsapp";
import type {
  Accessory,
  BuildColor,
  CpuPreference,
  GpuPreference,
  MainUse,
  MonitorPreference,
  QuoteFormData,
  Resolution,
  RgbPreference,
  StorageOption,
  TargetFps,
  WifiPreference,
} from "@/types";

const mainUseOptions: MainUse[] = [
  "Gaming",
  "Gaming + Streaming",
  "Work",
  "Editing",
  "Mixed use",
];
const resolutionOptions: Resolution[] = ["1080p", "1440p", "4K", "Not sure"];
const fpsOptions: TargetFps[] = [
  "60 FPS",
  "120+ FPS",
  "144+ FPS",
  "240+ FPS",
  "Not sure",
];
const cpuOptions: CpuPreference[] = ["AMD", "Intel", "No preference"];
const gpuOptions: GpuPreference[] = ["NVIDIA", "AMD", "No preference"];
const storageOptions: StorageOption[] = [
  "1TB",
  "2TB",
  "More than 2TB",
  "Not sure",
];
const colorOptions: BuildColor[] = ["Black", "White", "Other", "No preference"];
const rgbOptions: RgbPreference[] = ["Yes", "No", "Minimal"];
const wifiOptions: WifiPreference[] = ["Required", "Not required", "Not sure"];
const monitorOptions: MonitorPreference[] = [
  "I already have one",
  "I need a monitor",
];
const accessoryOptions: Accessory[] = ["Keyboard", "Mouse", "Headset"];

const initialData: QuoteFormData = {
  fullName: "",
  mobile: "",
  email: "",
  budgetQar: "",
  mainUse: "",
  games: "",
  resolution: "",
  targetFps: "",
  cpuPreference: "",
  gpuPreference: "",
  storage: "",
  buildColor: "",
  rgb: "",
  wifi: "",
  monitor: "",
  accessories: [],
  additionalRequirements: "",
};

export function QuoteForm() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<QuoteFormData>(initialData);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const reference = searchParams.get("reference");
    const category = searchParams.get("category");

    if (reference || category) {
      setData((prev) => ({
        ...prev,
        referenceBuild: reference ?? undefined,
        additionalRequirements: category
          ? `Interested in: ${category}${
              prev.additionalRequirements ? `\n${prev.additionalRequirements}` : ""
            }`
          : prev.additionalRequirements,
      }));
    }
    // Only run once on mount — intentionally not reacting to further param changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update<K extends keyof QuoteFormData>(key: K, value: QuoteFormData[K]) {
    setData((prev) => ({ ...prev, [key]: value }));
  }

  function toggleAccessory(accessory: Accessory) {
    setData((prev) => {
      const has = prev.accessories.includes(accessory);
      return {
        ...prev,
        accessories: has
          ? prev.accessories.filter((a) => a !== accessory)
          : [...prev.accessories, accessory],
      };
    });
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // "Main use" is a custom pill group, not a native form control, so the
    // browser's built-in `required` validation (which already covers Full
    // name / Mobile / Budget) can't catch it — check it explicitly.
    if (!data.fullName.trim() || !data.mobile.trim() || !data.budgetQar.trim()) {
      setError("Please fill in your name, mobile number and budget.");
      return;
    }
    if (!data.mainUse) {
      setError("Please select a main use for the PC.");
      return;
    }

    const message = buildQuoteMessage(data);
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
              value={data.fullName}
              onChange={(e) => update("fullName", e.target.value)}
              autoComplete="name"
            />
          </FieldWrapper>
          <FieldWrapper label="Mobile / WhatsApp" htmlFor="mobile" required>
            <TextInput
              id="mobile"
              type="tel"
              required
              placeholder="e.g. 5xxxxxxx"
              value={data.mobile}
              onChange={(e) => update("mobile", e.target.value)}
              autoComplete="tel"
            />
          </FieldWrapper>
        </div>
        <FieldWrapper label="Email" htmlFor="email">
          <TextInput
            id="email"
            type="email"
            value={data.email}
            onChange={(e) => update("email", e.target.value)}
            autoComplete="email"
          />
        </FieldWrapper>
      </fieldset>

      {/* Budget */}
      <fieldset className="flex flex-col gap-5">
        <legend className="font-display text-lg font-semibold text-text-primary">
          Budget
        </legend>
        <FieldWrapper label="Budget in QAR" htmlFor="budget" required>
          <TextInput
            id="budget"
            inputMode="numeric"
            required
            placeholder="e.g. 5000"
            value={data.budgetQar}
            onChange={(e) => update("budgetQar", e.target.value)}
          />
        </FieldWrapper>
      </fieldset>

      {/* Usage */}
      <fieldset className="flex flex-col gap-6">
        <legend className="font-display text-lg font-semibold text-text-primary">
          Usage &amp; performance
        </legend>

        <FieldWrapper label="Main use" required>
          <PillOptionGroup
            name="Main use"
            options={mainUseOptions}
            value={data.mainUse}
            onChange={(v) => update("mainUse", v)}
          />
        </FieldWrapper>

        <FieldWrapper
          label="Games you play"
          htmlFor="games"
          hint="List the games you play most, if any."
        >
          <TextInput
            id="games"
            value={data.games}
            onChange={(e) => update("games", e.target.value)}
          />
        </FieldWrapper>

        <FieldWrapper label="Resolution">
          <PillOptionGroup
            name="Resolution"
            options={resolutionOptions}
            value={data.resolution}
            onChange={(v) => update("resolution", v)}
          />
        </FieldWrapper>

        <FieldWrapper label="Target FPS">
          <PillOptionGroup
            name="Target FPS"
            options={fpsOptions}
            value={data.targetFps}
            onChange={(v) => update("targetFps", v)}
          />
        </FieldWrapper>
      </fieldset>

      {/* Component preferences */}
      <fieldset className="flex flex-col gap-6">
        <legend className="font-display text-lg font-semibold text-text-primary">
          Component preferences
        </legend>

        <FieldWrapper label="CPU preference">
          <PillOptionGroup
            name="CPU preference"
            options={cpuOptions}
            value={data.cpuPreference}
            onChange={(v) => update("cpuPreference", v)}
          />
        </FieldWrapper>

        <FieldWrapper label="GPU preference">
          <PillOptionGroup
            name="GPU preference"
            options={gpuOptions}
            value={data.gpuPreference}
            onChange={(v) => update("gpuPreference", v)}
          />
        </FieldWrapper>

        <FieldWrapper label="Storage">
          <PillOptionGroup
            name="Storage"
            options={storageOptions}
            value={data.storage}
            onChange={(v) => update("storage", v)}
          />
        </FieldWrapper>
      </fieldset>

      {/* Look & feel */}
      <fieldset className="flex flex-col gap-6">
        <legend className="font-display text-lg font-semibold text-text-primary">
          Look &amp; connectivity
        </legend>

        <FieldWrapper label="Build color">
          <PillOptionGroup
            name="Build color"
            options={colorOptions}
            value={data.buildColor}
            onChange={(v) => update("buildColor", v)}
          />
        </FieldWrapper>

        <FieldWrapper label="RGB lighting">
          <PillOptionGroup
            name="RGB"
            options={rgbOptions}
            value={data.rgb}
            onChange={(v) => update("rgb", v)}
          />
        </FieldWrapper>

        <FieldWrapper label="Wi-Fi">
          <PillOptionGroup
            name="Wi-Fi"
            options={wifiOptions}
            value={data.wifi}
            onChange={(v) => update("wifi", v)}
          />
        </FieldWrapper>

        <FieldWrapper label="Monitor">
          <PillOptionGroup
            name="Monitor"
            options={monitorOptions}
            value={data.monitor}
            onChange={(v) => update("monitor", v)}
          />
        </FieldWrapper>

        <FieldWrapper label="Accessories">
          <MultiPillOptionGroup
            name="Accessories"
            options={accessoryOptions}
            values={data.accessories}
            onToggle={toggleAccessory}
          />
        </FieldWrapper>
      </fieldset>

      {/* Additional requirements */}
      <fieldset className="flex flex-col gap-5">
        <legend className="font-display text-lg font-semibold text-text-primary">
          Anything else?
        </legend>
        <FieldWrapper label="Additional requirements" htmlFor="additional">
          <TextArea
            id="additional"
            rows={5}
            value={data.additionalRequirements}
            onChange={(e) => update("additionalRequirements", e.target.value)}
          />
        </FieldWrapper>
      </fieldset>

      <div className="flex flex-col gap-4 border-t border-border pt-6">
        <p className="text-xs text-text-muted">
          Submitting this form does not place an order or require payment. M1
          will review your requirements and contact you with a proposed
          configuration and current quotation.
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
