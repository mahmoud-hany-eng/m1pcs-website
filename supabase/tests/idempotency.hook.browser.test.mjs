// PLAT-0004 correction C7: the REAL idempotency-key hook (src/components/admin/use-idempotency-key.ts) and its rules
// (src/lib/staff/idempotency-client.ts), run in a REAL browser with REAL sessionStorage, real reloads and the real React 19 build
// from node_modules. No jsdom, no bundler and no new dependency: the browser loads the website's own TypeScript (types stripped
// by Node's own `stripTypeScriptTypes`) as native ES modules through an import map, and React's CommonJS builds through tiny
// generated wrappers.
//
// What it proves in a browser: the page's key is kept across a reload and across retries; it is replaced after a success or when the
// database retires it, and ONLY then; it is bound to the balance the page showed; a second tab has its own key; storage that is
// blocked (a private window) degrades to the page's own key without breaking the form; React StrictMode's doubled effects do
// not rotate the key twice.
//
// The staff screens themselves need a real second factor (see WORKFLOW_TESTS.md), so the form is not driven here; the hook is.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { loadPlaywright, ROOT } from "./support/browser.mjs";

const playwright = loadPlaywright();
const skip = playwright ? false : "Playwright is not installed (it is not a project dependency); CI installs a pinned copy";
const suite = skip ? describe.skip : describe;

const NM = join(ROOT, "node_modules");
const cjs = (file) => readFileSync(join(NM, file), "utf8");

/** Wraps a CommonJS React build as an ES module. `requires` maps require() names to the URLs of the modules that provide them. */
function esmWrapper(source, requires, namedExports) {
  const imports = Object.values(requires).map((url, i) => `import dep${i} from "${url}";`).join("\n");
  const table = Object.keys(requires).map((name, i) => `${JSON.stringify(name)}: dep${i}`).join(", ");
  return `${imports}
const module = { exports: {} };
const process = { env: { NODE_ENV: "development" } };
const require = (name) => ({ ${table} })[name];
(function (module, exports, require, process) {
${source}
})(module, module.exports, require, process);
const api = module.exports;
export default api;
${namedExports.length ? `export const { ${namedExports.join(", ")} } = api;` : ""}
`;
}

const REACT_EXPORTS = ["Children", "Fragment", "StrictMode", "createElement", "useEffect", "useRef", "useState", "useMemo", "useCallback"];
function vendor(path) {
  switch (path) {
    case "/vendor/react.js":
      return esmWrapper(cjs("react/cjs/react.development.js"), {}, REACT_EXPORTS);
    case "/vendor/scheduler.js":
      return esmWrapper(cjs("scheduler/cjs/scheduler.development.js"), {}, []);
    case "/vendor/react-dom.js":
      return esmWrapper(cjs("react-dom/cjs/react-dom.development.js"), { react: "/vendor/react.js" }, []);
    case "/vendor/react-dom-client.js":
      return esmWrapper(cjs("react-dom/cjs/react-dom-client.development.js"), { react: "/vendor/react.js", "react-dom": "/vendor/react-dom.js", scheduler: "/vendor/scheduler.js" }, ["createRoot"]);
    default:
      return null;
  }
}

