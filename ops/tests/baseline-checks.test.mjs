// The review baseline (OPS-0006). A review is independent verification only if its trusted baseline predates the work under review
// and holds the approved task definition. The OPS-0003 review was made from a baseline that descended from the reviewed head: it was
// a recorded exception, but nothing in the packet or the gate said so. Now the builder records how the baseline relates to the work,
// refuses a baseline that is not independent unless an exception naming an existing decision is given, and the gate makes the
// exception visible and keeps a human in the loop. A packet that can be generated is not thereby independent.
import assert from "node:assert/strict";
import path from "node:path";
import { after, test } from "node:test";
import { RESULTS, evaluateDecision } from "../lib/decision-gate.mjs";
import { PacketError, buildPacket, verifyPacket } from "../lib/review-packet.mjs";
import { TASK_ID, cleanupTmp, copyPacket, editManifest, goodDecision, makeWorld, tmp, writeDecision } from "./review-fixture.mjs";

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

const OK = world();
const sha = (w, rev) => w.repo.git("rev-parse", rev).trim();
const build = (w, over = {}) => buildPacket({ repoDir: w.repo.dir, baseline: w.baselineSha, base: w.baselineSha, head: w.headSha, taskId: TASK_ID, attemptId: w.attemptId, evidenceFile: w.evidenceFile, outDir: path.join(tmp(), "p"), toolRoot: w.repo.dir, ...over });
const refused = (w, code, over, fragment = null) => assert.throws(() => build(w, over), (e) => e instanceof PacketError && e.code === code && (fragment === null || e.message.includes(fragment)), `expected ${code}`);
const codes = (r) => r.reasons.map((x) => x.code);
const warnCodes = (r) => r.warnings.map((x) => x.code);
const humanCodes = (r) => r.human_approval_reasons.map((x) => x.code);
const judge = (w, packetDir) => evaluateDecision({ packetDir, decisionFile: writeDecision(goodDecision(w, packetDir)), toolRoot: w.repo.dir });

/* ------------------------------------------------------------------ an independent baseline */

test("a baseline that predates the work and holds the approved task is independent, and the manifest says why", () => {
  const b = OK.manifest.trusted_baseline;
  assert.equal(b.relation_to_head, "ancestor_of_head");
  assert.equal(b.reviewed_paths_in_baseline, 0);
  assert.equal(b.base_has_task_file, true);
  assert.equal(b.scope_established_by_evidence, true);
  assert.equal(b.task_file_matches_head, true);
  assert.equal(b.independent, true);
  assert.equal(b.exception, null);
  const r = judge(OK, OK.packetDir);
  assert.equal(r.result, RESULTS.VALID);
  assert.deepEqual(r.computed.baseline, { independent: true, relation_to_head: "ancestor_of_head", reviewed_paths_in_baseline: 0, exception: null });
  for (const code of ["DG-BASELINE-EXCEPTION", "DG-SCOPE-NOT-ESTABLISHED-BY-BASE"]) assert.ok(!warnCodes(r).includes(code), code);
  assert.ok(!codes(r).includes("DG-BASELINE-NOT-INDEPENDENT"));
  assert.ok(!humanCodes(r).includes("DG-HUMAN-BASELINE-EXCEPTION"));
});

/* ------------------------------------------------------------------ baselines that are not independent are refused */

test("a baseline that IS the reviewed head, or contains the reviewed work, or has nothing to do with it, is refused", () => {
  const cases = [
    ["the baseline is the head under review", sha(OK, OK.headSha), /is the commit under review/],
    ["the baseline is a commit in the middle of the work (some reviewed paths are already in it)", OK.workSha, /already have the reviewed content/],
    ["the baseline is not an ancestor of the head", (() => { OK.repo.branch("side", (r) => r.write("docs/guides/side-note.md", "# side\n"), { from: "main" }); return sha(OK, "side"); })(), /not an ancestor of the head/],
    ["the baseline descends from the head", (() => { OK.repo.branch("later", (r) => r.write("docs/guides/later-note.md", "# later\n"), { from: "report" }); return sha(OK, "later"); })(), /descends from the reviewed head/],
  ];
  for (const [name, baseline, message] of cases) {
    assert.throws(() => build(OK, { baseline }), (e) => e instanceof PacketError && e.code === "PK-BASELINE-NOT-INDEPENDENT" && message.test(e.message), name);
  }
});

test("the approved task definition must be in the baseline: a baseline from before it is refused", () => {
  const beforeTask = sha(OK, `${OK.baselineSha}~1`);
  refused(OK, "PK-TASK-NOT-IN-BASELINE", { baseline: beforeTask });
});

/* ------------------------------------------------------------------ an identifiable exception */

test("a weaker baseline is accepted only with an explicit exception that names an existing decision, and it is never called independent", () => {
  const later = sha(OK, "later");
  const { manifest, outDir } = build(OK, { baseline: later, baselineException: "HD-0010" });
  const b = manifest.trusted_baseline;
  assert.equal(b.independent, false);
  assert.equal(b.relation_to_head, "descends_from_head");
  assert.ok(b.reviewed_paths_in_baseline > 0);
  assert.equal(b.exception.approval_reference, "HD-0010");
  assert.ok(b.exception.reasons.length >= 1);
  const v = verifyPacket(outDir, { toolRoot: OK.repo.dir });
  assert.deepEqual(v.errors, []);
  const r = judge(OK, outDir);
  assert.equal(r.result, RESULTS.VALID, "the exception is visible, not fatal: a person decides");
  assert.ok(warnCodes(r).includes("DG-BASELINE-EXCEPTION"));
  assert.ok(humanCodes(r).includes("DG-HUMAN-BASELINE-EXCEPTION"));
  assert.deepEqual(r.computed.baseline, { independent: false, relation_to_head: "descends_from_head", reviewed_paths_in_baseline: b.reviewed_paths_in_baseline, exception: "HD-0010" });
  assert.equal(r.human_approval_required, true);
  assert.equal(r.reviewer_approval_is_binding, false);
});

