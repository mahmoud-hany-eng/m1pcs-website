"use client";

/**
 * The admin forms. They post to server actions and show what comes back. They hold no session, no database
 * connection, no role and no id that was not rendered for them by a server page: the browser sends only what the person
 * typed (and the ids of records the page showed), and the server decides everything else, including who they are.
 */
import { useActionState, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { formatQar, parseQarToMinor } from "@/lib/platform/money";
import {
  addOrderCostAction,
  adoptWorkflowAction,
  createCustomerAction,
  createOrderAction,
  editOrderCostAction,
  issueClaimCodeAction,
  previewDepositAction,
  publishTrackingAction,
  publishTrackingCorrectionAction,
  recordPaymentAction,
  retractTrackingAction,
  reversePaymentAction,
  revokeClaimCodeAction,
  setCostsCompleteAction,
  setDepositScheduleAction,
  setFulfillmentTypeAction,
  transitionOrderAction,
  verifyCompletionAction,
  voidOrderCostAction,
} from "@/lib/staff/actions";
import { enrolTotpAction, verifyTotpAction } from "@/lib/staff/mfa-actions";
import { safeAdminHref, staffIdleState, type StaffFormState } from "@/lib/staff/form-state";
import { NEW_ORDER_ITEM_KINDS, MAX_ORDER_ITEMS, CLAIM_CODE_HOURS, MAX_DEPOSIT_TIERS } from "@/lib/staff/validation";
import { ageText, percentLabel, plainAmount } from "@/lib/staff/format";
import { COST_CATEGORIES, COST_KINDS, MAX_NEW_ORDER_COSTS } from "@/lib/staff/finance";
import { EMPTY_PRICING_FORM, derivePricingView, type DiscountMode, type PricingContextView, type PricingFormState, type PricingView } from "@/lib/staff/pricing-form";
import { TYPE_LABEL, fulfillmentLabel } from "@/lib/workflow/labels";
import type { AdoptionOption, FulfillmentType, NextStatus } from "@/lib/workflow/types";
import { useIdempotencyKey } from "./use-idempotency-key";
import { Notice } from "@/components/account/ui";

type Action = (previous: StaffFormState, formData: FormData) => Promise<StaffFormState>;

/**
 * A successful create opens the new record with a full page load. The dashboard changes shape when a record appears
 * (new totals, new rows), and a clean load is the dependable choice after a server action: in the browser tests
 * Next 15.5's in-app navigation right after a server action sometimes did not complete.
 */
function useStaffForm(action: Action): [StaffFormState, (formData: FormData) => void, boolean] {
  const [state, formAction, pending] = useActionState(action, staffIdleState);
  const href = state.status === "success" ? safeAdminHref(state.href) : null;
  useEffect(() => {
    if (href) window.location.assign(href);
  }, [href]);
  return [state, formAction, pending];
}

const errorOf = (state: StaffFormState, name: string): string | undefined => (state.status === "error" ? state.fieldErrors?.[name] : undefined);
/** What was typed before an error: React clears an uncontrolled form after every submit, so the server hands the text back. */
const echoed = (state: StaffFormState, name: string): string | undefined => (state.status === "error" ? state.values?.[name] : undefined);

function Feedback({ state }: { state: StaffFormState }) {
  if (state.status === "error" && state.message) return <Notice tone="error">{state.message}</Notice>;
  if (state.status === "success") return <Notice tone="success">{state.message}</Notice>;
  return null;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs text-error">
      {message}
    </p>
  );
}

