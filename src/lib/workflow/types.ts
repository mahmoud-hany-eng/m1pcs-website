/**
 * Small shared shapes of the order workflow. They live outside src/lib/staff so that a client component (the staff forms) can use
 * them: the rule is that no client component imports staff server code, and these are plain types with no behaviour.
 */
export type FulfillmentType = "custom_pc_build" | "parts_only";
/** Where an order is in its Live tracking life; null for an order on the earlier workflow. */
export type TrackingPhase = "not_started" | "live" | "paused" | "ended" | "cancelled";
export interface WorkflowStageEntry {
  code: string;
  label: string;
  description: string;
  position: number;
  shows_tracking: boolean;
}
export interface AdoptionOption {
  target_status: string;
  label: string;
  is_default: boolean;
  requires_fulfillment: FulfillmentType | null;
}
export interface NextStatus {
  code: string;
  label: string;
  /** Why this move cannot be made yet, in words; null when it can be made now. */
  blocked_reason?: string | null;
}
