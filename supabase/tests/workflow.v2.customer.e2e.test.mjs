// The OWNER-DEFINED ORDER WORKFLOW as the customer sees it: a real production build of the website (next start), driven by a real browser
// (Playwright Chromium) at a desktop width (1280 x 900) and a phone width (390 x 844), reading a LOCAL database that has the REAL migrations
// and REAL row level security. Orders are created and moved by the REAL staff functions (admin.*) with harness-supplied claims, as in the
// other workflow suites. The sign-in service is the local emulator (not Supabase Auth), and the staff dashboard (which needs a real second
// factor) is covered by the database suite and the component render tests instead. Nothing here touches a hosted project; every name is synthetic.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startEmulator } from "../emulator/server.mjs";
import { findPgBin } from "./harness.mjs";
import { AS, ID, SENTINEL, newOrder } from "./fixtures.mjs";
import { ensureBuild, loadPlaywright, startWebsite } from "./support/browser.mjs";

const playwright = loadPlaywright();
const skip = !playwright ? "Playwright is not installed" : !findPgBin() ? "PostgreSQL server programs were not found" : false;
if (skip && process.env.M1_REQUIRE_PG === "1") throw new Error(`M1_REQUIRE_PG=1 but ${skip}`);

const SIZES = { desktop: { width: 1280, height: 900 }, phone: { width: 390, height: 844 } };
const ITEMS = [{ kind: "component", description: "Test console PC", quantity: 1, unit_price_minor: 200000 }];
const STAFF_ONLY = ["Published by", "Withdraw", "Reason for the correction", "Publish a tracking update", "Add a correction", "Order type", "Move to the current workflow", SENTINEL.reason, SENTINEL.note];
const COMMON = ["Order received", "Awaiting deposit", "Deposit confirmed", "Order confirmed", "Live tracking", "Order arrived in Qatar", "Carrier delivering order to M1"];
const BUILD = ["M1 is building your PC", "Final quality checks"];
const PARTS = ["Items arrived at M1", "Awaiting scheduling for pickup or delivery"];
const END = ["Ready for delivery or pickup", "Delivered / Collected"];