function Field({ id, label, hint, error, children, required }: { id: string; label: string; hint?: string; error?: string; children: ReactNode; required?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-white/90">
        {label}
        {required ? <span className="text-primary"> *</span> : null}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-text-muted">{hint}</p> : null}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

const inputClass = "glass-input min-h-[2.75rem] w-full px-3.5 py-2 text-sm";

function Input({ state, name, id, ...rest }: { state: StaffFormState; name: string; id: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  // A controlled input (it has `value`) keeps its own text; the others take it back from the server after an error.
  const kept = rest.value === undefined ? { defaultValue: echoed(state, name) ?? rest.defaultValue } : {};
  return <input id={id} name={name} aria-invalid={Boolean(errorOf(state, name))} aria-describedby={`${id}-error`} className={inputClass} {...rest} {...kept} />;
}

function Select({ state, name, id, children, ...rest }: { state: StaffFormState; name: string; id: string; children: ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const kept = rest.value === undefined ? { defaultValue: echoed(state, name) ?? rest.defaultValue } : {};
  // React does not move a <select>'s selected option when its defaultValue changes, so the element is re-created when the
  // value the server handed back changes: that is what puts the person's choice back after the form was cleared.
  return (
    <select key={`${name}:${echoed(state, name) ?? ""}`} id={id} name={name} aria-invalid={Boolean(errorOf(state, name))} aria-describedby={`${id}-error`} className={`${inputClass} cursor-pointer`} {...rest} {...kept}>
      {children}
    </select>
  );
}

function Check({ state, name, id, children }: { state: StaffFormState; name: string; id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex items-start gap-2.5 text-sm text-text-secondary">
        <input id={id} type="checkbox" name={name} value="yes" defaultChecked={echoed(state, name) === "yes"} aria-invalid={Boolean(errorOf(state, name))} aria-describedby={`${id}-error`} className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--color-primary))]" />
        <span>{children}</span>
      </label>
      <FieldError id={`${id}-error`} message={errorOf(state, name)} />
    </div>
  );
}

function Submit({ pending, children, tone = "red", pendingLabel = "Saving…", disabled = false }: { pending: boolean; children: ReactNode; tone?: "red" | "glass" | "danger"; pendingLabel?: string; disabled?: boolean }) {
  const style = tone === "red" ? "btn-red" : tone === "danger" ? "btn-glass !border-error/50 !text-error" : "btn-glass";
  return (
    <button type="submit" disabled={pending || disabled} aria-busy={pending} className={`btn-sheen ${style} inline-flex min-h-[2.75rem] items-center justify-center rounded-full px-6 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60`}>
      {pending ? pendingLabel : children}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------------------------------------------

export function CustomerForm() {
  const [state, action, pending] = useStaffForm(createCustomerAction);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Feedback state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="c-name" label="Full name" required error={errorOf(state, "full_name")}>
          <Input state={state} id="c-name" name="full_name" autoComplete="off" maxLength={120} required />
        </Field>
        <Field id="c-source" label="Where did they come from?" error={errorOf(state, "source")}>
          <Select state={state} id="c-source" name="source" defaultValue="whatsapp">
            <option value="whatsapp">WhatsApp</option>
            <option value="instagram">Instagram</option>
            <option value="walk_in">Walk-in</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field id="c-phone" label="Phone (WhatsApp)" hint="Digits, spaces, + or brackets." error={errorOf(state, "phone")}>
          <Input state={state} id="c-phone" name="phone" type="tel" inputMode="tel" autoComplete="off" maxLength={24} />
        </Field>
        <Field id="c-email" label="Email" error={errorOf(state, "email")}>
          <Input state={state} id="c-email" name="email" type="email" inputMode="email" autoComplete="off" maxLength={254} />
        </Field>
        <Field id="c-lang" label="Language" error={errorOf(state, "preferred_language")}>
          <Select state={state} id="c-lang" name="preferred_language" defaultValue="en">
            <option value="en">English</option>
            <option value="ar">Arabic</option>
          </Select>
        </Field>
        <Field id="c-address" label="Delivery address" error={errorOf(state, "delivery_address")}>
          <Input state={state} id="c-address" name="delivery_address" autoComplete="off" maxLength={500} />
        </Field>
      </div>
      <p className="text-xs text-text-muted">This creates a customer record only. It is never linked to a website account by matching an email address or phone number; the customer links it themselves with a claim code you issue.</p>
      <div>
        <Submit pending={pending}>Create customer</Submit>
      </div>
    </form>
  );
}

export function IssueClaimCodeForm({ customerId }: { customerId: string }) {
  const [state, action, pending] = useStaffForm(issueClaimCodeAction);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="customer_id" value={customerId} />
      {state.status === "success" && state.secret ? (
        <div role="status" className="rounded-glass-sm border border-accent/40 bg-accent/10 p-4">
          <p className="text-sm text-white/90">{state.message}</p>
          <p className="mt-2 break-all font-mono text-xl font-semibold tracking-wider text-accent select-all" data-testid="claim-code">
            {state.secret}
          </p>
          <p className="mt-2 text-xs text-text-muted">It is shown only now. Only a one-way hash is stored, so it cannot be shown again.</p>
        </div>
      ) : (
        <Feedback state={state} />
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Field id="cc-hours" label="Valid for" error={errorOf(state, "hours")}>
          <Select state={state} id="cc-hours" name="hours" defaultValue="72">
            {CLAIM_CODE_HOURS.map((h) => (
              <option key={h} value={h}>
                {h === 24 ? "24 hours" : h === 72 ? "3 days" : "7 days"}
              </option>
            ))}
          </Select>
        </Field>
        <Submit pending={pending} tone="glass" pendingLabel="Issuing…">
          Issue a claim code
        </Submit>
      </div>
    </form>
  );
}

export function RevokeClaimCodeForm({ customerId, codeId }: { customerId: string; codeId: string }) {
  const [state, action, pending] = useStaffForm(revokeClaimCodeAction);
  return (
    <details className="group">
      <summary className="cursor-pointer text-xs font-semibold text-text-secondary hover:text-error">Revoke</summary>
      <form action={action} className="mt-2 flex flex-col gap-2" noValidate>
        <input type="hidden" name="customer_id" value={customerId} />
        <input type="hidden" name="code_id" value={codeId} />
        <Feedback state={state} />
        <Field id={`rv-${codeId}`} label="Reason" error={errorOf(state, "reason")}>
          <Input state={state} id={`rv-${codeId}`} name="reason" maxLength={500} required />
        </Field>
        <div>
          <Submit pending={pending} tone="danger" pendingLabel="Revoking…">
            Revoke code
          </Submit>
        </div>
      </form>
    </details>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------------------------------------------

interface Row {
  id: number;
  kind: string;
  description: string;
  quantity: string;
  price: string;
}

const KIND_LABEL: Record<string, string> = { component: "Component", build_service: "Build service", delivery: "Delivery", discount: "Discount", other: "Other" };

/** Works out a row's line total in minor units, or null while it is incomplete. The server works it out again. A price is never negative. */
function lineMinor(row: Row): number | null {
  const minor = parseQarToMinor(row.price.trim());
  if (minor === null || !/^[0-9]{1,4}$/.test(row.quantity.trim() || "1")) return null;
  return minor * Number(row.quantity.trim() || "1");
}

/**
 * The duplicate-order warning: evidence plus an override. Nothing was created. A customer can legitimately buy the same thing
 * twice, so ticking the box and sending the form again always creates the order.
 */
function DuplicateOrderWarning({ state }: { state: StaffFormState }) {
  const duplicates = state.status === "error" ? (state.duplicates ?? []) : [];
  return (
    <div className="flex flex-col gap-3 rounded-glass-sm border border-warning/40 bg-warning/5 p-3" data-testid="duplicate-warning">
      <ul className="flex flex-col gap-1 text-sm text-text-secondary">
        {duplicates.map((d) => {
          const href = safeAdminHref(`/admin/orders/${d.id}`);
          return (
            <li key={d.id}>
              {href ? (
                <a href={href} className="font-semibold text-white underline" target="_blank" rel="noopener noreferrer">
                  {d.ref}
                </a>
              ) : (
                <span className="font-semibold text-white">{d.ref}</span>
              )}{" "}
              · {formatQar(d.totalMinor)} · {d.status.replaceAll("_", " ")} · created {ageText(d.createdAt)}
            </li>
          );
        })}
      </ul>
      <Check state={state} name="confirm_duplicate" id="o-confirm-duplicate">
        This customer really wants another order with these items. Create it anyway.
      </Check>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Pricing & Rewards: the discount, the loyalty points and the summary of what the customer pays
// ---------------------------------------------------------------------------------------------------------------

const fmt = (minor: number): string => formatQar(minor);

function SummaryRow({ label, value, note, testId, emphasis = false }: { label: string; value: string; note?: string; testId: string; emphasis?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-2.5 ${emphasis ? "border-t border-primary/40" : ""}`}>
      <dt className="min-w-0 text-sm text-text-secondary">
        <span className={emphasis ? "font-semibold text-white" : undefined}>{label}</span>
        {note ? <span className="mt-0.5 block text-xs text-text-muted">{note}</span> : null}
      </dt>
      <dd className={`shrink-0 text-right tabular-nums ${emphasis ? "font-display text-xl font-semibold text-white" : "text-sm text-white"}`} data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

/**
 * The money of an order, in the order the owner described it: the original total, the discount, the loyalty points, then the final amount
 * payable, the required deposit and what is left to pay after it. Everything is worked out as it is typed; the database works it out again
 * and refuses the order if it disagrees with what is shown here.
 */
function PricingRewardsSection({
  state, gross, context, form, setForm, view,
}: {
  state: StaffFormState;
  gross: number | null;
  context: PricingContextView;
  form: PricingFormState;
  setForm: (patch: Partial<PricingFormState>) => void;
  view: PricingView;
}) {
  const figures = view.figures;
  const problem = view.result && !view.result.ok ? view.result : null;
  const maxPoints = figures?.maxPoints ?? 0;
  const pointValue = context.pointValueMinor ?? 0;
  const discountAmount = figures?.discountMinor ?? 0;
  const mode = form.discountMode;
  return (
    <section aria-labelledby="pricing-heading" data-testid="pricing-rewards" className="flex flex-col gap-5 rounded-glass border border-primary/30 bg-white/[0.03] p-4 sm:p-5">
      <div>
        <h3 id="pricing-heading" className="font-display text-lg font-semibold text-white">
          Pricing &amp; Rewards
        </h3>
        <p className="mt-1 text-xs text-text-muted">The deposit is always worked out from the original order total. A discount or redeemed points never lower it.</p>
      </div>

      <div className="flex flex-col gap-3" data-testid="pricing-discount-block">
        <h4 className="text-sm font-semibold text-white">Discount</h4>
        {view.discountLocked ? (
          <p className="text-sm text-text-muted" data-testid="discount-locked">
            {view.discountLocked}
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
              <Field id="pr-mode" label="Type">
                <select
                  id="pr-mode"
                  name="discount_mode"
                  value={mode === "none" ? "" : mode}
                  onChange={(e) => setForm({ discountMode: (e.target.value || "none") as DiscountMode })}
                  className={`${inputClass} cursor-pointer`}
                >
                  <option value="">No discount</option>
                  <option value="fixed">Fixed amount (QAR)</option>
                  <option value="percent">Percentage (%)</option>
                </select>
              </Field>
              {mode === "fixed" ? (
                <Field id="pr-amount" label="Discount amount (QAR)" error={view.discountError ?? errorOf(state, "discount_amount")}>
                  <Input state={state} id="pr-amount" name="discount_amount" inputMode="decimal" placeholder="0.00" value={form.discountAmount} onChange={(e) => setForm({ discountAmount: e.target.value })} maxLength={16} />
                </Field>
              ) : null}
              {mode === "percent" ? (
                <Field id="pr-percent" label="Discount percentage" hint="From 0.01 to 100." error={view.discountError ?? errorOf(state, "discount_percent")}>
                  <Input state={state} id="pr-percent" name="discount_percent" inputMode="decimal" placeholder="0" value={form.discountPercent} onChange={(e) => setForm({ discountPercent: e.target.value })} maxLength={6} />
                </Field>
              ) : null}
            </div>
            {mode !== "none" ? (
              <>
                <Field id="pr-reason" label="Reason for the discount" hint="Kept with the record of who authorized it." error={view.reasonError ?? errorOf(state, "discount_reason")}>
                  <Input state={state} id="pr-reason" name="discount_reason" value={form.discountReason} onChange={(e) => setForm({ discountReason: e.target.value })} maxLength={500} />
                </Field>
                <p className="text-sm text-text-secondary" aria-live="polite">
                  Amount taken off: <span className="font-semibold text-white tabular-nums" data-testid="discount-amount">{discountAmount > 0 ? fmt(discountAmount) : "—"}</span>
                </p>
              </>
            ) : null}
          </>
        )}
      </div>

      <div className="flex flex-col gap-3" data-testid="pricing-loyalty-block">
        <h4 className="text-sm font-semibold text-white">Loyalty points</h4>
        {view.pointsAvailable !== null ? (
          <p className="text-sm text-text-secondary" data-testid="points-available">
            Available: <span className="font-semibold text-white tabular-nums">{view.pointsAvailable.toLocaleString("en-US")} points</span>
            {view.pointsAvailableMinor !== null && pointValue > 0 ? <> (worth {fmt(view.pointsAvailableMinor)}; 1 point = {fmt(pointValue)})</> : null}
          </p>
        ) : null}
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={form.redeemOn}
            aria-labelledby="pr-redeem-label"
            data-testid="redeem-toggle"
            disabled={view.redeemLocked !== null}
            onClick={() => setForm({ redeemOn: !form.redeemOn, points: "" })}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${form.redeemOn && view.redeemLocked === null ? "border-primary bg-primary" : "border-border-strong bg-white/10"}`}
          >
            <span aria-hidden="true" className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${form.redeemOn && view.redeemLocked === null ? "translate-x-6" : "translate-x-1"}`} />
          </button>
          <span id="pr-redeem-label" className={`text-sm font-medium ${view.redeemLocked ? "text-text-muted" : "text-white"}`}>
            Redeem loyalty points
          </span>
        </div>
        {view.redeemLocked ? (
          <p className="text-sm text-text-muted" data-testid="redeem-locked">
            {view.redeemLocked}
          </p>
        ) : null}
        {form.redeemOn && view.redeemLocked === null ? (
          <>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field
                id="pr-points"
                label="Points to redeem"
                hint={`Up to ${maxPoints.toLocaleString("en-US")} points on this order (${fmt(maxPoints * pointValue)}). Never more than the balance, or than what is left to pay after the discount.`}
                error={view.pointsError ?? errorOf(state, "redeem_points")}
              >
                <Input state={state} id="pr-points" name="redeem_points" inputMode="numeric" value={form.points} onChange={(e) => setForm({ points: e.target.value.replace(/[^0-9]/g, "") })} maxLength={9} />
              </Field>
              <button
                type="button"
                data-testid="use-max"
                disabled={maxPoints < 1}
                onClick={() => setForm({ points: String(maxPoints) })}
                className="btn-sheen btn-glass inline-flex min-h-[2.75rem] items-center justify-center rounded-full px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
              >
                Use Maximum
              </button>
            </div>
            {figures && figures.pointsRedeemed > 0 ? (
              <p className="text-sm text-text-secondary" aria-live="polite" data-testid="points-after">
                Credit applied: <span className="font-semibold text-white tabular-nums">{fmt(figures.creditMinor)}</span> · Points left after redemption:{" "}
                <span className="font-semibold text-white tabular-nums">{Math.max(figures.pointsBalanceAfter, 0).toLocaleString("en-US")}</span>
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="flex flex-col gap-1 rounded-glass-sm border border-border bg-black/20 p-3 sm:p-4" data-testid="pricing-summary">
        <h4 className="text-sm font-semibold text-white">Summary</h4>
        {gross === null || gross <= 0 || !figures ? (
          <p className="text-sm text-text-muted" data-testid="pricing-empty">
            {gross !== null && gross > 0 ? "The deposit schedule has not been set by the owner, so this order cannot be priced yet." : "Add priced items to see the summary."}
          </p>
        ) : (
          <dl className="divide-y divide-white/10">
            <SummaryRow testId="pricing-gross" label="Original order total" value={fmt(figures.grossMinor)} />
            <SummaryRow testId="pricing-discount" label="Discount" value={figures.discountMinor > 0 ? `− ${fmt(figures.discountMinor)}` : "None"} />
            <SummaryRow
              testId="pricing-credit"
              label={figures.pointsRedeemed > 0 ? `Loyalty credit (${figures.pointsRedeemed.toLocaleString("en-US")} points)` : "Loyalty credit"}
              value={figures.creditMinor > 0 ? `− ${fmt(figures.creditMinor)}` : "None"}
              note={figures.creditMinor > 0 ? "A credit on this order, not a payment." : undefined}
            />
            <SummaryRow testId="pricing-net" label="Final amount payable" value={fmt(figures.netPayableMinor)} emphasis />
            <SummaryRow
              testId="pricing-deposit"
              label="Required deposit"
              value={fmt(figures.depositMinor)}
              note={`${figures.depositRateBps !== null ? percentLabel(figures.depositRateBps) : "A fixed amount"} of the original order total${figures.depositTier ? ` (tier ${figures.depositTier})` : ""}. Not reduced by the discount or by points.`}
            />
            <SummaryRow testId="pricing-after-deposit" label="Remaining balance after deposit" value={fmt(figures.cashBalanceAfterDepositMinor)} note="Cash or Fawran still to pay once the deposit is paid." />
            {view.pointsToEarn !== null ? (
              <SummaryRow testId="pricing-earn" label="Points earned when completed and paid in full" value={view.pointsToEarn.toLocaleString("en-US")} note="On the final amount payable only, never on discounted or credited money." />
            ) : null}
          </dl>
        )}
      </div>

      {problem ? (
        <div role="alert" data-testid="pricing-problem" className="rounded-glass-sm border border-error/50 bg-error/10 p-3 text-sm text-error">
          {problem.code === "net_below_deposit" ? <p className="mb-1 font-semibold">Owner decision needed</p> : null}
          <p>{problem.problem}</p>
          {problem.code === "net_below_deposit" && figures && figures.maxPointsKeepingDeposit < figures.pointsRedeemed ? (
            <p className="mt-2 text-text-secondary">
              To keep the deposit payable in cash, redeem at most {figures.maxPointsKeepingDeposit.toLocaleString("en-US")} points ({fmt(figures.maxPointsKeepingDeposit * pointValue)}) with this discount.
            </p>
          ) : null}
        </div>
      ) : null}

      <input type="hidden" name="expected_net_minor" value={view.expectedNet} />
      <input type="hidden" name="expected_deposit_minor" value={view.expectedDeposit} />
    </section>
  );
}

export function OrderForm({ customerId, customerName, idempotencyKey, pricing, canManageCosts = false }: { customerId: string; customerName: string; idempotencyKey: string; pricing: PricingContextView; canManageCosts?: boolean }) {
  const [state, action, pending] = useStaffForm(createOrderAction);
  // An order has no balance to bind the key to: the customer is part of the scope, and the items are part of the request.
  const key = useIdempotencyKey(`order:${customerId}`, idempotencyKey, "", state);
  // After the order was created the form is locked until the browser opens it: nothing may be sent twice in that moment.
  const created = state.status === "success";
  const [rows, setRows] = useState<Row[]>([{ id: 1, kind: "component", description: "", quantity: "1", price: "" }]);
  const [nextId, setNextId] = useState(2);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewing, startPreview] = useTransition();
  const [pricingForm, setPricingForm] = useState<PricingFormState>(EMPTY_PRICING_FORM);

  const total = useMemo(() => {
    let sum = 0;
    for (const row of rows) {
      if (row.description.trim() === "" && row.price.trim() === "") continue;
      const line = lineMinor(row);
      if (line === null) return null;
      sum += line;
    }
    return sum;
  }, [rows]);

  // Everything the Pricing & Rewards section shows, worked out from the items and what has been typed in it. A change of any input works the
  // figures out again at once; a customer is fixed for the life of this form (a different customer is a different page, with its own balance).
  const pricingView = useMemo(() => derivePricingView(pricingForm, total, pricing), [pricingForm, total, pricing]);
  const patchPricing = (patch: Partial<PricingFormState>) => setPricingForm((current) => ({ ...current, ...patch }));

  const update = (id: number, patch: Partial<Row>) => {
    setPreview(null);
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  return (
    <form action={action} className="flex flex-col gap-5" noValidate data-created={created ? "yes" : undefined}>
      <fieldset disabled={created} className="contents">
      <input type="hidden" name="customer_id" value={customerId} />
      <input type="hidden" name="idempotency_key" value={key} />
      <Feedback state={state} />
      {errorOf(state, "items") ? <Notice tone="error">{errorOf(state, "items")}</Notice> : null}
      <p className="text-sm text-text-secondary">
        Customer: <span className="font-semibold text-white">{customerName}</span>
      </p>

      <ol className="flex flex-col gap-3" aria-label="Order items">
        {rows.map((row, index) => (
          <li key={row.id} className="rounded-glass-sm border border-border bg-white/[0.025] p-3 sm:p-4">
            <div className="grid gap-3 sm:grid-cols-[9rem_1fr_5rem_9rem_auto] sm:items-end">
              <Field id={`i-kind-${row.id}`} label="Type" error={errorOf(state, `item_kind_${index}`)}>
                <Select state={state} id={`i-kind-${row.id}`} name={`item_kind_${index}`} value={row.kind} onChange={(e) => update(row.id, { kind: e.target.value })}>
                  {NEW_ORDER_ITEM_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id={`i-desc-${row.id}`} label="Description" error={errorOf(state, `item_description_${index}`)}>
                <Input state={state} id={`i-desc-${row.id}`} name={`item_description_${index}`} value={row.description} onChange={(e) => update(row.id, { description: e.target.value })} maxLength={200} />
              </Field>
              <Field id={`i-qty-${row.id}`} label="Qty" error={errorOf(state, `item_quantity_${index}`)}>
                <Input state={state} id={`i-qty-${row.id}`} name={`item_quantity_${index}`} inputMode="numeric" value={row.quantity} onChange={(e) => update(row.id, { quantity: e.target.value })} maxLength={4} />
              </Field>
              <Field id={`i-price-${row.id}`} label="Unit price (QAR)" error={errorOf(state, `item_price_${index}`)}>
                <Input state={state} id={`i-price-${row.id}`} name={`item_price_${index}`} inputMode="decimal" placeholder="0.00" value={row.price} onChange={(e) => update(row.id, { price: e.target.value })} maxLength={16} />
              </Field>
              <div className="flex items-end justify-between gap-3 sm:justify-end">
                <span className="text-xs text-text-muted sm:hidden">Line</span>
                <span className="min-w-[6rem] text-right text-sm tabular-nums text-text-secondary">{lineMinor(row) === null ? "—" : formatQar(lineMinor(row) as number)}</span>
                <button
                  type="button"
                  onClick={() => {
                    setPreview(null);
                    setRows((current) => (current.length > 1 ? current.filter((r) => r.id !== row.id) : current));
                  }}
                  disabled={rows.length === 1}
                  aria-label={`Remove item ${index + 1}`}
                  className="rounded-full border border-border-strong px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-error disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => {
            if (rows.length >= MAX_ORDER_ITEMS) return;
            setRows((current) => [...current, { id: nextId, kind: "component", description: "", quantity: "1", price: "" }]);
            setNextId((n) => n + 1);
          }}
          disabled={rows.length >= MAX_ORDER_ITEMS}
          className="btn-sheen btn-glass inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          Add an item
        </button>
        <p className="text-sm text-text-secondary">
          Order total: <span className="font-display text-lg font-semibold text-white tabular-nums" data-testid="order-total">{total === null ? "—" : formatQar(total)}</span>
        </p>
      </div>

      <PricingRewardsSection state={state} gross={total} context={pricing} form={pricingForm} setForm={patchPricing} view={pricingView} />

      {canManageCosts ? <NewOrderCostsSection state={state} /> : null}

      <div className="flex flex-wrap items-center gap-3 rounded-glass-sm border border-border bg-white/[0.025] p-3 text-sm">
        <button
          type="button"
          disabled={previewing || total === null || total <= 0}
          onClick={() =>
            startPreview(async () => {
              const result = await previewDepositAction(total as number);
              setPreview(result.message);
            })
          }
          className="btn-sheen btn-glass inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          {previewing ? "Working it out…" : "Check the deposit"}
        </button>
        <span aria-live="polite" className="min-w-0 text-text-secondary" data-testid="deposit-preview">
          {preview ?? "Asks the server for the deposit on the original total. It is fixed, once, when the order is confirmed."}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="o-delivery" label="Delivery or collection" error={errorOf(state, "delivery_method")}>
          <Select state={state} id="o-delivery" name="delivery_method" defaultValue="">
            <option value="">Not decided yet</option>
            <option value="delivery">Delivery</option>
            <option value="collection">Collection</option>
          </Select>
        </Field>
        <Field id="o-address" label="Delivery address" error={errorOf(state, "delivery_address")}>
          <Input state={state} id="o-address" name="delivery_address" maxLength={500} />
        </Field>
      </div>

      <Check state={state} name="prices_verified" id="o-verified">
        I have checked every price against the current supplier price and the customer&apos;s agreed quotation.
      </Check>
      {state.status === "error" && state.duplicates?.length ? <DuplicateOrderWarning state={state} /> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Submit pending={pending} disabled={created || !pricingView.canSubmit} pendingLabel="Creating…">
          {created ? "Order created" : "Create order"}
        </Submit>
        {!created && pricingView.submitHint ? (
          <p className="min-w-0 text-sm text-text-muted" data-testid="submit-hint">
            {pricingView.submitHint}
          </p>
        ) : null}
      </div>
      </fieldset>
    </form>
  );
}

export function TransitionForm({ orderId, next }: { orderId: string; next: NextStatus[] }) {
  const [state, action, pending] = useStaffForm(transitionOrderAction);
  // Only moves that can be made right now are offered. A move that is valid but not available yet (for example Deposit confirmed
  // before the deposit is recorded) is listed below with the reason, so the person knows what is missing; it cannot be chosen.
  const ready = next.filter((n) => !n.blocked_reason);
  const waiting = next.filter((n) => n.blocked_reason);
  if (next.length === 0) return <p className="text-sm text-text-muted">This order is in a final state. No further status change is possible.</p>;
  return (
    <form action={action} className="flex flex-col gap-3" noValidate data-testid="transition-form">
      <input type="hidden" name="order_id" value={orderId} />
      <Feedback state={state} />
      {ready.length > 0 ? (
        <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
          <Field id="t-status" label="Move to" error={errorOf(state, "to_status")}>
            <Select state={state} id="t-status" name="to_status" defaultValue={ready[0].code}>
              {ready.map((n) => (
                <option key={n.code} value={n.code}>
                  {n.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="t-reason" label="Reason (optional)" error={errorOf(state, "reason")}>
            <Input state={state} id="t-reason" name="reason" maxLength={500} />
          </Field>
          <Submit pending={pending} pendingLabel="Updating…">
            Update status
          </Submit>
        </div>
      ) : (
        <p className="text-sm text-text-muted">No status change can be made right now.</p>
      )}
      {waiting.length > 0 ? (
        <ul className="flex flex-col gap-1.5 text-xs text-text-muted" data-testid="transition-blocked">
          {waiting.map((n) => (
            <li key={n.code}>
              <span className="font-semibold text-text-secondary">{n.label}</span> is not available yet: {n.blocked_reason}.
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

/** The fields both tracking forms share: where the shipment is, what happened and when. Nothing here is filled in for the person. */
function TrackingFields({ state, prefix }: { state: StaffFormState; prefix: string }) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`${prefix}-title`} label="Update title" error={errorOf(state, "title")}>
          <Input state={state} id={`${prefix}-title`} name="title" maxLength={120} placeholder="Departed Miami airport" />
        </Field>
        <Field id={`${prefix}-location`} label="Shipment location (optional)" error={errorOf(state, "location")}>
          <Input state={state} id={`${prefix}-location`} name="location" maxLength={120} placeholder="Miami, USA" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1.6fr_1fr]">
        <Field id={`${prefix}-msg`} label="Description (optional)" error={errorOf(state, "message")}>
          <Input state={state} id={`${prefix}-msg`} name="message" maxLength={1000} />
        </Field>
        <Field id={`${prefix}-when`} label="When it happened (Qatar time, optional)" error={errorOf(state, "occurred_at")}>
          <Input state={state} id={`${prefix}-when`} name="occurred_at" type="datetime-local" />
        </Field>
      </div>
    </>
  );
}

/** Open only while the order is in Live tracking (the page shows it only then; the database refuses it at any other time). */
export function TrackingForm({ orderId }: { orderId: string }) {
  const [state, action, pending] = useStaffForm(publishTrackingAction);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate data-testid="tracking-form">
      <input type="hidden" name="order_id" value={orderId} />
      <Feedback state={state} />
      <h3 className="font-display text-base font-semibold text-white">Publish a tracking update</h3>
      <TrackingFields state={state} prefix="tr" />
      <div>
        <Submit pending={pending} tone="glass" pendingLabel="Publishing…">
          Publish to customer
        </Submit>
      </div>
      <p className="text-xs text-text-muted">
        What you publish here is shown to the customer in their account, in order of when it happened. Type the place and the time yourself; nothing is filled in for you. Leave the time empty to use the moment you publish. A published update can be withdrawn but never deleted.
      </p>
    </form>
  );
}

/** Owner only, after Live tracking has ended: a reasoned, visibly marked addition. The original updates stay as they are. */
export function TrackingCorrectionForm({ orderId, corrects }: { orderId: string; corrects: { id: string; title: string }[] }) {
  const [state, action, pending] = useStaffForm(publishTrackingCorrectionAction);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate data-testid="tracking-correction-form">
      <input type="hidden" name="order_id" value={orderId} />
      <Feedback state={state} />
      <h3 className="font-display text-base font-semibold text-white">Add a correction</h3>
      <p className="text-xs text-text-muted">Live tracking has ended for this order, so a new entry is a correction: the customer sees it marked as a correction, and the reason below is kept for staff. The earlier updates are not changed.</p>
      <TrackingFields state={state} prefix="co" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="co-corrects" label="Update this corrects (optional)" error={errorOf(state, "corrects_event_id")}>
          <Select state={state} id="co-corrects" name="corrects_event_id" defaultValue="">
            <option value="">None in particular</option>
            {corrects.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="co-reason" label="Reason (kept for staff)" error={errorOf(state, "reason")}>
          <Input state={state} id="co-reason" name="reason" maxLength={500} required />
        </Field>
      </div>
      <div>
        <Submit pending={pending} tone="glass" pendingLabel="Adding…">
          Add correction
        </Submit>
      </div>
    </form>
  );
}

// (fulfillmentLabel lives in @/lib/workflow/labels: the server page needs it too, and a client module's exports cannot be called on the server.)

/** An explicit choice: nothing infers it from the items or the notes. Locked (by the page and by the database) once the order is inside its branch. */
export function FulfillmentTypeForm({ orderId, current, locked }: { orderId: string; current: FulfillmentType | null; locked: boolean }) {
  const [state, action, pending] = useStaffForm(setFulfillmentTypeAction);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate data-testid="fulfillment-form">
      <input type="hidden" name="order_id" value={orderId} />
      <Feedback state={state} />
      <p className="text-sm text-text-secondary">
        Order type: <span className="font-semibold text-white" data-testid="fulfillment-current">{fulfillmentLabel(current)}</span>
      </p>
      {current === null ? <p className="text-xs text-warning">Not chosen yet. It is required before this order can leave “Carrier delivering order to M1”.</p> : null}
      {locked ? (
        <p className="text-xs text-text-muted">The order is already inside its {current ? TYPE_LABEL[current] : ""} steps, so the type can no longer be changed.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field id="ft-type" label="Order type" error={errorOf(state, "fulfillment_type")}>
            <Select state={state} id="ft-type" name="fulfillment_type" defaultValue={current ?? ""}>
              <option value="" disabled>
                Choose…
              </option>
              <option value="custom_pc_build">{TYPE_LABEL.custom_pc_build}</option>
              <option value="parts_only">{TYPE_LABEL.parts_only}</option>
            </Select>
          </Field>
          <Submit pending={pending} tone="glass" pendingLabel="Saving…">
            Save type
          </Submit>
        </div>
      )}
    </form>
  );
}

/** Owner only, one order at a time: places an order of the earlier workflow on the current one. Its history, payments and updates are not touched. */
export function AdoptWorkflowForm({ orderId, options }: { orderId: string; options: AdoptionOption[] }) {
  const [state, action, pending] = useStaffForm(adoptWorkflowAction);
  const first = options.find((o) => o.is_default) ?? options[0];
  const [target, setTarget] = useState(first?.target_status ?? "");
  if (options.length === 0) return null;
  const chosen = options.find((o) => o.target_status === target) ?? first;
  const implied = chosen.requires_fulfillment;
  return (
    <form action={action} className="flex flex-col gap-3" noValidate data-testid="adopt-form">
      <input type="hidden" name="order_id" value={orderId} />
      <Feedback state={state} />
      <p className="text-sm text-text-secondary">
        This order is on the earlier workflow. Moving it to the current one keeps its history, payments, receipts and tracking updates exactly as they are, adds one history entry, and cannot be undone.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="ad-target" label="Place it at" error={errorOf(state, "target_status")}>
          <Select state={state} id="ad-target" name="target_status" value={target} onChange={(e) => setTarget(e.target.value)}>
            {options.map((o) => (
              <option key={o.target_status} value={o.target_status}>
                {o.label}
                {o.is_default ? " (suggested)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        {implied ? (
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">Order type</span>
            <span className="text-white">{TYPE_LABEL[implied]}</span>
            <input type="hidden" name="fulfillment_type" value={implied} />
          </div>
        ) : (
          <Field id="ad-type" label="Order type (optional)" error={errorOf(state, "fulfillment_type")}>
            <Select state={state} id="ad-type" name="fulfillment_type" defaultValue="">
              <option value="">Decide later</option>
              <option value="custom_pc_build">{TYPE_LABEL.custom_pc_build}</option>
              <option value="parts_only">{TYPE_LABEL.parts_only}</option>
            </Select>
          </Field>
        )}
      </div>
      <Field id="ad-reason" label="Reason (kept in the history)" error={errorOf(state, "reason")}>
        <Input state={state} id="ad-reason" name="reason" maxLength={500} required />
      </Field>
      <div>
        <Submit pending={pending} tone="glass" pendingLabel="Moving…">
          Move to the current workflow
        </Submit>
      </div>
    </form>
  );
}

export function RetractTrackingForm({ orderId, eventId }: { orderId: string; eventId: string }) {
  const [state, action, pending] = useStaffForm(retractTrackingAction);
  return (
    <details>
      <summary className="cursor-pointer text-xs font-semibold text-text-secondary hover:text-error">Withdraw</summary>
      <form action={action} className="mt-2 flex flex-col gap-2" noValidate>
        <input type="hidden" name="order_id" value={orderId} />
        <input type="hidden" name="event_id" value={eventId} />
        <Feedback state={state} />
        <Field id={`rt-${eventId}`} label="Reason" error={errorOf(state, "reason")}>
          <Input state={state} id={`rt-${eventId}`} name="reason" maxLength={500} required />
        </Field>
        <div>
          <Submit pending={pending} tone="danger" pendingLabel="Withdrawing…">
            Withdraw update
          </Submit>
        </div>
      </form>
    </details>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------------------------------------------

export function PaymentForm({ orderId, defaultPurpose, defaultAmount, idempotencyKey, expectedPaidMinor }: { orderId: string; defaultPurpose: "deposit" | "balance"; defaultAmount: string; idempotencyKey: string; expectedPaidMinor: number }) {
  const [state, action, pending] = useStaffForm(recordPaymentAction);
  // The key is bound to the amount already paid that this page shows: if the balance moves, the person is looking at a new
  // decision and gets a new key, so a deliberate second payment can never be mistaken for a repeat of the first.
  const key = useIdempotencyKey(`payment:${orderId}`, idempotencyKey, String(expectedPaidMinor), state);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="idempotency_key" value={key} />
      <input type="hidden" name="expected_paid_minor" value={String(expectedPaidMinor)} />
      <Feedback state={state} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="p-purpose" label="For" error={errorOf(state, "purpose")}>
          <Select state={state} id="p-purpose" name="purpose" defaultValue={defaultPurpose}>
            <option value="deposit">Deposit</option>
            <option value="balance">Balance</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field id="p-amount" label="Amount received (QAR)" error={errorOf(state, "amount")}>
          <Input state={state} id="p-amount" name="amount" inputMode="decimal" defaultValue={defaultAmount} maxLength={16} />
        </Field>
        <Field id="p-method" label="Method" error={errorOf(state, "method")}>
          <Select state={state} id="p-method" name="method" defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            <option value="cash">Cash</option>
            <option value="fawran">Fawran</option>
          </Select>
        </Field>
        <Field id="p-ref" label="Fawran reference (optional)" hint="Kept private. Not shown to the customer." error={errorOf(state, "reference")}>
          <Input state={state} id="p-ref" name="reference" maxLength={120} autoComplete="off" />
        </Field>
      </div>
      <Field id="p-notes" label="Internal note (optional)" error={errorOf(state, "notes")}>
        <Input state={state} id="p-notes" name="notes" maxLength={1000} autoComplete="off" />
      </Field>
      <Check state={state} name="received_confirmed" id="p-confirm">
        I confirm that I have received this payment myself. A deposit counts as paid only after a staff member confirms receipt.
      </Check>
      <p className="text-xs text-text-muted">The receipt number is generated automatically and is unique. It cannot be typed in or reused.</p>
      <div>
        <Submit pending={pending} pendingLabel="Recording…">
          Record payment
        </Submit>
      </div>
    </form>
  );
}

export function ReversePaymentForm({ orderId, paymentId, scope = "t" }: { orderId: string; paymentId: string; scope?: string }) {
  const [state, action, pending] = useStaffForm(reversePaymentAction);
  return (
    <details>
      <summary className="cursor-pointer text-xs font-semibold text-text-secondary hover:text-error">Reverse</summary>
      <form action={action} className="mt-2 flex flex-col gap-2" noValidate>
        <input type="hidden" name="order_id" value={orderId} />
        <input type="hidden" name="payment_id" value={paymentId} />
        <Feedback state={state} />
        <Field id={`${scope}-rp-${paymentId}`} label="Reason" error={errorOf(state, "reason")}>
          <Input state={state} id={`${scope}-rp-${paymentId}`} name="reason" maxLength={500} required />
        </Field>
        <Field id={`${scope}-rpc-${paymentId}`} label="Type REVERSE to confirm" error={errorOf(state, "typed_confirmation")}>
          <Input state={state} id={`${scope}-rpc-${paymentId}`} name="typed_confirmation" autoComplete="off" maxLength={10} />
        </Field>
        <p className="text-xs text-text-muted">The original entry is never changed or deleted. A matching reversal entry is added to the history.</p>
        <div>
          <Submit pending={pending} tone="danger" pendingLabel="Reversing…">
            Reverse payment
          </Submit>
        </div>
      </form>
    </details>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The deposit schedule
// ---------------------------------------------------------------------------------------------------------------

export interface ScheduleDefaults {
  /** One entry per tier, in order. `upTo` is the inclusive upper limit in QAR; the last tier has none (it covers everything above). */
  tiers: { upTo: string; percent: string }[];
}

export function DepositScheduleForm({ defaults }: { defaults: ScheduleDefaults }) {
  const [state, action, pending] = useStaffForm(setDepositScheduleAction);
  const [tiers, setTiers] = useState(() => (defaults.tiers.length > 0 ? defaults.tiers : [{ upTo: "", percent: "" }]));
  const count = tiers.length;
  const patch = (index: number, change: Partial<{ upTo: string; percent: string }>) => setTiers((current) => current.map((t, i) => (i === index ? { ...t, ...change } : t)));
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Feedback state={state} />
      <input type="hidden" name="tier_count" value={count} />
      <ol className="flex flex-col gap-3" aria-label="Deposit tiers">
        {tiers.map((tier, index) => {
          const last = index === count - 1;
          const above = index > 0 && tiers[index - 1].upTo.trim() !== "" ? `QAR ${tiers[index - 1].upTo.trim()}` : "the previous limit";
          return (
            <li key={index} data-testid={`deposit-tier-${index + 1}`} className="grid gap-3 rounded-glass-sm border border-border bg-white/[0.025] p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <Field
                id={`d-p${index}`}
                label={`Tier ${index + 1}: percent of the whole total`}
                hint={index === 0 ? "For orders up to and including the first limit." : last ? `For orders above ${above}.` : `Above ${above}, up to and including the limit.`}
                error={errorOf(state, `percent_${index}`)}
              >
                <Input state={state} id={`d-p${index}`} name={`percent_${index}`} inputMode="decimal" value={tier.percent} onChange={(e) => patch(index, { percent: e.target.value })} maxLength={6} />
              </Field>
              {last ? (
                <p className="pb-2 text-sm text-text-muted">No upper limit: this tier covers every order above the previous limit.</p>
              ) : (
                <Field id={`d-l${index}`} label="Up to and including (QAR)" error={errorOf(state, `up_to_${index}`)}>
                  <Input state={state} id={`d-l${index}`} name={`up_to_${index}`} inputMode="decimal" value={tier.upTo} onChange={(e) => patch(index, { upTo: e.target.value })} maxLength={16} />
                </Field>
              )}
              <button
                type="button"
                onClick={() => setTiers((current) => current.filter((_, i) => i !== index).map((t, i, all) => (i === all.length - 1 ? { ...t, upTo: "" } : t)))}
                disabled={count <= 1}
                aria-label={`Remove tier ${index + 1}`}
                className="rounded-full border border-border-strong px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-error disabled:opacity-40"
              >
                Remove
              </button>
            </li>
          );
        })}
      </ol>
      <div>
        <button
          type="button"
          onClick={() => setTiers((current) => [...current.slice(0, -1), { upTo: "", percent: "" }, current[current.length - 1]])}
          disabled={count >= MAX_DEPOSIT_TIERS}
          className="btn-sheen btn-glass inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50"
        >
          Add a tier
        </button>
      </div>
      <p className="text-xs text-text-muted">
        The percentage applies to the entire ORIGINAL order total (before any discount or redeemed points), not to the part above a limit. The deposit is rounded to the nearest dirham (a half rounds up). Orders whose deposit is already fixed are not changed.
      </p>
      <Field id="d-reason" label="Reason for the change" error={errorOf(state, "reason")}>
        <Input state={state} id="d-reason" name="reason" maxLength={500} />
      </Field>
      <Check state={state} name="confirmed_by_owner" id="d-owner">
        The owner has confirmed this schedule.
      </Check>
      <Field id="d-typed" label="Type CHANGE DEPOSIT SCHEDULE to confirm" error={errorOf(state, "typed_confirmation")}>
        <Input state={state} id="d-typed" name="typed_confirmation" autoComplete="off" maxLength={40} />
      </Field>
      <div>
        <Submit pending={pending}>Save as a new version</Submit>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The second factor
// ---------------------------------------------------------------------------------------------------------------

function VerifyCodeForm({ factorId }: { factorId: string }) {
  const [state, action, pending] = useStaffForm(verifyTotpAction);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate>
      <input type="hidden" name="factor_id" value={factorId} />
      <Feedback state={state} />
      <Field id="m-code" label="6-digit code" error={errorOf(state, "code")}>
        <Input state={state} id="m-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} pattern="[0-9 ]*" />
      </Field>
      <div>
        <Submit pending={pending} pendingLabel="Checking…">
          Verify
        </Submit>
      </div>
    </form>
  );
}

export function MfaPanel({ factorId }: { factorId: string | null }) {
  const [state, action, pending] = useActionState(enrolTotpAction, staffIdleState);
  if (factorId) return <VerifyCodeForm factorId={factorId} />;
  if (state.status === "success" && state.enrol) {
    return (
      <div className="flex flex-col gap-4">
        <Feedback state={state} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={state.enrol.qr} alt="QR code for your authenticator app" width={176} height={176} className="rounded-xl bg-white p-2" />
        <p className="text-xs text-text-muted">
          Cannot scan it? Enter this setup key by hand: <code className="select-all break-all text-text-secondary">{state.enrol.setupKey}</code>
        </p>
        <VerifyCodeForm factorId={state.enrol.factorId} />
      </div>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      <Feedback state={state} />
      <div>
        <Submit pending={pending} pendingLabel="Preparing…">
          Set up an authenticator app
        </Submit>
      </div>
    </form>
  );
}


// ---------------------------------------------------------------------------------------------------------------
// Private order costs (owner only). None of these forms is drawn for a person without finance.manage, and the database refuses the
// request anyway. Costs are never required, and an empty row is simply ignored.
// ---------------------------------------------------------------------------------------------------------------

/** What the edit and remove forms need to know about one cost entry (the shape the order page already holds; defined here so a client form imports no staff server types). */
export interface OrderCostEntry {
  id: string;
  category: string;
  description: string;
  amount_minor: number;
  cost_kind: string;
  supplier_ref: string | null;
  incurred_on: string;
  notes: string | null;
  version: number;
}

interface CostRow {
  id: number;
  category: string;
  description: string;
  amount: string;
  kind: string;
  ref: string;
  date: string;
  notes: string;
}
const blankCostRow = (id: number): CostRow => ({ id, category: "components", description: "", amount: "", kind: "estimated", ref: "", date: "", notes: "" });

function CostCategoryOptions() {
  return (
    <>
      {COST_CATEGORIES.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </>
  );
}
function CostKindOptions() {
  return (
    <>
      {COST_KINDS.map((k) => (
        <option key={k.value} value={k.value}>
          {k.label}
        </option>
      ))}
    </>
  );
}

/** The optional "Direct costs" block of the new-order form: estimated or known costs, entered now or later from the order page. */
function NewOrderCostsSection({ state }: { state: StaffFormState }) {
  const [rows, setRows] = useState<CostRow[]>([blankCostRow(1)]);
  const [nextId, setNextId] = useState(2);
  const update = (id: number, patch: Partial<CostRow>) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const entered = rows.filter((r) => r.description.trim() !== "" || r.amount.trim() !== "");
  const sum = entered.reduce<number | null>((acc, r) => {
    const minor = parseQarToMinor(r.amount);
    return acc === null || minor === null ? null : acc + minor;
  }, 0);
  return (
    <details className="rounded-glass-sm border border-border bg-white/[0.025] p-3 sm:p-4" data-testid="costs-section" open={entered.length > 0 || Object.keys(state.status === "error" ? state.fieldErrors ?? {} : {}).some((k) => k.startsWith("cost_"))}>
      <summary className="cursor-pointer text-sm font-semibold text-white">
        Direct order costs <span className="font-normal text-text-muted">(optional, private to the owner)</span>
      </summary>
      <div className="mt-4 flex flex-col gap-4">
        <p className="text-sm text-text-secondary">
          Add what you expect or already know this order will cost: supplier purchases, shipping, duties, assembly, delivery, payment charges. Nothing here is required, and you can add or correct costs on the order page at any time, even after it is delivered. A missing cost is never counted as zero.
        </p>
        <ol className="flex flex-col gap-3" aria-label="Direct order costs">
          {rows.map((row, index) => (
            <li key={row.id} className="rounded-glass-sm border border-border bg-white/[0.02] p-3">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[14rem_1fr_9rem_9rem]">
                <Field id={`c-cat-${row.id}`} label="Category" error={errorOf(state, `cost_category_${index}`)}>
                  <Select state={state} id={`c-cat-${row.id}`} name={`cost_category_${index}`} value={row.category} onChange={(e) => update(row.id, { category: e.target.value })}>
                    <CostCategoryOptions />
                  </Select>
                </Field>
                <Field id={`c-desc-${row.id}`} label="Description" error={errorOf(state, `cost_description_${index}`)}>
                  <Input state={state} id={`c-desc-${row.id}`} name={`cost_description_${index}`} value={row.description} onChange={(e) => update(row.id, { description: e.target.value })} maxLength={200} />
                </Field>
                <Field id={`c-amt-${row.id}`} label="Amount (QAR)" error={errorOf(state, `cost_amount_${index}`)}>
                  <Input state={state} id={`c-amt-${row.id}`} name={`cost_amount_${index}`} inputMode="decimal" placeholder="0.00" value={row.amount} onChange={(e) => update(row.id, { amount: e.target.value })} maxLength={16} />
                </Field>
                <Field id={`c-kind-${row.id}`} label="Estimated or actual" error={errorOf(state, `cost_cost_kind_${index}`)}>
                  <Select state={state} id={`c-kind-${row.id}`} name={`cost_cost_kind_${index}`} value={row.kind} onChange={(e) => update(row.id, { kind: e.target.value })}>
                    <CostKindOptions />
                  </Select>
                </Field>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_10rem_1fr_auto] lg:items-end">
                <Field id={`c-ref-${row.id}`} label="Supplier or reference (optional)" error={errorOf(state, `cost_supplier_ref_${index}`)}>
                  <Input state={state} id={`c-ref-${row.id}`} name={`cost_supplier_ref_${index}`} value={row.ref} onChange={(e) => update(row.id, { ref: e.target.value })} maxLength={120} autoComplete="off" />
                </Field>
                <Field id={`c-date-${row.id}`} label="Date (optional)" error={errorOf(state, `cost_incurred_on_${index}`)}>
                  <Input state={state} id={`c-date-${row.id}`} name={`cost_incurred_on_${index}`} type="date" value={row.date} onChange={(e) => update(row.id, { date: e.target.value })} />
                </Field>
                <Field id={`c-notes-${row.id}`} label="Private note (optional)" error={errorOf(state, `cost_notes_${index}`)}>
                  <Input state={state} id={`c-notes-${row.id}`} name={`cost_notes_${index}`} value={row.notes} onChange={(e) => update(row.id, { notes: e.target.value })} maxLength={1000} autoComplete="off" />
                </Field>
                <button
                  type="button"
                  onClick={() => setRows((current) => (current.length > 1 ? current.filter((r) => r.id !== row.id) : [blankCostRow(row.id)]))}
                  aria-label={`Remove cost ${index + 1}`}
                  className="rounded-full border border-border-strong px-3 py-1.5 text-xs font-semibold text-text-secondary hover:text-error"
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              if (rows.length >= MAX_NEW_ORDER_COSTS) return;
              setRows((current) => [...current, blankCostRow(nextId)]);
              setNextId((n) => n + 1);
            }}
            disabled={rows.length >= MAX_NEW_ORDER_COSTS}
            className="btn-sheen btn-glass inline-flex items-center rounded-full px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Add another cost
          </button>
          <p className="text-sm text-text-secondary">
            Costs entered: <span className="font-semibold text-white tabular-nums" data-testid="costs-entered-total">{sum === null ? "—" : formatQar(sum)}</span>
          </p>
        </div>
      </div>
    </details>
  );
}

const costInputFields = (state: StaffFormState, scope: string, entry?: OrderCostEntry) => (
  <>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field id={`${scope}-cat`} label="Category" error={errorOf(state, "category")}>
        <Select state={state} id={`${scope}-cat`} name="category" defaultValue={entry?.category ?? "components"}>
          <CostCategoryOptions />
        </Select>
      </Field>
      <Field id={`${scope}-desc`} label="Description" error={errorOf(state, "description")}>
        <Input state={state} id={`${scope}-desc`} name="description" defaultValue={entry?.description ?? ""} maxLength={200} />
      </Field>
      <Field id={`${scope}-amt`} label="Amount (QAR)" error={errorOf(state, "amount")}>
        <Input state={state} id={`${scope}-amt`} name="amount" inputMode="decimal" placeholder="0.00" defaultValue={entry ? plainAmount(entry.amount_minor) : ""} maxLength={16} />
      </Field>
      <Field id={`${scope}-kind`} label="Estimated or actual" error={errorOf(state, "cost_kind")}>
        <Select state={state} id={`${scope}-kind`} name="cost_kind" defaultValue={entry?.cost_kind ?? "actual"}>
          <CostKindOptions />
        </Select>
      </Field>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_10rem_1fr]">
      <Field id={`${scope}-ref`} label="Supplier or reference (optional)" error={errorOf(state, "supplier_ref")}>
        <Input state={state} id={`${scope}-ref`} name="supplier_ref" defaultValue={entry?.supplier_ref ?? ""} maxLength={120} autoComplete="off" />
      </Field>
      <Field id={`${scope}-date`} label="Date (optional)" error={errorOf(state, "incurred_on")}>
        <Input state={state} id={`${scope}-date`} name="incurred_on" type="date" defaultValue={entry?.incurred_on ?? ""} />
      </Field>
      <Field id={`${scope}-notes`} label="Private note (optional)" error={errorOf(state, "notes")}>
        <Input state={state} id={`${scope}-notes`} name="notes" defaultValue={entry?.notes ?? ""} maxLength={1000} autoComplete="off" />
      </Field>
    </div>
  </>
);

export function AddCostForm({ orderId, entryId, entries }: { orderId: string; entryId: string; entries: number }) {
  const [state, action, pending] = useStaffForm(addOrderCostAction);
  // The entry id is chosen once per intended entry (like a payment's key): sending the same form again saves it once. It is replaced after it is spent.
  const key = useIdempotencyKey(`cost:${orderId}`, entryId, String(entries), state);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate data-testid="add-cost-form">
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="idempotency_key" value={key} />
      <Feedback state={state} />
      {costInputFields(state, "ac")}
      <div>
        <Submit pending={pending} pendingLabel="Saving…">
          Add cost
        </Submit>
      </div>
    </form>
  );
}

export function EditCostForm({ orderId, entry, scope = "t" }: { orderId: string; entry: OrderCostEntry; scope?: string }) {
  const [state, action, pending] = useStaffForm(editOrderCostAction);
  const id = `${scope}-ec-${entry.id}`;
  return (
    <details>
      <summary className="cursor-pointer text-xs font-semibold text-text-secondary hover:text-white">Edit</summary>
      <form action={action} className="mt-3 flex min-w-[16rem] flex-col gap-3" noValidate>
        <input type="hidden" name="order_id" value={orderId} />
        <input type="hidden" name="cost_id" value={entry.id} />
        <input type="hidden" name="expected_version" value={String(entry.version)} />
        <Feedback state={state} />
        {costInputFields(state, id, entry)}
        <Field id={`${id}-reason`} label="Why is this being changed? (kept in the history)" error={errorOf(state, "reason")}>
          <Input state={state} id={`${id}-reason`} name="reason" maxLength={500} autoComplete="off" />
        </Field>
        <p className="text-xs text-text-muted">The old value stays in the history with your name and this reason. Nothing is overwritten.</p>
        <div>
          <Submit pending={pending} pendingLabel="Saving…">
            Save change
          </Submit>
        </div>
      </form>
    </details>
  );
}

export function VoidCostForm({ orderId, entry, scope = "t" }: { orderId: string; entry: OrderCostEntry; scope?: string }) {
  const [state, action, pending] = useStaffForm(voidOrderCostAction);
  const id = `${scope}-vc-${entry.id}`;
  return (
    <details>
      <summary className="cursor-pointer text-xs font-semibold text-text-secondary hover:text-error">Remove</summary>
      <form action={action} className="mt-3 flex flex-col gap-2" noValidate>
        <input type="hidden" name="order_id" value={orderId} />
        <input type="hidden" name="cost_id" value={entry.id} />
        <input type="hidden" name="expected_version" value={String(entry.version)} />
        <Feedback state={state} />
        <Field id={`${id}-reason`} label="Why is this entry being removed?" error={errorOf(state, "reason")}>
          <Input state={state} id={`${id}-reason`} name="reason" maxLength={500} autoComplete="off" />
        </Field>
        <p className="text-xs text-text-muted">The entry stops counting in the totals but is never deleted: it stays in the history.</p>
        <div>
          <Submit pending={pending} tone="danger" pendingLabel="Removing…">
            Remove from totals
          </Submit>
        </div>
      </form>
    </details>
  );
}

/** Declares the costs complete, or reopens them with a reason. Any later change to an entry reopens them automatically. */
export function CostsCompleteForm({ orderId, complete, blockedReason }: { orderId: string; complete: boolean; blockedReason: string | null }) {
  const [state, action, pending] = useStaffForm(setCostsCompleteAction);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate data-testid="costs-complete-form">
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="complete" value={complete ? "no" : "yes"} />
      <Feedback state={state} />
      {complete ? (
        <Field id="cc-reason" label="Why are the costs being reopened? (kept in the history)" error={errorOf(state, "reason")}>
          <Input state={state} id="cc-reason" name="reason" maxLength={500} autoComplete="off" />
        </Field>
      ) : null}
      {!complete && blockedReason ? <p className="text-xs text-text-muted">{blockedReason}</p> : null}
      <div>
        <Submit pending={pending} tone={complete ? "glass" : "red"} disabled={!complete && blockedReason !== null} pendingLabel="Saving…">
          {complete ? "Reopen the costs" : "Mark costs complete"}
        </Submit>
      </div>
    </form>
  );
}

/** The owner's one-time confirmation of the completion date of an order delivered before dates were recorded. */
export function VerifyCompletionForm({ orderId, moves }: { orderId: string; moves: { from_status: string | null; at: string; reason: string | null }[] }) {
  const [state, action, pending] = useStaffForm(verifyCompletionAction);
  return (
    <form action={action} className="flex flex-col gap-3" noValidate data-testid="verify-completion-form">
      <input type="hidden" name="order_id" value={orderId} />
      <Feedback state={state} />
      <p className="text-sm text-text-secondary">
        This order was delivered before completion dates were recorded, and its history does not prove the exact moment{moves.length ? ` (${moves.length} unclear history entr${moves.length === 1 ? "y" : "ies"})` : ""}. Enter the real date and time (Qatar time) from your own records. It is kept with your name and reason and can never be changed.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="vc-when" label="Delivered on (Qatar time)" error={errorOf(state, "completed_at")}>
          <Input state={state} id="vc-when" name="completed_at" type="datetime-local" />
        </Field>
        <Field id="vc-reason" label="How do you know? (kept with the record)" error={errorOf(state, "reason")}>
          <Input state={state} id="vc-reason" name="reason" maxLength={500} autoComplete="off" />
        </Field>
      </div>
      <div>
        <Submit pending={pending} pendingLabel="Recording…">
          Record the completion date
        </Submit>
      </div>
    </form>
  );
}
