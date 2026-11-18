// The consumers of CI evidence (OPS-0006): the packet builder, the packet verifier and the decision gate.
//
// OPS-0005B corrected the collector. These tests are about everything AFTER it. A consumer must not believe the verdict a document
// states about itself: it derives completeness, the CI result and the trust basis from the data inside the document and from
// expectations taken from the trusted baseline, and fails closed when they disagree. Every forgery below is a document that a person
// who knows the format could write; none may reach a valid gate result.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { MANDATORY_CHECK_IDS, buildEvidenceDocument, buildGithubCi, expectationsFromWorkflow } from "../lib/ci-evidence.mjs";
import { RESULTS, evaluateDecision } from "../lib/decision-gate.mjs";
import { PacketError, buildPacket, deriveCi, trustedExpectations, verifyPacket } from "../lib/review-packet.mjs";
import { ROOT, loadPolicy } from "./helpers.mjs";
import { TASK_ID, cleanupTmp, collectEvidence, copyPacket, editManifest, forge, goodDecision, makeWorld, readPacketJson, tmp, writeDecision } from "./review-fixture.mjs";

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

const LIVE_SHA = "0aba5e8f2c5f4971b3b7280e0a4cd23e4a5a9b75";
const RUNS = "docs/project-memory/runs/**";
const policy = loadPolicy();
const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
const liveRaw = (name) => fs.readFileSync(path.join(ROOT, "ops", "tests", "fixtures", "ci", `live-run-43995081483.${name}`), "utf8");
const clone = (x) => structuredClone(x);
const codes = (r) => r.reasons.map((x) => x.code);
const warnCodes = (r) => r.warnings.map((x) => x.code);

/** A packet builder call for an existing world, so that a forged evidence file can be offered to it. */
const build = (w, over = {}) => buildPacket({ repoDir: w.repo.dir, baseline: w.baselineSha, base: w.baselineSha, head: w.headSha, taskId: TASK_ID, attemptId: w.attemptId, evidenceFile: w.evidenceFile, outDir: path.join(tmp(), "p"), toolRoot: w.repo.dir, ...over });
const refusedWith = (w, code, fragment = null) => assert.throws(() => build(w), (e) => e instanceof PacketError && e.code === code && (fragment === null || e.message.includes(fragment)), `expected ${code}${fragment ? ` mentioning ${fragment}` : ""}`);

/** Evidence built by the real library from run and jobs alone: honest, current-shape, incomplete. */
const incompleteEvidence = (e) => {
  const head = e.subject.head_sha;
  const swap = (text) => JSON.parse(text.replaceAll(LIVE_SHA, head));
  const githubCi = buildGithubCi({ run: swap(liveRaw("run.json")), jobs: swap(liveRaw("jobs.json")), expected: expectationsFromWorkflow(workflow, policy, { repository: "owner/name", headSha: head, branch: null }) });
  Object.assign(e, buildEvidenceDocument({ repository: e.repository, headSha: head, baseSha: e.subject.base_sha, trustedBase: e.trusted_base, githubCi, collector: e.collector, now: new Date(e.generated_at) }));
};
/** Make a document read as complete and passed, the way a forger would: flip every recorded failure and every claim. */
const claimEverything = (e) => {
  for (const c of e.github_ci.consistency) c.passed = true;
  e.verdict.ci_passed = true;
  e.verdict.evidence_complete = true;
  if (Array.isArray(e.verdict.missing_evidence)) e.verdict.missing_evidence = [];
};
const removeChecks = (e, ids) => { e.github_ci.consistency = e.github_ci.consistency.filter((c) => !ids.includes(c.id)); };

const OK = world();
/** The paths that differ between a base and the head, computed from git (what the builder computes), sorted. */
const changedOf = (w, base = w.baselineSha) => w.repo.git("diff", "--name-only", "--no-renames", base, w.headSha).trim().split("\n").filter(Boolean).sort();
/** What a consumer hands deriveCi: the baseline's expectations and the comparison it computed itself (OPS-0006 attempt 2: base, merge-base, head, paths). */
const trustedFor = (w, over = {}) => ({ expected: trustedExpectations(loadTool(w), w.headSha, "owner/name"), changedPaths: changedOf(w), baseSha: w.baselineSha, mergeBaseSha: w.baselineSha, headSha: w.headSha, ...over });
function loadTool(w) {
  return { workflowText: w.repo.read(".github/workflows/ci.yml"), policy: JSON.parse(w.repo.read("docs/project-memory/policy/policy.json")) };
}

