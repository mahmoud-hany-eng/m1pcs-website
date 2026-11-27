"use client";

/**
 * The forms of the Historical Orders Import. Owner only (the server pages draw them only for a person with import.manage, and every action checks
 * it again, and the database again). They hold no session, no role and no id the server page did not render: the browser sends what the owner
 * typed and the ids of the records shown.
 */
import { useRef, useState, type ReactNode } from "react";
import {
  addAttachmentAction,
  attachmentUnavailableAction,
  classifyAttachmentAction,
  commitImportAction,
  correctRowAction,
  customerChoiceAction,
  discardImportAction,
  mergeGroupsAction,
  resolveFlagAction,
  rowDecisionAction,
  setOrderItemsAction,
  storeAttachmentAction,
  unmergeGroupAction,
  uploadImportAction,
} from "@/lib/staff/historical/actions";
import { ATTACHMENT_CLASSES, DATE_FORMAT_CHOICES, MAX_ITEM_LINES } from "@/lib/staff/historical/choices";
import { formatFileSize } from "@/lib/staff/receipts";
import { plainAmount } from "@/lib/staff/format";
import { formatQar } from "@/lib/platform/money";
import type { StaffFormState } from "@/lib/staff/form-state";
import type { ImportRow } from "@/lib/staff/historical/types";
import { Check, echoed, errorOf, Feedback, Field, Input, Select, Submit, useStaffForm, type Action } from "./forms";

