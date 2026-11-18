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
import { TASK_ID, cleanupTmp, collectEvidence, copyPacket, editManifest, goodDecision, makeWorld, tmp, writeDecision, writeEvidence } from "./review-fixture.mjs";

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
  assert.deepEqual(r.computed.baseline, { independent: true, relation_to_head: "ancestor_of_head", relation_to_base: "is_base", commits_after_base: 0, reviewed_paths_in_baseline: 0, exception: null });
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
  assert.deepEqual(r.computed.baseline, { independent: false, relation_to_head: "descends_from_head", relation_to_base: b.relation_to_base, commits_after_base: b.commits_after_base, reviewed_paths_in_baseline: b.reviewed_paths_in_baseline, exception: "HD-0010" });
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
  // the evidence has to be collected for the comparison the packet is about (attempt 2): this test once offered evidence for another base
  const evidenceFile = writeEvidence(collectEvidence({ repo: OK.repo, headSha: OK.headSha, baseSha: parent, taskId: OK.taskId }));
  const { manifest } = build(OK, { base: parent, evidenceFile });
  assert.equal(manifest.trusted_baseline.base_has_task_file, false);
  assert.equal(manifest.trusted_baseline.independent, true, "the baseline itself is still independent");
});

/* ------------------------------------------------------------------ F-2 (attempt 2): the baseline's HISTORY, not its final contents */
// Review B found that independence was decided from file contents alone: a baseline counted as independent if none of the reviewed
// paths held the reviewed content. The commits between the approved base and the baseline were never read, so an implementation or
// control-plane change that was later rewritten or reverted left no trace in the final trees. Now a baseline is independent only if
// it IS the approved base, or every commit between the base and the baseline touches only the task definition used by the review,
// and the baseline is an ancestor of the head. The documented human exception stays and is never granted by the tool.

const TASK_REL = `docs/project-memory/tasks/${TASK_ID}-fixture-review.md`;
const CI_YML = ".github/workflows/ci.yml";
/** Commit exactly the given paths: the world's own baseline commit adds the task definition (and anything else left over) afterwards. */
const commitPaths = (r, message, paths) => {
  r.git("add", "--", ...paths);
  r.git("commit", "-q", "-m", message);
};
/** A world whose baseline has a history behind it. `history(r)` runs on main right after the approved base is recorded; the world's own commit then adds the task definition. */
function historyWorld({ history, files, allowed }) {
  const ctx = { base: null };
  const w = world({ build: false, files, allowed, baselineMutate: (r) => { ctx.base = r.git("rev-parse", "HEAD").trim(); history(r); } });
  return { w, base: ctx.base };
}
/** Build a packet for another base with evidence collected for that base (the comparison must be the packet's own). */
const buildFor = (w, base, over = {}) => build(w, { base, evidenceFile: writeEvidence(collectEvidence({ repo: w.repo, headSha: w.headSha, baseSha: base, taskId: w.taskId })), ...over });
const refusedFor = (w, base, fragment = null) => assert.throws(() => buildFor(w, base), (e) => e instanceof PacketError && e.code === "PK-BASELINE-NOT-INDEPENDENT" && (fragment === null || e.message.includes(fragment)), `expected PK-BASELINE-NOT-INDEPENDENT${fragment ? ` mentioning ${fragment}` : ""}`);
const provenance = (m) => (({ relation_to_base, commits_after_base, non_preparation_paths, history_verified, independent }) => ({ relation_to_base, commits_after_base, non_preparation_paths, history_verified, independent }))(m.trusted_baseline);

test("F-2 case 1: a legitimate pre-implementation baseline (the base plus the approved task-definition commit) is independent, and the manifest records why", () => {
  const parent = sha(OK, `${OK.baselineSha}~1`);
  const { manifest } = buildFor(OK, parent);
  assert.deepEqual(provenance(manifest), { relation_to_base: "task_preparation_only", commits_after_base: 1, non_preparation_paths: [], history_verified: true, independent: true });
  assert.equal(manifest.trusted_baseline.relation_to_head, "ancestor_of_head");
});

test("F-2 case 2: a baseline equal to the approved base is independent, with no history between them", () => {
  assert.deepEqual(provenance(OK.manifest), { relation_to_base: "is_base", commits_after_base: 0, non_preparation_paths: [], history_verified: true, independent: true });
  assert.equal(OK.manifest.trusted_baseline.commit, OK.manifest.subject.base_sha);
});

