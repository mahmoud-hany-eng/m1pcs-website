/**
 * The order's main timeline: ONE component drawn for the staff dashboard and for the customer tracker, from the same
 * model (src/lib/workflow/timeline.ts), so the two cannot show different workflows. Completed stages carry a check, the
 * current stage is highlighted, later stages are muted.
 *
 * Live tracking is ONE stage. Its shipment updates are nested inside it, in a vertical timeline of connected dots (a check for
 * each earlier update, a ring and a "Latest" mark for the newest), inside a native <details> element: it expands and collapses
 * with a click or the keyboard, needs no script, and is open while the order is in Live tracking.
 *
 * A server component with no state. Staff-only controls are not part of it: the staff page hands them in through the three
 * slots below, and the customer page hands in none, so a customer's page has nothing staff-only to hide.
 */
import type { ReactNode } from "react";
import type { StageNode, TrackingNode, WorkflowTimeline as TimelineModel } from "@/lib/workflow/timeline";

export interface WorkflowTimelineProps {
  timeline: TimelineModel;
  /** Formats an ISO instant for display (each area has its own formatter; both use Qatar time). */
  formatTime: (iso: string) => string;
  audience: "staff" | "customer";
  /** Staff only: what is drawn under one update (for example the withdraw control). */
  updateExtras?: (node: TrackingNode) => ReactNode;
  /** Staff only: drawn at the bottom of the Live tracking section (the publish form, or why it is closed). */
  trackingFooter?: ReactNode;
  /** Staff only: drawn after the last common stage when the order's type has not been chosen yet. */
  branchNote?: ReactNode;
}

function Check({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8.5l3 3 6-7" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-4 w-4 shrink-0 text-text-muted transition-transform duration-200 group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 6l4.5 4.5L12.5 6" />
    </svg>
  );
}

function Pin() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 14s4.5-3.9 4.5-7.5a4.5 4.5 0 10-9 0C3.5 10.1 8 14 8 14z" />
      <circle cx="8" cy="6.5" r="1.5" />
    </svg>
  );
}

function StageDot({ stage }: { stage: StageNode }) {
  if (stage.state === "done") {
    return (
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-white" data-dot="done">
        <Check />
      </span>
    );
  }
  if (stage.state === "current") {
    const tone = stage.held ? "border-warning bg-warning/15 text-warning" : "border-primary bg-primary/15 text-primary";
    return (
      <span className={`flex h-7 w-7 items-center justify-center rounded-full border-2 shadow-[0_0_0_4px_rgba(255,255,255,0.04)] ${tone}`} data-dot="current">
        <span className="h-2.5 w-2.5 rounded-full bg-current" />
      </span>
    );
  }
  return <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border-strong text-text-muted" data-dot="upcoming" />;
}

