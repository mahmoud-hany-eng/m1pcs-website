"use client";

/**
 * Receipts on the Orders page. In the table a receipt is a small button (a paperclip and the number attached, or "Add" when there is none): no drop
 * area sits in a row. The button opens a compact panel for that one order with the attached PDFs (view, download, remove) and a drop area to attach
 * another. The panel is the browser's own `popover` (opened by the button, closed by a press outside, Escape or its Close button), so it needs no
 * script to open and close. Dropping a file on the area is the browser's own file input, so that needs none either; the script only shows the chosen
 * name, answers early about a wrong or oversized file, and shows progress.
 *
 * The browser sends the file and the id it chose for this upload; who the person is, whether the file is a real PDF and whether they may attach it are
 * decided on the server and again in the database. Nothing here holds a session, a role or a secret.
 */
import { useActionState, useEffect, useRef, useState } from "react";
import { removeReceiptAction, uploadReceiptAction } from "@/lib/staff/actions";
import { staffIdleState, type StaffFormState } from "@/lib/staff/form-state";
import { formatDay } from "@/lib/staff/format";
import { checkReceiptChoice, formatFileSize, MAX_RECEIPTS_PER_ORDER, receiptHref } from "@/lib/staff/receipts";
import type { ReceiptMeta } from "@/lib/staff/types";
import { useIdempotencyKey } from "./use-idempotency-key";

const fieldError = (state: StaffFormState, name: string): string | undefined => (state.status === "error" ? state.fieldErrors?.[name] : undefined);

function Paperclip() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m15.5 9.2-5.6 5.6a3.4 3.4 0 0 1-4.8-4.8l6-6a2.3 2.3 0 0 1 3.3 3.3l-6 6a1.1 1.1 0 0 1-1.6-1.6l5.4-5.4" />
    </svg>
  );
}

function ReceiptRemoveForm({ receiptId }: { receiptId: string }) {
  const [state, action, pending] = useActionState(removeReceiptAction, staffIdleState);
  const reason = fieldError(state, "reason");
  return (
    <details className="text-xs" data-testid="receipt-remove">
      <summary className="inline-flex cursor-pointer select-none list-none items-center font-semibold text-text-secondary hover:text-error [&::-webkit-details-marker]:hidden">Remove…</summary>
      <form action={action} className="mt-2 flex flex-col gap-2" noValidate>
        <input type="hidden" name="receipt_id" value={receiptId} />
        <label className="flex flex-col gap-1 text-xs text-text-muted">
          Why is it being removed? (kept in the history)
          <input name="reason" maxLength={300} autoComplete="off" aria-invalid={Boolean(reason)} className="glass-input min-h-[2.25rem] w-full px-3 py-1.5 text-sm text-white" />
        </label>
        {reason ? (
          <p role="alert" className="text-xs text-error">
            {reason}
          </p>
        ) : null}
        {state.status === "error" && state.message ? (
          <p role="alert" className="text-xs text-error">
            {state.message}
          </p>
        ) : null}
        <div>
          <button type="submit" disabled={pending} aria-busy={pending} className="btn-sheen btn-glass inline-flex min-h-[2.25rem] items-center justify-center rounded-full px-4 text-xs font-semibold !border-error/50 !text-error">
            {pending ? "Removing…" : "Remove receipt"}
          </button>
        </div>
      </form>
    </details>
  );
}

function ReceiptUploader({ orderId, uploadKey, count }: { orderId: string; uploadKey: string; count: number }) {
  const [state, action, pending] = useActionState(uploadReceiptAction, staffIdleState);
  // The receipt id is chosen once per intended upload (the server page chooses the first, so the form is complete before the script runs) and replaced once it is spent.
  const key = useIdempotencyKey(`receipt:${orderId}`, uploadKey, String(count), state);
  const [picked, setPicked] = useState<{ name: string; size: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "success") {
      formRef.current?.reset();
      setPicked(null);
      setProblem(null);
    }
  }, [state]);
  const serverProblem = fieldError(state, "file") ?? (state.status === "error" ? state.message : undefined);
  const shown = problem ?? serverProblem;
  return (
    <form ref={formRef} action={action} noValidate className="mt-3 flex flex-col gap-2" data-testid="receipt-upload-form">
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="idempotency_key" value={key} />
      <label
        className={`relative flex min-h-[5.5rem] cursor-pointer flex-col items-center justify-center gap-1 rounded-glass-sm border border-dashed px-4 py-4 text-center transition-colors focus-within:border-accent hover:border-accent ${over ? "border-accent bg-accent/10" : "border-border-strong bg-white/[0.02]"}`}
        onDragEnter={() => setOver(true)}
        onDragLeave={() => setOver(false)}
        onDrop={() => setOver(false)}
        data-testid="receipt-dropzone"
      >
        <input
          type="file"
          name="file"
          accept="application/pdf,.pdf"
          required
          aria-label="Choose a PDF receipt"
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null;
            const message = file ? checkReceiptChoice(file) : null;
            setProblem(message);
            if (message) {
              event.target.value = "";
              setPicked(null);
            } else {
              setPicked(file ? { name: file.name, size: file.size } : null);
            }
          }}
        />
        <Paperclip />
        <span className="max-w-full truncate text-sm font-medium text-white" data-testid="receipt-picked">
          {picked ? `${picked.name} · ${formatFileSize(picked.size)}` : "Drop a PDF here or click to choose"}
        </span>
        <span className="text-xs text-text-muted">PDF only, up to 4 MB</span>
      </label>
      {shown ? (
        <p role="alert" className="text-xs text-error" data-testid="receipt-problem">
          {shown}
        </p>
      ) : null}
      {state.status === "success" ? (
        <p role="status" className="text-xs text-success" data-testid="receipt-success">
          {state.message}
        </p>
      ) : null}
      <div>
        <button type="submit" disabled={pending} aria-busy={pending} className="btn-sheen btn-red inline-flex min-h-[2.5rem] items-center justify-center rounded-full px-5 text-sm font-semibold">
          {pending ? "Uploading…" : "Upload PDF"}
        </button>
      </div>
    </form>
  );
}

