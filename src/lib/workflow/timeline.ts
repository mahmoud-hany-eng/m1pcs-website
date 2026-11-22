/**
 * The ONE description of an order's workflow, shared by the customer tracker and the staff dashboard so that they cannot
 * disagree. Pure functions over plain rows (no server, no database, no locale): the staff page feeds it what the staff
 * function `admin.get_order` returns, the customer page feeds it the rows its own session may read, and both draw the result.
 *
 * What it knows and what it deliberately does not:
 *   - The stages, their order and which of them owns the nested Live tracking updates come from DATA
 *     (public.order_workflow_stages, via the `shows_tracking` flag). No status code decides what is nested.
 *   - "On hold" and "Cancelled" are the two exceptional states; they are not stages.
 *   - It never invents a tracking update or a place: it only arranges the ones staff published.
 *   - It carries no staff-only control. Whether a person may publish an update is decided by the staff page and, above all,
 *     by the database; nothing here is a permission.
 */

export type FulfillmentTypeValue = "custom_pc_build" | "parts_only";

export interface StageInput {
  code: string;
  label: string;
  description?: string;
  position: number;
  shows_tracking: boolean;
}

/** A row of public.order_workflow_stages joined with the status's customer wording. */
export interface StageRowInput {
  workflow_version: number;
  branch: "any" | FulfillmentTypeValue;
  position: number;
  status_code: string;
  shows_tracking: boolean;
}
export interface StatusWordingInput {
  code: string;
  customer_label: string;
  customer_description: string;
}

/**
 * The stages one order follows: its workflow's shared stages plus the branch of its fulfilment type (none until staff choose
 * the type, so the customer is never shown a branch nobody has decided). An empty list means "no stage data": the caller then
 * falls back to the earlier behaviour (a database that does not have the stages yet, for example).
 */
export function stagesForOrder(
  order: { workflow_version?: number | null; fulfillment_type?: FulfillmentTypeValue | null },
  rows: readonly StageRowInput[],
  statuses: readonly StatusWordingInput[],
): StageInput[] {
  const version = order.workflow_version ?? 1;
  const wording = new Map(statuses.map((s) => [s.code, s] as const));
  return rows
    .filter((r) => r.workflow_version === version && (r.branch === "any" || r.branch === (order.fulfillment_type ?? null)))
    .sort((a, b) => a.position - b.position)
    .flatMap((r) => {
      const w = wording.get(r.status_code);
      return w ? [{ code: r.status_code, label: w.customer_label, description: w.customer_description, position: r.position, shows_tracking: r.shows_tracking }] : [];
    });
}

export interface TrackingEventInput {
  id: string;
  title: string;
  message: string | null;
  location?: string | null;
  published_at: string;
  occurred_at?: string | null;
  event_kind?: "update" | "correction" | null;
  corrects_event_id?: string | null;
  /** Staff view only: a withdrawn update. The customer's own session never receives one. */
  retracted?: boolean;
  retraction_reason?: string | null;
  correction_reason?: string | null;
  by?: string | null;
}

export interface TrackingNode {
  id: string;
  title: string;
  message: string | null;
  location: string | null;
  /** The time the event happened (as staff typed it), or when it was published if they gave none. ISO. */
  at: string;
  /** When it was published. ISO. */
  recordedAt: string;
  kind: "update" | "correction";
  /** The title of the update a correction points at, when it points at one that is in this list. */
  correctsTitle: string | null;
  retracted: boolean;
  retractionReason: string | null;
  correctionReason: string | null;
  by: string | null;
  /** True for exactly one node: the newest update that has not been withdrawn. */
  isLatest: boolean;
}

export type StageState = "done" | "current" | "upcoming";

export interface StageNode {
  code: string;
  label: string;
  description: string;
  state: StageState;
  /** The order is on hold while at this stage. */
  held: boolean;
  /** This stage owns the nested tracking updates. */
  isTrackingStage: boolean;
  /** Updates nested in this stage, oldest first. Empty for every stage except the tracking stage. */
  updates: TrackingNode[];
}