/* ------------------------------------------------------------------ the honest case */

test("honest current evidence is derived as passed and complete, and the manifest records the derived values", () => {
  const ci = deriveCi(OK.evidence, trustedFor(OK));
  assert.deepEqual(ci.problems, []);
  assert.deepEqual([ci.present, ci.passed, ci.complete, ci.legacy, ci.recomputed, ci.missing], [true, true, true, false, true, []]);
  assert.deepEqual(ci.recordedOnly.sort(), ["log.permission_block_is_single_and_initial", "log.run_headers_are_expected_and_in_order", "log.run_headers_not_repeated"], "the log-structure checks can only be taken as recorded, and are named");
  assert.equal(OK.manifest.ci.ci_passed, true);
  assert.equal(OK.manifest.ci.evidence_complete, true);
  assert.equal(OK.manifest.ci.evidence_legacy, false);
  assert.equal(OK.manifest.ci.ci_trust_basis, OK.evidence.verdict.ci_trust_basis);
  const v = verifyPacket(OK.packetDir, { toolRoot: OK.repo.dir });
  assert.deepEqual(v.errors, []);
  assert.equal(v.data.ci.complete, true);
});

test("without trusted expectations nothing is re-evaluated, so a document is never complete", () => {
  const plain = deriveCi(OK.evidence);
  assert.equal(plain.passed, true, "what GitHub's data says is still derived");
  assert.equal(plain.recomputed, false);
  assert.equal(plain.complete, false);
  assert.ok(plain.problems.some((p) => p.code === "EV-NOT-RECOMPUTED" && p.kind === "incomplete"));
  const noWorkflow = deriveCi(OK.evidence, { expected: null, changedPaths: null, baseSha: null });
  assert.equal(noWorkflow.complete, false);
  assert.equal(trustedExpectations({ workflowText: null, policy }, "f".repeat(40)), null);
  assert.equal(trustedExpectations({ workflowText: "not: [a workflow", policy }, "f".repeat(40)), null, "an unreadable workflow gives no expectations instead of an exception");
});

/* ------------------------------------------------------------------ forged documents are refused by the builder */

const FORGERIES = [
  ["the mandatory log checks are deleted while the verdict says complete and passed", (e) => removeChecks(e, ["log.permission_block_is_single_and_initial", "log.run_headers_not_repeated", "log.run_headers_are_expected_and_in_order"]), "is not recorded"],
  ["every mandatory check is deleted", (e) => removeChecks(e, MANDATORY_CHECK_IDS), "is not recorded"],
  ["checks that are not mandatory but are derivable from the embedded data are deleted (a failed step is then not visible in the record)", (e) => { e.github_ci.jobs[0].steps.find((s) => s.name === "Build").conclusion = "failure"; removeChecks(e, ["steps.all_succeeded", "jobs.completed_successfully", "run.head_sha_is_expected"]); }, "steps.all_succeeded is not recorded"],
  ["the check runs, token permissions and test evidence are removed but the checks that rest on them still say passed", (e) => { e.github_ci.checks = null; e.github_ci.token_permissions = null; e.github_ci.test_evidence = null; }, "the data inside the evidence gives passed false"],
  ["a step failed in the embedded data but steps.all_succeeded is recorded as passed", (e) => { e.github_ci.jobs[0].steps.find((s) => s.name === "Build").conclusion = "failure"; }, "steps.all_succeeded is recorded as passed true"],
  ["the job did not succeed in the embedded data but is recorded as passed", (e) => { e.github_ci.jobs[0].conclusion = "failure"; }, "jobs.completed_successfully"],
  ["the steps were changed to another sequence but the sequence check is recorded as passed", (e) => { e.github_ci.jobs[0].steps.push({ number: 99, name: "Send the environment to a server", status: "completed", conclusion: "success" }); }, "steps.exactly_the_expected_sequence"],
  ["the run is for another commit but the head check is recorded as passed", (e) => { e.github_ci.workflow_run.head_sha = "e".repeat(40); }, "different commit"],
  ["the run is of another workflow file but the path check is recorded as passed", (e) => { e.github_ci.workflow_run.workflow_path = ".github/workflows/deploy.yml"; }, "run.workflow_path_is_expected"],
  ["the event is not an allowed one but the event check is recorded as passed", (e) => { e.github_ci.workflow_run.event = "workflow_dispatch"; }, "run.event_is_allowed"],
  ["the check runs name another app but the match is recorded as passed", (e) => { e.github_ci.checks[0].app_slug = "some-other-app"; }, "checks.match_jobs_from_actions_app"],
  ["the token had write access in the embedded data but the token check is recorded as passed", (e) => { e.github_ci.token_permissions.permissions[0].access = "write"; }, "log.token_is_read_only"],
  ["a mandatory check is recorded as non-blocking", (e) => { e.github_ci.consistency.find((c) => c.id === "log.token_is_read_only").blocking = false; }, "non-blocking"],
  ["a failing check is hidden behind a passing duplicate", (e) => { const c = e.github_ci.consistency.find((x) => x.id === "log.run_headers_not_repeated"); c.passed = false; e.github_ci.consistency.push({ ...c, passed: true }); }, "recorded 2 times"],
  ["the missing-evidence list is emptied", (e) => { e.verdict.missing_evidence = ["job_log"]; }, "lists missing evidence"],
  ["the verdict claims completeness that cannot be derived (the trusted-base section is gone)", (e) => { e.trusted_base = null; }, null],
];

