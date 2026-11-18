// Task, attempt and branch identifiers (OPS-0006): one definition, one optional uppercase letter, nothing broader.
// OPS-0005B is a correction of OPS-0005; the contracts used to reject it, so its task definition and run record could not be
// schema-valid. These tests show that every earlier id is still valid, the new ones are valid everywhere, and the malformed and
// ambiguous ones are rejected by every schema and reader.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import {
  ATTEMPT_ID_PATTERN, BRANCH_PATTERN, TASK_ID_PATTERN, attemptNumberOf, branchBelongsToTask, branchPrefix, isAttemptId, isTaskBranch, isTaskId,
  taskFileNameRegex, taskIdOfAttempt, taskIdOfFileName,
} from "../lib/ids.mjs";
import { validate } from "../lib/json-schema.mjs";
import { evaluateDecision } from "../lib/decision-gate.mjs";
import { PacketError, buildPacket, verifyPacket } from "../lib/review-packet.mjs";
import { TrustedBaseError, trustedBaseCheck } from "../lib/trusted-base.mjs";
import { validateReportDocument, validateTaskDocument } from "../validate-memory.mjs";
import { makeRepo } from "./git-fixture.mjs";
import { ROOT, fixture, fixtureContext, loadSchemas, readJson } from "./helpers.mjs";
import { cleanupTmp, goodDecision, makeWorld, tmp, writeDecision } from "./review-fixture.mjs";

const SCHEMA_DIR = "docs/project-memory/schemas";
const schemas = { ...loadSchemas(), packet: readJson(`${SCHEMA_DIR}/review-packet-manifest.schema.json`) };
const worlds = [];
after(() => {
  for (const w of worlds) w.repo.cleanup();
  cleanupTmp();
});

/** Ids that were valid before OPS-0006 and must stay valid. */
const OLD_TASK_IDS = ["OPS-0001", "OPS-0004", "OPS-9100", "ABC-0001", "ABCDE-9999", "OPS-0000"];
/** Ids with one optional uppercase letter: valid since OPS-0006. */
const NEW_TASK_IDS = ["OPS-0005B", "OPS-0001A", "ABC-1234Z", "ABCDE-9999Q"];
const BAD_TASK_IDS = [
  "OPS-0005b", // lower-case suffix
  "OPS-0005BC", // two letters
  "OPS-0005B1", // a digit after the letter
  "OPS-00005B", // five digits
  "OPS-005B", // three digits
  "OPS-0005-B", // the letter belongs directly after the digits
  "OPS-0005 B",
  "OPS-0005B ",
  " OPS-0005B",
  "OP-0005B", // two-letter prefix
  "OPSABC-0005B", // six-letter prefix
  "ops-0005B",
  "OPS-0005Β", // a Greek capital beta that looks like a B
  "OPS-0005B\n",
  "OPS-0005B-a1", // an attempt id is not a task id
  "", "OPS", "0005B", null, undefined, 5, {},
];
const OLD_ATTEMPT_IDS = ["OPS-0001-a1", "OPS-0004-a2", "OPS-9100-a12", "ABCDE-9999-a99"];
const NEW_ATTEMPT_IDS = ["OPS-0005B-a1", "OPS-0006A-a3", "ABC-1234Z-a10"];
const BAD_ATTEMPT_IDS = [
  "OPS-0005B-a0", "OPS-0005B-a100", "OPS-0005B-A1", "OPS-0005Ba1", "OPS-0005B-1", "OPS-0005B-a", "OPS-0005B-a1-x", "OPS-0005b-a1",
  "OPS-0005BC-a1", "OPS-0005-Ba1", "OPS-0005B-a01", "OPS-0005B_a1", "OPS-0005B-a1\n", "OPS-0005B", "", null, undefined,
];
const OLD_BRANCHES = ["claude/ops-0001-foundation", "claude/ops-0004-review-foundation", "claude/ops-9100-fixture-review", "claude/abc-0001-a", "claude/ops-0006-consumer-integrity"];
const NEW_BRANCHES = ["claude/ops-0005b-evidence-hardening", "claude/ops-0001a-x", "claude/abc-1234z-some-slug-2"];
const BAD_BRANCHES = [
  "claude/ops-0005B-evidence", // upper-case letter in a branch
  "claude/ops-0005bc-evidence", // two letters
  "claude/ops-0005b1-evidence",
  "claude/ops-0005b", // no slug
  "claude/ops-0005b-", // empty slug
  "claude/ops-0005b--x", // empty word
  "claude/ops-0005b-X", // upper-case slug
  "claude/ops-0005b_x",
  "claude/OPS-0005b-x",
  "feature/ops-0005b-x",
  "claude/ops-0005bevidence", // no hyphen after the suffix
  "claude/ops-0005b-evidence-", "claude//ops-0005b-x", " claude/ops-0005b-x", "claude/ops-0005b-x\n", "", null,
];

