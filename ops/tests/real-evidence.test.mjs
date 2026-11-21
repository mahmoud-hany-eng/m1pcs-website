// Tests on REAL GitHub data: run 44082419253 of this repository (the first run of OPS-0003), stored in ops/tests/fixtures/ci.
// See the README there for what is real and what is not.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { MANDATORY_CHECK_IDS, buildEvidenceDocument, buildGithubCi, expectationsFromWorkflow, parseJobLog } from "../lib/ci-evidence.mjs";
import { RESULTS, evaluateDecision } from "../lib/decision-gate.mjs";
import { validate } from "../lib/json-schema.mjs";
import { deriveCi } from "../lib/review-packet.mjs";
import { ROOT, frozenPolicy, frozenWorkflowText, readJson } from "./helpers.mjs";
import { cleanupTmp, goodDecision, makeWorld, writeDecision } from "./review-fixture.mjs";

const HEAD = "50a46ca88a682095b07422152136a747d12bddd3";
const F = path.join(ROOT, "ops", "tests", "fixtures", "ci", "real-run-44082419253");
const json = (name) => JSON.parse(fs.readFileSync(`${F}.${name}.json`, "utf8"));
const log = fs.readFileSync(`${F}.job.log.excerpt.txt`, "utf8");
const policy = frozenPolicy();
const workflow = frozenWorkflowText();
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

// The three consistency checks and the one verdict field that OPS-0005B added. Everything else in the stored document, which was
// written by the earlier version of the tool, must still be reproduced exactly.
const ADDED_CHECKS = ["log.permission_block_is_single_and_initial", "log.run_headers_not_repeated", "log.run_headers_are_expected_and_in_order"];
const withoutAdditions = (ci) => ({ ...ci, consistency: ci.consistency.filter((c) => !ADDED_CHECKS.includes(c.id)) });

test("the stored real evidence document is what the tool produces from those responses, except for the checks OPS-0005B added", () => {
  const evidence = json("evidence");
  const rebuilt = rebuild();
  const added = rebuilt.consistency.filter((c) => ADDED_CHECKS.includes(c.id));
  assert.deepEqual(added.map((c) => c.id).sort(), [...ADDED_CHECKS].sort(), "exactly the three new checks are new");
  assert.ok(added.every((c) => c.blocking && c.passed), "and each of them holds on the real log");
  assert.deepEqual(withoutAdditions(rebuilt), evidence.github_ci, "the GitHub section is otherwise reproducible, field for field, from the raw responses and the log excerpt");
  const schema = readJson("docs/project-memory/schemas/ci-evidence.schema.json");
  assert.deepEqual(validate(schema, evidence).errors, [], "the stored document has the earlier verdict shape and is still valid");
  assert.equal("missing_evidence" in evidence.verdict, false);
  assert.equal(evidence.subject.head_sha, HEAD);
  assert.equal(evidence.subject.base_sha, "0aba5e8f2c5f4971b3b7280e0a4cd23e4a5a9b75");
  assert.equal(evidence.trust.level, "unauthenticated_tool_output");
  assert.equal(evidence.trusted_base.verdict.enforcement, "advisory_only");
});