for (const [name, mutate, fragment] of FORGERIES) {
  test(`forged evidence is refused by the packet builder: ${name}`, () => {
    const w = world({ build: false, evidenceMutate: mutate });
    refusedWith(w, "PK-EVIDENCE", fragment);
  });
}

test("a forged verdict over incomplete evidence is refused: the document that honestly says it is incomplete is accepted, the one that lies is not", () => {
  const honest = world({ evidenceMutate: incompleteEvidence });
  assert.equal(honest.manifest.ci.ci_passed, false);
  assert.equal(honest.manifest.ci.evidence_complete, false);
  const forgedA = world({ build: false, evidenceMutate: (e) => { incompleteEvidence(e); claimEverything(e); } });
  refusedWith(forgedA, "PK-EVIDENCE");
  const forgedB = world({ build: false, evidenceMutate: (e) => { incompleteEvidence(e); e.verdict.missing_evidence = []; } });
  refusedWith(forgedB, "PK-EVIDENCE");
  const forgedC = world({ build: false, evidenceMutate: (e) => { incompleteEvidence(e); e.verdict.evidence_complete = true; } });
  refusedWith(forgedC, "PK-EVIDENCE");
});

test("a forged trust basis is refused: the changed paths are computed by the consumer, not read from the evidence", () => {
  const files = { "ops/lib/example.mjs": "export {};\n" };
  const allowed = ["ops/lib/example.mjs", RUNS];
  const categories = ["ops_control_plane", "docs_only"];
  const honest = world({ files, allowed, categories });
  assert.equal(honest.manifest.ci.ci_trust_basis, "ci_definition_modified_from_base");
  const forged = world({ files, allowed, categories, build: false, evidenceMutate: (e) => { e.trusted_base.flags.ops_code_changed = false; e.verdict.ci_trust_basis = "ci_definition_unchanged_from_base"; } });
  refusedWith(forged, "PK-EVIDENCE", "unchanged");
  const claimedOnly = world({ files, allowed, categories, build: false, evidenceMutate: (e) => { e.verdict.ci_trust_basis = "ci_definition_unchanged_from_base"; } });
  refusedWith(claimedOnly, "PK-EVIDENCE", "trusted-base section gives");
});

/* ------------------------------------------------------------------ forged packets are rejected by the verifier and the gate */

test("a forger who rewrites the evidence AND recomputes the manifest is caught by the derivation, in the verifier and in the gate", () => {
  for (const [name, mutate] of [["mandatory checks deleted", (e) => removeChecks(e, ["log.run_headers_not_repeated"])], ["embedded data contradicts a recorded pass", (e) => { e.github_ci.jobs[0].steps.find((x) => x.name === "Build").conclusion = "failure"; }], ["inputs removed under passing checks", (e) => { e.github_ci.checks = null; }]]) {
    const dir = copyPacket(OK.packetDir);
    const e = readPacketJson(dir, "trusted/ci-evidence.json");
    mutate(e);
    forge(dir, "trusted/ci-evidence.json", `${JSON.stringify(e, null, 2)}\n`); // the manifest's hash for the file is recomputed too
    const v = verifyPacket(dir, { toolRoot: OK.repo.dir });
    assert.equal(v.ok, false, name);
    assert.ok(v.errors.some((x) => x.code === "PK-EVIDENCE-INCONSISTENT"), `${name}: ${v.errors.map((x) => x.code).join(", ")}`);
    const r = evaluateDecision({ packetDir: dir, decisionFile: writeDecision(goodDecision(OK)), toolRoot: OK.repo.dir });
    assert.equal(r.result, RESULTS.INVALID, name);
    assert.ok(r.human_approval_required);
  }
});

