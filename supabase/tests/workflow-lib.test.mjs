// Unit tests for the order-workflow logic that needs no server, no database and no browser: the shared timeline model that both
// the customer tracker and the staff dashboard draw from, the customer status view that now follows each order's own stage list,
// the staff-form validators for the new tracking fields, and the TIMELINE COMPONENT rendered to HTML on the server.
// They say nothing about a real Supabase project. Every name and time is synthetic.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, test } from "node:test";

register("./support/alias-loader.mjs", import.meta.url);

let skip = false;
let timeline;
let views;
let staffValidation;
let ui;
const here = new URL(".", import.meta.url).pathname;
try {
  timeline = await import("../../src/lib/workflow/timeline.ts");
  views = await import("../../src/lib/accounts/shared/view-models.ts");
  staffValidation = await import("../../src/lib/staff/validation.ts");
  ui = await loadComponent();
} catch (error) {
  if (process.env.M1_REQUIRE_PG === "1") throw error;
  skip = `this Node version cannot import TypeScript directly (${error.code ?? error.message}); use Node 22.18 or newer`;
}

/** Compiles the timeline component (TSX) with the project's own TypeScript and returns a function that renders it to static HTML. */
async function loadComponent() {
  const require = createRequire(import.meta.url);
  const ts = require("typescript");
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const source = readFileSync(join(here, "..", "..", "src", "components", "workflow", "WorkflowTimeline.tsx"), "utf8");
  const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const dir = join(tmpdir(), `m1-workflow-ui-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "WorkflowTimeline.mjs");
  writeFileSync(file, `import React from ${JSON.stringify(pathToFileURL(require.resolve("react")).href)};\n${out}`);
  const mod = await import(pathToFileURL(file).href);
  return { render: (props) => renderToStaticMarkup(React.createElement(mod.WorkflowTimeline, props)), React };
}

// ---- the data the database holds (public.order_statuses and public.order_workflow_stages), restated for the tests --------
const WORDING = [
  ["pending_confirmation", "Order received"], ["awaiting_deposit", "Awaiting deposit"], ["deposit_received", "Deposit confirmed"],
  ["order_confirmed", "Order confirmed"], ["live_tracking", "Live tracking"], ["arrived_in_qatar", "Order arrived in Qatar"],
  ["carrier_delivering", "Carrier delivering order to M1"], ["building", "M1 is building your PC"], ["quality_check", "Final quality checks"],
  ["items_arrived", "Items arrived at M1"], ["awaiting_scheduling", "Awaiting scheduling for pickup or delivery"],
  ["ready_for_delivery", "Ready for delivery or pickup"], ["delivered", "Delivered / Collected"], ["sourcing", "Sourcing your parts"],
  ["in_transit", "On its way to Qatar"], ["on_hold", "On hold"], ["cancelled", "Cancelled"],
].map(([code, customer_label], i) => ({ code, customer_label, customer_description: `${customer_label}.`, sort_order: code === "on_hold" ? 900 : code === "cancelled" ? 910 : (i + 1) * 10, is_terminal: code === "delivered" || code === "cancelled", is_provisional: false }));
const row = (workflow_version, branch, position, status_code, shows_tracking = false) => ({ workflow_version, branch, position, status_code, shows_tracking });
const STAGE_ROWS = [
  ...["pending_confirmation", "awaiting_deposit", "deposit_received", "sourcing", "in_transit", "building", "quality_check", "ready_for_delivery", "delivered"].map((c, i) => row(1, "any", i + 1, c)),
  ...["pending_confirmation", "awaiting_deposit", "deposit_received", "order_confirmed"].map((c, i) => row(2, "any", (i + 1) * 10, c)),
  row(2, "any", 50, "live_tracking", true), row(2, "any", 60, "arrived_in_qatar"), row(2, "any", 70, "carrier_delivering"), row(2, "any", 100, "ready_for_delivery"), row(2, "any", 110, "delivered"),
  row(2, "custom_pc_build", 80, "building"), row(2, "custom_pc_build", 90, "quality_check"), row(2, "parts_only", 80, "items_arrived"), row(2, "parts_only", 90, "awaiting_scheduling"),
];
const codes = (stages) => stages.map((s) => s.code);
const stagesOf = (order) => timeline.stagesForOrder(order, STAGE_ROWS, WORDING);
const wording = (code) => WORDING.find((w) => w.code === code);
const build = (status, { type = "custom_pc_build", version = 2, events = [], stoppedAt = null, includeRetracted = false } = {}) =>
  timeline.buildWorkflowTimeline({
    stages: stagesOf({ workflow_version: version, fulfillment_type: type }),
    status: { code: status, label: wording(status).customer_label, description: wording(status).customer_description, isTerminal: wording(status).is_terminal },
    stoppedAt, events, includeRetracted,
  });
const ev = (id, title, published_at, extra = {}) => ({ id, title, message: null, published_at, ...extra });
const STATES = (t) => t.stages.map((s) => `${s.code}:${s.state}`).join(" ");

describe("the stages an order follows", { skip }, () => {
  test("workflow 2 without a chosen type shows only the common stages: a branch nobody decided is never drawn", () => {
    assert.deepEqual(codes(stagesOf({ workflow_version: 2, fulfillment_type: null })), ["pending_confirmation", "awaiting_deposit", "deposit_received", "order_confirmed", "live_tracking", "arrived_in_qatar", "carrier_delivering", "ready_for_delivery", "delivered"]);
  });
  test("a custom PC build adds building and final checks; parts only adds items arrived and awaiting scheduling; never both", () => {
    assert.deepEqual(codes(stagesOf({ workflow_version: 2, fulfillment_type: "custom_pc_build" })).slice(7, 9), ["building", "quality_check"]);
    assert.deepEqual(codes(stagesOf({ workflow_version: 2, fulfillment_type: "parts_only" })).slice(7, 9), ["items_arrived", "awaiting_scheduling"]);
    for (const type of ["custom_pc_build", "parts_only"]) assert.equal(stagesOf({ workflow_version: 2, fulfillment_type: type }).length, 11);
  });
  test("an order on the earlier workflow (or with no workflow field, as from an earlier database) follows the earlier nine stages", () => {
    const earlier = codes(stagesOf({ workflow_version: 1, fulfillment_type: null }));
    assert.deepEqual(earlier, ["pending_confirmation", "awaiting_deposit", "deposit_received", "sourcing", "in_transit", "building", "quality_check", "ready_for_delivery", "delivered"]);
    assert.deepEqual(codes(stagesOf({})), earlier);
    assert.deepEqual(codes(stagesOf({ workflow_version: undefined, fulfillment_type: undefined })), earlier);
  });
  test("without stage data (an earlier database) there are no stages, and a status that has no wording is skipped, never invented", () => {
    assert.deepEqual(timeline.stagesForOrder({ workflow_version: 2 }, [], WORDING), []);
    assert.deepEqual(codes(timeline.stagesForOrder({ workflow_version: 2 }, [row(2, "any", 10, "pending_confirmation"), row(2, "any", 20, "no_such_status")], WORDING)), ["pending_confirmation"]);
  });
  test("exactly one stage owns the nested tracking updates, and it is Live tracking", () => {
    const owners = stagesOf({ workflow_version: 2, fulfillment_type: "parts_only" }).filter((s) => s.shows_tracking);
    assert.deepEqual(codes(owners), ["live_tracking"]);
  });
});

describe("the main timeline: done, current, upcoming", { skip }, () => {
  test("at Awaiting deposit: one stage done, one current, the rest upcoming", () => {
    const t = build("awaiting_deposit");
    assert.deepEqual(t.stages.map((s) => s.state), ["done", "current", ...Array(9).fill("upcoming")]);
    assert.equal(t.currentCode, "awaiting_deposit");
    assert.equal(t.complete, false);
  });
  test("each status of a custom build is the single current stage, with everything before it done and everything after it upcoming", () => {
    const path = ["pending_confirmation", "awaiting_deposit", "deposit_received", "order_confirmed", "live_tracking", "arrived_in_qatar", "carrier_delivering", "building", "quality_check", "ready_for_delivery"];
    path.forEach((status, index) => {
      const t = build(status);
      assert.equal(t.stages.filter((s) => s.state === "current").length, 1, status);
      assert.equal(t.stages.filter((s) => s.state === "done").length, index, status);
      assert.equal(t.currentCode, status);
    });
  });
  test("parts only walks its own branch", () => {
    for (const [status, done] of [["items_arrived", 7], ["awaiting_scheduling", 8], ["ready_for_delivery", 9]]) {
      const t = build(status, { type: "parts_only" });
      assert.equal(t.stages.filter((s) => s.state === "done").length, done, status);
      assert.equal(t.currentCode, status);
    }
  });
  test("Delivered / Collected completes the timeline: every stage shows a check and nothing is 'current'", () => {
    const t = build("delivered");
    assert.ok(t.stages.every((s) => s.state === "done"));
    assert.equal(t.complete, true);
    assert.equal(t.currentCode, null);
  });
  test("a final-checks rework (back to building) moves the highlight back and the later stage is upcoming again", () => {
    assert.match(STATES(build("building")), /building:current quality_check:upcoming/);
  });
  test("on hold: the stage it was held from is current and marked paused, and the banner is set; without that knowledge nothing is guessed", () => {
    const staff = build("on_hold", { stoppedAt: "live_tracking" });
    assert.equal(staff.currentCode, "live_tracking");
    assert.equal(staff.stages.find((s) => s.code === "live_tracking").held, true);
    assert.equal(staff.exceptional.code, "on_hold");
    assert.equal(staff.trackingLive, false, "a held order is not in Live tracking, so the form stays closed");
    const customer = build("on_hold");
    assert.equal(customer.currentCode, null);
    assert.ok(customer.stages.every((s) => s.state === "upcoming" && s.held === false));
    assert.equal(customer.exceptional.label, "On hold");
  });
  test("cancelled is exceptional, not complete", () => {
    const t = build("cancelled", { stoppedAt: "building" });
    assert.equal(t.exceptional.code, "cancelled");
    assert.equal(t.complete, false);
  });
  test("a status the stage list does not know (never expected) marks nothing current rather than something wrong", () => {
    const t = build("sourcing");
    assert.equal(t.currentCode, null);
    assert.ok(t.stages.every((s) => s.state === "upcoming"));
  });
});

describe("Live tracking: one stage, the updates nested inside it", { skip }, () => {
  const e1 = ev("e1", "Packed", "2026-11-20T08:05:00Z", { occurred_at: "2026-11-20T08:00:00Z", location: "Miami, USA" });
  const e2 = ev("e2", "Departed", "2026-11-21T09:35:00Z", { occurred_at: "2026-11-21T09:30:00Z", location: "Miami airport" });
  const e3 = ev("e3", "Landed", "2026-11-22T11:00:00Z", { location: "Doha" });

  test("the updates are nested under Live tracking only, oldest first, and the newest is the single 'latest'", () => {
    const t = build("live_tracking", { events: [e3, e1, e2] });
    const live = t.stages.find((s) => s.code === "live_tracking");
    assert.deepEqual(live.updates.map((u) => u.title), ["Packed", "Departed", "Landed"]);
    assert.deepEqual(live.updates.map((u) => u.isLatest), [false, false, true]);
    assert.equal(t.latest.title, "Landed");
    for (const s of t.stages.filter((x) => x.code !== "live_tracking")) assert.deepEqual(s.updates, []);
    assert.equal(t.trackingStageCode, "live_tracking");
    assert.equal(t.trackingLive, true);
    assert.deepEqual(t.looseUpdates, []);
  });
  test("they are ordered by when the event happened, not when it was published, and a missing time falls back to the publish time", () => {
    const late = ev("late", "Typed late, happened early", "2026-11-25T10:00:00Z", { occurred_at: "2026-11-19T10:00:00Z" });
    const t = build("live_tracking", { events: [e1, e2, late, e3] });
    assert.deepEqual(t.allUpdates.map((u) => u.title), ["Typed late, happened early", "Packed", "Departed", "Landed"]);
    assert.equal(t.allUpdates[0].at, "2026-11-19T10:00:00Z");
    assert.equal(t.allUpdates[3].at, "2026-11-22T11:00:00Z", "no time given: the publish time");
  });
  test("ties are broken by the publish time, then the id, so the order never depends on how the rows arrived", () => {
    const a = ev("b", "Second by id", "2026-11-22T10:00:00Z");
    const b = ev("a", "First by id", "2026-11-22T10:00:00Z");
    const c = ev("c", "Published later", "2026-11-22T10:00:01Z", { occurred_at: "2026-11-22T10:00:00Z" });
    for (const input of [[a, b, c], [c, b, a], [b, c, a]]) assert.deepEqual(build("live_tracking", { events: input }).allUpdates.map((u) => u.title), ["First by id", "Second by id", "Published later"]);
  });
  test("unreadable dates never throw", () => {
    const t = build("live_tracking", { events: [ev("x", "Bad", "not a date"), ev("y", "Good", "2026-11-22T10:00:00Z")] });
    assert.equal(t.allUpdates.length, 2);
  });
  test("moving past Live tracking keeps every update, the stage is done, and the section is no longer 'live'", () => {
    for (const status of ["arrived_in_qatar", "carrier_delivering", "building", "ready_for_delivery", "delivered"]) {
      const t = build(status, { events: [e1, e2, e3] });
      assert.equal(t.stages.find((s) => s.code === "live_tracking").state, "done", status);
      assert.equal(t.stages.find((s) => s.code === "live_tracking").updates.length, 3, status);
      assert.equal(t.trackingLive, false, status);
      assert.equal(t.latest.title, "Landed", status);
    }
  });
  test("a withdrawn update is left out for a customer, shown (struck through) for staff, and never counted as the latest", () => {
    const withdrawn = ev("w", "Posted by mistake", "2026-11-23T10:00:00Z", { retracted: true, retraction_reason: "wrong order" });
    const customer = build("live_tracking", { events: [e1, e2, e3, withdrawn] });
    assert.deepEqual(customer.allUpdates.map((u) => u.title), ["Packed", "Departed", "Landed"]);
    const staff = build("live_tracking", { events: [e1, e2, e3, withdrawn], includeRetracted: true });
    assert.deepEqual(staff.allUpdates.map((u) => u.title), ["Packed", "Departed", "Landed", "Posted by mistake"]);
    assert.equal(staff.allUpdates[3].retracted, true);
    assert.equal(staff.allUpdates[3].isLatest, false);
    assert.equal(staff.latest.title, "Landed");
  });
  test("a correction is marked, points at the update it corrects, and is just another entry in the same chronological list", () => {
    const fix = ev("fix", "Corrected location", "2026-11-26T10:00:00Z", { event_kind: "correction", corrects_event_id: "e1", location: "Houston", correction_reason: "typo" });
    const t = build("carrier_delivering", { events: [e1, e2, fix] });
    const node = t.allUpdates.find((u) => u.id === "fix");
    assert.deepEqual([node.kind, node.correctsTitle, node.isLatest], ["correction", "Packed", true]);
    assert.equal(t.allUpdates.find((u) => u.id === "e1").kind, "update");
    assert.equal(build("carrier_delivering", { events: [fix] }).allUpdates[0].correctsTitle, null, "pointing at an update that is not in the list says nothing");
  });
  test("on the earlier workflow there is no nested stage: the updates are one flat list, as before", () => {
    const t = build("in_transit", { type: null, version: 1, events: [e1, e2] });
    assert.equal(t.trackingStageCode, null);
    assert.equal(t.trackingLive, false);
    assert.deepEqual(t.looseUpdates.map((u) => u.title), ["Packed", "Departed"]);
    for (const s of t.stages) assert.deepEqual(s.updates, []);
  });
  test("with no updates there is nothing to show and nothing invented: no node, no location, no 'latest'", () => {
    const t = build("live_tracking");
    assert.deepEqual(t.allUpdates, []);
    assert.equal(t.latest, null);
  });
  test("the model carries no staff-only data when the rows it is given have none (a customer's rows never do)", () => {
    const node = build("live_tracking", { events: [e1] }).allUpdates[0];
    assert.deepEqual([node.by, node.correctionReason, node.retractionReason, node.retracted], [null, null, null, false]);
  });
});

describe("the customer status view follows each order's own stages", { skip }, () => {
  const order = (status, extra = {}) => ({ id: "o", order_ref: "O-2611-00001", customer_id: "c", status, workflow_version: 2, fulfillment_type: "custom_pc_build", total_minor: 100000, deposit_required_minor: 15000, amount_paid_minor: 15000, balance_due_minor: 85000, created_at: "2026-11-20T00:00:00Z", ...extra });
  test("'Stage n of m' counts the stages of the order's own workflow, not every status in the table", () => {
    const v2 = views.buildOrderSummary(order("building"), WORDING, STAGE_ROWS);
    assert.deepEqual([v2.status.step, v2.status.steps], [8, 11]);
    const parts = views.buildOrderSummary(order("awaiting_scheduling", { fulfillment_type: "parts_only" }), WORDING, STAGE_ROWS);
    assert.deepEqual([parts.status.step, parts.status.steps], [9, 11]);
    const earlier = views.buildOrderSummary(order("in_transit", { workflow_version: 1, fulfillment_type: null }), WORDING, STAGE_ROWS);
    assert.deepEqual([earlier.status.step, earlier.status.steps], [5, 9]);
  });
  test("with no stage data it behaves exactly as it did before (every status below the off-path threshold)", () => {
    const old = views.buildOrderSummary(order("in_transit", { workflow_version: 1 }), WORDING.filter((w) => !["order_confirmed", "live_tracking", "arrived_in_qatar", "carrier_delivering", "items_arrived", "awaiting_scheduling"].includes(w.code)));
    assert.equal(old.status.steps, 9);
    assert.equal(views.buildStatusView("building", WORDING).steps, 15, "without a path, every status below 900 counts");
  });
  test("on hold and cancelled are off the path whatever the workflow", () => {
    for (const code of ["on_hold", "cancelled"]) {
      const v = views.buildOrderSummary(order(code), WORDING, STAGE_ROWS).status;
      assert.equal(v.step, null);
      assert.equal(v.steps, 11);
    }
    assert.equal(views.buildOrderSummary(order("on_hold"), WORDING, STAGE_ROWS).status.tone, "paused");
    assert.equal(views.buildOrderSummary(order("cancelled"), WORDING, STAGE_ROWS).status.tone, "cancelled");
  });
});

describe("the tracking fields staff type", { skip }, () => {
  const form = (fields) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    return data;
  };
  const now = new Date("2026-11-22T12:00:00Z");
  test("a title is required; the location, description and time are optional", () => {
    assert.equal(staffValidation.parseTracking(form({ title: "" }), now).ok, false);
    assert.deepEqual(staffValidation.parseTracking(form({ title: "Departed" }), now).value, { title: "Departed", message: null, location: null, occurredAt: null });
  });
  test("a time typed in the datetime field is Qatar time (UTC+3) and is stored as the exact instant", () => {
    assert.equal(staffValidation.parseQatarDateTime("2026-11-22T14:30"), "2026-11-22T11:30:00.000Z");
    assert.equal(staffValidation.parseQatarDateTime("2026-11-22T00:15"), "2026-11-21T21:15:00.000Z", "across midnight");
    const parsed = staffValidation.parseTracking(form({ title: "x", occurred_at: "2026-11-22T10:00", location: "  Doha hub  ", message: " ok " }), now);
    assert.deepEqual(parsed.value, { title: "x", message: "ok", location: "Doha hub", occurredAt: "2026-11-22T07:00:00.000Z" });
  });
  test("an impossible date is refused, not rolled over: 30 February, month 13, hour 25, a free-text time", () => {
    for (const bad of ["2026-02-30T10:00", "2026-13-01T10:00", "2026-11-22T25:00", "2026-11-22T10:61", "tomorrow", "2026-11-22 10:00", "2026-11-22"]) {
      assert.equal(staffValidation.parseQatarDateTime(bad), null, bad);
      assert.equal(staffValidation.parseTracking(form({ title: "x", occurred_at: bad }), now).ok, false, bad);
    }
  });
  test("a time more than a day in the future is refused; the recent past and 'now' are fine", () => {
    assert.equal(staffValidation.parseTracking(form({ title: "x", occurred_at: "2026-11-25T10:00" }), now).ok, false);
    assert.equal(staffValidation.parseTracking(form({ title: "x", occurred_at: "2026-11-22T15:00" }), now).ok, true);
    assert.equal(staffValidation.parseTracking(form({ title: "x", occurred_at: "2026-01-01T10:00" }), now).ok, true);
  });
  test("length limits: title 120, location 120, description 1000", () => {
    assert.equal(staffValidation.parseTracking(form({ title: "t".repeat(121) }), now).ok, false);
    assert.equal(staffValidation.parseTracking(form({ title: "t", location: "l".repeat(121) }), now).ok, false);
    assert.equal(staffValidation.parseTracking(form({ title: "t", message: "m".repeat(1001) }), now).ok, false);
    assert.equal(staffValidation.parseTracking(form({ title: "t".repeat(120), location: "l".repeat(120), message: "m".repeat(1000) }), now).ok, true);
  });
  test("a correction also needs a reason (3 to 500 characters) and, if it names an update, a real id", () => {
    const base = { title: "Fix", location: "Doha" };
    assert.equal(staffValidation.parseTrackingCorrection(form(base), now).ok, false);
    assert.equal(staffValidation.parseTrackingCorrection(form({ ...base, reason: "ab" }), now).ok, false);
    assert.equal(staffValidation.parseTrackingCorrection(form({ ...base, reason: "typo", corrects_event_id: "not-an-id" }), now).ok, false);
    const ok = staffValidation.parseTrackingCorrection(form({ ...base, reason: "typo", corrects_event_id: "00000000-0000-4000-8000-000000000001" }), now);
    assert.deepEqual([ok.ok, ok.value.reason, ok.value.correctsEventId], [true, "typo", "00000000-0000-4000-8000-000000000001"]);
    assert.equal(staffValidation.parseTrackingCorrection(form({ ...base, reason: "typo" }), now).value.correctsEventId, null);
  });
  test("the fulfilment type is exactly one of two values: nothing else is accepted, and nothing is inferred", () => {
    assert.equal(staffValidation.parseFulfillmentType(form({ fulfillment_type: "custom_pc_build" })).ok, true);
    assert.equal(staffValidation.parseFulfillmentType(form({ fulfillment_type: "parts_only" })).ok, true);
    for (const bad of ["", "both", "Custom PC build", "custom", "PARTS_ONLY"]) assert.equal(staffValidation.parseFulfillmentType(form({ fulfillment_type: bad })).ok, false, bad);
    assert.equal(staffValidation.parseFulfillmentType(new FormData()).ok, false);
  });
});

describe("the timeline component, rendered on the server", { skip }, () => {
  const e1 = ev("e1", "Packed", "2026-11-20T08:05:00Z", { occurred_at: "2026-11-20T08:00:00Z", location: "Miami, USA", message: "Sealed" });
  const e2 = ev("e2", "Departed", "2026-11-21T09:35:00Z", { occurred_at: "2026-11-21T09:30:00Z", location: "Miami airport" });
  const e3 = ev("e3", "Landed", "2026-11-22T11:00:00Z", { location: "Doha" });
  const formatTime = (iso) => `T(${iso.slice(0, 16)})`;
  const draw = (t, extra = {}) => ui.render({ timeline: t, formatTime, audience: "customer", ...extra });
  const count = (html, needle) => html.split(needle).length - 1;

  test("the custom-build timeline: every stage in order, checks on the done ones, the current one marked, the rest muted", () => {
    const html = draw(build("live_tracking", { events: [e1, e2, e3] }));
    assert.equal(count(html, 'data-testid="workflow-stage"'), 11);
    assert.equal(count(html, 'data-state="done"'), 4);
    assert.equal(count(html, 'data-state="current"'), 1);
    assert.equal(count(html, 'data-state="upcoming"'), 6);
    assert.equal(count(html, 'data-dot="done"'), 4);
    assert.equal(count(html, 'aria-current="step"'), 1);
    const labels = [...html.matchAll(/data-stage="([a-z_]+)"/g)].map((m) => m[1]);
    assert.deepEqual(labels, ["pending_confirmation", "awaiting_deposit", "deposit_received", "order_confirmed", "live_tracking", "arrived_in_qatar", "carrier_delivering", "building", "quality_check", "ready_for_delivery", "delivered"]);
    for (const name of ["Awaiting deposit", "Deposit confirmed", "Order confirmed", "Live tracking", "Order arrived in Qatar", "Carrier delivering order to M1", "M1 is building your PC", "Final quality checks", "Ready for delivery or pickup", "Delivered / Collected"]) assert.ok(html.includes(name), name);
    assert.ok(!html.includes("Items arrived at M1"), "the parts-only stages are not drawn for a custom build");
  });

  test("Live tracking is ONE expandable section (a details element), open while the order is in Live tracking, with the updates nested in order", () => {
    const html = draw(build("live_tracking", { events: [e3, e1, e2] }));
    assert.equal(count(html, 'data-testid="live-tracking-section"'), 1);
    assert.match(html, /<details[^>]*data-testid="live-tracking-section"/);
    assert.match(html, /<details[^>]*\sopen=""[^>]*data-testid="live-tracking-section"|<details[^>]*data-testid="live-tracking-section"[^>]*\sopen=""|<details class="[^"]*" open=""/);
    assert.match(html, /<summary[^>]*data-testid="live-tracking-toggle"/);
    assert.equal(count(html, 'data-testid="tracking-update"'), 3);
    const list = html.slice(html.indexOf('data-testid="tracking-updates"'));
    assert.ok(list.indexOf(">Packed<") < list.indexOf(">Departed<") && list.indexOf(">Departed<") < list.indexOf(">Landed<"), "oldest first");
    assert.equal(count(html, 'data-latest="true"'), 1);
    assert.ok(list.indexOf('data-latest="true"') > list.indexOf(">Departed<"), "the newest carries the mark");
    assert.match(html, /Latest: Landed · Doha · T\(2026-11-22T11:00\)/, "the summary line says what is newest without opening it");
    assert.match(html, /3 updates/);
    // the nested list lives INSIDE the one section, which lives inside the Live tracking stage
    const stageStart = html.indexOf('data-stage="live_tracking"');
    const nextStage = html.indexOf('data-stage="arrived_in_qatar"');
    for (const title of ["Packed", "Departed", "Landed"]) {
      const at = html.indexOf(`>${title}<`);
      assert.ok(at > stageStart && at < nextStage, `${title} is inside the Live tracking stage`);
    }
  });

  test("each update shows its location and time; connected by a rail, with a check for earlier ones and a ring for the latest", () => {
    const html = draw(build("live_tracking", { events: [e1, e2, e3] }));
    assert.equal(count(html, 'data-testid="tracking-location"'), 3);
    for (const place of ["Miami, USA", "Miami airport", "Doha"]) assert.ok(html.includes(place), place);
    assert.ok(html.includes("T(2026-11-20T08:00)") && html.includes("T(2026-11-21T09:30)"), "the time the event happened is shown, not the publish time");
    assert.equal(count(html, 'data-dot="update"'), 2);
    assert.equal(count(html, 'data-dot="latest"'), 1);
    assert.ok(count(html, "data-rail") >= 10);
  });

  test("after the order has moved on, the section is closed by default but the updates are still in the page and the summary still says what is newest", () => {
    const html = draw(build("building", { events: [e1, e2, e3] }));
    assert.doesNotMatch(html, /<details[^>]*\sopen=""/);
    assert.equal(count(html, 'data-testid="tracking-update"'), 3);
    assert.match(html, /Latest: Landed/);
    assert.equal(count(html, 'data-state="done"'), 7);
  });

  test("before Live tracking starts the section says there is nothing yet, and invents no update and no location", () => {
    const html = draw(build("order_confirmed"));
    assert.equal(count(html, 'data-testid="tracking-update"'), 0);
    assert.equal(count(html, 'data-testid="tracking-location"'), 0);
    assert.match(html, /data-testid="tracking-empty"/);
    assert.doesNotMatch(html, /<details[^>]*\sopen=""/);
    assert.match(html, /No tracking updates were published for this order\./);
  });

  test("an order in Live tracking with no update yet says the first one will appear", () => {
    assert.match(draw(build("live_tracking")), /No update has been published yet\. The first one will appear here\./);
  });

  test("a customer's page carries nothing staff-only: no form, no withdraw control, no author, no reason, no branch warning", () => {
    const withdrawn = ev("w", "Posted by mistake", "2026-11-23T10:00:00Z", { retracted: true, retraction_reason: "private reason" });
    const fix = ev("fix", "Fix", "2026-11-24T10:00:00Z", { event_kind: "correction", corrects_event_id: "e1", correction_reason: "private owner reason", by: "Owner (test)" });
    const html = draw(build("arrived_in_qatar", { events: [e1, withdrawn, fix] }), {
      updateExtras: () => ui.React.createElement("button", null, "WITHDRAW-BUTTON"),
      trackingFooter: ui.React.createElement("form", { "data-testid": "tracking-form" }, "STAFF-FORM"),
      branchNote: ui.React.createElement("p", null, "BRANCH-NOTE"),
    });
    for (const secret of ["WITHDRAW-BUTTON", "STAFF-FORM", "BRANCH-NOTE", "tracking-form", "private reason", "private owner reason", "Owner (test)", "Published by", "Withdrawn", "Reason for the correction", "Posted by mistake"]) assert.ok(!html.includes(secret), `customer HTML must not contain: ${secret}`);
    assert.match(html, /Correction/);
    assert.match(html, /Corrects: Packed/);
  });

  test("the staff page of the same order shows the same stages and the same updates, and adds the staff-only controls", () => {
    const events = [e1, e2, e3];
    const customer = draw(build("live_tracking", { events }));
    const staff = ui.render({
      timeline: build("live_tracking", { events, includeRetracted: true }), formatTime, audience: "staff",
      updateExtras: (node) => ui.React.createElement("button", null, `WITHDRAW-${node.id}`),
      trackingFooter: ui.React.createElement("form", { "data-testid": "tracking-form" }, "STAFF-FORM"),
      branchNote: ui.React.createElement("p", null, "BRANCH-NOTE"),
    });
    const stagesOf = (html) => [...html.matchAll(/data-stage="([a-z_]+)" data-state="([a-z]+)"/g)].map((m) => `${m[1]}:${m[2]}`);
    assert.deepEqual(stagesOf(staff), stagesOf(customer), "one underlying workflow");
    const titles = (html) => [...html.matchAll(/data-testid="tracking-update"[\s\S]*?<p class="[^"]*">([^<]+)<\/p>/g)].map((m) => m[1]);
    assert.deepEqual(titles(staff), titles(customer));
    for (const present of ["STAFF-FORM", "BRANCH-NOTE", "WITHDRAW-e1", "WITHDRAW-e3", "Published by"]) assert.ok(staff.includes(present), present);
    assert.match(staff, /data-audience="staff"/);
    assert.match(customer, /data-audience="customer"/);
  });

  test("staff also see a withdrawn update struck through with who and why, but no withdraw control on it", () => {
    const withdrawn = ev("w", "Posted by mistake", "2026-11-23T10:00:00Z", { retracted: true, retraction_reason: "wrong order", by: "Staff (test)" });
    const html = ui.render({ timeline: build("live_tracking", { events: [e1, withdrawn], includeRetracted: true }), formatTime, audience: "staff", updateExtras: (n) => ui.React.createElement("button", null, `WITHDRAW-${n.id}`) });
    assert.match(html, /line-through/);
    assert.match(html, /Withdrawn: wrong order/);
    assert.ok(html.includes("WITHDRAW-e1") && !html.includes("WITHDRAW-w"));
    assert.equal(count(html, 'data-latest="true"'), 1);
  });

  test("on hold: the banner is shown, and for staff the stage it was held from says 'Paused here'", () => {
    const staff = ui.render({ timeline: build("on_hold", { stoppedAt: "live_tracking", events: [e1] }), formatTime, audience: "staff" });
    assert.match(staff, /data-testid="workflow-exception"[^>]*data-code="on_hold"/);
    assert.match(staff, /Paused here/);
    const customer = draw(build("on_hold", { events: [e1] }));
    assert.match(customer, /data-code="on_hold"/);
    assert.doesNotMatch(customer, /Paused here/);
    assert.equal(count(customer, 'data-testid="tracking-update"'), 1, "the history stays visible while held");
  });

  test("the earlier workflow draws its stages with no nested section (its updates are listed flat by the page)", () => {
    const html = draw(build("in_transit", { type: null, version: 1, events: [e1] }));
    assert.equal(count(html, 'data-testid="live-tracking-section"'), 0);
    assert.equal(count(html, 'data-testid="workflow-stage"'), 9);
  });
});