test("an exception must be well formed, must name a decision in the baseline's log, and is not allowed for an independent baseline", () => {
  const later = sha(OK, "later");
  refused(OK, "PK-BASELINE-EXCEPTION", { baseline: later, baselineException: "HD-9999" }, "not in the baseline's decision log");
  refused(OK, "PK-BASELINE-EXCEPTION", { baseline: later, baselineException: "because I said so" }, "such as HD-0017");
  refused(OK, "PK-BASELINE-EXCEPTION", { baseline: later, baselineException: "hd-0010" }, "such as HD-0017");
  refused(OK, "PK-BASELINE-EXCEPTION", { baselineException: "HD-0010" }, "independent");
  refused(OK, "PK-BASELINE-NOT-INDEPENDENT", { baseline: later, baselineException: null });
});

/* ------------------------------------------------------------------ the verifier and the gate on manifests */

const edited = (fn) => {
  const dir = copyPacket(OK.packetDir);
  editManifest(dir, fn);
  return dir;
};

test("the verifier rejects a manifest whose baseline claims contradict each other", () => {
  const cases = [
    ["independent over a baseline that descends from the head", (m) => { m.trusted_baseline.relation_to_head = "descends_from_head"; }, "PK-BASELINE-INCONSISTENT"],
    ["independent over reviewed paths already in the baseline", (m) => { m.trusted_baseline.reviewed_paths_in_baseline = 2; }, "PK-BASELINE-INCONSISTENT"],
    ["not independent over an ancestor with no reviewed paths", (m) => { m.trusted_baseline.independent = false; }, "PK-BASELINE-INCONSISTENT"],
    ["an exception recorded for an independent baseline", (m) => { m.trusted_baseline.exception = { approval_reference: "HD-0010", reasons: ["a reason"] }; }, "PK-BASELINE-INCONSISTENT"],
    ["an exception naming a decision that is not in the log", (m) => { m.trusted_baseline.independent = false; m.trusted_baseline.relation_to_head = "is_head"; m.trusted_baseline.exception = { approval_reference: "HD-9999", reasons: ["a reason"] }; }, "PK-BASELINE-EXCEPTION"],
    ["a scope claim that the evidence does not support", (m) => { m.trusted_baseline.scope_established_by_evidence = false; }, "PK-BASELINE-INCONSISTENT"],
  ];
  for (const [name, mutate, code] of cases) {
    const v = verifyPacket(edited(mutate), { toolRoot: OK.repo.dir });
    assert.equal(v.ok, false, name);
    assert.ok(v.errors.some((e) => e.code === code), `${name}: ${v.errors.map((e) => e.code).join(", ")}`);
  }
});

test("a weak baseline with no recorded exception that reaches the gate, even in a consistent manifest, needs corrections and is not independent verification", () => {
  const dir = edited((m) => {
    m.trusted_baseline.relation_to_head = "descends_from_head";
    m.trusted_baseline.reviewed_paths_in_baseline = 3;
    m.trusted_baseline.independent = false;
  });
  assert.deepEqual(verifyPacket(dir, { toolRoot: OK.repo.dir }).errors, [], "the claims agree with each other, so the packet is well formed");
  const r = judge(OK, dir);
  assert.equal(r.result, RESULTS.CORRECTIONS);
  assert.ok(codes(r).includes("DG-BASELINE-NOT-INDEPENDENT"));
  assert.equal(r.computed.baseline.independent, false);
  assert.equal(r.computed.baseline.exception, null);
});

/* ------------------------------------------------------------------ the task's scope */

test("a scope that the base could not establish is recorded, warned about, and still judged by the gate itself", () => {
  const w = world({ evidenceMutate: (e) => { e.trusted_base.task_scope = { task_id: TASK_ID, source: "not_found_in_base", violations: [] }; } });
  assert.equal(w.manifest.trusted_baseline.scope_established_by_evidence, false);
  assert.equal(w.manifest.trusted_baseline.independent, true, "this does not make the baseline weaker");
  const r = judge(w, w.packetDir);
  assert.equal(r.result, RESULTS.VALID);
  assert.ok(warnCodes(r).includes("DG-SCOPE-NOT-ESTABLISHED-BY-BASE"));
  // the gate's own scope check, against the baseline's task file, still runs
  const out = world({ files: { "docs/guides/ok.md": "# ok\n", "src/app/extra.tsx": "export {};\n" }, evidenceMutate: (e) => { e.trusted_base.task_scope = { task_id: TASK_ID, source: "not_found_in_base", violations: [] }; } });
  const rs = judge(out, out.packetDir);
  assert.ok(codes(rs).includes("DG-SCOPE"));
});

test("whether the base holds the same task definition is recorded: a base from before the definition says so", () => {
  const parent = sha(OK, `${OK.baselineSha}~1`);
  const { manifest } = build(OK, { base: parent });
  assert.equal(manifest.trusted_baseline.base_has_task_file, false);
  assert.equal(manifest.trusted_baseline.independent, true, "the baseline itself is still independent");
});
