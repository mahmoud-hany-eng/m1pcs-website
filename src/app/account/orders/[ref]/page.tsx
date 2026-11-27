import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountShell } from "@/components/account/AccountShell";
import { ItemsTable, MoneySummary, PaymentList, Timeline } from "@/components/account/dashboard";
import { EmptyState, Panel, ProgressSteps, StatusPill } from "@/components/account/ui";
import { WorkflowTimeline } from "@/components/workflow/WorkflowTimeline";
import { loadOrderDetail, loadStatuses, loadWorkflowStages } from "@/lib/accounts/server/data";
import { requireLinkedCustomer } from "@/lib/accounts/server/guard";
import { buildItems, buildOrderSummary, buildPayments, buildTimeline, formatDateTime, isOrderRef } from "@/lib/accounts/shared/view-models";
import { buildWorkflowTimeline, stagesForOrder } from "@/lib/workflow/timeline";

/**
 * One order. The reference in the address is only a lookup key: the database returns the order only if it belongs to
 * the signed-in customer, so an order that is someone else's is indistinguishable from one that does not exist.
 */
export default async function OrderDetailPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref: rawRef } = await params;
  const ref = decodeURIComponent(rawRef);
  const { user, supabase } = await requireLinkedCustomer(isOrderRef(ref) ? `/account/orders/${ref}` : "/account/orders");
  if (!isOrderRef(ref)) notFound();

  const [detail, statuses, stageRows] = await Promise.all([loadOrderDetail(supabase, ref), loadStatuses(supabase), loadWorkflowStages(supabase)]);
  if (!detail) notFound();

  const summary = buildOrderSummary(detail.order, statuses, stageRows);
  const timeline = buildTimeline(detail.events, statuses);
  // An order on the owner-defined workflow is drawn as ONE timeline with the shipment updates nested in Live tracking: the same
  // model the staff dashboard draws. An order on the earlier workflow (or a database without the stage data) keeps the page it always had.
  const stages = stagesForOrder(detail.order, stageRows, statuses);
  const workflow =
    (detail.order.workflow_version ?? 1) >= 2 && stages.length > 0
      ? buildWorkflowTimeline({
          stages,
          status: { code: summary.status.code, label: summary.status.label, description: summary.status.description, isTerminal: statuses.find((s) => s.code === summary.status.code)?.is_terminal === true },
          events: detail.events,
        })
      : null;
  const payments = buildPayments(detail.payments);
  const items = buildItems(detail.items);
  const latest = timeline.length > 0 ? timeline[timeline.length - 1] : null;

  return (
    <AccountShell active="orders" email={user.email} title={`Order ${summary.ref}`} description={`${summary.dateLabel} ${summary.placedOn}${summary.isHistorical ? " · Historical WhatsApp order" : ""}`}>
      <Link href="/account/orders" className="text-sm font-semibold text-accent underline-offset-2 hover:underline">
        ← All orders
      </Link>

      {summary.isHistorical ? (
        <Panel title="Your order" aside={<StatusPill status={summary.status} />}>
          <p className="text-sm text-text-secondary" data-testid="historical-note">
            You bought this from M1 on WhatsApp, before our website existed. It was completed on {summary.placedOn}. Tracking updates were not recorded for it, and nothing is outstanding.
          </p>
        </Panel>
      ) : (
      <Panel title="Where your order is" aside={<StatusPill status={summary.status} />}>
        <div className="flex flex-col gap-4">
          {workflow ? null : <ProgressSteps status={summary.status} />}
          {workflow ? null : <p className="text-sm text-text-secondary">{summary.status.description}</p>}
          {workflow ? <WorkflowTimeline timeline={workflow} formatTime={formatDateTime} audience="customer" /> : null}
          {!workflow && latest ? (
            <div className="glass-subtle rounded-glass-sm p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">Latest update · {latest.when}</p>
              <p className="mt-1 font-display text-base font-semibold text-white">{latest.title}</p>
              {latest.message ? <p className="mt-1 text-sm text-text-secondary">{latest.message}</p> : null}
            </div>
          ) : null}
        </div>
      </Panel>
      )}

      <Panel title="Payments and balance">
        <div className="flex flex-col gap-6">
          <MoneySummary order={summary} />
          {summary.depositOutstanding ? (
            <p className="text-sm text-warning">The deposit is not fully paid yet: {summary.depositOutstanding} to go. M1 confirms each payment by hand once it is received.</p>
          ) : null}
          {payments.length > 0 ? (
            <PaymentList payments={payments} />
          ) : summary.isHistorical ? (
            <p className="text-sm text-text-secondary">This purchase was settled before the website existed, so there are no individual payment records to list here.</p>
          ) : (
            <p className="text-sm text-text-secondary">No payment has been recorded on this order yet. A payment appears here only after M1 confirms it was received.</p>
          )}
        </div>
      </Panel>

      <Panel title="What is in your order">
        <ItemsTable items={items} />
      </Panel>

      {workflow || summary.isHistorical ? null : (
      <Panel title="Tracking timeline">
        {timeline.length > 0 ? (
          <Timeline entries={timeline} />
        ) : (
          <EmptyState title="No updates yet">
            <p>M1 posts an update here at each important step, such as sourcing, arrival and building. The first one will appear soon.</p>
          </EmptyState>
        )}
      </Panel>
      )}
    </AccountShell>
  );
}