function UpdateNode({ node, formatTime, audience, extras }: { node: TrackingNode; formatTime: (iso: string) => string; audience: "staff" | "customer"; extras?: (node: TrackingNode) => ReactNode }) {
  const retracted = node.retracted;
  return (
    <li
      className="group/update relative flex gap-3 pb-5 last:pb-0"
      data-testid="tracking-update"
      data-latest={node.isLatest ? "true" : "false"}
      data-kind={node.kind}
      data-retracted={retracted ? "true" : "false"}
    >
      <span aria-hidden="true" className="absolute bottom-0 left-[9px] top-5 w-px bg-border-strong/80 group-last/update:hidden" data-rail />
      <span className="relative z-10 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
        {node.isLatest ? (
          <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-primary bg-primary/20 shadow-[0_0_0_3px_rgba(220,38,38,0.12)]" data-dot="latest">
            <span className="h-2 w-2 rounded-full bg-primary" />
          </span>
        ) : retracted ? (
          <span className="h-3.5 w-3.5 rounded-full border border-border-strong bg-transparent" data-dot="withdrawn" />
        ) : (
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/80 text-white" data-dot="update">
            <Check className="h-2.5 w-2.5" />
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className={`text-sm font-semibold ${retracted ? "text-text-muted line-through" : "text-white"}`}>{node.title}</p>
          {node.isLatest ? <span className="rounded-full border border-primary/50 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-primary">Latest</span> : null}
          {node.kind === "correction" ? <span className="rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-warning">Correction</span> : null}
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-text-muted">
          <time dateTime={node.at}>{formatTime(node.at)}</time>
          {node.location ? (
            <span className="inline-flex items-center gap-1 text-text-secondary" data-testid="tracking-location">
              <Pin />
              {node.location}
            </span>
          ) : null}
        </p>
        {node.message ? <p className="mt-1 text-sm text-text-secondary">{node.message}</p> : null}
        {node.correctsTitle ? <p className="mt-1 text-xs text-text-muted">Corrects: {node.correctsTitle}</p> : null}
        {audience === "staff" ? (
          <div className="mt-1 flex flex-col gap-1 text-xs text-text-muted">
            <p>
              Published by {node.by ?? "—"}
              {node.at !== node.recordedAt ? ` at ${formatTime(node.recordedAt)}` : ""}
            </p>
            {node.correctionReason ? <p>Reason for the correction: {node.correctionReason}</p> : null}
            {retracted ? <p className="text-warning">Withdrawn{node.retractionReason ? `: ${node.retractionReason}` : ""}. The customer no longer sees it.</p> : null}
          </div>
        ) : null}
        {audience === "staff" && !retracted && extras ? <div className="mt-2">{extras(node)}</div> : null}
      </div>
    </li>
  );
}

function TrackingSection({ stage, timeline, formatTime, audience, updateExtras, trackingFooter }: { stage: StageNode; timeline: TimelineModel } & Omit<WorkflowTimelineProps, "timeline" | "branchNote">) {
  const updates = stage.updates;
  const latest = timeline.latest;
  // Open while the order is in Live tracking (that is where updates arrive); a person can open or close it at any time.
  const open = timeline.trackingLive;
  return (
    <details className="group mt-3 rounded-glass-sm border border-border bg-white/[0.025]" open={open} data-testid="live-tracking-section" data-updates={updates.length}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-glass-sm p-3.5 marker:hidden [&::-webkit-details-marker]:hidden" data-testid="live-tracking-toggle">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-white">
            Tracking updates <span className="font-normal text-text-muted">· {updates.length === 0 ? "none yet" : `${updates.length} ${updates.length === 1 ? "update" : "updates"}`}</span>
          </span>
          {latest ? (
            <span className="mt-0.5 block truncate text-xs text-text-secondary" data-testid="live-tracking-latest">
              Latest: {latest.title}
              {latest.location ? ` · ${latest.location}` : ""} · {formatTime(latest.at)}
            </span>
          ) : null}
        </span>
        <Chevron />
      </summary>
      <div className="border-t border-border p-3.5">
        {updates.length === 0 ? (
          <p className="text-sm text-text-secondary" data-testid="tracking-empty">
            {timeline.trackingLive ? "No update has been published yet. The first one will appear here." : "No tracking updates were published for this order."}
          </p>
        ) : (
          <ol className="flex flex-col" data-testid="tracking-updates" aria-label="Tracking updates, oldest first">
            {updates.map((node) => (
              <UpdateNode key={node.id} node={node} formatTime={formatTime} audience={audience} extras={updateExtras} />
            ))}
          </ol>
        )}
        {audience === "staff" && trackingFooter ? <div className="mt-4 border-t border-border pt-4">{trackingFooter}</div> : null}
      </div>
    </details>
  );
}

export function WorkflowTimeline(props: WorkflowTimelineProps) {
  const { timeline, formatTime, audience, branchNote } = props;
  return (
    <div data-testid="workflow-timeline" data-audience={audience}>
      {timeline.exceptional ? (
        <div
          className={`mb-4 rounded-glass-sm border p-3.5 text-sm ${timeline.exceptional.code === "cancelled" ? "border-error/40 bg-error/10 text-error" : "border-warning/40 bg-warning/10 text-warning"}`}
          role="status"
          data-testid="workflow-exception"
          data-code={timeline.exceptional.code}
        >
          <p className="font-semibold">{timeline.exceptional.label}</p>
          {timeline.exceptional.description ? <p className="mt-0.5 text-text-secondary">{timeline.exceptional.description}</p> : null}
        </div>
      ) : null}
      <ol className="flex flex-col" aria-label="Order progress">
        {timeline.stages.map((stage, index) => {
          const last = index === timeline.stages.length - 1;
          const linkDone = stage.state === "done";
          return (
            <li
              key={stage.code}
              className="group relative flex gap-4 pb-6 last:pb-0"
              data-testid="workflow-stage"
              data-stage={stage.code}
              data-state={stage.state}
              data-held={stage.held ? "true" : "false"}
              aria-current={stage.state === "current" ? "step" : undefined}
            >
              {last ? null : <span aria-hidden="true" className={`absolute bottom-0 left-[13px] top-7 w-px ${linkDone ? "bg-primary/70" : "bg-border-strong/70"}`} data-rail />}
              <span className="relative z-10 shrink-0">
                <StageDot stage={stage} />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className={`font-display text-sm font-semibold sm:text-base ${stage.state === "upcoming" ? "text-text-muted" : "text-white"}`}>{stage.label}</p>
                  {stage.state === "current" ? (
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${stage.held ? "border-warning/50 bg-warning/10 text-warning" : "border-primary/50 bg-primary/10 text-primary"}`}>
                      {stage.held ? "Paused here" : "Current"}
                    </span>
                  ) : null}
                </div>
                {stage.state === "current" && stage.description ? <p className="mt-0.5 text-sm text-text-secondary">{stage.description}</p> : null}
                {stage.isTrackingStage ? <TrackingSection stage={stage} timeline={timeline} formatTime={formatTime} audience={audience} updateExtras={props.updateExtras} trackingFooter={props.trackingFooter} /> : null}
              </div>
            </li>
          );
        })}
      </ol>
      {audience === "staff" && branchNote ? <div className="mt-4">{branchNote}</div> : null}
    </div>
  );
}