test("F-2 case 3: a baseline reached through more than one commit that touches only the task definition is still independent", () => {
  const { w, base } = historyWorld({ history: (r) => {
    commitPaths(r, "task definition, first draft", [TASK_REL]);
    r.write(TASK_REL, `${r.read(TASK_REL)}\nA second preparation commit, still only the task definition.\n`);
  } });
  const { manifest, outDir } = buildFor(w, base);
  assert.deepEqual(provenance(manifest), { relation_to_base: "task_preparation_only", commits_after_base: 2, non_preparation_paths: [], history_verified: true, independent: true });
  assert.deepEqual(verifyPacket(outDir, { toolRoot: w.repo.dir }).errors, []);
});

test("F-2 case 4: a baseline whose history holds worker implementation is not independent: refused, named, and only a recorded decision admits it", () => {
  const { w, base } = historyWorld({
    allowed: ["docs/guides/**", "ops/**", "docs/project-memory/tasks/**", "docs/project-memory/runs/**"], // a base before the baseline puts the task definition itself into the reviewed diff
    history: (r) => { r.write("ops/lib/worker-implementation.mjs", "export const implemented = true;\n"); commitPaths(r, "worker implementation", ["ops/lib/worker-implementation.mjs"]); },
  });
  refusedFor(w, base, "ops/lib/worker-implementation.mjs");
  const { manifest, outDir } = buildFor(w, base, { baselineException: "HD-0010" });
  assert.deepEqual(provenance(manifest), { relation_to_base: "other_changes_in_history", commits_after_base: 2, non_preparation_paths: ["ops/lib/worker-implementation.mjs"], history_verified: true, independent: false });
  assert.equal(manifest.trusted_baseline.exception.approval_reference, "HD-0010", "the exception is the documented one, and it names the decision");
  assert.deepEqual(verifyPacket(outDir, { toolRoot: w.repo.dir }).errors, []);
  const r = judge(w, outDir);
  assert.equal(r.result, RESULTS.VALID, `the exception is visible, not fatal: a person decides (${r.reasons.map((x) => `${x.code}: ${x.message.slice(0, 120)}`).join(" | ")})`);
  assert.ok(warnCodes(r).includes("DG-BASELINE-EXCEPTION") && humanCodes(r).includes("DG-HUMAN-BASELINE-EXCEPTION"));
  assert.equal(r.computed.baseline.relation_to_base, "other_changes_in_history");
});

test("F-2 case 5: a baseline whose history holds an implementation change that was later rewritten is not independent (the final contents no longer match the head's)", () => {
  const { w, base } = historyWorld({
    files: { "docs/guides/rewritten.md": "# version 3, written after the baseline\n" },
    allowed: ["docs/guides/**", "docs/project-memory/runs/**"],
    history: (r) => {
      r.write("docs/guides/rewritten.md", "# version 1\n");
      commitPaths(r, "implementation, first version", ["docs/guides/rewritten.md"]);
      r.write("docs/guides/rewritten.md", "# version 2\n");
      commitPaths(r, "implementation, rewritten", ["docs/guides/rewritten.md"]);
    },
  });
  // what the earlier comparison of final contents saw: the file at the baseline differs from the head's, so nothing looked shared
  assert.notEqual(w.repo.git("show", `${w.baselineSha}:docs/guides/rewritten.md`), w.repo.git("show", `${w.headSha}:docs/guides/rewritten.md`));
  refusedFor(w, base, "docs/guides/rewritten.md");
});

test("F-2 case 6: a baseline whose history holds a control-plane change that was later reverted is not independent (the final trees are identical)", () => {
  const { w, base } = historyWorld({ history: (r) => {
    const original = r.read(CI_YML);
    r.write(CI_YML, `${original}# a temporary change to what CI runs\n`);
    commitPaths(r, "change the workflow", [CI_YML]);
    r.write(CI_YML, original);
    commitPaths(r, "revert the workflow", [CI_YML]);
  } });
  assert.equal(w.repo.git("diff", "--name-only", base, w.baselineSha).trim(), TASK_REL, "the baseline's tree differs from the base only by the task definition: file equality sees nothing");
  refusedFor(w, base, CI_YML);
});