test("the verifier names each contradiction the derivation finds, even when the document and the manifest honestly say the CI did not pass", () => {
  const dir = copyPacket(OK.packetDir);
  const e = readPacketJson(dir, "trusted/ci-evidence.json");
  e.github_ci.jobs[0].steps.find((x) => x.name === "Build").conclusion = "failure"; // the record still says steps.all_succeeded passed
  e.verdict.ci_passed = false;
  e.verdict.evidence_complete = false;
  forge(dir, "trusted/ci-evidence.json", `${JSON.stringify(e, null, 2)}\n`);
  editManifest(dir, (m) => { m.ci.ci_passed = false; m.ci.evidence_complete = false; });
  const v = verifyPacket(dir, { toolRoot: OK.repo.dir });
  assert.equal(v.ok, false, "a document that contradicts its own data is not a verified packet, whatever it says about the outcome");
  assert.ok(v.errors.some((x) => x.code === "PK-EVIDENCE-INCONSISTENT" && x.message.includes("steps.all_succeeded")), v.errors.map((x) => `${x.code}: ${x.message}`).join(" | "));
});

test("a forger who also rewrites the manifest's CI summary to match the forged claims is still caught", () => {
  const dir = copyPacket(OK.packetDir);
  const e = readPacketJson(dir, "trusted/ci-evidence.json");
  removeChecks(e, MANDATORY_CHECK_IDS);
  e.github_ci.checks = null;
  forge(dir, "trusted/ci-evidence.json", `${JSON.stringify(e, null, 2)}\n`);
  editManifest(dir, (m) => { m.ci.evidence_complete = true; m.ci.ci_passed = true; m.ci.evidence_legacy = false; });
  const v = verifyPacket(dir, { toolRoot: OK.repo.dir });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((x) => x.code === "PK-EVIDENCE-INCONSISTENT"));
});

test("the evidence hash, the head commit and the policy version stay bound", () => {
  const d = goodDecision(OK);
  const staleEvidence = clone(d);
  staleEvidence.reviewed.ci_result_sha256 = "0".repeat(64);
  assert.ok(codes(evaluateDecision({ packetDir: OK.packetDir, decisionFile: writeDecision(staleEvidence), toolRoot: OK.repo.dir })).includes("DG-BIND-CI"));
  const otherHead = clone(d);
  otherHead.reviewed.head_sha = "1".repeat(40);
  assert.ok(codes(evaluateDecision({ packetDir: OK.packetDir, decisionFile: writeDecision(otherHead), toolRoot: OK.repo.dir })).includes("DG-BIND-HEAD"));
  const otherPolicy = clone(d);
  otherPolicy.reviewed.policy_version = "0.0.1";
  assert.ok(codes(evaluateDecision({ packetDir: OK.packetDir, decisionFile: writeDecision(otherPolicy), toolRoot: OK.repo.dir })).includes("DG-BIND-POLICY"));
  // a decision made for the honest packet does not fit a packet whose evidence was rewritten (the hash it binds to changed)
  const dir = copyPacket(OK.packetDir);
  const e = readPacketJson(dir, "trusted/ci-evidence.json");
  e.generated_at = "2030-01-01T00:00:00Z";
  forge(dir, "trusted/ci-evidence.json", `${JSON.stringify(e, null, 2)}\n`);
  assert.ok(codes(evaluateDecision({ packetDir: dir, decisionFile: writeDecision(d), toolRoot: OK.repo.dir })).includes("DG-BIND-CI"));
});

/* ------------------------------------------------------------------ the gate on incomplete and legacy evidence */

