// Tests on REAL GitHub data: run 44082419253 of this repository (the first run of OPS-0003), stored in ops/tests/fixtures/ci.
// See the README there for what is real and what is not.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { buildGithubCi, expectationsFromWorkflow } from "../lib/ci-evidence.mjs";
import { validate } from "../lib/json-schema.mjs";
import { deriveCi } from "../lib/review-packet.mjs";
import { ROOT, loadPolicy, readJson } from "./helpers.mjs";

const HEAD = "50a46ca88a682095b07422152136a747d12bddd3";
const F = path.join(ROOT, "ops", "tests", "fixtures", "ci", "real-run-44082419253");
const json = (name) => JSON.parse(fs.readFileSync(`${F}.${name}.json`, "utf8"));
const log = fs.readFileSync(`${F}.job.log.excerpt.txt`, "utf8");
const policy = loadPolicy();
const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
const expected = expectationsFromWorkflow(workflow, policy, { repository: "mahmoud-hany-eng/m1pcs-website", headSha: HEAD, branch: "claude/ops-0003-trusted-ci" });
const rebuild = (over = {}) => buildGithubCi({ run: over.run ?? json("run"), jobs: over.jobs ?? json("jobs"), checkRuns: over.checks ?? json("check-runs"), jobLog: over.log ?? log, expected });

test("rebuilt from GitHub's unmodified responses, the real run passes every consistency check", () => {
  const ci = rebuild();
  assert.deepEqual(ci.consistency.filter((c) => !c.passed), []);
  assert.equal(ci.workflow_run.id, 44082419253);
  assert.equal(ci.workflow_run.head_sha, HEAD);
  assert.equal(ci.workflow_run.conclusion, "success");
  assert.equal(ci.jobs.length, 1);
  assert.equal(ci.jobs[0].name, "verify");
  assert.equal(ci.jobs[0].steps.filter((s) => !/^(Set up job|Complete job|Post )/.test(s.name)).length, 9);
});

test("the stored real evidence document is exactly what the tool produces from those responses", () => {
  const evidence = json("evidence");
  assert.deepEqual(rebuild(), evidence.github_ci, "the GitHub section is reproducible from the raw responses and the log excerpt");
  const schema = readJson("docs/project-memory/schemas/ci-evidence.schema.json");
  assert.deepEqual(validate(schema, evidence).errors, []);
  assert.equal(evidence.subject.head_sha, HEAD);
  assert.equal(evidence.subject.base_sha, "0aba5e8f2c5f4971b3b7280e0a4cd23e4a5a9b75");
  assert.equal(evidence.trust.level, "unauthenticated_tool_output");
  assert.equal(evidence.trusted_base.verdict.enforcement, "advisory_only");
});

test("what the real data says, field by field, and which of it is a claim", () => {
  const ci = rebuild();
  assert.deepEqual(ci.token_permissions, { source: "job_log", permissions: [{ scope: "contents", access: "read" }, { scope: "metadata", access: "read" }] });
  assert.deepEqual(ci.checks.map((c) => [c.name, c.app_slug, c.conclusion]).sort(), [["Vercel Preview Comments", "vercel", "success"], ["verify", "github-actions", "success"]]);
  assert.equal(ci.test_evidence.authority, "claim_by_output_of_the_code_under_test");
  assert.deepEqual([ci.test_evidence.tests, ci.test_evidence.pass, ci.test_evidence.fail, ci.test_evidence.validate_files_checked, ci.test_evidence.build_static_pages], [417, 417, 0, 111, 56]);
});

test("the CI result is derived from GitHub's fields, not from the document's own verdict", () => {
  const evidence = json("evidence");
  const d = deriveCi(evidence);
  assert.deepEqual([d.present, d.passed, d.runId, d.conclusion, d.headSha], [true, true, 44082419253, "success", HEAD]);
  const tampered = structuredClone(evidence);
  tampered.github_ci.workflow_run.conclusion = "failure";
  assert.equal(deriveCi(tampered).passed, false, "the verdict field still says passed, the derivation does not");
  assert.equal(tampered.verdict.ci_passed, true);
});

test("the real data, altered the ways an attacker would, is caught", () => {
  const blocking = (ci) => ci.consistency.filter((c) => !c.passed && c.blocking).map((c) => c.id);
  const failed = json("run");
  failed.conclusion = "failure";
  assert.ok(blocking(rebuild({ run: failed })).includes("run.completed_successfully"));
  const otherCommit = json("run");
  otherCommit.head_sha = "e".repeat(40);
  assert.ok(blocking(rebuild({ run: otherCommit })).includes("run.head_sha_is_expected"));
  const otherApp = json("check-runs");
  otherApp.check_runs.find((c) => c.name === "verify").app.slug = "some-other-app";
  assert.ok(blocking(rebuild({ checks: otherApp })).includes("checks.match_jobs_from_actions_app"));
  const writeToken = log.replace("Contents: read", "Contents: write");
  assert.ok(blocking(rebuild({ log: writeToken })).includes("log.token_is_read_only"));
  const extraStep = json("jobs");
  extraStep.jobs[0].steps.splice(5, 0, { name: "Send the environment to a server", status: "completed", conclusion: "success", number: 99 });
  assert.ok(blocking(rebuild({ jobs: extraStep })).includes("steps.exactly_the_expected_sequence"));
});

test("the older synthetic check-run fixture has the shape of the real check run", () => {
  const synthetic = JSON.parse(fs.readFileSync(path.join(ROOT, "ops/tests/fixtures/ci/live-run-43995081483.check-runs.synthetic.json"), "utf8")).check_runs[0];
  const real = json("check-runs").check_runs.find((c) => c.name === "verify");
  for (const key of Object.keys(synthetic)) assert.ok(key in real, `the real check run has ${key}`);
  assert.equal(synthetic.app.slug, real.app.slug);
});