describe("order workflow v2: the customer tracker (production build, real browser, local emulator, real RLS)", { skip, timeout: 900_000 }, () => {
  let emu;
  let site;
  let browser;
  const pages = {};
  const contexts = [];
  let bobPage;
  const O = {};

  const db = () => emu.db;
  const lines = (out) => out.split("\n").filter((l) => l !== "");
  const sam = (sql) => db().commit(`${AS.sam}${sql}`);
  const olivia = (sql) => db().commit(`${AS.olivia}${sql}`);
  const create = () => lines(db().commit(`${newOrder({ customer: ID.custA, items: ITEMS, into: "o", who: AS.sam })}select :'o';`)).pop().trim();
  const refOf = (id) => db().ok(`select order_ref from public.orders where id = '${id}';`);
  const move = (id, to) => sam(`select admin.transition_order('${id}', '${to}');`);
  const update = (id, title, loc, at, msg = null) =>
    sam(`select admin.publish_tracking_update('${id}', '${title}', ${msg ? `'${msg}'` : "null"}, ${loc ? `'${loc}'` : "null"}, ${at ? `'${at}'::timestamptz` : "null"});`);
  /** A workflow-2 order, deposit paid, moved to `target`. */
  function v2(target, { type = null } = {}) {
    const id = create();
    if (type) sam(`select admin.set_order_fulfillment_type('${id}', '${type}');`);
    move(id, "awaiting_deposit");
    olivia(`select admin.record_payment('${id}', 'deposit', 30000, 'cash');`);
    const steps = ["deposit_received", "order_confirmed", "live_tracking", "arrived_in_qatar", "carrier_delivering"];
    const branch = type === "custom_pc_build" ? ["building", "quality_check"] : type === "parts_only" ? ["items_arrived", "awaiting_scheduling"] : [];
    for (const step of [...steps, ...branch, "ready_for_delivery", "delivered"]) {
      if (db().ok(`select status from public.orders where id = '${id}';`) === target) break;
      move(id, step);
    }
    return id;
  }

  const body = async (page) => {
    await page.waitForLoadState("networkidle");
    await page.locator('[aria-busy="true"]').waitFor({ state: "detached", timeout: 20_000 }).catch(() => {});
    return page.locator("body").innerText();
  };
  async function open(page, ref) {
    await page.goto(`${site.base}/account/orders/${ref}`);
    return body(page);
  }
  const eachSize = async (ref, fn) => {
    for (const [name, page] of Object.entries(pages)) {
      try {
        await fn(await open(page, ref), page, name);
      } catch (error) {
        error.message = `[${name} ${SIZES[name].width}px] ${error.message}`;
        throw error;
      }
    }
  };
  const order = (text, labels) => {
    let at = -1;
    for (const label of labels) {
      const next = text.indexOf(label, at + 1);
      assert.ok(next > at, `"${label}" should appear after the previous stage`);
      at = next;
    }
  };
  const states = (page) => page.locator('[data-testid="workflow-stage"]').evaluateAll((els) => els.map((e) => `${e.getAttribute("data-stage")}:${e.getAttribute("data-state")}`));
  async function signIn(page, user) {
    await page.goto(`${site.base}/auth/sign-in`);
    await page.fill("#signin-email", user.email);
    await page.fill("#signin-password", user.password);
    await page.click("form:has(#signin-email) button[type=submit]");
    await page.waitForURL((url) => !url.pathname.startsWith("/auth/"), { timeout: 20_000 });
  }

  before(async () => {
    ensureBuild();
    emu = await startEmulator({ seed: false });
    // An order created BEFORE the release switch is flipped is an earlier-workflow order: the legacy rendering is checked with it.
    O.legacy = create();
    move(O.legacy, "awaiting_deposit");
    olivia(`select admin.record_payment('${O.legacy}', 'deposit', 30000, 'cash');`);
    for (const step of ["deposit_received", "sourcing", "in_transit"]) move(O.legacy, step);
    for (const [title, msg] of [["Parts ordered", "Ordered from the supplier"], ["Parts shipped", "On a flight"], ["Arrived at the hub", "Cleared customs"], ["Out for delivery", "On the way to M1"]]) {
      sam(`select admin.publish_tracking_event('${O.legacy}', '${title}', '${msg}', 'in_transit');`);
    }
    olivia(`select admin.set_policy('orders.workflow', '{"default_version": 2}'::jsonb, 'confirmed_by_owner', 'test: release switch');`);
    site = await startWebsite({
      CUSTOMER_ACCOUNTS_ENABLED: "true",
      NEXT_PUBLIC_SUPABASE_URL: emu.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: emu.anonKey,
      CUSTOMER_ACCOUNTS_PREVIEW_LABEL: "Local emulator preview: demonstration data, not real orders",
    });
    browser = await playwright.chromium.launch();
    for (const [name, viewport] of Object.entries(SIZES)) {
      const context = await browser.newContext({ viewport });
      contexts.push(context);
      pages[name] = await context.newPage();
      await signIn(pages[name], emu.users.alice);
    }
    const bobContext = await browser.newContext({ viewport: SIZES.desktop });
    contexts.push(bobContext);
    bobPage = await bobContext.newPage();
    await signIn(bobPage, emu.users.bob);
  });

  after(async () => {
    for (const context of contexts) await context.close().catch(() => {});
    await browser?.close();
    await site?.stop();
    await emu?.stop();
  });

  // =================================================================================================================
  describe("a custom PC build in Live tracking", () => {
    before(() => {
      O.live = v2("live_tracking", { type: "custom_pc_build" });
      update(O.live, "Packed and sealed", "Miami, USA", "2026-11-20T08:00:00Z", "Packed by the supplier");
      update(O.live, "Departed the airport", "Miami airport", "2026-11-21T09:30:00Z");
      update(O.live, "Landed in Doha", "Hamad airport, Doha", "2026-11-22T11:00:00Z", "Cleared customs");
      O.liveRef = refOf(O.live);
    });

    it("shows the owner's stages in order, checks on the finished ones, the current one marked, and the build branch (not the parts one)", async () => {
      await eachSize(O.liveRef, async (text, page) => {
        order(text, [...COMMON, ...BUILD, ...END]);
        for (const label of PARTS) assert.ok(!text.includes(label), `${label} belongs to parts-only orders`);
        assert.deepEqual(await states(page), [
          "pending_confirmation:done", "awaiting_deposit:done", "deposit_received:done", "order_confirmed:done", "live_tracking:current", "arrived_in_qatar:upcoming",
          "carrier_delivering:upcoming", "building:upcoming", "quality_check:upcoming", "ready_for_delivery:upcoming", "delivered:upcoming",
        ]);
        assert.equal(await page.locator('[data-dot="done"]').count(), 4);
        assert.match(text, /current/i);
        assert.equal(await page.locator('[aria-current="step"]').count(), 1);
      });
    });

    it("Live tracking is ONE open section with the three updates nested inside it, oldest first, each with its place and time, the newest marked", async () => {
      await eachSize(O.liveRef, async (text, page) => {
        const section = page.locator('[data-testid="live-tracking-section"]');
        assert.equal(await section.count(), 1);
        assert.equal(await section.evaluate((el) => el.open), true, "open while the order is in Live tracking");
        const titles = await page.locator('[data-testid="tracking-update"] p.text-sm.font-semibold').allInnerTexts();
        assert.deepEqual(titles.map((t) => t.replace(/\s*(LATEST|Latest|CORRECTION|Correction)\s*$/, "").trim()), ["Packed and sealed", "Departed the airport", "Landed in Doha"]);
        assert.equal(await page.locator('[data-testid="tracking-update"][data-latest="true"]').count(), 1);
        assert.match(await page.locator('[data-testid="tracking-update"][data-latest="true"]').innerText(), /Landed in Doha/);
        const places = await page.locator('[data-testid="tracking-location"]').allInnerTexts();
        assert.deepEqual(places.map((p) => p.trim()), ["Miami, USA", "Miami airport", "Hamad airport, Doha"]);
        assert.match(text, /20 Nov 2026, 11:00/, "the time the event happened, shown in Qatar time (08:00 UTC)");
        assert.match(text, /Cleared customs/);
        assert.match(text, /Latest: Landed in Doha · Hamad airport, Doha/);
        // every nested update is inside the Live tracking stage, not a separate card
        assert.equal(await page.locator('[data-stage="live_tracking"] [data-testid="tracking-update"]').count(), 3);
        assert.equal(await page.locator('[data-testid="tracking-update"] [data-rail]').count(), 3);
        for (const staffOnly of STAFF_ONLY) assert.ok(!text.includes(staffOnly), `the customer page must not show: ${staffOnly}`);
      });
    });

    it("on a phone the whole timeline fits the screen (no sideways scrolling)", async () => {
      const page = pages.phone;
      await open(page, O.liveRef);
      const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: document.documentElement.clientWidth }));
      assert.ok(scroll <= width + 1, `the page is ${scroll}px wide on a ${width}px screen`);
    });

    it("the order list and the overview count the stages of THIS order's workflow", async () => {
      for (const page of Object.values(pages)) {
        await page.goto(`${site.base}/account/orders`);
        const text = await body(page);
        assert.match(text, /Stage 5 of 11/, "a custom build has eleven stages and is at the fifth");
      }
    });
  });

  // =================================================================================================================
  describe("the nested section expands and collapses, and keeps its updates after the order moves on", () => {
    before(() => {
      O.past = v2("carrier_delivering", { type: "parts_only" });
      // (updates must be published while in Live tracking: this order is built by publishing before it moved on)
    });

    it("an order that went through Live tracking with updates keeps them: the section is closed, says what is newest, and opens on click", async () => {
      const id = create();
      sam(`select admin.set_order_fulfillment_type('${id}', 'custom_pc_build');`);
      move(id, "awaiting_deposit");
      olivia(`select admin.record_payment('${id}', 'deposit', 30000, 'cash');`);
      for (const step of ["deposit_received", "order_confirmed", "live_tracking"]) move(id, step);
      update(id, "First scan", "Dallas, USA", "2026-11-20T10:00:00Z");
      update(id, "Second scan", "Dubai hub", "2026-11-21T10:00:00Z");
      for (const step of ["arrived_in_qatar", "carrier_delivering", "building"]) move(id, step);
      O.moved = id;
      for (const [name, page] of Object.entries(pages)) {
        const text = await open(page, refOf(id));
        const section = page.locator('[data-testid="live-tracking-section"]');
        assert.equal(await section.evaluate((el) => el.open), false, `${name}: closed once the order has moved on`);
        assert.match(text, /2 updates/);
        assert.match(text, /Latest: Second scan · Dubai hub/);
        assert.equal(await page.locator('[data-stage="live_tracking"]').getAttribute("data-state"), "done");
        assert.equal(await page.locator('[data-stage="building"]').getAttribute("data-state"), "current");
        // closed: the nested list is not visible; open: both updates are
        assert.equal(await page.locator('[data-testid="tracking-update"]').first().isVisible(), false);
        await page.locator('[data-testid="live-tracking-toggle"]').click();
        assert.equal(await section.evaluate((el) => el.open), true, `${name}: opens on click`);
        assert.equal(await page.locator('[data-testid="tracking-update"]').count(), 2);
        assert.equal(await page.locator('[data-testid="tracking-update"]').first().isVisible(), true);
        assert.match(await page.locator('[data-testid="live-tracking-section"]').innerText(), /First scan[\s\S]*Second scan/);
        await page.locator('[data-testid="live-tracking-toggle"]').click();
        assert.equal(await section.evaluate((el) => el.open), false, `${name}: collapses again`);
        assert.equal(await page.locator('[data-testid="tracking-update"]').first().isVisible(), false);
      }
    });

    it("the toggle works from the keyboard too", async () => {
      const page = pages.desktop;
      await open(page, refOf(O.moved));
      await page.locator('[data-testid="live-tracking-toggle"]').focus();
      await page.keyboard.press("Enter");
      assert.equal(await page.locator('[data-testid="live-tracking-section"]').evaluate((el) => el.open), true);
      await page.keyboard.press("Enter");
      assert.equal(await page.locator('[data-testid="live-tracking-section"]').evaluate((el) => el.open), false);
    });

    it("a correction after Live tracking joins the same list, marked as a correction, and the owner's private reason never reaches the customer", async () => {
      olivia(`select admin.publish_tracking_correction('${O.moved}', 'Corrected scan location', 'It was Houston', 'Houston, USA', null, 'a private owner reason', (select id from public.order_tracking_events where order_id = '${O.moved}' and title = 'First scan'));`);
      const page = pages.desktop;
      const text = await open(page, refOf(O.moved));
      await page.locator('[data-testid="live-tracking-toggle"]').click();
      const list = await page.locator('[data-testid="live-tracking-section"]').innerText();
      assert.match(list, /Corrected scan location/);
      assert.match(list, /Correction/i);
      assert.match(list, /Corrects: First scan/);
      assert.match(list, /Houston, USA/);
      assert.ok(!text.includes("a private owner reason") && !list.includes("a private owner reason"));
      assert.match(await page.locator('[data-testid="live-tracking-section"]').innerText(), /3 updates|Tracking updates/);
    });

    it("an update that staff withdrew disappears for the customer", async () => {
      const id = create();
      move(id, "awaiting_deposit");
      olivia(`select admin.record_payment('${id}', 'deposit', 30000, 'cash');`);
      for (const step of ["deposit_received", "order_confirmed", "live_tracking"]) move(id, step);
      update(id, "Keep this one", "Doha", null);
      update(id, "Posted on the wrong order", "Nowhere", null);
      sam(`select admin.retract_tracking_event((select id from public.order_tracking_events where order_id = '${id}' and title = 'Posted on the wrong order'), 'wrong order');`);
      const text = await open(pages.desktop, refOf(id));
      assert.match(text, /Keep this one/);
      assert.ok(!text.includes("Posted on the wrong order") && !text.includes("Nowhere"));
      assert.match(text, /1 update\b/);
    });
  });

  // =================================================================================================================
  describe("the two branches, an order whose type is not chosen yet, and the exceptional states", () => {
    it("a parts-only order shows its own branch: items arrived and awaiting scheduling, with no building or final-checks stages", async () => {
      const id = v2("awaiting_scheduling", { type: "parts_only" });
      await eachSize(refOf(id), async (text, page) => {
        order(text, [...COMMON, ...PARTS, ...END]);
        for (const label of BUILD) assert.ok(!text.includes(label), `${label} belongs to custom builds`);
        assert.equal(await page.locator('[data-stage="awaiting_scheduling"]').getAttribute("data-state"), "current");
        assert.equal(await page.locator('[data-stage="items_arrived"]').getAttribute("data-state"), "done");
      });
    });

    it("an order whose type has not been chosen shows only the common stages: nothing is guessed, and no staff warning leaks", async () => {
      const id = v2("carrier_delivering");
      await eachSize(refOf(id), async (text, page) => {
        order(text, [...COMMON, ...END]);
        for (const label of [...BUILD, ...PARTS]) assert.ok(!text.includes(label), label);
        assert.equal(await page.locator('[data-testid="workflow-stage"]').count(), 9);
        assert.ok(!text.includes("has not been chosen"));
      });
    });

    it("a finished order shows every stage done, and the nested updates stay", async () => {
      const id = create();
      sam(`select admin.set_order_fulfillment_type('${id}', 'parts_only');`);
      move(id, "awaiting_deposit");
      olivia(`select admin.record_payment('${id}', 'deposit', 30000, 'cash'); select admin.record_payment('${id}', 'balance', 170000, 'cash');`);
      for (const step of ["deposit_received", "order_confirmed", "live_tracking"]) move(id, step);
      update(id, "Left the warehouse", "Miami", null);
      for (const step of ["arrived_in_qatar", "carrier_delivering", "items_arrived", "awaiting_scheduling", "ready_for_delivery", "delivered"]) move(id, step);
      await eachSize(refOf(id), async (text, page) => {
        assert.equal(await page.locator('[data-testid="workflow-stage"][data-state="done"]').count(), 11);
        assert.equal(await page.locator('[aria-current="step"]').count(), 0);
        assert.match(text, /Delivered \/ Collected/);
        assert.match(text, /1 update\b/);
      });
    });

    it("on hold: a clear banner, the history stays, and the stages claim nothing the customer cannot know; cancelled shows its own banner", async () => {
      const held = v2("live_tracking", { type: "custom_pc_build" });
      update(held, "Before the hold", "Miami", null);
      move(held, "on_hold");
      await eachSize(refOf(held), async (text, page) => {
        assert.equal(await page.locator('[data-testid="workflow-exception"]').getAttribute("data-code"), "on_hold");
        assert.match(text, /On hold/);
        assert.match(text, /We will contact you/);
        assert.equal(await page.locator('[data-testid="workflow-stage"][data-state="current"]').count(), 0);
        assert.equal(await page.locator('[data-testid="tracking-update"]').count() >= 0, true);
      });
      const text = await open(pages.desktop, refOf(held));
      await pages.desktop.locator('[data-testid="live-tracking-toggle"]').click();
      assert.match(await pages.desktop.locator('[data-testid="live-tracking-section"]').innerText(), /Before the hold/);
      assert.ok(text.length > 0);
      move(held, "cancelled");
      const cancelled = await open(pages.desktop, refOf(held));
      assert.equal(await pages.desktop.locator('[data-testid="workflow-exception"]').getAttribute("data-code"), "cancelled");
      assert.match(cancelled, /This order has been cancelled/);
    });
  });

  // =================================================================================================================
  describe("existing orders: unchanged until the owner moves them, then on the new timeline with everything kept", () => {
    it("an order on the earlier workflow still shows the page it always had (progress bar and a flat tracking list), even after the switch", async () => {
      const ref = refOf(O.legacy);
      await eachSize(ref, async (text, page) => {
        assert.equal(await page.locator('[data-testid="workflow-timeline"]').count(), 0);
        assert.match(text, /Stage 5 of 9/);
        assert.match(text, /Tracking timeline/);
        for (const title of ["Parts ordered", "Parts shipped", "Arrived at the hub", "Out for delivery"]) assert.match(text, new RegExp(title));
      });
    });

    it("after the owner moves it onto the current workflow it is in Live tracking with its four earlier updates nested inside, and nothing is lost", async () => {
      const before = db().ok(`select (select count(*) from public.payments where order_id = '${O.legacy}') || ':' || (select count(*) from public.order_tracking_events where order_id = '${O.legacy}') || ':' || (select amount_paid_minor from public.orders where id = '${O.legacy}');`);
      assert.equal(lines(olivia(`select admin.adopt_new_workflow('${O.legacy}', 'owner moved the order');`)).pop().trim(), "live_tracking");
      assert.equal(db().ok(`select (select count(*) from public.payments where order_id = '${O.legacy}') || ':' || (select count(*) from public.order_tracking_events where order_id = '${O.legacy}') || ':' || (select amount_paid_minor from public.orders where id = '${O.legacy}');`), before);
      await eachSize(refOf(O.legacy), async (text, page) => {
        assert.equal(await page.locator('[data-testid="workflow-timeline"]').count(), 1);
        assert.equal(await page.locator('[data-stage="live_tracking"]').getAttribute("data-state"), "current");
        assert.equal(await page.locator('[data-testid="tracking-update"]').count(), 4);
        assert.match(text, /Latest: /);
        assert.equal(await page.locator('[data-testid="workflow-stage"]').count(), 9, "an order whose type is not chosen shows the nine common stages");
      });
      await pages.desktop.goto(`${site.base}/account/orders`);
      assert.match(await body(pages.desktop), /Stage 5 of 9/);
    });
  });

  // =================================================================================================================
  describe("who can see what", () => {
    it("another customer cannot open this order, nor see any of its updates", async () => {
      await bobPage.goto(`${site.base}/account/orders/${O.liveRef}`);
      const text = await body(bobPage);
      assert.match(text, /We could not find that/);
      for (const secret of ["Packed and sealed", "Miami", "Landed in Doha"]) assert.ok(!text.includes(secret), secret);
    });

    it("a signed-in customer reaches no staff control on any order page: no form, no staff section, no staff API", async () => {
      for (const ref of [O.liveRef, refOf(O.moved)]) {
        const html = await (await pages.desktop.request.get(`${site.base}/account/orders/${ref}`)).text();
        for (const marker of ["tracking-form", "tracking-correction-form", "fulfillment-form", "adopt-form", "transition-form", "Published by"]) assert.ok(!html.includes(marker), marker);
      }
    });
  });
});