test("the gate never returns a valid result for evidence that is not complete as derived, and says why", () => {
  const w = world({ evidenceMutate: incompleteEvidence });
  const honest = goodDecision(w);
  honest.verdict = "request_changes";
  honest.findings = [{ id: "F-1", severity: "major", category: "scope_creep", path: null, line: null, title: "A problem", detail: "Something must change.", evidence_ref: "diff", recommendation: "Fix it." }];
  honest.next_step = { action: "revise_same_task", rationale: "Fix the finding.", next_task: null };
  const r = evaluateDecision({ packetDir: w.packetDir, decisionFile: writeDecision(honest), toolRoot: w.repo.dir });
  assert.equal(r.result, RESULTS.CORRECTIONS);
  assert.ok(codes(r).includes("DG-EVIDENCE-NOT-COMPLETE"));
  assert.ok(codes(r).includes("DG-CI-FAILED"));
  assert.ok(warnCodes(r).includes("DG-EVIDENCE-INCOMPLETE"));
  assert.equal(r.computed.ci.evidence_complete, false);
  const approving = evaluateDecision({ packetDir: w.packetDir, decisionFile: writeDecision(goodDecision(w)), toolRoot: w.repo.dir });
  assert.notEqual(approving.result, RESULTS.VALID);
});

test("legacy evidence still parses and builds a packet, is named as legacy, and fails closed", () => {
  const w = world({ evidenceMutate: (e) => { delete e.verdict.missing_evidence; removeChecks(e, ["log.permission_block_is_single_and_initial", "log.run_headers_not_repeated", "log.run_headers_are_expected_and_in_order"]); } });
  assert.deepEqual([w.manifest.ci.ci_passed, w.manifest.ci.evidence_complete, w.manifest.ci.evidence_legacy], [true, false, true]);
  const v = verifyPacket(w.packetDir, { toolRoot: w.repo.dir });
  assert.deepEqual(v.errors, []);
  assert.equal(v.data.ci.legacy, true);
  const r = evaluateDecision({ packetDir: w.packetDir, decisionFile: writeDecision(goodDecision(w)), toolRoot: w.repo.dir });
  assert.equal(r.result, RESULTS.CORRECTIONS);
  assert.ok(codes(r).includes("DG-EVIDENCE-NOT-COMPLETE"));
  assert.ok(warnCodes(r).includes("DG-EVIDENCE-LEGACY"));
  assert.equal(r.computed.ci.evidence_legacy, true);
  assert.equal(r.human_approval_required, true);
});

test("legacy evidence cannot be made complete by adding checks that its own data does not support", () => {
  const w = world({ build: false, evidenceMutate: (e) => { delete e.verdict.missing_evidence; e.github_ci.token_permissions = null; e.github_ci.checks = null; } });
  refusedWith(w, "PK-EVIDENCE");
});

/* ------------------------------------------------------------------ human authority is untouched */

test("a complete, honest packet still needs a human, and the reviewer's approval is still only advice", () => {
  const r = evaluateDecision({ packetDir: OK.packetDir, decisionFile: writeDecision(goodDecision(OK)), toolRoot: OK.repo.dir });
  assert.equal(r.result, RESULTS.VALID);
  assert.equal(r.human_approval_required, true);
  assert.equal(r.reviewer_approval_is_binding, false);
  assert.deepEqual(r.automation, { merge: false, deploy: false, authorize_sensitive_change: false, launch_task: false });
  assert.ok(r.human_approval_reasons.some((x) => x.code === "DG-HUMAN-ALWAYS"));
  const src = world({ files: { "src/app/page.tsx": "export default function Page() { return 2; }\n" }, allowed: ["src/**", RUNS], categories: ["ui_public_site", "docs_only"] });
  const rs = evaluateDecision({ packetDir: src.packetDir, decisionFile: writeDecision(goodDecision(src)), toolRoot: src.repo.dir });
  assert.ok(rs.human_approval_reasons.some((x) => x.code === "DG-HUMAN-PROTECTED-PATHS"), "a protected change still needs a human");
});

/* ------------------------------------------------------------------ F-1 (attempt 2): the evidence must describe the packet's own comparison */
// Review B found that the cross-check of the changed paths against the evidence's CI trust basis ran only when the evidence's base
// happened to equal the packet's. Evidence collected for ANOTHER comparison skipped the check silently and could say "unchanged" for
// a change that modifies the review control plane. The packet's base, the evidence subject's base, the trusted-base evaluation's
// base, the merge-base, the head and the changed paths must all agree, or the evidence does not qualify. Nothing is substituted.