export function ReceiptsCell({
  orderId,
  orderRef,
  receipts,
  canManage,
  uploadKey,
  view,
}: {
  orderId: string;
  orderRef: string;
  receipts: readonly ReceiptMeta[];
  /** The person may attach and remove receipts (payments.record). Without it the panel only lists, views and downloads. */
  canManage: boolean;
  /** The receipt id this order's upload form starts with (chosen by the server page). */
  uploadKey: string;
  /** The table and the phone cards both draw this cell; the panel's id must be unique in each. */
  view: "table" | "card";
}) {
  const count = receipts.length;
  if (count === 0 && !canManage) return <span className="text-text-muted">—</span>;
  const id = `receipts-${view}-${orderId}`;
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        aria-label={count > 0 ? `Receipts for ${orderRef}: ${count} attached` : `Attach a receipt to ${orderRef}`}
        data-testid="receipts-button"
        className="btn-glass inline-flex h-10 min-w-[3.25rem] items-center justify-center gap-1.5 rounded-full px-3.5 text-xs font-semibold text-white xl:h-8 xl:px-3"
      >
        <Paperclip />
        <span className="tabular-nums">{count > 0 ? count : "Add"}</span>
      </button>
      <div id={id} popover="auto" role="dialog" aria-label={`Receipts for ${orderRef}`} className="m-auto w-[min(26rem,calc(100vw-2rem))] max-w-none bg-transparent p-0 text-white backdrop:bg-black/60" data-testid="receipts-panel">
        <div className="max-h-[85dvh] overflow-y-auto rounded-glass-lg border border-border-strong bg-surface-elevated p-4 shadow-[0_24px_60px_-16px_rgb(0_0_0/0.9)] sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display text-base font-semibold text-white">Receipts</h3>
              <p className="truncate text-xs text-text-muted">{orderRef}</p>
            </div>
            <button type="button" popoverTarget={id} popoverTargetAction="hide" aria-label="Close" className="btn-glass inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white">
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="m5 5 10 10M15 5 5 15" />
              </svg>
            </button>
          </div>
          {count === 0 ? (
            <p className="mt-3 text-sm text-text-muted" data-testid="receipt-empty">
              No receipts attached yet.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col divide-y divide-border/60" data-testid="receipt-list">
              {receipts.map((receipt) => (
                <li key={receipt.id} className="flex flex-col gap-1.5 py-2.5" data-testid="receipt-item">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <a href={receiptHref(receipt.id)} target="_blank" rel="noopener noreferrer" title={receipt.file_name} className="block truncate text-sm font-medium text-white hover:text-accent">
                        {receipt.file_name}
                      </a>
                      <p className="text-xs text-text-muted">
                        {formatFileSize(receipt.size_bytes)} · {formatDay(receipt.uploaded_at)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-xs font-semibold">
                      <a href={receiptHref(receipt.id)} target="_blank" rel="noopener noreferrer" className="text-text-secondary hover:text-white">
                        View
                      </a>
                      <a href={receiptHref(receipt.id, { download: true })} download className="text-text-secondary hover:text-white">
                        Download
                      </a>
                    </div>
                  </div>
                  {canManage ? <ReceiptRemoveForm receiptId={receipt.id} /> : null}
                </li>
              ))}
            </ul>
          )}
          {canManage ? (
            count >= MAX_RECEIPTS_PER_ORDER ? (
              <p className="mt-3 text-xs text-text-muted">An order can hold up to {MAX_RECEIPTS_PER_ORDER} receipts. Remove one to attach another.</p>
            ) : (
              <ReceiptUploader orderId={orderId} uploadKey={uploadKey} count={count} />
            )
          ) : null}
        </div>
      </div>
    </>
  );
}