/** The website's own TypeScript as an ES module: types stripped, the "@/" alias and extension-less imports pointed at /app/. */
function appModule(path) {
  const rel = path.replace(/^\/app\//, "").replace(/\.js$/, "");
  for (const ext of [".ts", ".tsx"]) {
    let source;
    try {
      source = readFileSync(join(ROOT, "src", rel + ext), "utf8");
    } catch {
      continue;
    }
    const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
    const js = stripTypeScriptTypes(source, { mode: "strip" });
    return js.replace(/(from\s+|import\s+)(["'])([^"']+)\2/g, (whole, lead, quote, spec) => {
      if (spec.startsWith("@/")) return `${lead}${quote}/app/${spec.slice(2)}.js${quote}`;
      if (spec.startsWith("./") || spec.startsWith("../")) {
        const parts = `${dir}/${spec}`.split("/").filter(Boolean);
        const out = [];
        for (const part of parts) {
          if (part === "..") out.pop();
          else if (part !== ".") out.push(part);
        }
        return `${lead}${quote}/app/${out.join("/")}.js${quote}`;
      }
      return whole;
    });
  }
  return null;
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>hook</title>
<script type="importmap">{"imports":{"react":"/vendor/react.js","react-dom/client":"/vendor/react-dom-client.js"}}</script>
<div id="root"></div>
<script type="module">
import { createElement as h, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { useIdempotencyKey } from "/app/components/admin/use-idempotency-key.js";

function Harness({ scope, initial, binding, tick }) {
  const [state, setState] = useState({ status: "idle" });
  const key = useIdempotencyKey(scope, initial, binding, state);
  window.__setState = (next) => setState(next);
  window.__renders = (window.__renders || 0) + 1;
  return h("div", { "data-tick": tick }, h("output", { id: "key" }, key), h("input", { type: "hidden", name: "idempotency_key", value: key }));
}
const root = createRoot(document.getElementById("root"));
window.__mount = (props, strict) => root.render(strict ? h(StrictMode, null, h(Harness, props)) : h(Harness, props));
const q = new URLSearchParams(location.search);
window.__mount({ scope: q.get("scope"), initial: q.get("initial"), binding: q.get("binding") ?? "", tick: 0 }, q.get("strict") === "1");
window.__ready = true;
</script>`;

suite("the idempotency-key hook, in a real browser with real sessionStorage (PLAT-0004 correction C7)", { skip }, () => {
  let server;
  let base;
  let browser;
  let context;

  before(async () => {
    server = createServer((req, res) => {
      const path = new URL(req.url, "http://x").pathname;
      if (path === "/") {
        res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
        return;
      }
      const body = path.startsWith("/vendor/") ? vendor(path) : path.startsWith("/app/") ? appModule(path) : null;
      if (body === null) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "content-type": "text/javascript" }).end(body);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await playwright.chromium.launch();
    context = await browser.newContext();
  });
  after(async () => {
    await context?.close();
    await browser?.close();
    await new Promise((resolve) => server?.close(resolve));
  });

  const KEY = (n) => `page-key-${String(n).padStart(8, "0")}`;
  const open = async (params, { storageBlocked = false, ctx = context } = {}) => {
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    if (storageBlocked) await page.addInitScript(() => Object.defineProperty(window, "sessionStorage", { get() { throw new Error("blocked"); } }));
    await page.goto(`${base}/?${new URLSearchParams(params)}`);
    await page.waitForFunction(() => window.__ready === true);
    await page.waitForTimeout(50);
    return { page, errors, key: () => page.locator("#key").textContent(), hidden: () => page.locator('input[name="idempotency_key"]').inputValue() };
  };
  const saved = (page, scope) => page.evaluate((s) => window.sessionStorage.getItem(`m1-idem:${s}`), scope);
  const set = (page, state) => page.evaluate((s) => window.__setState(s), state).then(() => page.waitForTimeout(60));
  const remount = (page, props, strict = false) => page.evaluate(([p, st]) => window.__mount(p, st), [props, strict]).then(() => page.waitForTimeout(60));

  it("the form carries the page's own key at first, and the browser then saves it for this scope", async () => {
    const { page, key, hidden, errors } = await open({ scope: "payment:o1", initial: KEY(1), binding: "0" });
    assert.equal(await key(), KEY(1));
    assert.equal(await hidden(), KEY(1), "the hidden form field carries the key");
    assert.deepEqual(JSON.parse(await saved(page, "payment:o1")), { key: KEY(1), binding: "0" });
    assert.deepEqual(errors, []);
    await page.close();
  });

  it("a RELOAD (a lost response, then the person reloads) keeps the same key even though the server rendered a different page key", async () => {
    const { page, key } = await open({ scope: "payment:o2", initial: KEY(2), binding: "0" });
    assert.equal(await key(), KEY(2));
    await page.goto(`${base}/?${new URLSearchParams({ scope: "payment:o2", initial: KEY(3), binding: "0" })}`);
    await page.waitForFunction(() => window.__ready === true);
    await page.waitForTimeout(50);
    assert.equal(await page.locator("#key").textContent(), KEY(2), "the saved key wins, so the retry is the same request");
    await page.close();
  });

  it("when the balance the page shows has CHANGED, the reload is a new decision: the page's new key is used, not the old one", async () => {
    const { page } = await open({ scope: "payment:o3", initial: KEY(4), binding: "0" });
    await page.goto(`${base}/?${new URLSearchParams({ scope: "payment:o3", initial: KEY(5), binding: "30000" })}`);
    await page.waitForFunction(() => window.__ready === true);
    await page.waitForTimeout(50);
    assert.equal(await page.locator("#key").textContent(), KEY(5));
    assert.deepEqual(JSON.parse(await saved(page, "payment:o3")), { key: KEY(5), binding: "30000" });
    await page.close();
  });

  it("after a SUCCESS the next action gets a NEW key, saved, and that key survives a reload", async () => {
    const { page, key } = await open({ scope: "payment:o4", initial: KEY(6), binding: "0" });
    await set(page, { status: "success", message: "Payment recorded." });
    const next = await key();
    assert.notEqual(next, KEY(6));
    assert.match(next, /^[A-Za-z0-9._:-]{8,100}$/);
    assert.equal(JSON.parse(await saved(page, "payment:o4")).key, next);
    await page.reload();
    await page.waitForFunction(() => window.__ready === true);
    await page.waitForTimeout(50);
    assert.equal(await page.locator("#key").textContent(), next);
    await page.close();
  });

  it("the key is replaced when the database RETIRED it (keyRetired), and for no other failure: a validation error, a business refusal and an unknown outcome all KEEP it", async () => {
    const { page, key } = await open({ scope: "payment:o5", initial: KEY(7), binding: "0" });
    for (const state of [
      { status: "error", message: "Enter the amount received in QAR.", fieldErrors: { amount: "x" } },
      { status: "error", message: "this payment would exceed the order total" },
      { status: "error", message: "The connection was lost before we could confirm the result, so this may or may not have been saved. Reload the page and check first." },
      { status: "error", message: "the amount paid on this order changed while you were working" },
      { status: "error", message: "this idempotency key was already used for a different request; nothing was changed" },
      { status: "idle" },
    ]) {
      await set(page, state);
      assert.equal(await key(), KEY(7), JSON.stringify(state.message ?? state.status));
    }
    await set(page, { status: "error", message: "this payment was recorded and has since been reversed", keyRetired: true });
    assert.notEqual(await key(), KEY(7));
    await page.close();
  });

  it("the SAME result shown again (an unrelated re-render) does not rotate the key a second time", async () => {
    const { page, key } = await open({ scope: "payment:o6", initial: KEY(8), binding: "0" });
    await set(page, { status: "success", message: "Payment recorded." });
    const afterSuccess = await key();
    for (let tick = 1; tick <= 3; tick++) await remount(page, { scope: "payment:o6", initial: KEY(8), binding: "0", tick });
    assert.equal(await key(), afterSuccess);
    await page.close();
  });

  it("after a success the page re-renders with the NEW balance (revalidated): the key follows the new decision and the form is ready for the next, different payment", async () => {
    const { page, key } = await open({ scope: "payment:o7", initial: KEY(9), binding: "0" });
    await set(page, { status: "success", message: "Payment recorded." });
    await remount(page, { scope: "payment:o7", initial: KEY(10), binding: "30000", tick: 1 });
    assert.equal(await key(), KEY(10), "a new balance is a new decision: the page's fresh key");
    await page.close();
  });

  it("a SECOND TAB has its own sessionStorage and therefore its own key (two tabs never share an intent by accident)", async () => {
    const a = await open({ scope: "payment:o8", initial: KEY(11), binding: "0" });
    const b = await open({ scope: "payment:o8", initial: KEY(12), binding: "0" });
    assert.equal(await a.key(), KEY(11));
    assert.equal(await b.key(), KEY(12));
    await set(a.page, { status: "success", message: "Payment recorded." });
    assert.equal(await b.key(), KEY(12), "tab B is untouched by tab A's success");
    await a.page.close();
    await b.page.close();
  });

  it("different scopes (another order, the order form) never share a key", async () => {
    const a = await open({ scope: "payment:oa", initial: KEY(13), binding: "0" });
    await a.page.evaluate(() => window.sessionStorage.setItem("m1-idem:payment:ob", JSON.stringify({ key: "other-order-key-0001", binding: "0" })));
    await a.page.goto(`${base}/?${new URLSearchParams({ scope: "payment:ob", initial: KEY(14), binding: "0" })}`);
    await a.page.waitForFunction(() => window.__ready === true);
    await a.page.waitForTimeout(50);
    assert.equal(await a.page.locator("#key").textContent(), "other-order-key-0001");
    assert.equal(JSON.parse(await saved(a.page, "payment:oa")).key, KEY(13), "the first scope still holds its own");
    await a.page.close();
  });

  it("damaged saved values (not JSON, wrong shape, a key that fails the database's own pattern) are ignored: the page's key is used and the entry repaired", async () => {
    for (const [i, bad] of ["not json", "{}", JSON.stringify({ key: "bad key!", binding: "0" }), JSON.stringify({ key: KEY(1) }), "old-plain-key-00000001"].entries()) {
      const first = await context.newPage();
      await first.goto(`${base}/?${new URLSearchParams({ scope: `damaged:${i}`, initial: KEY(20 + i), binding: "0" })}`, { waitUntil: "domcontentloaded" });
      await first.evaluate(([s, v]) => window.sessionStorage.setItem(`m1-idem:${s}`, v), [`damaged:${i}`, bad]);
      await first.reload();
      await first.waitForFunction(() => window.__ready === true);
      await first.waitForTimeout(50);
      assert.equal(await first.locator("#key").textContent(), KEY(20 + i), bad);
      assert.deepEqual(JSON.parse(await saved(first, `damaged:${i}`)), { key: KEY(20 + i), binding: "0" });
      await first.close();
    }
  });

  it("with sessionStorage BLOCKED (a private window, a policy) the form still works: it carries the page's key, rotates in memory after a success, and nothing throws", async () => {
    const { page, key, errors } = await open({ scope: "payment:o9", initial: KEY(30), binding: "0" }, { storageBlocked: true });
    assert.equal(await key(), KEY(30));
    await set(page, { status: "success", message: "Payment recorded." });
    const next = await key();
    assert.notEqual(next, KEY(30));
    assert.match(next, /^[A-Za-z0-9._:-]{8,100}$/);
    assert.deepEqual(errors, [], "no page error from the blocked storage");
    await page.close();
  });

  it("React StrictMode (effects run twice in development) neither rotates the key early nor loses it", async () => {
    const { page, key, errors } = await open({ scope: "payment:o10", initial: KEY(31), binding: "0", strict: "1" });
    assert.equal(await key(), KEY(31));
    await set(page, { status: "success", message: "Payment recorded." });
    const next = await key();
    assert.notEqual(next, KEY(31));
    assert.equal(JSON.parse(await saved(page, "payment:o10")).key, next);
    assert.deepEqual(errors, []);
    await page.close();
  });
});