test("F-2 case 7: a baseline that is unrelated to the base, or descends from the reviewed head, is not independent", () => {
  // unrelated: a side line of history from before the baseline that carries the same task definition
  const parent = sha(OK, `${OK.baselineSha}~1`);
  const taskText = OK.repo.read(TASK_REL);
  OK.repo.branch("side-line", (r) => { r.write(TASK_REL, taskText); r.write("docs/guides/side.md", "# side\n"); }, { from: parent });
  const sideTip = sha(OK, "side-line");
  assert.throws(() => buildFor(OK, OK.baselineSha, { baseline: sideTip }), (e) => e instanceof PacketError && e.code === "PK-BASELINE-NOT-INDEPENDENT" && /does not descend from it|not an ancestor/.test(e.message));
  const unrelated = buildFor(OK, OK.baselineSha, { baseline: sideTip, baselineException: "HD-0010" }).manifest;
  assert.deepEqual([unrelated.trusted_baseline.relation_to_base, unrelated.trusted_baseline.history_verified, unrelated.trusted_baseline.independent], ["not_a_descendant_of_base", false, false], "the history behind an unrelated baseline is not read, and the manifest says so");
  // a sibling: it IS the base plus a commit that touches only the task definition (a clean preparation), but it lies on another line of history than the head's, so it does not predate the work under review
  OK.repo.branch("sibling-prep", (r) => r.write(TASK_REL, taskText), { from: parent });
  const sibling = sha(OK, "sibling-prep");
  assert.notEqual(sibling, OK.baselineSha);
  assert.throws(() => buildFor(OK, parent, { baseline: sibling }), (e) => e instanceof PacketError && e.code === "PK-BASELINE-NOT-INDEPENDENT" && /not an ancestor of the head/.test(e.message));
  const sib = buildFor(OK, parent, { baseline: sibling, baselineException: "HD-0010" }).manifest.trusted_baseline;
  assert.deepEqual([sib.relation_to_base, sib.history_verified, sib.relation_to_head, sib.independent], ["task_preparation_only", true, "unrelated", false], "a clean preparation history is not enough: the baseline must also be an ancestor of the head");
  // a descendant of the head
  OK.repo.branch("after-head", (r) => r.write("docs/guides/after-head.md", "# after\n"), { from: "report" });
  assert.throws(() => buildFor(OK, OK.baselineSha, { baseline: sha(OK, "after-head") }), (e) => e instanceof PacketError && e.code === "PK-BASELINE-NOT-INDEPENDENT" && /descends from the reviewed head/.test(e.message));
});

test("F-2: a merge commit between the base and the baseline cannot be attributed to the task definition, so the baseline is not independent", () => {
  // the side line touches nothing but the task definition: the merge commit is the ONLY thing that makes this baseline unfit
  const { w, base } = historyWorld({ history: (r) => {
    r.git("switch", "-q", "-c", "side-prep", "main");
    commitPaths(r, "task definition on a side line", [TASK_REL]);
    r.git("switch", "-q", "main");
    r.git("merge", "--no-ff", "-q", "-m", "merge the side line", "side-prep");
    r.write(TASK_REL, `${r.read(TASK_REL)}\nAfter the merge.\n`);
  } });
  const parents = (c) => w.repo.git("rev-list", "--parents", "-n", "1", c).trim().split(" ").length - 1;
  assert.deepEqual(w.repo.git("log", "--format=%H", `${base}..${w.baselineSha}`).trim().split("\n").map(parents).sort(), [1, 1, 2], "a side commit, the merge, and the world's own commit");
  assert.equal(w.repo.git("diff", "--name-only", `${base}..${w.baselineSha}`).trim(), TASK_REL, "every path in the history is the task definition");
  refusedFor(w, base, "merge commit");
  const { manifest } = buildFor(w, base, { baselineException: "HD-0010" });
  assert.deepEqual(provenance(manifest), { relation_to_base: "other_changes_in_history", commits_after_base: 3, non_preparation_paths: [], history_verified: true, independent: false });
});

