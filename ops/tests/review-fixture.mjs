// Test helper for the review packet and decision gate (OPS-0004): a throwaway git repository that holds a trusted baseline
// (the real governed files plus one fixture task) and a worker branch with a work commit and a separate report commit, the
// CI evidence for that head, and the packet built from them. Nothing here touches the real repository.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildEvidenceDocument, buildGithubCi, expectationsFromWorkflow } from "../lib/ci-evidence.mjs";
import { maxClass } from "../lib/policy.mjs";
import { buildPacket, sha256, verifyPacket } from "../lib/review-packet.mjs";
import { trustedBaseCheck } from "../lib/trusted-base.mjs";
import { makeRepo } from "./git-fixture.mjs";
import { ROOT, fixture } from "./helpers.mjs";

export const TASK_ID = "OPS-9100";
const LIVE_SHA = "0aba5e8f2c5f4971b3b7280e0a4cd23e4a5a9b75";
const FIX = path.join(ROOT, "ops", "tests", "fixtures", "ci");
const raw = (name) => fs.readFileSync(path.join(FIX, `live-run-43995081483.${name}`), "utf8");
const tmpDirs = [];

export function tmp(prefix = "m1-rv-") {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
export function cleanupTmp() {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

/** The CI data of the first real run, re-addressed to another commit so it can be paired with a test repository. */
function liveFor(sha) {
  const swap = (text) => JSON.parse(text.replaceAll(LIVE_SHA, sha));
  return { run: swap(raw("run.json")), jobs: swap(raw("jobs.json")), checks: swap(raw("check-runs.synthetic.json")), log: raw("job.log.txt") };
}

function taskFile({ taskId, allowed, declaredClass, categories, maxAttempts, requirementRefs }) {
  const t = fixture("valid/task.json");
  t.task_id = taskId;
  t.branch = `claude/${taskId.toLowerCase()}-fixture-review`;
  t.title = "Fixture review task";
  t.requirement_refs = requirementRefs;
  t.files_allowed = allowed;
  t.files_forbidden = ["public/builds/**", "public/logo.png", ".env*"];
  t.declared_risk_class = declaredClass;
  t.declared_risk_categories = categories;
  t.max_attempts = maxAttempts;
  t.depends_on = [];
  t.approval_reference = declaredClass === "A" ? null : "HD-0010";
  return `---json\n${JSON.stringify(t, null, 2)}\n---\n\n# Fixture review task\n\nThis fixture task exists only inside tests. It stands in for a task whose attempt is reviewed by a separate session.\n`;
}

/**
 * CI evidence for `headSha`, collected the way ops/ci-evidence.mjs collects it, with the REAL collector code, against the revision
 * `baseSha`. A test that wants genuine evidence for a comparison other than the packet's passes another `baseSha`: nothing in the
 * document is edited by hand, so it is internally consistent for the comparison it describes (OPS-0006 attempt 2).
 */
export function collectEvidence({ repo, headSha, baseSha, taskId, ciPasses = true }) {
  const live = liveFor(headSha);
  if (!ciPasses) {
    live.run.conclusion = "failure";
    live.jobs.jobs[0].conclusion = "failure";
    live.jobs.jobs[0].steps.find((s) => s.name === "Build").conclusion = "failure";
    live.checks.check_runs[0].conclusion = "failure";
  }
  const policy = JSON.parse(repo.read("docs/project-memory/policy/policy.json"));
  const expected = expectationsFromWorkflow(repo.read(".github/workflows/ci.yml"), policy, { repository: "owner/name", headSha, branch: null });
  const githubCi = buildGithubCi({ run: live.run, jobs: live.jobs, checkRuns: live.checks, jobLog: live.log, expected });
  const trustedBase = trustedBaseCheck({ repoDir: repo.dir, base: baseSha, head: headSha, taskId });
  return buildEvidenceDocument({ repository: "owner/name", headSha, baseSha, trustedBase, githubCi, collector: { tool: "ops/ci-evidence.mjs", tool_source: "working_tree", role: "human" }, now: new Date("2026-01-02T03:04:05Z") });
}

/** Write an evidence document to a fresh file (inside a temporary directory that cleanupTmp removes) and return its path. */
export function writeEvidence(evidence) {
  const file = path.join(tmp(), "ci-evidence.json");
  fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
  return file;
}

/**
 * Build one complete world: repository, evidence, packet.
 * @param {object} o
 * @param {Record<string,string|Buffer>} [o.files]   files the worker adds or changes (default: one allowed guide)
 * @param {string[]} [o.allowed]                     the task's files_allowed
 * @param {"A"|"B"|"C"} [o.declaredClass]
 * @param {string[]} [o.categories]
 * @param {number} [o.attempt]
 * @param {string} [o.taskId]                        the task id (default OPS-9100; OPS-9101B exercises the optional letter)
 * @param {number} [o.maxAttempts]
 * @param {boolean} [o.ciPasses]
 * @param {(report: object) => void} [o.reportMutate]
 * @param {(evidence: object) => void} [o.evidenceMutate]
 * @param {(r: object) => void} [o.baselineMutate]   extra changes on the baseline (before the work)
 * @param {boolean} [o.build]                        build the packet (default true)
 */
export function makeWorld({
  taskId = TASK_ID,
  files = { "docs/guides/example-guide.md": "# Example guide\n\nA short guide.\n" },
  allowed = ["docs/guides/**", "docs/project-memory/runs/**"],
  declaredClass = "B",
  categories = ["docs_only", "ops_control_plane"],
  attempt = 1,
  maxAttempts = 3,
  ciPasses = true,
  reportMutate = () => {},
  evidenceMutate = () => {},
  baselineMutate = () => {},
  build = true,
} = {}) {
  const repo = makeRepo();
  const attemptId = `${taskId}-a${attempt}`;
  // the trusted baseline: the governed files plus the approved task
  repo.write(`docs/project-memory/tasks/${taskId}-fixture-review.md`, taskFile({ taskId, allowed, declaredClass, categories, maxAttempts, requirementRefs: ["REQ-OPS-001", "REQ-OPS-007"] }));
  baselineMutate(repo);
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "baseline with the approved task");
  const baselineSha = repo.git("rev-parse", "HEAD").trim();

  // the worker: one work commit, then the report as a separate final commit
  repo.branch("work", (r) => { for (const [rel, content] of Object.entries(files)) r.write(rel, content); }, { from: "main" });
  const workSha = repo.git("rev-parse", "work").trim();
  const numstat = repo.git("diff", "--numstat", baselineSha, workSha).trim().split("\n").filter(Boolean).map((l) => l.split("\t"));
  const report = fixture("valid/run-report.json");
  report.task_id = taskId;
  report.attempt_id = attemptId;
  report.attempt_number = attempt;
  report.branch = `claude/${taskId.toLowerCase()}-fixture-review`;
  report.base_sha = baselineSha;
  report.head_sha = workSha;
  report.session = { id: "session_fixture_worker_01", url: null };
  report.commits = [{ sha: workSha, subject: "Fixture work" }];
  report.changed_files = numstat.map(([a, d, p]) => ({ path: p, change_type: "added", additions: Number(a), deletions: Number(d) }));
  reportMutate(report);
  const reportRel = `docs/project-memory/runs/${taskId}/${attemptId}/report.json`;
  repo.branch("report", (r) => r.write(reportRel, `${JSON.stringify(report, null, 2)}\n`), { from: "work" });
  const headSha = repo.git("rev-parse", "report").trim();

  // the CI evidence for that head, built the way ops/ci-evidence.mjs builds it
  const evidence = collectEvidence({ repo, headSha, baseSha: baselineSha, taskId, ciPasses });
  evidenceMutate(evidence);
  const evidenceFile = path.join(tmp(), "ci-evidence.json");
  fs.writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`);

  const world = { repo, taskId, baselineSha, workSha, headSha, evidenceFile, evidence, report, reportRel, attemptId, packetDir: null, manifest: null };
  if (build) {
    world.packetDir = path.join(tmp(), "packet");
    world.manifest = buildPacket({ repoDir: repo.dir, baseline: baselineSha, base: baselineSha, head: headSha, taskId, attemptId, evidenceFile, outDir: world.packetDir, toolRoot: repo.dir }).manifest;
  }
  return world;
}

/** A private copy of a packet that a test may damage. */
export function copyPacket(packetDir) {
  const dest = path.join(tmp(), "packet");
  fs.cpSync(packetDir, dest, { recursive: true });
  return dest;
}

/** Overwrite a packet file AND recompute the manifest's hash for it: what a forger who knows the format would do. */
export function forge(packetDir, relPath, newContent) {
  const file = path.join(packetDir, ...relPath.split("/"));
  const buf = Buffer.isBuffer(newContent) ? newContent : Buffer.from(newContent, "utf8");
  fs.writeFileSync(file, buf);
  const manifestFile = path.join(packetDir, "MANIFEST.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const entry = manifest.files.find((f) => f.path === relPath);
  entry.sha256 = sha256(buf);
  entry.bytes = buf.length;
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function editManifest(packetDir, fn) {
  const manifestFile = path.join(packetDir, "MANIFEST.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  fn(manifest);
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
}

export const readPacketJson = (packetDir, rel) => JSON.parse(fs.readFileSync(path.join(packetDir, ...rel.split("/")), "utf8"));
export const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

/** A reviewer decision that binds correctly to the packet and passes every check. Override fields to attack it. */
export function goodDecision(world, packetDir = world.packetDir) {
  const v = verifyPacket(packetDir, { toolRoot: world.repo.dir });
  if (!v.ok) throw new Error(`fixture packet is not valid: ${v.errors.map((e) => e.code).join(", ")}`);
  const m = v.manifest;
  const file = (role) => m.files.find((f) => f.role === role).sha256;
  const task = v.data.task;
  return {
    schema_version: "1",
    decision_kind: "review_decision",
    trust: { level: "unverified_reviewer_claim", verified_by_orchestrator: false },
    reviewer: { role: "reviewer", runtime: "manual_session", session: { id: "session_fixture_reviewer_01", url: null } },
    task_id: m.subject.task_id,
    attempt_id: m.subject.attempt_id,
    reviewed: { head_sha: m.subject.head_sha, report_sha256: file("run_report"), diff_sha256: file("diff"), ci_result_sha256: file("ci_evidence"), policy_version: m.trusted_baseline.policy_version, prompt_version: m.trusted_baseline.prompt_version },
    verdict: "approve",
    confidence: 0.8,
    summary: "The change matches the task and the evidence agrees with the report.",
    findings: [],
    verification_assessment: {
      report_consistency: "consistent",
      ci_status: v.data.evidence.verdict.ci_passed ? "passed" : "failed",
      acceptance_criteria: task.acceptance_criteria.map((a) => ({ id: a.id, met: "yes", note: "Shown in the diff." })),
    },
    risk_assessment: { advised_class: maxClass(v.data.classification.class, task.declared_risk_class, v.data.report.risk.declared_class), categories: v.data.classification.categories, rationale: "Derived from the changed paths.", advisory_only: true },
    next_step: { action: "merge_candidate", rationale: "No blocking finding; a human decides.", next_task: null },
    stop_reason: null,
    questions_for_human: [],
    memory_update_suggestions: [],
  };
}

export function writeDecision(decision, name = "review.json") {
  const file = path.join(tmp(), name);
  fs.writeFileSync(file, typeof decision === "string" ? decision : `${JSON.stringify(decision, null, 2)}\n`);
  return file;
}

/** A proposal for a next task that passes every check; override fields to attack it. */
export function goodProposal(over = {}) {
  const nt = {
    title: "Add a second example guide",
    objective: "Add a second example guide page to the documentation folder as a follow-up demonstration of the same pattern.",
    depends_on: [TASK_ID],
    blocked_by_open_questions: [],
    requirement_refs: [],
    declared_risk_class: "A",
    declared_risk_categories: ["docs_only"],
    files_allowed: ["docs/guides/**"],
    files_forbidden: [],
    out_of_scope: ["Any change outside docs/guides"],
    acceptance_criteria: [{ id: "AC-1", statement: "The new guide exists.", verification_method: "inspection", command: null }],
    required_checks: [{ id: "lint", command: "npm run lint", description: "ESLint over the repository", must_pass: true }],
    max_attempts: 2,
    prompt_markdown: "Add docs/guides/second-guide.md with a short guide in the same style as the first one. Do not change any other file.",
    ...over,
  };
  return nt;
}