const CSV_LIMIT = 512 * 1024;
const ATTACHMENT_LIMIT = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------------------------------------------
export function UploadImportForm() {
  const [state, action, pending] = useStaffForm(uploadImportAction);
  const [picked, setPicked] = useState<{ name: string; size: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = problem ?? errorOf(state, "file");
  return (
    <form action={action} noValidate className="flex flex-col gap-4" data-testid="import-upload-form">
      <Feedback state={state} />
      <Field id="imp-file" label="CSV export" hint="Up to 512 KB. Nothing is imported when you upload: the file is only read and checked." error={shown} required>
        <input
          id="imp-file"
          name="file"
          type="file"
          accept=".csv,text/csv,text/plain"
          required
          aria-invalid={Boolean(shown)}
          aria-describedby="imp-file-error"
          className="glass-input min-h-[2.75rem] w-full cursor-pointer px-3.5 py-2 text-sm file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-sm file:font-semibold file:text-white"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            if (!file) {
              setPicked(null);
              setProblem(null);
              return;
            }
            if (file.size === 0) setProblem("That file is empty.");
            else if (file.size > CSV_LIMIT) setProblem("The file is larger than 512 KB. Check that it is the right file.");
            else setProblem(null);
            setPicked({ name: file.name, size: file.size });
          }}
        />
      </Field>
      {picked && !problem ? (
        <p className="text-xs text-text-muted" data-testid="import-picked">
          {picked.name} · {formatFileSize(picked.size)}
        </p>
      ) : null}
      <Field id="imp-dates" label="How are the dates written?" hint="Leave this on automatic. If the file cannot say (for example 03/04/2025), you will be asked rather than guessed at." error={errorOf(state, "date_format")}>
        <Select state={state} id="imp-dates" name="date_format" defaultValue="auto">
          {DATE_FORMAT_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </Select>
      </Field>
      <div>
        <Submit pending={pending} disabled={Boolean(problem)} pendingLabel="Reading the file…">
          Read and check the file
        </Submit>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Review: correct a row, skip it, decide a duplicate, merge customers, choose a profile
// ---------------------------------------------------------------------------------------------------------------
const Summary = ({ children }: { children: ReactNode }) => (
  <summary className="inline-flex cursor-pointer select-none list-none items-center text-xs font-semibold text-accent hover:underline [&::-webkit-details-marker]:hidden">{children}</summary>
);

export function CorrectRowForm({ batchId, row, view }: { batchId: string; row: ImportRow; view: string }) {
  const [state, action, pending] = useStaffForm(correctRowAction);
  const id = `cr-${row.id}-${view}`;
  return (
    <details data-testid={`correct-row-${row.row_number}`}>
      <Summary>Correct…</Summary>
      <form action={action} noValidate className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="batch_id" value={batchId} />
        <input type="hidden" name="row_id" value={row.id} />
        <Feedback state={state} />
        <Field id={`${id}-c`} label="Customer" error={errorOf(state, "customer")}>
          <Input state={state} id={`${id}-c`} name="customer" defaultValue={row.customer_name ?? ""} maxLength={120} autoComplete="off" />
        </Field>
        <Field id={`${id}-p`} label="Phone" error={errorOf(state, "phone")}>
          <Input state={state} id={`${id}-p`} name="phone" defaultValue={row.phone ?? ""} maxLength={40} autoComplete="off" inputMode="tel" />
        </Field>
        <Field id={`${id}-d`} label="Completion date (YYYY-MM-DD)" error={errorOf(state, "date")}>
          <Input state={state} id={`${id}-d`} name="date" defaultValue={row.happened_on ?? ""} maxLength={10} autoComplete="off" placeholder="2025-12-31" />
        </Field>
        <Field id={`${id}-r`} label="Revenue (QAR)" error={errorOf(state, "revenue")}>
          <Input state={state} id={`${id}-r`} name="revenue" defaultValue={row.revenue_minor !== null ? plainAmount(row.revenue_minor) : ""} maxLength={20} autoComplete="off" inputMode="decimal" />
        </Field>
        <Field id={`${id}-k`} label="Direct cost (QAR)" hint="Leave empty if it is not known: an unknown cost is never counted as zero." error={errorOf(state, "cost")}>
          <Input state={state} id={`${id}-k`} name="cost" defaultValue={row.cost_minor !== null ? plainAmount(row.cost_minor) : ""} maxLength={20} autoComplete="off" inputMode="decimal" />
        </Field>
        <div>
          <Submit pending={pending} tone="glass" pendingLabel="Checking…">
            Save the correction
          </Submit>
        </div>
      </form>
    </details>
  );
}

export function SkipRowForm({ batchId, rowId, view }: { batchId: string; rowId: string; view: string }) {
  const [state, action, pending] = useStaffForm(rowDecisionAction);
  const id = `sk-${rowId}-${view}`;
  return (
    <details>
      <Summary>Skip…</Summary>
      <form action={action} noValidate className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="batch_id" value={batchId} />
        <input type="hidden" name="row_id" value={rowId} />
        <input type="hidden" name="decision" value="skip" />
        <Feedback state={state} />
        <Field id={id} label="Why is it skipped?" error={errorOf(state, "reason")}>
          <Input state={state} id={id} name="reason" maxLength={300} autoComplete="off" />
        </Field>
        <div>
          <Submit pending={pending} tone="danger" pendingLabel="Saving…">
            Skip this row
          </Submit>
        </div>
      </form>
    </details>
  );
}

export function RestoreRowForm({ batchId, rowId }: { batchId: string; rowId: string }) {
  const [state, action, pending] = useStaffForm(rowDecisionAction);
  return (
    <form action={action} noValidate className="flex flex-col gap-1">
      <input type="hidden" name="batch_id" value={batchId} />
      <input type="hidden" name="row_id" value={rowId} />
      <input type="hidden" name="decision" value="import" />
      <Feedback state={state} />
      <div>
        <Submit pending={pending} tone="glass" pendingLabel="Saving…">
          Import this row after all
        </Submit>
      </div>
    </form>
  );
}

/** A small one-button form for a decision that needs no typing. */
function DecisionButton({ action, hidden, label, tone = "glass", testId }: { action: Action; hidden: Record<string, string>; label: string; tone?: "red" | "glass" | "danger"; testId?: string }) {
  const [state, formAction, pending] = useStaffForm(action);
  return (
    <form action={formAction} noValidate className="flex flex-col gap-1" data-testid={testId}>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Feedback state={state} />
      <div>
        <Submit pending={pending} tone={tone} pendingLabel="Saving…">
          {label}
        </Submit>
      </div>
    </form>
  );
}

export function ResolveFlagForm({ batchId, flagKey, resolution, label, testId }: { batchId: string; flagKey: string; resolution: "keep_separate" | "import_anyway"; label: string; testId?: string }) {
  return <DecisionButton action={resolveFlagAction} hidden={{ batch_id: batchId, flag_key: flagKey, resolution }} label={label} testId={testId} />;
}

export function MergeGroupsForm({ batchId, fromGroup, intoGroup, label = "These are the same person: merge" }: { batchId: string; fromGroup: string; intoGroup: string; label?: string }) {
  return <DecisionButton action={mergeGroupsAction} hidden={{ batch_id: batchId, from_group: fromGroup, into_group: intoGroup }} label={label} />;
}

export function UnmergeGroupForm({ batchId, groupId }: { batchId: string; groupId: string }) {
  return <DecisionButton action={unmergeGroupAction} hidden={{ batch_id: batchId, group_id: groupId }} label="Separate them again" />;
}

export function CustomerChoiceForm({ batchId, groupId, existingCustomerId, existingLabel, current }: { batchId: string; groupId: string; existingCustomerId: string; existingLabel: string; current: "new" | "existing" | null }) {
  const [state, action, pending] = useStaffForm(customerChoiceAction);
  return (
    <form action={action} noValidate className="flex flex-col gap-2" data-testid="customer-choice-form">
      <input type="hidden" name="batch_id" value={batchId} />
      <input type="hidden" name="group_id" value={groupId} />
      <input type="hidden" name="customer_id" value={existingCustomerId} />
      <Feedback state={state} />
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Which profile do these orders belong to?</legend>
        <label className="flex items-start gap-2.5 text-sm text-text-secondary">
          <input type="radio" name="choice" value="new" defaultChecked={current === "new"} className="mt-0.5 h-4 w-4 accent-[rgb(var(--color-primary))]" />
          <span>Create a NEW customer profile (no sign-in, no email)</span>
        </label>
        <label className="flex items-start gap-2.5 text-sm text-text-secondary">
          <input type="radio" name="choice" value="existing" defaultChecked={current === "existing"} className="mt-0.5 h-4 w-4 accent-[rgb(var(--color-primary))]" />
          <span>Add them to the EXISTING customer {existingLabel}</span>
        </label>
        {errorOf(state, "choice") ? (
          <p role="alert" className="text-xs text-error">
            {errorOf(state, "choice")}
          </p>
        ) : null}
      </fieldset>
      <div>
        <Submit pending={pending} tone="glass" pendingLabel="Saving…">
          Save this choice
        </Submit>
      </div>
    </form>
  );
}

export function DiscardImportForm({ batchId }: { batchId: string }) {
  const [state, action, pending] = useStaffForm(discardImportAction);
  return (
    <details>
      <Summary>Discard this import…</Summary>
      <form action={action} noValidate className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="batch_id" value={batchId} />
        <Feedback state={state} />
        <Field id="disc-reason" label="Why is it being discarded?" hint="Nothing has been imported, so nothing in your orders, customers or loyalty changes." error={errorOf(state, "reason")}>
          <Input state={state} id="disc-reason" name="reason" maxLength={300} autoComplete="off" />
        </Field>
        <div>
          <Submit pending={pending} tone="danger" pendingLabel="Discarding…">
            Discard this import
          </Submit>
        </div>
      </form>
    </details>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The final confirmation
// ---------------------------------------------------------------------------------------------------------------
export interface CommitFigures {
  orders: number;
  revenueMinor: number;
  costMinor: number;
  points: number;
}

export function CommitImportForm({ batchId, figures, blocking }: { batchId: string; figures: CommitFigures; blocking: number }) {
  const [state, action, pending] = useStaffForm(commitImportAction);
  const phrase = `IMPORT ${figures.orders} ORDERS`;
  const [typed, setTyped] = useState("");
  const ready = blocking === 0 && typed.trim().toUpperCase() === phrase;
  return (
    <form action={action} noValidate className="flex flex-col gap-4" data-testid="commit-form">
      <input type="hidden" name="batch_id" value={batchId} />
      <input type="hidden" name="expected_orders" value={String(figures.orders)} />
      <input type="hidden" name="expected_revenue_minor" value={String(figures.revenueMinor)} />
      <input type="hidden" name="expected_cost_minor" value={String(figures.costMinor)} />
      <input type="hidden" name="expected_points" value={String(figures.points)} />
      <Feedback state={state} />
      {errorOf(state, "expected") ? (
        <p role="alert" className="text-sm text-error">
          {errorOf(state, "expected")}
        </p>
      ) : null}
      <fieldset className="flex flex-col gap-3 rounded-glass-sm border border-border-strong p-4">
        <legend className="px-1 text-sm font-semibold text-white">Confirm what you know about these orders</legend>
        <Check state={state} id="att-date" name="attest_date">
          The date in the file is the date each order was <strong className="text-white">completed and handed over</strong>, not the date it was placed.
        </Check>
        <Check state={state} id="att-revenue" name="attest_revenue">
          The revenue is the <strong className="text-white">final amount the customer paid</strong> for the order (after any discount).
        </Check>
        <Check state={state} id="att-paid" name="attest_paid">
          Every one of these orders was <strong className="text-white">paid in full</strong>. The import records your confirmation, not payments.
        </Check>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-white/90">
            Are the costs in the file the <strong>complete direct costs</strong> of each order?
          </span>
          <label className="flex items-start gap-2.5 text-sm text-text-secondary">
            <input type="radio" name="costs_complete" value="yes" defaultChecked={echoed(state, "costs_complete") === "yes"} className="mt-0.5 h-4 w-4 accent-[rgb(var(--color-primary))]" />
            <span>Yes: report profit as verified</span>
          </label>
          <label className="flex items-start gap-2.5 text-sm text-text-secondary">
            <input type="radio" name="costs_complete" value="no" defaultChecked={echoed(state, "costs_complete") === "no"} className="mt-0.5 h-4 w-4 accent-[rgb(var(--color-primary))]" />
            <span>Not sure: report profit as provisional until the costs are confirmed order by order</span>
          </label>
          {errorOf(state, "costs_complete") ? (
            <p role="alert" className="text-xs text-error">
              {errorOf(state, "costs_complete")}
            </p>
          ) : null}
        </div>
      </fieldset>
      <Field id="commit-phrase" label={`Type ${phrase} to confirm`} hint="This is the last step before anything is saved." error={errorOf(state, "phrase")}>
        <input
          id="commit-phrase"
          name="phrase"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          maxLength={40}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-describedby="commit-phrase-error"
          className="glass-input min-h-[2.75rem] w-full px-3.5 py-2 font-mono text-sm"
        />
      </Field>
      <p className="text-sm text-text-secondary">
        This will create <strong className="text-white">{figures.orders}</strong> completed orders worth <strong className="text-white">{formatQar(figures.revenueMinor)}</strong> and award{" "}
        <strong className="text-white">{figures.points.toLocaleString("en-US")}</strong> loyalty points, once each. No customer will be emailed, no sign-in account is created, and no existing order or balance changes.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button name="intent" value="check" type="submit" disabled={pending || blocking > 0} className="btn-sheen btn-glass inline-flex min-h-[2.75rem] items-center justify-center rounded-full px-6 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60" data-testid="commit-check">
          {pending ? "Working…" : "Check without importing"}
        </button>
        <button name="intent" value="import" type="submit" disabled={pending || !ready} aria-busy={pending} className="btn-sheen btn-red inline-flex min-h-[2.75rem] items-center justify-center rounded-full px-6 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60" data-testid="commit-import">
          {pending ? "Importing…" : `Import ${figures.orders} orders`}
        </button>
      </div>
      {blocking > 0 ? (
        <p className="text-xs text-warning" role="status">
          {blocking} {blocking === 1 ? "item still needs" : "items still need"} your decision above before this can be imported.
        </p>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------------------------
function FilePicker({ id, error, onProblem }: { id: string; error?: string; onProblem: (message: string | null) => void }) {
  return (
    <Field id={id} label="PDF or PNG file" hint="Up to 4 MB. The file's content is checked, not just its name." error={error}>
      <input
        id={id}
        name="file"
        type="file"
        accept="application/pdf,image/png,.pdf,.png"
        aria-describedby={`${id}-error`}
        className="glass-input min-h-[2.5rem] w-full cursor-pointer px-3 py-1.5 text-sm file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-white/10 file:px-3 file:py-1 file:text-sm file:font-semibold file:text-white"
        onChange={(event) => {
          const file = event.target.files?.[0] ?? null;
          onProblem(file && file.size > ATTACHMENT_LIMIT ? "That file is larger than 4 MB." : file && file.size === 0 ? "That file is empty." : null);
        }}
      />
    </Field>
  );
}

const ClassSelect = ({ state, id, defaultValue = "unclassified" }: { state: StaffFormState; id: string; defaultValue?: string }) => (
  <Field id={id} label="What kind of document is it?" error={errorOf(state, "classification")}>
    <Select state={state} id={id} name="classification" defaultValue={defaultValue}>
      {ATTACHMENT_CLASSES.map((c) => (
        <option key={c.value} value={c.value}>
          {c.label}
        </option>
      ))}
    </Select>
  </Field>
);

export function StoreAttachmentForm({ batchId, attachmentId, orderId, view, label = "Attach the original" }: { batchId: string; attachmentId: string; orderId?: string | null; view: string; label?: string }) {
  const [state, action, pending] = useStaffForm(storeAttachmentAction);
  const [problem, setProblem] = useState<string | null>(null);
  const id = `sa-${attachmentId}-${view}`;
  return (
    <details>
      <Summary>{label}…</Summary>
      <form action={action} noValidate className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="batch_id" value={batchId} />
        <input type="hidden" name="attachment_id" value={attachmentId} />
        {orderId ? <input type="hidden" name="order_id" value={orderId} /> : null}
        <Feedback state={state} />
        <FilePicker id={`${id}-f`} error={problem ?? errorOf(state, "file")} onProblem={setProblem} />
        <ClassSelect state={state} id={`${id}-c`} />
        <div>
          <Submit pending={pending} tone="glass" disabled={Boolean(problem)} pendingLabel="Checking and storing…">
            Store the file
          </Submit>
        </div>
      </form>
    </details>
  );
}

export function AddAttachmentForm({ batchId, rowId, orderId, view }: { batchId: string; rowId: string; orderId?: string | null; view: string }) {
  const [state, action, pending] = useStaffForm(addAttachmentAction);
  const [problem, setProblem] = useState<string | null>(null);
  const id = `aa-${rowId}-${view}`;
  return (
    <details>
      <Summary>Add another file…</Summary>
      <form action={action} noValidate className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="batch_id" value={batchId} />
        <input type="hidden" name="row_id" value={rowId} />
        {orderId ? <input type="hidden" name="order_id" value={orderId} /> : null}
        <Feedback state={state} />
        <FilePicker id={`${id}-f`} error={problem ?? errorOf(state, "file")} onProblem={setProblem} />
        <ClassSelect state={state} id={`${id}-c`} />
        <div>
          <Submit pending={pending} tone="glass" disabled={Boolean(problem)} pendingLabel="Checking and storing…">
            Store the file
          </Submit>
        </div>
      </form>
    </details>
  );
}

export function ClassifyAttachmentForm({ batchId, attachmentId, orderId, current, view }: { batchId: string; attachmentId: string; orderId?: string | null; current: string; view: string }) {
  const [state, action, pending] = useStaffForm(classifyAttachmentAction);
  const [choice, setChoice] = useState(current);
  const id = `ca-${attachmentId}-${view}`;
  return (
    <details>
      <Summary>Change type…</Summary>
      <form action={action} noValidate className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="batch_id" value={batchId} />
        <input type="hidden" name="attachment_id" value={attachmentId} />
        {orderId ? <input type="hidden" name="order_id" value={orderId} /> : null}
        <Feedback state={state} />
        <Field id={`${id}-c`} label="What kind of document is it?" error={errorOf(state, "classification")}>
          <Select state={state} id={`${id}-c`} name="classification" value={choice} onChange={(event) => setChoice(event.target.value)}>
            {ATTACHMENT_CLASSES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        {choice === "customer_receipt" ? (
          <Check state={state} id={`${id}-v`} name="customer_visible">
            Allow the customer to see this receipt later (nothing is shown until you do, and a supplier invoice can never be shown)
          </Check>
        ) : null}
        <div>
          <Submit pending={pending} tone="glass" pendingLabel="Saving…">
            Save
          </Submit>
        </div>
      </form>
    </details>
  );
}

export function UnavailableAttachmentForm({ batchId, attachmentId, orderId, view }: { batchId: string; attachmentId: string; orderId?: string | null; view: string }) {
  const [state, action, pending] = useStaffForm(attachmentUnavailableAction);
  const id = `ua-${attachmentId}-${view}`;
  return (
    <details>
      <Summary>Original not available…</Summary>
      <form action={action} noValidate className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="batch_id" value={batchId} />
        <input type="hidden" name="attachment_id" value={attachmentId} />
        {orderId ? <input type="hidden" name="order_id" value={orderId} /> : null}
        <Feedback state={state} />
        <Field id={id} label="Why can't it be attached?" hint="A missing original never blocks the order. A file can still be attached later." error={errorOf(state, "reason")}>
          <Input state={state} id={id} name="reason" maxLength={300} autoComplete="off" />
        </Field>
        <div>
          <Submit pending={pending} tone="glass" pendingLabel="Saving…">
            Save
          </Submit>
        </div>
      </form>
    </details>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Describing what was bought, later
// ---------------------------------------------------------------------------------------------------------------
export function SetOrderItemsForm({ orderId, netMinor }: { orderId: string; netMinor: number }) {
  const [state, action, pending] = useStaffForm(setOrderItemsAction);
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form ref={formRef} action={action} noValidate className="flex flex-col gap-3" data-testid="historical-items-form">
      <input type="hidden" name="order_id" value={orderId} />
      <Feedback state={state} />
      <p className="text-sm text-text-secondary">
        Describe what was bought, only as far as you can prove it. The lines must add up to exactly <strong className="text-white">{formatQar(netMinor)}</strong>: this never changes what the customer paid or the points they earned.
      </p>
      {Array.from({ length: MAX_ITEM_LINES }, (_, index) => index + 1).map((n) => (
        <div key={n} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_9rem]">
          <Field id={`hi-d-${n}`} label={`Line ${n}`} error={errorOf(state, `description_${n}`)}>
            <Input state={state} id={`hi-d-${n}`} name={`description_${n}`} maxLength={300} autoComplete="off" placeholder={n === 1 ? "What was bought" : undefined} />
          </Field>
          <Field id={`hi-q-${n}`} label="Qty" error={errorOf(state, `quantity_${n}`)}>
            <Input state={state} id={`hi-q-${n}`} name={`quantity_${n}`} inputMode="numeric" maxLength={4} autoComplete="off" />
          </Field>
          <Field id={`hi-p-${n}`} label="Unit price (QAR)" error={errorOf(state, `price_${n}`)}>
            <Input state={state} id={`hi-p-${n}`} name={`price_${n}`} inputMode="decimal" maxLength={14} autoComplete="off" />
          </Field>
        </div>
      ))}
      <Field id="hi-reason" label="What is this description based on?" hint="For example: the customer's WhatsApp conversation, or the supplier invoice. It is kept with the history." error={errorOf(state, "reason")}>
        <Input state={state} id="hi-reason" name="reason" maxLength={500} autoComplete="off" />
      </Field>
      <div>
        <Submit pending={pending} pendingLabel="Saving…">
          Save the description
        </Submit>
      </div>
    </form>
  );
}