/* ------------------------------------------------------------------ one definition, everywhere */

test("every schema carries exactly the patterns of the shared definition, and no schema keeps an older one", () => {
  const found = { task_id: [], attempt_id: [], branch: [] };
  const walk = (node, where, key) => {
    if (node && typeof node === "object") {
      if (typeof node.pattern === "string" && (key === "task_id" || key === "attempt_id" || key === "branch")) found[key].push({ where, pattern: node.pattern });
      for (const [k, v] of Object.entries(node)) walk(v, `${where}/${k}`, k);
    }
  };
  const expectedCounts = { "task.schema.json": [1, 0, 1], "run-report.schema.json": [1, 1, 1], "review-decision.schema.json": [1, 1, 0], "review-packet-manifest.schema.json": [1, 1, 0] };
  for (const [file, [tasks, attempts, branches]] of Object.entries(expectedCounts)) {
    found.task_id = [];
    found.attempt_id = [];
    found.branch = [];
    walk(readJson(`${SCHEMA_DIR}/${file}`), file, "");
    assert.equal(found.task_id.length, tasks, `${file}: task id patterns`);
    assert.equal(found.attempt_id.length, attempts, `${file}: attempt id patterns`);
    assert.equal(found.branch.length, branches, `${file}: branch patterns`);
    for (const f of found.task_id) assert.equal(f.pattern, TASK_ID_PATTERN, f.where);
    for (const f of found.attempt_id) assert.equal(f.pattern, ATTEMPT_ID_PATTERN, f.where);
    for (const f of found.branch) assert.equal(f.pattern, BRANCH_PATTERN, f.where);
  }
  const everything = fs.readdirSync(path.join(ROOT, SCHEMA_DIR)).filter((n) => n.endsWith(".json")).map((n) => fs.readFileSync(path.join(ROOT, SCHEMA_DIR, n), "utf8")).join("\n");
  for (const old of ["^[A-Z]{3,5}-[0-9]{4}$", "^[A-Z]{3,5}-[0-9]{4}-a[1-9][0-9]?$", "^claude/[a-z]{3,5}-[0-9]{4}-[a-z0-9]+(-[a-z0-9]+)*$"]) {
    assert.ok(!everything.includes(old), `no schema still carries ${old}`);
  }
});

test("no code reader writes its own identifier expression", () => {
  const readers = ["ops/lib/review-packet.mjs", "ops/lib/decision-gate.mjs", "ops/lib/trusted-base.mjs", "ops/validate-memory.mjs", "ops/review-packet.mjs", "ops/decision-gate.mjs", "ops/ci-evidence.mjs"];
  for (const rel of readers) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\/\/.*$/gm, "");
    assert.ok(!/\[A-Z\]\{[23],5\}-(\[0-9\]|\\d)\{4\}/.test(text), `${rel} does not repeat the task id expression`);
    assert.ok(!/split\("-a"\)/.test(text), `${rel} does not split an attempt id by hand`);
  }
});

/* ------------------------------------------------------------------ the helpers */

test("task ids: every earlier id stays valid, one optional capital letter is added, nothing else", () => {
  for (const id of [...OLD_TASK_IDS, ...NEW_TASK_IDS]) assert.equal(isTaskId(id), true, id);
  for (const id of BAD_TASK_IDS) assert.equal(isTaskId(id), false, JSON.stringify(id));
  for (const id of BAD_TASK_IDS) if (typeof id === "string") assert.equal(new RegExp(TASK_ID_PATTERN).test(id), false, `the schema pattern also rejects ${JSON.stringify(id)}`);
});