export interface WorkflowTimeline {
  stages: StageNode[];
  /** The highlighted stage: where the order is now (or was when it was put on hold). Null when unknown or finished. */
  currentCode: string | null;
  /** Set when the order is on hold or cancelled. */
  exceptional: { code: string; label: string; description: string } | null;
  /** True when the order is complete (every stage shows as done). */
  complete: boolean;
  trackingStageCode: string | null;
  /** The order is in the tracking stage right now: it is the stage staff publish into, so it opens by default. */
  trackingLive: boolean;
  /** Every visible update, oldest first, whether nested or not. */
  allUpdates: TrackingNode[];
  /** Updates when the workflow has no tracking stage (the earlier workflow): shown as one flat list, as before. */
  looseUpdates: TrackingNode[];
  latest: TrackingNode | null;
}

export interface TimelineInput {
  stages: readonly StageInput[];
  status: { code: string; label: string; description?: string; isTerminal?: boolean };
  /**
   * The stage the order was at before it was put on hold (or cancelled). Staff can see it; a customer's own session cannot,
   * so it is optional: without it an exceptional order shows no "current" stage rather than a guess.
   */
  stoppedAt?: string | null;
  events: readonly TrackingEventInput[];
  /** Staff pass true to also see withdrawn updates (struck through); the customer view never has any. */
  includeRetracted?: boolean;
}

const EXCEPTIONAL = new Set(["on_hold", "cancelled"]);

const time = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** The order updates are shown in: when the event happened, then when it was published, then the id (a total order). */
export function compareTracking(a: { at: string; recordedAt: string; id: string }, b: { at: string; recordedAt: string; id: string }): number {
  return time(a.at) - time(b.at) || time(a.recordedAt) - time(b.recordedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function buildTrackingNodes(events: readonly TrackingEventInput[], includeRetracted = false): TrackingNode[] {
  const titles = new Map(events.map((e) => [e.id, e.title] as const));
  const nodes = events
    .filter((e) => includeRetracted || !e.retracted)
    .map<TrackingNode>((e) => ({
      id: e.id,
      title: e.title,
      message: e.message,
      location: e.location ?? null,
      at: e.occurred_at ?? e.published_at,
      recordedAt: e.published_at,
      kind: e.event_kind === "correction" ? "correction" : "update",
      correctsTitle: e.corrects_event_id ? (titles.get(e.corrects_event_id) ?? null) : null,
      retracted: e.retracted === true,
      retractionReason: e.retraction_reason ?? null,
      correctionReason: e.correction_reason ?? null,
      by: e.by ?? null,
      isLatest: false,
    }))
    .sort(compareTracking);
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (!nodes[i].retracted) {
      nodes[i].isLatest = true;
      break;
    }
  }
  return nodes;
}

export function buildWorkflowTimeline(input: TimelineInput): WorkflowTimeline {
  const stages = [...input.stages].sort((a, b) => a.position - b.position);
  const exceptional = EXCEPTIONAL.has(input.status.code);
  const effective = exceptional ? (input.stoppedAt ?? null) : input.status.code;
  const complete = !exceptional && input.status.isTerminal === true && stages.some((s) => s.code === input.status.code);
  const index = effective ? stages.findIndex((s) => s.code === effective) : -1;
  const trackingStage = stages.find((s) => s.shows_tracking) ?? null;

  const all = buildTrackingNodes(input.events, input.includeRetracted === true);
  const nodes = stages.map<StageNode>((s, i) => ({
    code: s.code,
    label: s.label,
    description: s.description ?? "",
    state: complete || (index >= 0 && i < index) ? "done" : index >= 0 && i === index ? "current" : "upcoming",
    held: exceptional && index >= 0 && i === index,
    isTrackingStage: s.shows_tracking,
    updates: s.shows_tracking ? all : [],
  }));
  const latest = all.find((n) => n.isLatest) ?? null;
  return {
    stages: nodes,
    currentCode: complete || index < 0 ? null : stages[index].code,
    exceptional: exceptional ? { code: input.status.code, label: input.status.label, description: input.status.description ?? "" } : null,
    complete,
    trackingStageCode: trackingStage?.code ?? null,
    trackingLive: !exceptional && trackingStage !== null && input.status.code === trackingStage.code,
    allUpdates: all,
    looseUpdates: trackingStage ? [] : all,
    latest,
  };
}