// a change that touches the control plane: the honest trust basis is "modified", and only evidence for THIS comparison says so
const CP = world({ files: { "ops/lib/example-control.mjs": "export const example = 1;\n" }, allowed: ["ops/**", "docs/guides/**", RUNS], categories: ["ops_control_plane", "docs_only"] });
const FAKE = "d".repeat(40);
const evidenceFileFor = (e) => {
  const f = path.join(tmp(), "ci-evidence.json");
  fs.writeFileSync(f, `${JSON.stringify(e, null, 2)}\n`);
  return f;
};
const refusedEvidence = (w, e, fragment = null) => assert.throws(() => build(w, { evidenceFile: evidenceFileFor(e) }), (err) => err instanceof PacketError && err.code === "PK-EVIDENCE" && (fragment === null || err.message.includes(fragment)), `expected PK-EVIDENCE${fragment ? ` mentioning "${fragment}"` : ""}`);
/** The evidence swapped into a finished packet with the manifest's hash recomputed (what a forger who knows the format can do). `claim` makes the manifest's CI summary agree, so that only the comparison binding is left to catch it. */
const swapEvidence = (w, e, claim = null) => {
  const dir = copyPacket(w.packetDir);
  forge(dir, "trusted/ci-evidence.json", `${JSON.stringify(e, null, 2)}\n`);
  if (claim) editManifest(dir, (m) => { Object.assign(m.ci, claim); });
  return dir;
};
const verifierRefuses = (w, dir, fragment = null) => {
  const v = verifyPacket(dir, { toolRoot: w.repo.dir });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((x) => x.code === "PK-EVIDENCE-INCONSISTENT" && (fragment === null || x.message.includes(fragment))), `${fragment}: ${v.errors.map((x) => `${x.code} ${x.message}`).join(" | ")}`);
  const r = evaluateDecision({ packetDir: dir, decisionFile: writeDecision(goodDecision(w)), toolRoot: w.repo.dir });
  assert.equal(r.result, RESULTS.INVALID, "the gate does not judge a packet that does not verify");
};
const problemCodes = (ci) => ci.problems.map((p) => p.code);

test("F-1: valid evidence for the packet's own comparison is accepted, and every identity in it agrees with the packet", () => {
  for (const w of [OK, CP]) {
    const ci = deriveCi(w.evidence, trustedFor(w));
    assert.deepEqual(ci.problems, [], problemCodes(ci).join(", "));
    assert.deepEqual([ci.passed, ci.complete], [true, true]);
    const e = w.evidence;
    assert.deepEqual([e.subject.base_sha, e.trusted_base.evaluated.base_sha], [w.baselineSha, w.baselineSha]);
    assert.deepEqual([e.subject.merge_base_sha, e.trusted_base.evaluated.merge_base_sha], [w.baselineSha, w.baselineSha]);
    assert.deepEqual([e.subject.head_sha, e.trusted_base.evaluated.head_sha], [w.headSha, w.headSha]);
    assert.deepEqual(verifyPacket(w.packetDir, { toolRoot: w.repo.dir }).errors, []);
  }
});

test("F-1: a change to control-plane paths is identified as one: CI's definition is modified, the packet is complete, a human is still required", () => {
  assert.ok(changedOf(CP).includes("ops/lib/example-control.mjs"));
  assert.equal(CP.manifest.ci.ci_trust_basis, "ci_definition_modified_from_base");
  assert.equal(CP.manifest.ci.evidence_complete, true);
  assert.equal(OK.manifest.ci.ci_trust_basis, "ci_definition_unchanged_from_base", "a documents-only change really is unchanged");
  const r = evaluateDecision({ packetDir: CP.packetDir, decisionFile: writeDecision(goodDecision(CP)), toolRoot: CP.repo.dir });
  assert.equal(r.result, RESULTS.VALID);
  assert.ok(r.human_approval_reasons.some((x) => x.code === "DG-HUMAN-CI-DEFINITION"));
  assert.equal(r.reviewer_approval_is_binding, false);
});