test("attempt ids carry the task id with its letter, and the split is unambiguous", () => {
  for (const id of [...OLD_ATTEMPT_IDS, ...NEW_ATTEMPT_IDS]) assert.equal(isAttemptId(id), true, id);
  for (const id of BAD_ATTEMPT_IDS) assert.equal(isAttemptId(id), false, JSON.stringify(id));
  assert.equal(taskIdOfAttempt("OPS-0005B-a1"), "OPS-0005B");
  assert.equal(taskIdOfAttempt("OPS-0005-a1"), "OPS-0005");
  assert.notEqual(taskIdOfAttempt("OPS-0005B-a1"), taskIdOfAttempt("OPS-0005-a1"), "OPS-0005B is not OPS-0005");
  assert.equal(attemptNumberOf("OPS-0005B-a12"), 12);
  assert.equal(attemptNumberOf("OPS-0001-a1"), 1);
  assert.equal(taskIdOfAttempt("OPS-0005B"), null);
  assert.equal(attemptNumberOf("nonsense"), null);
});

test("branches: the letter is part of the task's identity, so OPS-0005 and OPS-0005B cannot share a branch", () => {
  for (const b of [...OLD_BRANCHES, ...NEW_BRANCHES]) assert.equal(isTaskBranch(b), true, b);
  for (const b of BAD_BRANCHES) assert.equal(isTaskBranch(b), false, JSON.stringify(b));
  assert.equal(branchPrefix("OPS-0005B"), "claude/ops-0005b-");
  assert.equal(branchPrefix("OPS-0005"), "claude/ops-0005-");
  assert.equal(branchBelongsToTask("claude/ops-0005b-evidence-hardening", "OPS-0005B"), true);
  assert.equal(branchBelongsToTask("claude/ops-0005b-evidence-hardening", "OPS-0005"), false);
  assert.equal(branchBelongsToTask("claude/ops-0005-b-evidence", "OPS-0005B"), false, "a word that starts with b is a slug, not a suffix");
  assert.equal(branchBelongsToTask("claude/ops-0005-b-evidence", "OPS-0005"), true);
  assert.equal(branchBelongsToTask("claude/ops-0006-consumer-integrity", "OPS-0006"), true);
  assert.equal(branchBelongsToTask("claude/ops-0006-consumer-integrity", "NOT-AN-ID"), false);
});

test("task file names: the letter is read from the name, and a slug that starts with b is not a letter", () => {
  assert.equal(taskIdOfFileName("OPS-0005B-evidence-hardening.md"), "OPS-0005B");
  assert.equal(taskIdOfFileName("OPS-0005-b-evidence.md"), "OPS-0005");
  assert.equal(taskIdOfFileName("OPS-0004-review-foundation.md"), "OPS-0004");
  for (const bad of ["OPS-0005b-evidence.md", "OPS-0005BC-x.md", "TEMPLATE.md", "OPS-0005B.md", "OPS-0005B-Evidence.md", "OPS-0005B-x.txt", "README.md", null, 7]) assert.equal(taskIdOfFileName(bad), null, String(bad));
  assert.equal(taskFileNameRegex("OPS-0005").test("OPS-0005B-evidence.md"), false, "the files of OPS-0005B are not files of OPS-0005");
  assert.equal(taskFileNameRegex("OPS-0005B").test("OPS-0005B-evidence.md"), true);
  assert.equal(taskFileNameRegex("OPS-0005B").test("OPS-0005-evidence.md"), false);
});

/* ------------------------------------------------------------------ the schemas and the validator */

const taskWith = (taskId, branch) => ({ ...fixture("valid/task.json"), task_id: taskId, branch });
const reportWith = (taskId, attemptId, branch) => ({ ...fixture("valid/run-report.json"), task_id: taskId, attempt_id: attemptId, attempt_number: Number(/-a(\d+)$/.exec(attemptId)?.[1] ?? 1), branch });
const ctxFor = (task) => {
  const ctx = fixtureContext();
  ctx.tasks = new Map([[task.task_id, task]]);
  ctx.taskIds = new Set([task.task_id]);
  return ctx;
};
const errors = (issues) => issues.filter((i) => i.severity === "error").map((i) => i.code);