test("F-2: no exception is granted automatically: it needs a well formed, recorded decision, and an independent baseline needs none", () => {
  const { w, base } = historyWorld({ history: (r) => { r.write("ops/lib/impl.mjs", "export {};\n"); commitPaths(r, "impl", ["ops/lib/impl.mjs"]); } });
  refusedFor(w, base);
  assert.throws(() => buildFor(w, base, { baselineException: "HD-9999" }), (e) => e instanceof PacketError && e.code === "PK-BASELINE-EXCEPTION" && /not in the baseline's decision log/.test(e.message));
  assert.throws(() => buildFor(w, base, { baselineException: "because I say so" }), (e) => e instanceof PacketError && e.code === "PK-BASELINE-EXCEPTION");
  assert.throws(() => buildFor(OK, sha(OK, `${OK.baselineSha}~1`), { baselineException: "HD-0010" }), (e) => e instanceof PacketError && e.code === "PK-BASELINE-EXCEPTION" && /independent/.test(e.message));
});

test("F-2: the verifier rejects a manifest whose provenance claims contradict each other or the commit ids", () => {
  const prep = buildFor(OK, sha(OK, `${OK.baselineSha}~1`)).outDir;
  const cases = [
    ["is_base for a baseline that is not the base", prep, (m) => { m.trusted_baseline.relation_to_base = "is_base"; m.trusted_baseline.commits_after_base = 0; }],
    ["task_preparation_only for a baseline that is the base", OK.packetDir, (m) => { m.trusted_baseline.relation_to_base = "task_preparation_only"; m.trusted_baseline.commits_after_base = 1; }],
    ["independent despite other changes in the history", prep, (m) => { m.trusted_baseline.relation_to_base = "other_changes_in_history"; m.trusted_baseline.non_preparation_paths = ["ops/lib/x.mjs"]; }],
    ["task_preparation_only with a path outside the task definition listed", prep, (m) => { m.trusted_baseline.non_preparation_paths = ["ops/lib/x.mjs"]; }],
    ["independent without a verified history", prep, (m) => { m.trusted_baseline.history_verified = false; }],
    ["no commits after the base but a preparation relation", prep, (m) => { m.trusted_baseline.commits_after_base = 0; }],
    ["other changes found in a history that was not read", prep, (m) => { m.trusted_baseline.relation_to_base = "other_changes_in_history"; m.trusted_baseline.history_verified = false; m.trusted_baseline.independent = false; }],
    ["a baseline that is not a descendant of the base, with a verified history", prep, (m) => { m.trusted_baseline.relation_to_base = "not_a_descendant_of_base"; m.trusted_baseline.independent = false; }],
  ];
  for (const [name, source, mutate] of cases) {
    const dir = copyPacket(source);
    editManifest(dir, mutate);
    const v = verifyPacket(dir, { toolRoot: OK.repo.dir });
    assert.equal(v.ok, false, name);
    assert.ok(v.errors.some((e) => e.code === "PK-BASELINE-INCONSISTENT"), `${name}: ${v.errors.map((e) => e.code).join(", ")}`);
  }
});

test("F-2: a consistent manifest that names a baseline with other changes in its history and records no exception needs corrections at the gate", () => {
  const weak = buildFor(OK, sha(OK, `${OK.baselineSha}~1`)).outDir;
  const d2 = copyPacket(weak);
  editManifest(d2, (m) => {
    m.trusted_baseline.relation_to_base = "other_changes_in_history";
    m.trusted_baseline.non_preparation_paths = ["ops/lib/x.mjs"];
    m.trusted_baseline.independent = false;
  });
  assert.deepEqual(verifyPacket(d2, { toolRoot: OK.repo.dir }).errors, [], "the claims agree with each other, so the packet is well formed");
  const r = judge(OK, d2);
  assert.equal(r.result, RESULTS.CORRECTIONS);
  assert.ok(codes(r).includes("DG-BASELINE-NOT-INDEPENDENT"));
  assert.equal(r.computed.baseline.independent, false);
  assert.equal(r.computed.baseline.exception, null);
});

test("F-2: a baseline too far from the base to be read in full is not independent, and is never called verified", () => {
  const { w, base } = historyWorld({ history: (r) => { for (let i = 0; i < 201; i += 1) r.git("commit", "-q", "--allow-empty", "-m", `preparation ${i}`); } });
  assert.equal(w.repo.git("rev-list", "--count", `${base}..${w.baselineSha}`).trim(), "202", "201 empty commits and the world's own baseline commit");
  assert.throws(() => buildFor(w, base), (e) => e instanceof PacketError && e.code === "PK-BASELINE-NOT-INDEPENDENT" && /cannot be verified/.test(e.message));
  const { manifest } = buildFor(w, base, { baselineException: "HD-0010" });
  assert.deepEqual(provenance(manifest), { relation_to_base: "not_a_descendant_of_base", commits_after_base: 202, non_preparation_paths: [], history_verified: false, independent: false });
});
