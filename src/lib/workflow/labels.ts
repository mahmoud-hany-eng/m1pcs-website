/**
 * The words for an order's fulfilment type. A plain module on purpose (no "use client", no server code): the staff order PAGE (a server
 * component) and the staff FORMS (client components) both need it. It used to live in components/admin/forms.tsx, a client module, and the page
 * called it from there; Next.js turns every export of a client module into a client reference when server code imports it, and calling one on
 * the server throws ("Attempted to call fulfillmentLabel() from the server but fulfillmentLabel is on the client"). That took the whole page down
 * for every order on the current workflow. supabase/tests/server-client-boundary.test.mjs now refuses that pattern anywhere in src/.
 */
import type { FulfillmentType } from "./types";

export const TYPE_LABEL: Record<FulfillmentType, string> = { custom_pc_build: "Custom PC build", parts_only: "Parts only" };

export const fulfillmentLabel = (type: FulfillmentType | null | undefined): string => (type ? TYPE_LABEL[type] : "Not chosen yet");