test("the task schema and validator accept the new ids and the old ones, with their matching branches", () => {
  for (const [id, branch] of [["OPS-9001", "claude/ops-9001-example-guide"], ["OPS-9002B", "claude/ops-9002b-example-guide"], ["OPS-9003Z", "claude/ops-9003z-slug"]]) {
    const task = taskWith(id, branch);
    assert.deepEqual(validate(schemas.task, task).errors, [], id);
    assert.deepEqual(errors(validateTaskDocument(task, ctxFor(task), { filename: `${id}-example-guide.md`, body: "x".repeat(80) })), [], id);
  }
});

test("the task schema and validator reject malformed and ambiguous ids and branches", () => {
  for (const id of BAD_TASK_IDS.filter((x) => typeof x === "string")) {
    const task = taskWith(id, "claude/ops-9001-example-guide");
    assert.equal(validate(schemas.task, task).valid, false, JSON.stringify(id));
  }
  for (const branch of BAD_BRANCHES.filter((x) => typeof x === "string")) {
    assert.equal(validate(schemas.task, taskWith("OPS-9001", branch)).valid, false, JSON.stringify(branch));
  }
  // valid on their own, but they do not belong together
  const letterMissing = taskWith("OPS-9002B", "claude/ops-9002-example-guide");
  assert.deepEqual(validate(schemas.task, letterMissing).errors, []);
  assert.ok(errors(validateTaskDocument(letterMissing, ctxFor(letterMissing), { filename: "OPS-9002B-example-guide.md", body: "x".repeat(80) })).includes("TASK-BRANCH"));
  const letterExtra = taskWith("OPS-9002", "claude/ops-9002b-example-guide");
  assert.ok(errors(validateTaskDocument(letterExtra, ctxFor(letterExtra), { filename: "OPS-9002-example-guide.md", body: "x".repeat(80) })).includes("TASK-BRANCH"));
  // and the file name must carry the letter
  const task = taskWith("OPS-9002B", "claude/ops-9002b-example-guide");
  assert.ok(errors(validateTaskDocument(task, ctxFor(task), { filename: "OPS-9002-example-guide.md", body: "x".repeat(80) })).includes("TASK-FILENAME"));
});

test("the run-report schema and validator accept the new ids and reject mismatched attempts", () => {
  const task = taskWith("OPS-9002B", "claude/ops-9002b-example-guide");
  const ctx = ctxFor(task);
  const good = reportWith("OPS-9002B", "OPS-9002B-a1", "claude/ops-9002b-example-guide");
  assert.deepEqual(validate(schemas.report, good).errors, []);
  assert.deepEqual(errors(validateReportDocument(good, ctx, { location: "docs/project-memory/runs/OPS-9002B/OPS-9002B-a1/report.json" })), []);
  const other = reportWith("OPS-9002B", "OPS-9002-a1", "claude/ops-9002b-example-guide");
  assert.ok(errors(validateReportDocument(other, ctx, { location: null })).includes("REPORT-IDS"), "an attempt of OPS-9002 is not an attempt of OPS-9002B");
  const wrongPlace = validateReportDocument(good, ctx, { location: "docs/project-memory/runs/OPS-9002/OPS-9002B-a1/report.json" });
  assert.ok(errors(wrongPlace).includes("REPORT-LOCATION"));
  for (const bad of BAD_ATTEMPT_IDS.filter((x) => typeof x === "string")) assert.equal(validate(schemas.report, { ...good, attempt_id: bad }).valid, false, JSON.stringify(bad));
  assert.equal(validate(schemas.report, { ...good, branch: "claude/ops-9002B-example-guide" }).valid, false);
});

