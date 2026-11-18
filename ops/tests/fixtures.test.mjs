// Valid fixtures must pass; every invalid fixture must be rejected with the documented message.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { validateDecisionDocument, validateReportDocument, validateTaskDocument } from "../validate-memory.mjs";
import { ROOT, fixture, fixtureContext } from "./helpers.mjs";

const ctx = fixtureContext();
const run = {
  task: (doc) => validateTaskDocument(doc, ctx, { filename: `${doc.task_id}-fixture.md`, body: "x".repeat(80) }),
  report: (doc) => validateReportDocument(doc, ctx),
  decision: (doc) => validateDecisionDocument(doc, ctx),
};
const errorsOf = (issues) => issues.filter((i) => i.severity === "error");
const text = (issues) => errorsOf(issues).map((i) => `[${i.code}] ${i.message}`).join("\n");

test("valid fixtures are accepted without errors", async (t) => {
  await t.test("task", () => assert.deepEqual(errorsOf(run.task(fixture("valid/task.json"))), []));
  await t.test("run report", () => assert.deepEqual(errorsOf(run.report(fixture("valid/run-report.json"))), []));
  await t.test("reviewer decision", () => assert.deepEqual(errorsOf(run.decision(fixture("valid/review-decision.json"))), []));
});

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "ops/tests/fixtures/manifest.json"), "utf8"));

test("the manifest lists every invalid fixture file, and only those", () => {
  const onDisk = fs.readdirSync(path.join(ROOT, "ops/tests/fixtures/invalid")).map((f) => `invalid/${f}`).sort();
  assert.deepEqual(manifest.cases.map((c) => c.file).sort(), onDisk);
  assert.ok(manifest.cases.length >= 25);
});

for (const c of manifest.cases) {
  test(`invalid fixture is rejected: ${c.file} (${c.why})`, () => {
    const issues = run[c.kind](fixture(c.file));
    const report = text(issues);
    assert.ok(errorsOf(issues).length > 0, `expected at least one error, got none (fixture is not rejected)`);
    for (const fragment of c.expect) {
      assert.ok(report.includes(fragment), `expected the message to contain "${fragment}" but got:\n${report}`);
    }
  });
}
