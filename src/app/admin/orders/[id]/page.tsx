import { randomUUID } from "node:crypto";
import Link from "next/link";
import { AdminShell } from "@/components/admin/AdminShell";
import { AdminMissing } from "@/components/admin/Missing";
import { Badge, DataTable, Empty, KeyValues, Money, Section, StatusBadge } from "@/components/admin/ui";
import {
  AdoptWorkflowForm,
  FulfillmentTypeForm,
  PaymentForm,
  RetractTrackingForm,
  ReversePaymentForm,
  TrackingCorrectionForm,
  TrackingForm,
  TransitionForm,
} from "@/components/admin/forms";
import { WorkflowTimeline } from "@/components/workflow/WorkflowTimeline";
import { fulfillmentLabel } from "@/lib/workflow/labels";
import { buildWorkflowTimeline } from "@/lib/workflow/timeline";
import { entryLabel, formatDay, formatWhen, methodLabel, percentLabel, plainAmount, purposeLabel } from "@/lib/staff/format";
import { StaffOperationError } from "@/lib/staff/gateway";
import { isUuid } from "@/lib/staff/validation";
import { requireStaff } from "@/lib/staff/session";
import type { OrderDetail } from "@/lib/staff/types";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { staff, api, can } = await requireStaff(`/admin/orders/${isUuid(id) ? id : ""}`);
  if (!isUuid(id) || !can("orders.read")) return <AdminMissing active="orders" email={staff.email} can={can} />;
  let order: OrderDetail;
  try {
    order = await api.getOrder(id);
  } catch (error) {
    if (error instanceof StaffOperationError) return <AdminMissing active="orders" email={staff.email} can={can} />;
    throw error;
  }
  const fixed = order.deposit_fixed_at !== null;
  const payments = order.payments;
  const defaultPurpose = order.deposit_outstanding_minor > 0 ? "deposit" : "balance";
  const defaultAmount = plainAmount(order.deposit_outstanding_minor > 0 ? order.deposit_outstanding_minor : Math.max(order.balance_due_minor, 0));
  // The staff dashboard and the customer tracker draw the SAME model (src/lib/workflow/timeline.ts) from the same stage data.
  // An earlier database that has not been given the stage data yet returns no stages: the page then shows the flat list it always did.
  const stages = order.stages ?? [];
  const onCurrentWorkflow = (order.workflow_version ?? 1) >= 2 && stages.length > 0;
  const timeline = stages.length > 0
    ? buildWorkflowTimeline({
        stages,
        status: { code: order.status, label: order.status_label, isTerminal: order.status_is_terminal === true },
        stoppedAt: order.held_from ?? null,
        events: order.tracking,
        includeRetracted: true,
      })
    : null;
  const phase = order.tracking_phase ?? null;
  const type = order.fulfillment_type ?? null;
  const correctable = order.tracking.filter((event) => !event.retracted && event.event_kind !== "correction").map((event) => ({ id: event.id, title: event.title }));
  const trackingFooter = !onCurrentWorkflow ? null : phase === "live" ? (
    can("tracking.publish") ? <TrackingForm orderId={order.id} /> : <p className="text-sm text-text-muted">Your role cannot publish tracking updates.</p>
  ) : phase === "not_started" ? (
    <p className="text-sm text-text-muted" data-testid="tracking-closed">Tracking updates open when the order reaches Live tracking. None can be published before then.</p>
  ) : phase === "cancelled" ? (
    <p className="text-sm text-text-muted" data-testid="tracking-closed">This order was cancelled. No further tracking updates can be added.</p>
  ) : (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted" data-testid="tracking-closed">
        {phase === "paused" ? "This order is on hold, so tracking updates wait until it returns to Live tracking. " : "Live tracking has ended for this order, so the history is read-only. "}
        Adding to it now is a correction, made by the owner with a reason.
      </p>
      {can("tracking.correct") ? <TrackingCorrectionForm orderId={order.id} corrects={correctable} /> : null}
    </div>
  );
  return (
    <AdminShell
      active="orders"
      email={staff.email}
      can={can}
      title={order.order_ref}
      description={`${order.customer.full_name} · placed ${formatDay(order.created_at)}`}
      previewLabel={process.env.CUSTOMER_ACCOUNTS_PREVIEW_LABEL?.slice(0, 160) ?? null}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {onCurrentWorkflow ? <Badge tone="neutral">{fulfillmentLabel(type)}</Badge> : null}
          <StatusBadge code={order.status} label={order.status_label} />
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-4" data-testid="order-money">
        <Money3 label="Order total" minor={order.total_minor} />
        <Money3 label={fixed ? "Deposit required" : "Deposit (provisional)"} minor={order.deposit_required_minor} hint={fixed ? `Fixed ${formatDay(order.deposit_fixed_at)}` : "Fixed when the order is confirmed"} />
        {payments !== undefined ? <Money3 label="Received" minor={order.amount_paid_minor} /> : null}
        {payments !== undefined ? <Money3 label="Balance due" minor={order.balance_due_minor} tone="red" /> : null}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="flex min-w-0 flex-col gap-6">
          {timeline ? (
            <Section title="Order progress" aside={onCurrentWorkflow ? undefined : <Badge tone="paused">Earlier workflow</Badge>}>
              <WorkflowTimeline
                timeline={timeline}
                formatTime={formatWhen}
                audience="staff"
                updateExtras={onCurrentWorkflow && can("tracking.publish") ? (node) => <RetractTrackingForm orderId={order.id} eventId={node.id} /> : undefined}
                trackingFooter={trackingFooter}
                branchNote={
                  onCurrentWorkflow && type === null ? (
                    <p className="rounded-glass-sm border border-warning/40 bg-warning/10 p-3 text-sm text-warning" data-testid="branch-note">
                      The steps after “Carrier delivering order to M1” depend on the order type (Custom PC build or Parts only). It has not been chosen yet. Choose it under Order type.
                    </p>
                  ) : null
                }
              />
            </Section>
          ) : null}

          {can("orders.transition") ? (
            <Section title="Status">
              <TransitionForm orderId={order.id} next={order.next_statuses} />
            </Section>
          ) : null}

          {onCurrentWorkflow ? (
            <Section title="Order type">
              {can("orders.transition") ? (
                <FulfillmentTypeForm orderId={order.id} current={type} locked={order.fulfillment_locked === true || order.status === "cancelled"} />
              ) : (
                <p className="text-sm text-text-secondary">{fulfillmentLabel(type)}</p>
              )}
            </Section>
          ) : null}

          {order.adoption_options && order.adoption_options.length > 0 && can("orders.adopt") ? (
            <Section title="Move to the current workflow">
              <AdoptWorkflowForm orderId={order.id} options={order.adoption_options} />
            </Section>
          ) : null}

          <Section title="Items">
            <DataTable
              rows={order.items}
              rowKey={(i) => String(i.position)}
              empty="No items."
              columns={[
                { key: "desc", header: "Item", cell: (i) => i.description, primary: true },
                { key: "kind", header: "Type", cell: (i) => i.kind.replace(/_/g, " ") },
                { key: "qty", header: "Qty", cell: (i) => i.quantity, align: "right" },
                { key: "unit", header: "Unit price", cell: (i) => <Money minor={i.unit_price_minor} />, align: "right" },
                { key: "line", header: "Line total", cell: (i) => <Money minor={i.line_total_minor} />, align: "right" },
              ]}
            />
          </Section>

          {onCurrentWorkflow ? null : (
            <Section title="Tracking updates shown to the customer">
              {order.tracking.length === 0 ? (
                <Empty>No update has been published yet.</Empty>
              ) : (
                <ol className="flex flex-col gap-3">
                  {order.tracking.map((event) => (
                    <li key={event.id} className="rounded-glass-sm border border-border bg-white/[0.025] p-3.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className={`text-sm font-semibold ${event.retracted ? "text-text-muted line-through" : "text-white"}`}>{event.title}</p>
                        <span className="text-xs text-text-muted">{formatWhen(event.occurred_at ?? event.published_at)}</span>
                      </div>
                      {event.location ? <p className="mt-1 text-xs text-text-secondary">Location: {event.location}</p> : null}
                      {event.message ? <p className="mt-1 text-sm text-text-secondary">{event.message}</p> : null}
                      {event.retracted ? <p className="mt-2 text-xs text-warning">Withdrawn{event.retraction_reason ? `: ${event.retraction_reason}` : ""}. The customer no longer sees it.</p> : null}
                      {!event.retracted && can("tracking.publish") ? (
                        <div className="mt-2">
                          <RetractTrackingForm orderId={order.id} eventId={event.id} />
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
              {can("tracking.publish") ? (
                <div className="mt-5 border-t border-border pt-5">
                  <TrackingForm orderId={order.id} />
                </div>
              ) : null}
            </Section>
          )}

          <Section title="Status history">
            <DataTable
              rows={order.history}
              rowKey={(h) => `${h.at}-${h.to_status}`}
              empty="No history."
              columns={[
                { key: "to", header: "Status", cell: (h) => h.to_status.replace(/_/g, " "), primary: true },
                { key: "at", header: "When", cell: (h) => formatWhen(h.at) },
                { key: "by", header: "By", cell: (h) => h.by ?? "—" },
                { key: "reason", header: "Reason", cell: (h) => h.reason ?? "—" },
              ]}
            />
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Section title="Customer">
            <KeyValues
              items={[
                { label: "Name", value: <Link href={`/admin/customers/${order.customer.id}`} className="text-accent hover:underline">{order.customer.full_name}</Link> },
                { label: "Code", value: <span className="font-mono text-xs">{order.customer.customer_code}</span> },
                { label: "Phone", value: order.customer.phone ?? "—" },
                { label: "Email", value: order.customer.email ?? "—" },
                { label: "Delivery", value: order.delivery_method ? order.delivery_method : "Not decided" },
                { label: "Address", value: order.delivery_address ?? "—" },
              ]}
            />
          </Section>

          <Section title="Deposit">
            {fixed ? (
              <div className="flex flex-col gap-2 text-sm">
                <p className="text-text-secondary">
                  Fixed at <span className="font-semibold text-white"><Money minor={order.deposit_required_minor} /></span>
                  {order.deposit_rate_bps !== null ? ` (${percentLabel(order.deposit_rate_bps)} of the whole total)` : ""}, using version {order.deposit_policy_version ?? "—"} of the schedule.
                </p>
                {order.deposit_rule ? <p className="text-xs text-text-muted">{order.deposit_rule}</p> : null}
                <p className="text-xs text-text-muted">A later change to the schedule does not change this order.</p>
              </div>
            ) : (
              <p className="text-sm text-text-secondary">The deposit is worked out from the current schedule and fixed, once, when the order is confirmed. The figure above is provisional until then.</p>
            )}
            <p className="mt-3 text-sm">
              {order.deposit_received ? <Badge tone="done">Deposit received (recorded by staff)</Badge> : <Badge tone="paused">Deposit not received yet</Badge>}
            </p>
          </Section>
        </div>
      </div>

      {payments !== undefined ? (
        <Section title="Payments">
          <DataTable
            rows={payments}
            rowKey={(p) => p.id}
            empty="No payment has been recorded for this order."
            columns={[
              { key: "receipt", header: "Receipt", cell: (p) => <span className="font-mono text-xs">{p.receipt_number ?? "—"}</span>, primary: true },
              { key: "type", header: "Type", cell: (p) => (p.entry_type === "payment" ? purposeLabel(p.purpose) : entryLabel(p.entry_type)) },
              { key: "amount", header: "Amount", cell: (p) => <Money minor={p.amount_minor} />, align: "right" },
              { key: "method", header: "Method", cell: (p) => methodLabel(p.method) },
              { key: "ref", header: "Reference (private)", cell: (p) => p.internal_reference ?? "—" },
              { key: "when", header: "Received", cell: (p) => formatWhen(p.received_at) },
              { key: "by", header: "Recorded by", cell: (p) => p.recorded_by ?? "—", hideOnCard: true },
              {
                key: "state",
                header: "",
                cell: (p, view) =>
                  p.reversed ? <Badge tone="cancelled">Reversed</Badge> : p.entry_type === "payment" && can("payments.reverse") ? <ReversePaymentForm orderId={order.id} paymentId={p.id} scope={view} /> : null,
              },
            ]}
          />
          {can("payments.record") ? (
            <div className="mt-5 border-t border-border pt-5">
              <h3 className="mb-3 font-display text-base font-semibold text-white">Record a payment</h3>
              <PaymentForm orderId={order.id} defaultPurpose={defaultPurpose} defaultAmount={defaultAmount} idempotencyKey={randomUUID()} expectedPaidMinor={order.amount_paid_minor} />
            </div>
          ) : null}
        </Section>
      ) : null}
    </AdminShell>
  );
}

function Money3({ label, minor, hint, tone = "default" }: { label: string; minor: number; hint?: string; tone?: "default" | "red" }) {
  return (
    <div className={`glass glass-flat ${tone === "red" ? "glass-tint-red" : ""} flex flex-col gap-1 p-4 sm:p-5`}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-text-muted">{label}</span>
      <span className="font-display text-xl font-semibold text-white sm:text-2xl">
        <Money minor={minor} />
      </span>
      {hint ? <span className="text-xs text-text-secondary">{hint}</span> : null}
    </div>
  );
}