test("earlier valid documents are unchanged: the fixtures still validate", () => {
  assert.deepEqual(validate(schemas.task, fixture("valid/task.json")).errors, []);
  assert.deepEqual(validate(schemas.report, fixture("valid/run-report.json")).errors, []);
  assert.deepEqual(validate(schemas.decision, fixture("valid/review-decision.json")).errors, []);
  for (const rel of ["docs/project-memory/tasks/OPS-0001-shared-project-memory.md", "docs/project-memory/tasks/OPS-0004-review-foundation.md"]) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const data = JSON.parse(text.split("---json\n")[1].split("\n---\n")[0]);
    assert.deepEqual(validate(schemas.task, data).errors, [], rel);
  }
  for (const rel of ["docs/project-memory/runs/OPS-0004/OPS-0004-a2/report.json", "docs/project-memory/runs/OPS-0003/OPS-0003-a1/report.json", "docs/project-memory/runs/OPS-0001/OPS-0001-a1/report.json"]) {
    assert.deepEqual(validate(schemas.report, readJson(rel)).errors, [], rel);
  }
});

/* ------------------------------------------------------------------ the packet builder, verifier, gate and trusted-base check */

test("a packet, its verification and a gate decision work end to end for a task with a letter", () => {
  const w = makeWorld({ taskId: "OPS-9101B" });
  worlds.push(w);
  assert.equal(w.manifest.subject.task_id, "OPS-9101B");
  assert.equal(w.manifest.subject.attempt_id, "OPS-9101B-a1");
  assert.deepEqual(validate(schemas.packet, w.manifest).errors, []);
  const v = verifyPacket(w.packetDir, { toolRoot: w.repo.dir });
  assert.deepEqual(v.errors, []);
  assert.equal(v.ok, true);
  const r = evaluateDecision({ packetDir: w.packetDir, decisionFile: writeDecision(goodDecision(w)), toolRoot: w.repo.dir });
  assert.equal(r.task_id, "OPS-9101B");
  assert.equal(r.attempt_id, "OPS-9101B-a1");
  assert.equal(r.human_approval_required, true);
  assert.equal(r.reviewer_approval_is_binding, false);
  assert.deepEqual(r.reasons, []);
  assert.deepEqual(validate(schemas.decision, goodDecision(w)).errors, []);
});

test("the packet builder refuses malformed ids, and an attempt that belongs to another task", () => {
  const w = makeWorld({ taskId: "OPS-9101B" });
  worlds.push(w);
  const attempt = (taskId, attemptId) => () => buildPacket({
    repoDir: w.repo.dir, baseline: w.baselineSha, base: w.baselineSha, head: w.headSha, taskId, attemptId, evidenceFile: w.evidenceFile, outDir: path.join(tmp(), "p"), toolRoot: w.repo.dir,
  });
  for (const [taskId, attemptId] of [["OPS-9101b", "OPS-9101b-a1"], ["OPS-9101BC", "OPS-9101BC-a1"], ["OPS-9101B", "OPS-9101-a1"], ["OPS-9101", "OPS-9101B-a1"], ["OPS-9101B", "OPS-9101B-a0"], ["OPS-9101B", "OPS-9101B"]]) {
    assert.throws(attempt(taskId, attemptId), (e) => e instanceof PacketError && e.code === "PK-ARGS", `${taskId} / ${attemptId}`);
  }
  assert.ok(attempt("OPS-9101B", "OPS-9101B-a1"), "the right pair is at least well formed");
});

test("the trusted-base check accepts a task id with a letter and rejects malformed ones", () => {
  const repo = makeRepo();
  worlds.push({ repo });
  repo.branch("docs", (r) => r.write("docs/example-note.md", "# A note\n"));
  const ok = trustedBaseCheck({ repoDir: repo.dir, base: "main", head: "docs", taskId: "OPS-9101B" });
  assert.equal(ok.task_scope.task_id, "OPS-9101B");
  assert.equal(ok.task_scope.source, "not_found_in_base");
  for (const bad of ["OPS-9101b", "OPS-9101BC", "../../etc", "OP-9101", "OPS-9101B-a1"]) {
    assert.throws(() => trustedBaseCheck({ repoDir: repo.dir, base: "main", head: "docs", taskId: bad }), (e) => e instanceof TrustedBaseError && e.code === "TB-TASK", bad);
  }
});