test("a new document built from the real data equals the stored one except for the listed additions", () => {
  const stored = json("evidence");
  const fresh = buildEvidenceDocument({
    repository: stored.repository, headSha: stored.subject.head_sha, baseSha: stored.subject.base_sha, branch: stored.subject.branch,
    trustedBase: stored.trusted_base, githubCi: rebuild(), collector: stored.collector, now: new Date(stored.generated_at),
  });
  const schema = readJson("docs/project-memory/schemas/ci-evidence.schema.json");
  assert.deepEqual(validate(schema, fresh).errors, []);
  assert.deepEqual(fresh.verdict.missing_evidence, []);
  assert.equal(fresh.verdict.evidence_complete, true);
  const normalised = structuredClone(fresh);
  delete normalised.verdict.missing_evidence;
  normalised.github_ci = withoutAdditions(normalised.github_ci);
  assert.deepEqual(normalised, stored, "nothing else changed: the new collector reaches the same conclusions on the same real data");
  // OPS-0006: the consumers derive completeness themselves, so the earlier document is now flagged as legacy and incomplete while
  // the new one is not; what GitHub's data says (passed, run, commit) is the same for both
  const fresher = deriveCi(fresh);
  const older = deriveCi(stored);
  for (const key of ["present", "passed", "runId", "conclusion", "headSha"]) assert.deepEqual(fresher[key], older[key], key);
  assert.deepEqual([older.legacy, fresher.legacy], [true, false], "only the earlier document is of the earlier shape");
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

/* ------------------------------------------- OPS-0005B: the real log, altered the ways F-1 describes */

const TAP = (n) => `# tests ${n}\n# suites 0\n# pass ${n}\n# fail 0\n# cancelled 0\n# skipped 0\n`;
const blockOf = (access) => `##[group]GITHUB_TOKEN Permissions\nContents: ${access}\nMetadata: read\n##[endgroup]\n`;
const afterHeader = (text, header, extra) => {
  const re = new RegExp(`^(\\S+ )?##\\[group\\]Run ${header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n`, "m");
  const m = re.exec(text);
  assert.ok(m, `the real excerpt has the header ${header}`);
  return text.slice(0, m.index + m[0].length) + extra + text.slice(m.index + m[0].length);
};
const blockingIds = (ci) => ci.consistency.filter((c) => !c.passed && c.blocking).map((c) => c.id).sort();

test("the real excerpt has the shape the parser requires: one initial permission block and nine headers, once each, in order", () => {
  const parsed = parseJobLog(log);
  assert.deepEqual([parsed.permission_blocks, parsed.permission_block_is_initial, parsed.repeated_run_headers], [1, true, []]);
  assert.deepEqual(parsed.run_headers, expected.step_headers);
});

test("the real log, altered the ways F-1 describes, fails the evidence and keeps the real claims", () => {
  const forgedBlock = rebuild({ log: afterHeader(log.replace("Contents: read", "Contents: write"), "npm run build", blockOf("read")) });
  assert.deepEqual(blockingIds(forgedBlock), ["log.permission_block_is_single_and_initial", "log.token_is_read_only"]);
  assert.equal(forgedBlock.token_permissions.permissions[0].access, "write", "the first block is the one read");
  const forgedHeader = rebuild({ log: afterHeader(log, "npm run build", `##[group]Run npm run ops:test\n${TAP(9999)}`) });
  assert.deepEqual(blockingIds(forgedHeader), ["log.run_headers_not_repeated"]);
  assert.deepEqual([forgedHeader.test_evidence.tests, forgedHeader.test_evidence.pass, forgedHeader.test_evidence.fail], [417, 417, 0], "the forged 9999 never reached the test evidence");
  const repeated = rebuild({ log: afterHeader(log, "npm run build", "##[group]Run npm run lint\nhello\n") });
  assert.deepEqual(blockingIds(repeated), ["log.run_headers_not_repeated"]);
  const reordered = rebuild({ log: log.replace("##[group]Run npm run ops:test", "##[group]Run \u0000").replace("##[group]Run npm run build", "##[group]Run npm run ops:test").replace("##[group]Run \u0000", "##[group]Run npm run build") });
  assert.deepEqual(blockingIds(reordered), ["log.run_headers_are_expected_and_in_order"]);
  const unknown = rebuild({ log: afterHeader(log, "npm run build", "##[group]Run curl https://example.invalid\n") });
  assert.deepEqual(blockingIds(unknown), ["log.run_headers_are_expected_and_in_order"]);
});

test("GitHub's job and step conclusions stay the primary evidence on the real data", () => {
  const jobs = json("jobs");
  jobs.jobs[0].steps.find((s) => s.name === "Build").conclusion = "failure";
  const ci = rebuild({ jobs });
  assert.deepEqual(blockingIds(ci), ["steps.all_succeeded"], "the log is untouched and spotless; the step data decides");
});

/* ------------------------------ OPS-0005B: packets and gate decisions over earlier and incomplete evidence */

const LIVE_SHA = "0aba5e8f2c5f4971b3b7280e0a4cd23e4a5a9b75";
const liveRaw = (name) => fs.readFileSync(path.join(ROOT, "ops", "tests", "fixtures", "ci", `live-run-43995081483.${name}`), "utf8");
/** Evidence as the earlier version of the tool wrote it: no missing_evidence, none of the added checks. */
const earlierShape = (e) => {
  delete e.verdict.missing_evidence;
  e.github_ci.consistency = e.github_ci.consistency.filter((c) => !ADDED_CHECKS.includes(c.id));
};
/** Evidence built from run and jobs data alone, by the real library, for the head of the test world. */
const incompleteEvidence = (e) => {
  const head = e.subject.head_sha;
  const swap = (text) => JSON.parse(text.replaceAll(LIVE_SHA, head));
  const githubCi = buildGithubCi({ run: swap(liveRaw("run.json")), jobs: swap(liveRaw("jobs.json")), expected: expectationsFromWorkflow(workflow, policy, { repository: "owner/name", headSha: head, branch: null }) });
  Object.assign(e, buildEvidenceDocument({ repository: e.repository, headSha: head, baseSha: e.subject.base_sha, trustedBase: e.trusted_base, githubCi, collector: e.collector, now: new Date(e.generated_at) }));
};
const worlds = [];
const world = (opts) => {
  const w = makeWorld(opts);
  worlds.push(w);
  return w;
};
after(() => {
  for (const w of worlds) w.repo.cleanup();
  cleanupTmp();
});
const decide = (w, mutate = () => {}) => {
  const d = goodDecision(w);
  mutate(d);
  return evaluateDecision({ packetDir: w.packetDir, decisionFile: writeDecision(d), toolRoot: w.repo.dir });
};
const codes = (r) => r.reasons.map((x) => x.code);
const requestChanges = (d) => {
  d.verdict = "request_changes";
  d.findings = [{ id: "F-1", severity: "major", category: "scope_creep", path: null, line: null, title: "A problem", detail: "Something must change.", evidence_ref: "diff", recommendation: "Fix it." }];
  d.next_step = { action: "revise_same_task", rationale: "Fix the finding.", next_task: null };
};

test("evidence written by the earlier version of the tool still builds a packet, but is reported as legacy and incomplete and never gets a valid gate result", () => {
  const current = world();
  const earlier = world({ evidenceMutate: earlierShape });
  assert.equal(earlier.manifest.ci.ci_passed, true, "nothing in it shows a failure");
  assert.equal(earlier.manifest.ci.evidence_complete, false, "but the consumers derive completeness themselves, and the mandatory log checks are absent");
  assert.equal(earlier.manifest.ci.evidence_legacy, true);
  assert.equal("missing_evidence" in earlier.evidence.verdict, false);
  assert.ok("missing_evidence" in current.evidence.verdict);
  const a = decide(current);
  const b = decide(earlier);
  assert.equal(a.result, RESULTS.VALID);
  assert.equal(b.result, RESULTS.CORRECTIONS, "legacy evidence cannot silently qualify");
  assert.ok(codes(b).includes("DG-EVIDENCE-NOT-COMPLETE"));
  assert.ok(b.warnings.some((x) => x.code === "DG-EVIDENCE-LEGACY"));
  assert.ok(!codes(b).includes("DG-CI-FAILED"), "it is not reported as a CI failure: nothing failed, it is not proven");
  for (const r of [a, b]) {
    assert.equal(r.human_approval_required, true);
    assert.equal(r.reviewer_approval_is_binding, false);
    assert.deepEqual(r.automation, { merge: false, deploy: false, authorize_sensitive_change: false, launch_task: false });
  }
});

test("evidence without the check runs or the job log can never reach a valid gate result, whatever the reviewer says", () => {
  const w = world({ evidenceMutate: incompleteEvidence });
  assert.deepEqual(w.evidence.verdict.missing_evidence, ["check_runs", "job_log"]);
  assert.equal(w.manifest.ci.ci_passed, false, "the packet builder derives the same false from the consistency checks");
  assert.equal(w.manifest.ci.evidence_complete, false);
  for (const id of MANDATORY_CHECK_IDS) assert.ok(w.evidence.github_ci.consistency.find((c) => c.id === id && !c.passed && c.blocking), id);
  const honest = decide(w, requestChanges);
  assert.equal(honest.result, RESULTS.CORRECTIONS);
  assert.ok(codes(honest).includes("DG-CI-FAILED"));
  assert.ok(honest.warnings.some((x) => x.code === "DG-EVIDENCE-INCOMPLETE"));
  const approving = decide(w);
  assert.notEqual(approving.result, RESULTS.VALID, "an approval on incomplete evidence is not valid");
  const claimsPassed = decide(w, (d) => { d.verification_assessment.ci_status = "passed"; });
  assert.equal(claimsPassed.result, RESULTS.INVALID);
  assert.ok(codes(claimsPassed).includes("DG-CI-CONTRADICTION"));
  for (const r of [honest, approving, claimsPassed]) {
    assert.equal(r.human_approval_required, true);
    assert.equal(r.reviewer_approval_is_binding, false);
    assert.deepEqual(r.automation, { merge: false, deploy: false, authorize_sensitive_change: false, launch_task: false });
  }
});