test("F-1: genuine evidence collected for another comparison is refused however clean it looks, and no other base is substituted", () => {
  const others = {
    "the work commit (the comparison then holds only the report)": CP.workSha,
    "the commit before the baseline": CP.repo.git("rev-parse", `${CP.baselineSha}~1`).trim(),
  };
  for (const [name, baseSha] of Object.entries(others)) {
    const other = collectEvidence({ repo: CP.repo, headSha: CP.headSha, baseSha, taskId: CP.taskId });
    assert.equal(other.subject.base_sha, baseSha, name);
    // on its own terms it is a perfectly good document ...
    const own = deriveCi(other, trustedFor(CP, { baseSha, mergeBaseSha: baseSha, changedPaths: changedOf(CP, baseSha) }));
    assert.deepEqual(own.problems, [], `${name}: ${problemCodes(own)}`);
    assert.equal(own.complete, true, name);
    // ... and for this packet it qualifies as nothing
    const ci = deriveCi(other, trustedFor(CP));
    assert.deepEqual([ci.passed, ci.complete], [false, false], name);
    assert.ok(ci.problems.some((p) => p.code === "EV-BASE-MISMATCH" && p.kind === "inconsistent" && p.message.includes(baseSha.slice(0, 12))), `${name}: the mismatch names the base the evidence is for`);
    refusedEvidence(CP, other, "base");
    verifierRefuses(CP, swapEvidence(CP, other, { ci_trust_basis: other.verdict.ci_trust_basis }), "base");
  }
});

test("F-1: the evidence that names the work commit as its base says 'unchanged' for a change that modifies the control plane, and is still refused (the bypass Review B found)", () => {
  const other = collectEvidence({ repo: CP.repo, headSha: CP.headSha, baseSha: CP.workSha, taskId: CP.taskId });
  assert.equal(other.verdict.ci_trust_basis, "ci_definition_unchanged_from_base", "genuinely unchanged for its own comparison");
  assert.ok(changedOf(CP).some((p) => p.startsWith("ops/")), "but the packet's change touches ops/");
  refusedEvidence(CP, other);
  verifierRefuses(CP, swapEvidence(CP, other, { ci_trust_basis: "ci_definition_unchanged_from_base" }));
});

test("F-1: every identity in the evidence is checked on its own: a changed base, merge-base or head is refused", () => {
  const fields = [
    ["the evidence subject's base", (e) => { e.subject.base_sha = FAKE; }],
    ["the trusted-base evaluation's base", (e) => { e.trusted_base.evaluated.base_sha = FAKE; }],
    ["the evidence subject's merge-base", (e) => { e.subject.merge_base_sha = FAKE; }],
    ["the trusted-base evaluation's merge-base", (e) => { e.trusted_base.evaluated.merge_base_sha = FAKE; }],
    ["the trusted-base evaluation's head", (e) => { e.trusted_base.evaluated.head_sha = FAKE; }],
    // the builder and the verifier reject a different subject head earlier, with their own message; deriveCi still names it when called directly
    ["the evidence subject's head", (e) => { e.subject.head_sha = FAKE; }, false],
  ];
  for (const [label, mutate, namedByConsumers = true] of fields) {
    const e = clone(CP.evidence);
    mutate(e);
    const ci = deriveCi(e, trustedFor(CP));
    assert.ok(ci.problems.some((p) => p.code === "EV-BASE-MISMATCH" && p.message.includes(label)), `${label}: ${problemCodes(ci)}`);
    assert.equal(ci.complete, false, label);
    refusedEvidence(CP, e, namedByConsumers ? label : null);
    verifierRefuses(CP, swapEvidence(CP, e), namedByConsumers ? label : null);
  }
});

test("F-1: a trust basis of 'unchanged' is refused when the changed paths touch the control plane, whatever the evidence's own flags and verdict say", () => {
  const forged = clone(CP.evidence);
  for (const f of Object.keys(forged.trusted_base.flags)) forged.trusted_base.flags[f] = false;
  forged.trusted_base.package_scripts.ci_entrypoints_changed = false;
  forged.verdict.ci_trust_basis = "ci_definition_unchanged_from_base";
  const ci = deriveCi(forged, trustedFor(CP));
  assert.ok(problemCodes(ci).includes("EV-FLAGS-MISMATCH"), problemCodes(ci).join(","));
  assert.ok(problemCodes(ci).includes("EV-TRUST-BASIS"), problemCodes(ci).join(","));
  assert.equal(ci.passed, false);
  refusedEvidence(CP, forged);
  verifierRefuses(CP, swapEvidence(CP, forged, { ci_trust_basis: "ci_definition_unchanged_from_base" }));
  // each half on its own
  const flagsOnly = clone(CP.evidence);
  flagsOnly.trusted_base.flags.ops_code_changed = false;
  assert.ok(problemCodes(deriveCi(flagsOnly, trustedFor(CP))).includes("EV-FLAGS-MISMATCH"));
  const verdictOnly = clone(CP.evidence);
  verdictOnly.verdict.ci_trust_basis = "ci_definition_unchanged_from_base";
  assert.ok(problemCodes(deriveCi(verdictOnly, trustedFor(CP))).includes("EV-TRUST-BASIS"));
  // a flag that is raised although the paths do not justify it is just as inconsistent
  const raised = clone(OK.evidence);
  raised.trusted_base.flags.workflow_files_changed = true;
  assert.ok(problemCodes(deriveCi(raised, trustedFor(OK))).includes("EV-FLAGS-MISMATCH"));
});

test("F-1: the changed paths recorded in the evidence must be exactly the ones the packet computed", () => {
  const hidden = clone(CP.evidence);
  hidden.trusted_base.changes.paths = hidden.trusted_base.changes.paths.filter((p) => !p.path.startsWith("ops/"));
  assert.ok(problemCodes(deriveCi(hidden, trustedFor(CP))).includes("EV-CHANGED-PATHS-MISMATCH"), "a path left out of the list");
  const invented = clone(CP.evidence);
  invented.trusted_base.changes.paths.push({ ...invented.trusted_base.changes.paths[0], path: "docs/guides/invented.md" });
  assert.ok(problemCodes(deriveCi(invented, trustedFor(CP))).includes("EV-CHANGED-PATHS-MISMATCH"), "a path that is not in the change");
  const counted = clone(CP.evidence);
  counted.trusted_base.changes.total = 1;
  assert.ok(problemCodes(deriveCi(counted, trustedFor(CP))).includes("EV-CHANGED-PATHS-MISMATCH"), "a wrong count");
  // the full forgery: hide the control-plane path, mark the list truncated, lower every flag, say 'unchanged'
  const full = clone(CP.evidence);
  full.trusted_base.changes.paths = full.trusted_base.changes.paths.filter((p) => !p.path.startsWith("ops/"));
  full.trusted_base.changes.truncated = true;
  for (const f of Object.keys(full.trusted_base.flags)) full.trusted_base.flags[f] = false;
  full.verdict.ci_trust_basis = "ci_definition_unchanged_from_base";
  const ci = deriveCi(full, trustedFor(CP));
  assert.equal(ci.passed, false);
  assert.ok(problemCodes(ci).includes("EV-FLAGS-MISMATCH"));
  refusedEvidence(CP, full);
  verifierRefuses(CP, swapEvidence(CP, full, { ci_trust_basis: "ci_definition_unchanged_from_base" }));
});

test("F-1: a truncated list of changed paths is checked by membership and count, not skipped", () => {
  const e = clone(OK.evidence);
  e.trusted_base.changes.truncated = true;
  e.trusted_base.changes.paths = e.trusted_base.changes.paths.slice(0, 1);
  assert.deepEqual(deriveCi(e, trustedFor(OK)).problems, [], "a shorter list of real paths with the right count is accepted");
  const foreign = clone(e);
  foreign.trusted_base.changes.paths[0].path = "docs/guides/not-in-the-change.md";
  assert.ok(problemCodes(deriveCi(foreign, trustedFor(OK))).includes("EV-CHANGED-PATHS-MISMATCH"));
  const miscounted = clone(e);
  miscounted.trusted_base.changes.total = 7;
  assert.ok(problemCodes(deriveCi(miscounted, trustedFor(OK))).includes("EV-CHANGED-PATHS-MISMATCH"));
});

test("F-1: a consumer that does not supply the comparison cannot obtain complete evidence", () => {
  const { mergeBaseSha, headSha, ...noMergeBase } = trustedFor(OK);
  for (const [name, trusted] of [["no merge-base", { ...noMergeBase, headSha }], ["no head", { ...noMergeBase, mergeBaseSha }], ["no base", trustedFor(OK, { baseSha: null })], ["no computed paths", trustedFor(OK, { changedPaths: null })]]) {
    const ci = deriveCi(OK.evidence, trusted);
    assert.equal(ci.complete, false, name);
    assert.ok(ci.problems.some((p) => p.code === "EV-COMPARISON-UNBOUND" && p.kind === "incomplete"), `${name}: ${problemCodes(ci)}`);
  }
});
