// Review packet (OPS-0004). Offline: reads a git repository and files, writes a directory. No network, no credential, no model.
//
// A review packet is what an independent reviewer session reads about ONE attempt of ONE task:
//
//   MANIFEST.json                              binds the packet to a commit, a task and an attempt, and lists every file's SHA-256
//   trusted/   reviewer-instructions.md        from the trusted baseline commit (never from the worker's branch)
//              review-decision.schema.json     the output contract, from the baseline
//              task.md                         the approved task definition, from the baseline
//              policy.json                     the deterministic policy, from the baseline
//              requirements.md                 the requirement lines the task cites, from the baseline
//              ci-evidence.json                GitHub's results about the run, as produced by ops/ci-evidence.mjs
//              changed-files.json              the changed paths with risk classes, computed from git
//   untrusted/ run-report.json                 the worker's own report: a CLAIM
//              diff.patch                      the bounded diff: facts computed by git, text written by the worker
//              commits.json                    commit ids and subjects: text written by the worker
//
// "trusted" says where a file came from. No file in either folder can instruct the reviewer: only the reviewer's launch
// message and its instructions from the baseline can. Instruction-like text found in worker-written files is counted in the
// manifest as data and is never obeyed.
//
// The tool must be run from a checkout of the trusted baseline. It checks that its own policy, schemas and reviewer prompt are
// byte-identical to the baseline commit's, so a branch cannot redefine the reviewer's instructions or the rules it is judged by.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isAttemptId, isTaskId, taskIdOfAttempt } from "./ids.mjs";
import { EARLIER_MANDATORY_CHECK_IDS, MANDATORY_CHECK_IDS, coreChecks, expectationsFromWorkflow, missingEvidenceOf, trustBasisOf } from "./ci-evidence.mjs";
import { validate } from "./json-schema.mjs";
import { classifyPaths } from "./policy.mjs";
import { addedInstructionLineCount, foreignEmailCount, instructionLineCount, secretShapes } from "./review-text.mjs";
import { changedPaths, ciDefinitionFlagsOf, git, readBlobAtRevision, resolveCommit } from "./trusted-base.mjs";
import { DEFAULT_ROOT, PATHS, parseTaskFile } from "../validate-memory.mjs";

export class PacketError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PacketError";
    this.code = code;
  }
}

export const PACKET_TOOL = { name: "ops/review-packet", version: "1.0.0" };
export const PROMPT_PATH = "docs/project-memory/reviewer/REVIEWER_PROMPT.md";
const PROMPT_START = "<!-- PROMPT-START -->";
const PROMPT_END = "<!-- PROMPT-END -->";

/** The fixed layout. Every role appears exactly once; nothing else may be in the packet. */
export const LAYOUT = [
  { role: "reviewer_instructions", path: "trusted/reviewer-instructions.md", trust: "trusted_baseline", max: 100_000 },
  { role: "decision_schema", path: "trusted/review-decision.schema.json", trust: "trusted_baseline", max: 200_000 },
  { role: "task", path: "trusted/task.md", trust: "trusted_baseline", max: 200_000 },
  { role: "policy", path: "trusted/policy.json", trust: "trusted_baseline", max: 500_000 },
  { role: "requirements", path: "trusted/requirements.md", trust: "trusted_baseline", max: 100_000 },
  { role: "ci_evidence", path: "trusted/ci-evidence.json", trust: "github_derived", max: 1_000_000 },
  { role: "changed_files", path: "trusted/changed-files.json", trust: "computed_from_git", max: 500_000 },
  { role: "run_report", path: "untrusted/run-report.json", trust: "worker_claim", max: 1_000_000 },
  { role: "diff", path: "untrusted/diff.patch", trust: "worker_authored", max: 1_500_000 },
  { role: "commits", path: "untrusted/commits.json", trust: "worker_authored", max: 200_000 },
];
export const LIMITS = { manifestBytes: 100_000, totalBytes: 4_500_000, subjectChars: 200 };
const byRole = Object.fromEntries(LAYOUT.map((f) => [f.role, f]));

export const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const text = (buf) => buf.toString("utf8");
const json = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");

function need(cond, code, message) {
  if (!cond) throw new PacketError(code, message);
}

function parseJson(buf, code, label) {
  try {
    return JSON.parse(text(buf));
  } catch {
    throw new PacketError(code, `${label} is not valid JSON`);
  }
}

/* --------------------------------------------------------------- trusted files */

/** The reviewer's instructions: the text between the markers of the prompt file, and its version. */
export function extractPrompt(promptText) {
  const start = promptText.indexOf(PROMPT_START);
  const end = promptText.indexOf(PROMPT_END);
  need(start >= 0 && end > start, "PK-PROMPT", "the reviewer prompt has no PROMPT-START and PROMPT-END markers");
  const version = /^- \*\*Prompt version:\*\* (\S+)\s*$/m.exec(promptText);
  need(version, "PK-PROMPT", "the reviewer prompt states no version");
  return { version: version[1], body: `${promptText.slice(start + PROMPT_START.length, end).trim()}\n` };
}

/** The verbatim requirement lines that a task cites. */
export function requirementsExcerpt(requirementsText, refs) {
  const lines = requirementsText.split(/\r?\n/);
  const picked = [];
  for (const ref of [...refs].sort()) {
    const line = lines.find((l) => l.startsWith(`- **${ref}**`));
    need(line, "PK-REQUIREMENT", `the task cites ${ref}, which is not in the baseline's requirements`);
    picked.push(line);
  }
  return `# Requirements cited by the task\n\nVerbatim lines from the trusted baseline.\n\n${picked.join("\n")}\n`;
}

function loadToolContext(toolRoot) {
  const read = (rel) => fs.readFileSync(path.join(toolRoot, rel));
  const schemas = {};
  const schemaBytes = {};
  for (const [key, rel] of Object.entries(PATHS.schemas)) {
    schemaBytes[key] = read(rel);
    schemas[key] = JSON.parse(text(schemaBytes[key]));
  }
  const policyBytes = read(PATHS.policy);
  const policy = JSON.parse(text(policyBytes));
  // what a correct CI run looks like comes from the baseline's own workflow file, never from the evidence being judged
  const wfPath = policy.workflow_policy && Array.isArray(policy.workflow_policy.required_workflow_files) ? policy.workflow_policy.required_workflow_files[0] : null;
  let workflowText = null;
  if (typeof wfPath === "string" && !wfPath.startsWith("/") && !wfPath.split("/").includes("..")) {
    try {
      workflowText = text(read(wfPath));
    } catch {
      workflowText = null;
    }
  }
  let humanDecisionsText = "";
  try {
    humanDecisionsText = text(read(PATHS.humanDecisions));
  } catch {
    humanDecisionsText = "";
  }
  return { root: toolRoot, schemas, schemaBytes, policy, policyBytes, promptBytes: read(PROMPT_PATH), requirementsText: text(read(PATHS.requirements)), workflowText, humanDecisionsText };
}
export { loadToolContext };

/** The task file of the tool's own checkout (the trusted baseline), as bytes, or null. */
export function toolTaskFile(ctx, taskId) {
  const dir = path.join(ctx.root, PATHS.tasksDir);
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => new RegExp(`^${taskId}-[a-z0-9-]+\\.md$`).test(n)) : [];
  if (names.length !== 1) return null;
  return fs.readFileSync(path.join(dir, names[0]));
}

/* -------------------------------------------------------------- derived facts */

/** The trusted expectations of a correct CI run, from the baseline's workflow and policy, or null when they cannot be derived. */
export function trustedExpectations(tool, headSha, repository = "owner/name") {
  if (!tool.workflowText) return null;
  try {
    return expectationsFromWorkflow(tool.workflowText, tool.policy, { repository, headSha, branch: null });
  } catch {
    return null;
  }
}

const SHA40 = /^[0-9a-f]{40}$/;
const shortSha = (s) => (typeof s === "string" && SHA40.test(s) ? s.slice(0, 12) : JSON.stringify(s) ?? "none");

/**
 * The evidence must describe the comparison THIS packet is about, and nothing else (OPS-0006 attempt 2, finding F-1). Evidence
 * collected for another base can be perfectly consistent on its own terms, and can say CI's definition is unchanged for a change
 * that modifies the review control plane; the earlier check of the changed paths ran only when the evidence's base happened to equal
 * the packet's, so a mismatch skipped it silently. Now a mismatch is a refusal and nothing is substituted.
 *
 * The consumer supplies what it computed itself: the base, the merge-base of base and head, the head, and the changed paths from
 * git (or, in the verifier, from the packet). Each identity in the evidence has to equal them: the subject's and the trusted-base
 * evaluation's. The recorded changed paths have to be the computed ones, and the CI-definition flags and the trust basis are
 * checked against flags computed from the consumer's own paths, whatever base the evidence names.
 */
function bindComparison(evidence, trusted, trustedBase, result, problem) {
  const missing = ["baseSha", "mergeBaseSha", "headSha"].filter((k) => !SHA40.test(String(trusted[k] ?? "")));
  if (missing.length || !Array.isArray(trusted.changedPaths)) {
    problem("EV-COMPARISON-UNBOUND", "incomplete", `the consumer gave no ${[...missing.map((k) => ({ baseSha: "base", mergeBaseSha: "merge-base", headSha: "head" })[k]), ...(Array.isArray(trusted.changedPaths) ? [] : ["computed changed paths"])].join(", ")}, so the comparison the evidence describes cannot be matched to the packet`);
    return;
  }
  if (!trustedBase || !trustedBase.evaluated || !evidence.subject) return; // the missing section is reported as incomplete elsewhere
  const same = (label, actual, wanted, what) => {
    if (actual !== wanted) problem("EV-BASE-MISMATCH", "inconsistent", `${label} is ${shortSha(actual)}, but the packet's ${what} is ${shortSha(wanted)}: the evidence was collected for another comparison and does not describe this packet`);
  };
  same("the evidence subject's base", evidence.subject.base_sha, trusted.baseSha, "base");
  same("the trusted-base evaluation's base", trustedBase.evaluated.base_sha, trusted.baseSha, "base");
  same("the evidence subject's merge-base", evidence.subject.merge_base_sha, trusted.mergeBaseSha, "merge-base");
  same("the trusted-base evaluation's merge-base", trustedBase.evaluated.merge_base_sha, trusted.mergeBaseSha, "merge-base");
  same("the evidence subject's head", evidence.subject.head_sha, trusted.headSha, "head");
  same("the trusted-base evaluation's head", trustedBase.evaluated.head_sha, trusted.headSha, "head");

  // the changed paths the evidence records must be the ones computed here (a truncated list is still checked: membership and count)
  const computed = new Set(trusted.changedPaths);
  const ch = trustedBase.changes;
  if (!ch || !Array.isArray(ch.paths)) problem("EV-CHANGED-PATHS-MISMATCH", "inconsistent", "the evidence records no list of changed paths to compare with the packet's");
  else {
    const listed = new Set(ch.paths.map((p) => p.path));
    const outside = [...listed].filter((p) => !computed.has(p));
    const left = ch.truncated === true ? [] : [...computed].filter((p) => !listed.has(p));
    if (ch.total !== computed.size || outside.length || left.length) {
      problem("EV-CHANGED-PATHS-MISMATCH", "inconsistent", `the evidence records ${ch.total} changed path(s)${outside.length ? `, including ${outside.length} the packet does not have (${outside.slice(0, 2).join(", ")})` : ""}${left.length ? `, and leaves out ${left.length} the packet has (${left.slice(0, 2).join(", ")})` : ""}; the packet computed ${computed.size}`);
    }
  }

  // the CI-definition flags, and so the trust basis, from the consumer's own paths, whatever base the evidence names
  const flags = ciDefinitionFlagsOf(trusted.changedPaths);
  for (const [flag, value] of Object.entries(flags)) {
    const recorded = Boolean(trustedBase.flags && trustedBase.flags[flag]);
    if (recorded !== value) problem("EV-FLAGS-MISMATCH", "inconsistent", `the evidence says ${flag} is ${recorded}, but the changed paths computed for this packet give ${value}`);
  }
  if (Object.values(flags).some(Boolean) && result.trustBasis === "ci_definition_unchanged_from_base") {
    problem("EV-TRUST-BASIS", "inconsistent", "the evidence says CI's definition is unchanged, but the changed paths include a workflow, ops/, policy, schema or build input");
  }
}

/**
 * What an evidence document says about CI, DERIVED from the data inside it and from trusted expectations, never read from the
 * document's own verdict (OPS-0006). A forged or earlier-shape document therefore cannot read as passed or complete.
 *
 * `trusted` is { expected, changedPaths, baseSha, mergeBaseSha, headSha }: the expectations from the baseline's workflow
 * (trustedExpectations), the changed paths the consumer computed itself, and the base, merge-base and head of the comparison the
 * packet is about. Without it nothing can be re-evaluated, so the result is never complete (a document is only as good as what could
 * be checked); and evidence that describes another comparison is inconsistent (see bindComparison).
 *
 * Problems have a kind: "inconsistent" (the document contradicts its own data or the expectations: refuse it), "failed" (GitHub's
 * data shows a failure) or "incomplete" (not enough was checked or supplied). passed is false for the first two; complete needs
 * none of the three. legacy means the verdict has no missing_evidence: it was written before the mandatory log checks existed.
 */
export function deriveCi(evidence, trusted = null) {
  const g = evidence && evidence.github_ci && typeof evidence.github_ci === "object" ? evidence.github_ci : null;
  const verdict = (evidence && evidence.verdict) || {};
  const legacy = !Array.isArray(verdict.missing_evidence);
  const trustedBase = (evidence && evidence.trusted_base) || null;
  const problems = [];
  const problem = (code, kind, message) => problems.push({ code, kind, message });
  const result = { present: false, passed: false, complete: false, legacy, runId: null, conclusion: null, headSha: null, trustBasis: trustBasisOf(trustedBase, g), missing: missingEvidenceOf(trustedBase, g), problems, recordedOnly: [], recomputed: false };
  if (!g) {
    problem("EV-NO-GITHUB-DATA", "incomplete", "the evidence holds no GitHub run data");
    return result;
  }
  const run = g.workflow_run;
  const jobs = Array.isArray(g.jobs) ? g.jobs : [];
  const recorded = Array.isArray(g.consistency) ? g.consistency : [];
  result.present = true;
  result.runId = run.id;
  result.conclusion = run.conclusion;
  result.headSha = run.head_sha;

  const byId = new Map();
  for (const c of recorded) byId.set(c.id, [...(byId.get(c.id) ?? []), c]);
  for (const [id, list] of byId) if (list.length > 1) problem("EV-DUPLICATE-CHECK", "inconsistent", `the check ${id} is recorded ${list.length} times`);
  const entry = (id) => (byId.get(id) ?? [null])[0];
  const failedIds = recorded.filter((c) => c.blocking && !c.passed).map((c) => c.id);
  if (failedIds.length) problem("EV-CHECK-FAILED", "failed", `blocking check(s) failed: ${[...new Set(failedIds)].slice(0, 6).join(", ")}`);
  const runOk = run.status === "completed" && run.conclusion === "success";
  if (!runOk) problem("EV-RUN-NOT-SUCCESSFUL", "failed", `the run is ${run.status} with conclusion ${run.conclusion}`);

  // re-evaluate what the embedded data decides, with the collector's own check logic and the baseline's expectations
  if (trusted && trusted.expected) {
    result.recomputed = true;
    let embedded = null;
    try {
      embedded = coreChecks(run, jobs, g.checks ?? null, trusted.expected);
    } catch {
      problem("EV-RECOMPUTE-ERROR", "inconsistent", "the GitHub data inside the evidence cannot be re-evaluated");
    }
    for (const c of embedded ?? []) {
      const rec = entry(c.id);
      if (!rec) problem("EV-CHECK-ABSENT", "inconsistent", `the check ${c.id} is not recorded`);
      else if (rec.passed !== c.passed || rec.blocking !== c.blocking) problem("EV-RECOMPUTE-MISMATCH", "inconsistent", `${c.id} is recorded as passed ${rec.passed} (blocking ${rec.blocking}), but the data inside the evidence gives passed ${c.passed} (blocking ${c.blocking})`);
    }
    const tp = g.token_permissions;
    const tokenOk = Boolean(tp && Array.isArray(tp.permissions)) && tp.permissions.every((x) => x.access === "read" && (x.scope === "contents" || x.scope === "metadata"));
    const tokenRec = entry("log.token_is_read_only");
    if (tokenRec && tokenRec.passed !== tokenOk) problem("EV-RECOMPUTE-MISMATCH", "inconsistent", `log.token_is_read_only is recorded as passed ${tokenRec.passed}, but the token permissions inside the evidence give passed ${tokenOk}`);
  } else problem("EV-NOT-RECOMPUTED", "incomplete", trusted ? "the baseline's workflow gives no expectations, so the GitHub data inside the evidence was not re-evaluated" : "no trusted expectations were given, so the GitHub data inside the evidence was not re-evaluated");

  // the mandatory checks must exist, block, and (checked above) pass; the log-structure ones can only be taken as recorded
  for (const id of MANDATORY_CHECK_IDS) {
    const rec = entry(id);
    const earlier = EARLIER_MANDATORY_CHECK_IDS.includes(id);
    if (!rec) problem(legacy ? "EV-LEGACY-MANDATORY-ABSENT" : "EV-MANDATORY-ABSENT", legacy ? "incomplete" : "inconsistent", legacy ? `evidence of the earlier shape lacks ${id}, which is mandatory today` : `the mandatory check ${id} is not recorded`);
    else if (!rec.blocking) problem("EV-MANDATORY-NOT-BLOCKING", "inconsistent", `the mandatory check ${id} is recorded as non-blocking`);
    else if (!earlier) result.recordedOnly.push(id);
  }
  if (g.checks === null || g.checks === undefined) problem("EV-INPUT-MISSING", "incomplete", "no check-run data is inside the evidence");
  if (!g.test_evidence || !g.token_permissions) problem("EV-INPUT-MISSING", "incomplete", "no job-log data (token permissions, test evidence) is inside the evidence");
  if (!trustedBase) problem("EV-INPUT-MISSING", "incomplete", "the evidence holds no trusted-base section");

  // what the document claims about itself must equal what was derived (a current-shape document); earlier ones are flagged as legacy
  if (!legacy && JSON.stringify(verdict.missing_evidence) !== JSON.stringify(result.missing)) problem("EV-VERDICT-CLAIM", "inconsistent", `the verdict lists missing evidence ${JSON.stringify(verdict.missing_evidence)}, but ${JSON.stringify(result.missing)} was derived`);
  if (verdict.ci_trust_basis !== result.trustBasis) problem("EV-TRUST-BASIS", "inconsistent", `the verdict says ${verdict.ci_trust_basis}, but the trusted-base section gives ${result.trustBasis}`);
  if (trusted) bindComparison(evidence, trusted, trustedBase, result, problem);

  result.passed = runOk && !problems.some((p) => p.kind === "inconsistent" || p.kind === "failed");
  result.complete = result.passed && problems.length === 0 && result.missing.length === 0;
  if (!legacy && result.recomputed && Boolean(verdict.evidence_complete) !== result.complete) {
    problem("EV-VERDICT-CLAIM", "inconsistent", `the verdict says evidence_complete ${verdict.evidence_complete}, but ${result.complete} was derived`);
    result.passed = false;
    result.complete = false;
  }
  return result;
}

/** The set of paths named by the `diff --git` headers of a patch. */
export function pathsInPatch(patchText) {
  const out = new Set();
  for (const line of patchText.split("\n")) {
    const m = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    if (m) out.add(m[2]);
  }
  return out;
}

function classificationDoc(paths, policy) {
  const c = classifyPaths(paths, policy);
  return {
    class: c.class,
    restriction: c.restriction,
    categories: [...c.categories].sort(),
    control_plane_paths: [...c.controlPlanePaths].sort(),
    protected_paths: [...c.protectedPaths].sort(),
    immutable_paths: [...c.immutablePaths].sort(),
    hits: c.hits,
  };
}

function numstat(repoDir, from, to) {
  const out = git(repoDir, ["diff", "--numstat", "-z", "--no-renames", from, to]).toString("utf8").split("\0").filter(Boolean);
  const map = new Map();
  for (const rec of out) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/s.exec(rec);
    if (m) map.set(m[3], { additions: m[1] === "-" ? 0 : Number(m[1]), deletions: m[2] === "-" ? 0 : Number(m[2]) });
  }
  return map;
}

function indicatorList(files) {
  const out = [];
  const add = (file, count) => count > 0 && out.push({ file, kind: "instruction_like_text", count });
  add(byRole.run_report.path, instructionLineCount(text(files.get(byRole.run_report.path))));
  add(byRole.diff.path, addedInstructionLineCount(text(files.get(byRole.diff.path))));
  add(byRole.commits.path, instructionLineCount(JSON.parse(text(files.get(byRole.commits.path))).map((c) => c.subject).join("\n")));
  return out.sort((a, b) => (a.file < b.file ? -1 : 1));
}

function sensitiveProblems(files, policy) {
  const allowed = policy.memory_contract.content_scan.allowed_emails;
  const problems = [];
  for (const spec of LAYOUT) {
    const buf = files.get(spec.path);
    if (!buf) continue;
    const t = text(buf);
    const shapes = secretShapes(t);
    if (shapes.length) problems.push({ code: "PK-SENSITIVE", message: `${spec.path} contains text shaped like a credential (${shapes.join(", ")})` });
    if (foreignEmailCount(t, allowed) > 0) problems.push({ code: "PK-SENSITIVE", message: `${spec.path} contains an email address that is not on the policy's allowed list` });
  }
  return problems;
}

/* ---------------------------------------------------------------- the baseline */

const decisionRecorded = (decisionsText, id) => new RegExp(`^### ${id}( |$)`, "m").test(decisionsText ?? "");

const MAX_PREPARATION_COMMITS = 200;
const MAX_LISTED_PATHS = 20;

const isAncestorOf = (repoDir, a, b) => {
  try {
    git(repoDir, ["merge-base", "--is-ancestor", a, b]);
    return true;
  } catch {
    return false;
  }
};

/**
 * How the baseline's HISTORY relates to the approved base (OPS-0006 attempt 2, finding F-2). Review B found that independence was
 * decided from the final contents of the reviewed files, so an implementation or control-plane change that was later rewritten or
 * reverted left no trace. The commits between the base and the baseline are therefore read one by one. The baseline is independent
 * only if it IS the approved base, or every commit between them changes nothing but the task definition the review uses (the
 * approved preparation of the task). Any other path in any of those commits, a merge commit, or a baseline that does not descend
 * from the base, is not independent, whatever the final trees look like.
 *
 * Offline limits: "the approved base" is the base the builder was given (the owner pins it), and the task definition's content is
 * not judged, only that nothing else was touched.
 */
function baselineProvenance({ repoDir, baselineSha, baseSha, taskPath }) {
  const out = { relation_to_base: "not_a_descendant_of_base", commits_after_base: 0, non_preparation_paths: [], history_verified: false, reasons: [] };
  if (baselineSha === baseSha) return { ...out, relation_to_base: "is_base", history_verified: true };
  if (!isAncestorOf(repoDir, baseSha, baselineSha)) {
    out.reasons.push("the baseline is not the base and does not descend from it, so it is not the approved starting point of the work");
    return out;
  }
  let revs;
  try {
    revs = git(repoDir, ["rev-list", "--reverse", "--topo-order", `${baseSha}..${baselineSha}`]).toString("utf8").split("\n").filter(Boolean);
  } catch {
    out.reasons.push("the commits between the base and the baseline could not be read, so the baseline's history cannot be verified");
    return out;
  }
  out.commits_after_base = revs.length;
  if (revs.length > MAX_PREPARATION_COMMITS) {
    out.reasons.push(`${revs.length} commits lie between the base and the baseline (the limit is ${MAX_PREPARATION_COMMITS}), so the history cannot be verified`);
    return out;
  }
  const other = new Set();
  let merges = 0;
  for (const commit of revs) {
    const parents = git(repoDir, ["rev-list", "--parents", "-n", "1", commit]).toString("utf8").trim().split(" ").length - 1;
    if (parents !== 1) {
      merges += 1; // a merge (or a root) cannot be attributed to the task definition
      continue;
    }
    for (const name of git(repoDir, ["diff-tree", "-r", "--no-commit-id", "--name-only", "--no-renames", "-z", commit]).toString("utf8").split("\0").filter(Boolean)) {
      if (name !== taskPath) other.add(name);
    }
  }
  out.history_verified = true;
  out.non_preparation_paths = [...other].sort().slice(0, MAX_LISTED_PATHS);
  out.relation_to_base = other.size > 0 || merges > 0 ? "other_changes_in_history" : "task_preparation_only";
  if (other.size > 0) out.reasons.push(`${revs.length} commit(s) between the base and the baseline change ${other.size} path(s) other than the task definition (${[...other].sort().slice(0, 3).join(", ")}${other.size > 3 ? ", ..." : ""}), so the baseline may contain work that is under review`);
  if (merges > 0) out.reasons.push(`${merges} merge commit(s) lie between the base and the baseline and cannot be attributed to the task definition`);
  return out;
}

/**
 * How the trusted baseline relates to the work under review (OPS-0006). A baseline is independent verification only if it predates
 * the work: it is an ancestor of the head, it is the approved base or differs from it only by commits that touch the task
 * definition (baselineProvenance reads that history), and none of the reviewed code is already in it. The approved task definition
 * must be in it (the builder refuses otherwise); here we also record whether the base holds the same definition and whether the
 * evidence's trusted-base check could judge the task's scope from it.
 */
function baselineAssessment({ repoDir, baselineSha, baseSha, headSha, changed, taskPath, taskBlob, evidence }) {
  const isAncestor = (a, b) => isAncestorOf(repoDir, a, b);
  let relation = "unrelated";
  if (baselineSha === headSha) relation = "is_head";
  else if (isAncestor(baselineSha, headSha)) relation = "ancestor_of_head";
  else if (isAncestor(headSha, baselineSha)) relation = "descends_from_head";
  const prov = baselineProvenance({ repoDir, baselineSha, baseSha, taskPath });
  let inBaseline = 0;
  for (const c of changed) {
    if (c.path === taskPath) continue;
    const atHead = readBlobAtRevision(repoDir, headSha, c.path);
    const atBaseline = readBlobAtRevision(repoDir, baselineSha, c.path);
    if (atHead !== null && atBaseline !== null) {
      if (Buffer.compare(atHead, atBaseline) === 0) inBaseline += 1;
    } else if (atHead === null && atBaseline === null && readBlobAtRevision(repoDir, baseSha, c.path) !== null) inBaseline += 1; // the deletion is already in the baseline
  }
  const baseBlob = readBlobAtRevision(repoDir, baseSha, taskPath);
  const tb = evidence && evidence.trusted_base;
  const reasons = [];
  if (relation === "is_head") reasons.push("the baseline is the commit under review");
  else if (relation === "descends_from_head") reasons.push("the baseline descends from the reviewed head, so it contains the code under review");
  else if (relation === "unrelated") reasons.push("the baseline is not an ancestor of the head, so it does not predate the work");
  if (inBaseline > 0) reasons.push(`${inBaseline} reviewed path(s) already have the reviewed content in the baseline`);
  reasons.push(...prov.reasons);
  const preparedOrBase = prov.relation_to_base === "is_base" || prov.relation_to_base === "task_preparation_only";
  return {
    relation_to_head: relation,
    reviewed_paths_in_baseline: inBaseline,
    relation_to_base: prov.relation_to_base,
    commits_after_base: prov.commits_after_base,
    non_preparation_paths: prov.non_preparation_paths,
    history_verified: prov.history_verified,
    base_has_task_file: baseBlob !== null && Buffer.compare(baseBlob, taskBlob) === 0,
    scope_established_by_evidence: Boolean(tb && tb.task_scope && tb.task_scope.source === "base_revision"),
    independent: relation === "ancestor_of_head" && preparedOrBase && prov.history_verified && inBaseline === 0,
    reasons,
  };
}

/* ---------------------------------------------------------------------- build */

/**
 * Build a review packet.
 * @param {object} o
 * @param {string} o.repoDir     a git repository that holds all revisions
 * @param {string} o.baseline    the trusted commit: source of the task definition, policy, schemas, requirements and reviewer instructions
 * @param {string} o.base        the revision the change starts from
 * @param {string} o.head        the revision under review
 * @param {string} o.taskId      for example OPS-0003
 * @param {string} o.attemptId   for example OPS-0003-a1
 * @param {string} o.evidenceFile  a CI evidence document (ops/ci-evidence.mjs output)
 * @param {string} o.outDir      a directory that does not exist yet
 * @param {string} [o.toolRoot]  the checkout this tool runs from; it must be the baseline
 * @param {string|null} [o.baselineException]  a decision (HD-nnnn) that records why a baseline that is not independent is accepted
 */
export function buildPacket({ repoDir, baseline, base, head, taskId, attemptId, evidenceFile, outDir, toolRoot = DEFAULT_ROOT, baselineException = null }) {
  need(isTaskId(taskId), "PK-ARGS", "task must look like OPS-0003 or OPS-0005B");
  need(isAttemptId(attemptId) && taskIdOfAttempt(attemptId) === taskId, "PK-ARGS", "attempt must look like OPS-0003-a1 and belong to the task");
  need(typeof outDir === "string" && outDir !== "", "PK-ARGS", "an output directory is required");
  need(!fs.existsSync(outDir), "PK-OUT-EXISTS", "the output directory already exists; a packet is never overwritten");
  need(fs.existsSync(path.dirname(path.resolve(outDir))), "PK-ARGS", "the parent of the output directory does not exist");

  const baselineSha = resolveCommit(repoDir, baseline, "baseline");
  const baseSha = resolveCommit(repoDir, base, "base");
  const headSha = resolveCommit(repoDir, head, "head");
  const mergeBase = git(repoDir, ["merge-base", baseSha, headSha]).toString("utf8").trim();
  need(/^[0-9a-f]{40}$/.test(mergeBase), "PK-NO-MERGE-BASE", "base and head have no common history");

  const tool = loadToolContext(toolRoot);

  // 1. this tool must be running from the baseline: the same policy, schemas and reviewer prompt, byte for byte
  const sameAsBaseline = (rel, bytes) => {
    const blob = readBlobAtRevision(repoDir, baselineSha, rel);
    return blob !== null && Buffer.compare(blob, bytes) === 0;
  };
  need(sameAsBaseline(PATHS.policy, tool.policyBytes), "PK-TOOL-NOT-BASELINE", "this checkout's policy differs from the baseline commit's; run the tool from a checkout of the baseline");
  need(sameAsBaseline(PROMPT_PATH, tool.promptBytes), "PK-TOOL-NOT-BASELINE", "this checkout's reviewer prompt differs from the baseline commit's; run the tool from a checkout of the baseline");
  for (const [key, rel] of Object.entries(PATHS.schemas)) need(sameAsBaseline(rel, tool.schemaBytes[key]), "PK-TOOL-NOT-BASELINE", `this checkout's ${key} schema differs from the baseline commit's`);

  // 2. the approved task definition, from the baseline
  const taskNames = git(repoDir, ["ls-tree", "-r", "--name-only", "-z", baselineSha, "--", PATHS.tasksDir]).toString("utf8").split("\0").filter((n) => new RegExp(`^${PATHS.tasksDir}/${taskId}-[a-z0-9-]+\\.md$`).test(n));
  need(taskNames.length === 1, "PK-TASK-NOT-IN-BASELINE", `the baseline holds ${taskNames.length} task files for ${taskId}; exactly one is required (the task definition must not come from the worker's branch)`);
  const taskBlob = readBlobAtRevision(repoDir, baselineSha, taskNames[0]);
  const parsedTask = parseTaskFile(text(taskBlob));
  need(parsedTask.data, "PK-TASK", `the baseline's task file is unreadable: ${parsedTask.error}`);
  need(parsedTask.data.task_id === taskId, "PK-TASK", "the task file names a different task id");
  const taskSchema = validate(tool.schemas.task, parsedTask.data);
  need(taskSchema.valid, "PK-TASK", `the baseline's task file does not match the task schema: ${taskSchema.errors[0]}`);
  const headTaskBlob = readBlobAtRevision(repoDir, headSha, taskNames[0]);
  const taskMatchesHead = headTaskBlob !== null && Buffer.compare(headTaskBlob, taskBlob) === 0;

  // 3. the worker's report, from the head
  const reportRel = `${PATHS.runsDir}/${taskId}/${attemptId}/report.json`;
  const reportBlob = readBlobAtRevision(repoDir, headSha, reportRel);
  need(reportBlob !== null, "PK-NO-REPORT", `the head holds no run report at ${reportRel}`);
  need(reportBlob.length <= byRole.run_report.max, "PK-TOO-LARGE", "the run report is too large");
  const report = parseJson(reportBlob, "PK-REPORT", "the run report");
  const reportSchema = validate(tool.schemas.report, report);
  need(reportSchema.valid, "PK-REPORT", `the run report does not match the run-report schema: ${reportSchema.errors[0]}`);
  need(report.task_id === taskId && report.attempt_id === attemptId, "PK-REPORT", "the run report is for another task or attempt");
  // the report is a separate final commit, so the head may be a few commits after the commit the report describes; nothing but the report may differ
  const reportHead = report.head_sha;
  need(git(repoDir, ["cat-file", "-t", reportHead]).toString("utf8").trim() === "commit", "PK-REPORT-HEAD", "the report's head commit does not exist in this repository");
  try {
    git(repoDir, ["merge-base", "--is-ancestor", reportHead, headSha]);
  } catch {
    throw new PacketError("PK-REPORT-HEAD", "the report describes a commit that is not an ancestor of the head");
  }
  const afterReport = git(repoDir, ["diff", "--name-only", "-z", reportHead, headSha]).toString("utf8").split("\0").filter(Boolean);
  need(afterReport.every((p) => p === reportRel), "PK-REPORT-HEAD", "the branch changed files other than the report after the commit the report describes, so the report does not describe the head");

  // 4. the change, computed from git
  const changed = changedPaths(repoDir, mergeBase, headSha);
  const stats = numstat(repoDir, mergeBase, headSha);
  const paths = changed.map((c) => c.path).sort();
  const classification = classificationDoc(paths, tool.policy);
  const hitByPath = new Map(classification.hits.map((h) => [h.path, h]));
  const filesDoc = changed.slice().sort((a, b) => (a.path < b.path ? -1 : 1)).map((c) => {
    const h = hitByPath.get(c.path);
    const s = stats.get(c.path) ?? { additions: 0, deletions: 0 };
    return { path: c.path, status: c.status, additions: s.additions, deletions: s.deletions, class: h.class, restriction: h.restriction, categories: [...h.categories].sort() };
  });
  const totals = { files: filesDoc.length, additions: filesDoc.reduce((n, f) => n + f.additions, 0), deletions: filesDoc.reduce((n, f) => n + f.deletions, 0) };
  const changedDoc = {
    base_sha: baseSha,
    head_sha: headSha,
    merge_base_sha: mergeBase,
    totals,
    classification: { class: classification.class, restriction: classification.restriction, categories: classification.categories, control_plane_paths: classification.control_plane_paths, protected_paths: classification.protected_paths, immutable_paths: classification.immutable_paths },
    files: filesDoc,
  };
  const diffBuf = git(repoDir, ["-c", "core.quotePath=false", "diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "-U3", mergeBase, headSha]);
  need(diffBuf.length <= byRole.diff.max, "PK-TOO-LARGE", `the diff is ${diffBuf.length} bytes; the limit is ${byRole.diff.max}. A reviewer cannot judge a change it only partly sees: split the task`);
  const logRaw = git(repoDir, ["log", "--format=%H%x00%s%x1e", `${mergeBase}..${headSha}`]).toString("utf8").split("\x1e").map((r) => r.replace(/^\n/, "")).filter(Boolean);
  const commits = logRaw.map((r) => {
    const [sha, subject] = r.split("\0");
    return { sha, subject: (subject ?? "").slice(0, LIMITS.subjectChars) };
  });

  // 5. the CI evidence
  need(fs.existsSync(evidenceFile) && fs.statSync(evidenceFile).isFile(), "PK-NO-EVIDENCE", "the CI evidence file does not exist");
  const evidenceBuf = fs.readFileSync(evidenceFile);
  need(evidenceBuf.length <= byRole.ci_evidence.max, "PK-TOO-LARGE", "the CI evidence is too large");
  const evidence = parseJson(evidenceBuf, "PK-EVIDENCE", "the CI evidence");
  const evidenceSchema = validate(tool.schemas.evidence, evidence);
  need(evidenceSchema.valid, "PK-EVIDENCE", `the CI evidence does not match its schema: ${evidenceSchema.errors[0]}`);
  need(evidence.subject.head_sha === headSha, "PK-EVIDENCE", "the CI evidence is about a different commit than the head");
  // completeness and the CI facts are DERIVED here from the data inside the evidence and the baseline's expectations; the verdict
  // the document states about itself is only compared with them, never believed (OPS-0006)
  const ci = deriveCi(evidence, { expected: trustedExpectations(tool, headSha, evidence.repository), changedPaths: paths, baseSha, mergeBaseSha: mergeBase, headSha });
  need(ci.present, "PK-EVIDENCE", "the CI evidence holds no GitHub run data");
  need(ci.headSha === headSha, "PK-EVIDENCE", "the GitHub run in the evidence was for a different commit than the head");
  const inconsistent = ci.problems.filter((p) => p.kind === "inconsistent");
  need(inconsistent.length === 0, "PK-EVIDENCE", `the CI evidence contradicts its own data or the baseline's expectations: ${inconsistent.slice(0, 3).map((p) => p.message).join("; ")}`);
  need(evidence.verdict.ci_passed === ci.passed, "PK-EVIDENCE", "the evidence's own verdict disagrees with its consistency checks");

  // the baseline must predate the work and hold the approved task; a weaker one is refused unless an exception is recorded
  const bl = baselineAssessment({ repoDir, baselineSha, baseSha, headSha, changed, taskPath: taskNames[0], taskBlob, evidence });
  let exception = null;
  if (baselineException !== null && baselineException !== undefined) {
    need(/^HD-[0-9]{4}$/.test(baselineException), "PK-BASELINE-EXCEPTION", "a baseline exception must name a human decision such as HD-0017");
    need(!bl.independent, "PK-BASELINE-EXCEPTION", "the baseline is independent, so no exception is needed or allowed");
    need(decisionRecorded(tool.humanDecisionsText, baselineException), "PK-BASELINE-EXCEPTION", `${baselineException} is not in the baseline's decision log`);
    exception = { approval_reference: baselineException, reasons: bl.reasons.slice(0, 6).map((r) => r.slice(0, 300)) };
  }
  need(bl.independent || exception !== null, "PK-BASELINE-NOT-INDEPENDENT", `the baseline is not independent (${bl.reasons.join("; ")}), so a review from it is not independent verification. Use a baseline that predates the work and holds the approved task definition, or record an explicit exception with a decision`);

  // 6. assemble, scan, write
  const files = new Map();
  files.set(byRole.reviewer_instructions.path, Buffer.from(extractPrompt(text(tool.promptBytes)).body, "utf8"));
  files.set(byRole.decision_schema.path, tool.schemaBytes.decision);
  files.set(byRole.task.path, taskBlob);
  files.set(byRole.policy.path, tool.policyBytes);
  files.set(byRole.requirements.path, Buffer.from(requirementsExcerpt(tool.requirementsText, parsedTask.data.requirement_refs), "utf8"));
  files.set(byRole.ci_evidence.path, evidenceBuf);
  files.set(byRole.changed_files.path, json(changedDoc));
  files.set(byRole.run_report.path, reportBlob);
  files.set(byRole.diff.path, diffBuf);
  files.set(byRole.commits.path, json(commits));
  const total = [...files.values()].reduce((n, b) => n + b.length, 0);
  need(total <= LIMITS.totalBytes, "PK-TOO-LARGE", "the packet is larger than the total limit");
  for (const spec of LAYOUT) need(files.get(spec.path).length <= spec.max, "PK-TOO-LARGE", `${spec.path} is larger than its limit`);
  const sensitive = sensitiveProblems(files, tool.policy);
  need(sensitive.length === 0, "PK-SENSITIVE", sensitive.map((p) => p.message).join("; "));

  const prompt = extractPrompt(text(tool.promptBytes));
  const manifest = {
    schema_version: "1",
    packet_kind: "review_packet",
    tool: PACKET_TOOL,
    trust: { authenticated: false, note: "A manifest cannot prove who built it. Build the packet yourself from a checkout of the baseline, check it with the verify command, and never accept a packet built by the branch under review." },
    subject: { task_id: taskId, attempt_id: attemptId, branch: null, base_sha: baseSha, head_sha: headSha, merge_base_sha: mergeBase, report_head_sha: reportHead },
    trusted_baseline: {
      commit: baselineSha, policy_version: tool.policy.policy_version, prompt_version: prompt.version, task_file_matches_head: taskMatchesHead,
      relation_to_head: bl.relation_to_head, reviewed_paths_in_baseline: bl.reviewed_paths_in_baseline, base_has_task_file: bl.base_has_task_file,
      relation_to_base: bl.relation_to_base, commits_after_base: bl.commits_after_base, non_preparation_paths: bl.non_preparation_paths, history_verified: bl.history_verified,
      scope_established_by_evidence: bl.scope_established_by_evidence, independent: bl.independent, exception,
    },
    ci: { run_id: ci.runId, conclusion: ci.conclusion, ci_passed: ci.passed, ci_trust_basis: ci.trustBasis, evidence_complete: ci.complete, evidence_legacy: ci.legacy },
    change: { files_changed: totals.files, additions: totals.additions, deletions: totals.deletions, diff_bytes: diffBuf.length },
    files: LAYOUT.map((spec) => ({ path: spec.path, role: spec.role, trust: spec.trust, sha256: sha256(files.get(spec.path)), bytes: files.get(spec.path).length })),
    indicators: indicatorList(files),
  };
  manifest.subject.branch = evidence.subject.branch ?? null;
  const manifestSchema = validate(tool.schemas.packet, manifest);
  need(manifestSchema.valid, "PK-MANIFEST", `internal error: the manifest does not match its schema: ${manifestSchema.errors[0]}`);

  fs.mkdirSync(outDir);
  fs.mkdirSync(path.join(outDir, "trusted"));
  fs.mkdirSync(path.join(outDir, "untrusted"));
  for (const spec of LAYOUT) fs.writeFileSync(path.join(outDir, ...spec.path.split("/")), files.get(spec.path), { mode: 0o644, flag: "wx" });
  const manifestBuf = json(manifest);
  fs.writeFileSync(path.join(outDir, "MANIFEST.json"), manifestBuf, { mode: 0o644, flag: "wx" });
  return { manifest, manifestSha256: sha256(manifestBuf), outDir };
}

/* --------------------------------------------------------------------- verify */

/**
 * Check a packet from the packet alone, plus the trusted files of this checkout.
 * Never throws for a bad packet: every problem is returned as { code, message }.
 * @returns {{ ok: boolean, errors: {code:string,message:string}[], manifest: object|null, data: object|null }}
 */
export function verifyPacket(packetDir, { toolRoot = DEFAULT_ROOT, expectBaseline = null } = {}) {
  const errors = [];
  const err = (code, message) => errors.push({ code, message });
  const fail = () => ({ ok: false, errors, manifest: null, data: null });

  let st;
  try {
    st = fs.lstatSync(packetDir);
  } catch {
    err("PK-MISSING", "the packet directory does not exist");
    return fail();
  }
  if (!st.isDirectory() || st.isSymbolicLink()) {
    err("PK-ENTRY", "the packet must be a real directory");
    return fail();
  }

  // exactly the expected entries, no links, no extras
  const found = new Map();
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(packetDir, rel)).sort()) {
      const r = rel ? `${rel}/${name}` : name;
      const s = fs.lstatSync(path.join(packetDir, r));
      if (s.isSymbolicLink() || !(s.isFile() || s.isDirectory())) err("PK-ENTRY", `${r} is a symbolic link or a special file`);
      else if (s.isDirectory()) {
        if (rel === "" && (name === "trusted" || name === "untrusted")) walk(r);
        else err("PK-EXTRA-FILE", `unexpected directory ${r}`);
      } else found.set(r, s.size);
    }
  };
  walk("");
  const expected = new Set(["MANIFEST.json", ...LAYOUT.map((f) => f.path)]);
  for (const name of found.keys()) if (!expected.has(name)) err("PK-EXTRA-FILE", `unexpected file ${name}`);
  for (const name of expected) if (!found.has(name)) err("PK-MISSING-FILE", `missing file ${name}`);
  if (!found.has("MANIFEST.json") || found.get("MANIFEST.json") > LIMITS.manifestBytes) {
    if (found.has("MANIFEST.json")) err("PK-TOO-LARGE", "MANIFEST.json is too large");
    return fail();
  }

  let tool;
  try {
    tool = loadToolContext(toolRoot);
  } catch {
    err("PK-TOOL", "this checkout lacks the policy, schemas or reviewer prompt that the packet is judged by");
    return fail();
  }

  let manifest;
  try {
    manifest = JSON.parse(text(fs.readFileSync(path.join(packetDir, "MANIFEST.json"))));
  } catch {
    err("PK-MANIFEST", "MANIFEST.json is not valid JSON");
    return fail();
  }
  const ms = validate(tool.schemas.packet, manifest);
  if (!ms.valid) {
    err("PK-MANIFEST", `MANIFEST.json does not match its schema: ${ms.errors[0]}`);
    return fail();
  }

  // every file: present, within its limit, and exactly the bytes the manifest hashed
  const files = new Map();
  let total = 0;
  for (const spec of LAYOUT) {
    const entry = manifest.files.find((f) => f.role === spec.role);
    if (!entry || entry.path !== spec.path || entry.trust !== spec.trust) {
      err("PK-LAYOUT", `the manifest does not list ${spec.path} as ${spec.role} (${spec.trust})`);
      continue;
    }
    if (!found.has(spec.path)) continue;
    if (found.get(spec.path) > spec.max) {
      err("PK-TOO-LARGE", `${spec.path} is larger than its limit of ${spec.max} bytes`);
      continue;
    }
    const buf = fs.readFileSync(path.join(packetDir, ...spec.path.split("/")));
    total += buf.length;
    files.set(spec.path, buf);
    if (sha256(buf) !== entry.sha256 || buf.length !== entry.bytes) err("PK-HASH-MISMATCH", `${spec.path} does not match the hash or size recorded in the manifest (it was changed after the manifest was written)`);
  }
  if (total > LIMITS.totalBytes) err("PK-TOO-LARGE", "the packet is larger than the total limit");
  if (errors.length) return fail();

  const get = (role) => files.get(byRole[role].path);
  const parsed = {};
  for (const role of ["policy", "ci_evidence", "changed_files", "run_report", "commits"]) {
    try {
      parsed[role] = JSON.parse(text(get(role)));
    } catch {
      err("PK-PARSE", `${byRole[role].path} is not valid JSON`);
    }
  }
  if (errors.length) return fail();

  if (expectBaseline !== null && manifest.trusted_baseline.commit !== expectBaseline) err("PK-BASELINE-MISMATCH", "the packet names a different baseline commit than the one expected");

  // the trusted files must be the ones of this checkout (the baseline), not copies that anyone could have edited
  if (Buffer.compare(get("policy"), tool.policyBytes) !== 0) err("PK-POLICY-NOT-TRUSTED", "trusted/policy.json differs from this checkout's policy");
  if (parsed.policy.policy_version !== manifest.trusted_baseline.policy_version) err("PK-POLICY-NOT-TRUSTED", "the manifest's policy version is not the policy's version");
  let prompt = null;
  try {
    prompt = extractPrompt(text(tool.promptBytes));
  } catch (e) {
    err("PK-PROMPT", e.message);
  }
  if (prompt) {
    if (text(get("reviewer_instructions")) !== prompt.body) err("PK-INSTRUCTIONS-NOT-TRUSTED", "trusted/reviewer-instructions.md differs from this checkout's reviewer prompt");
    if (prompt.version !== manifest.trusted_baseline.prompt_version) err("PK-INSTRUCTIONS-NOT-TRUSTED", "the manifest's prompt version is not the prompt's version");
  }
  if (Buffer.compare(get("decision_schema"), tool.schemaBytes.decision) !== 0) err("PK-SCHEMA-NOT-TRUSTED", "trusted/review-decision.schema.json differs from this checkout's schema");
  const taskId = manifest.subject.task_id;
  const ownTask = toolTaskFile(tool, taskId);
  if (ownTask === null) err("PK-TASK-NOT-TRUSTED", `this checkout holds no single task file for ${taskId}, so the packet's task cannot be checked against a trusted source`);
  else if (Buffer.compare(ownTask, get("task")) !== 0) err("PK-TASK-NOT-TRUSTED", "trusted/task.md differs from this checkout's task file");
  const parsedTask = parseTaskFile(text(get("task")));
  if (!parsedTask.data) err("PK-TASK", `trusted/task.md is unreadable: ${parsedTask.error}`);
  else {
    if (parsedTask.data.task_id !== taskId) err("PK-TASK", "trusted/task.md is for another task");
    try {
      if (text(get("requirements")) !== requirementsExcerpt(tool.requirementsText, parsedTask.data.requirement_refs)) err("PK-REQUIREMENTS-NOT-TRUSTED", "trusted/requirements.md differs from the lines of this checkout's requirements that the task cites");
    } catch (e) {
      err("PK-REQUIREMENTS-NOT-TRUSTED", e.message);
    }
  }

  // the change: totals, classification and the patch must agree with each other
  const cf = parsed.changed_files;
  if (cf.head_sha !== manifest.subject.head_sha || cf.base_sha !== manifest.subject.base_sha || cf.merge_base_sha !== manifest.subject.merge_base_sha) err("PK-CHANGE", "trusted/changed-files.json names other revisions than the manifest");
  const listed = Array.isArray(cf.files) ? cf.files : [];
  const paths = listed.map((f) => f.path).sort();
  const cls = classificationDoc(paths, parsed.policy);
  const hit = new Map(cls.hits.map((h) => [h.path, h]));
  for (const f of listed) {
    const h = hit.get(f.path);
    if (!h || h.class !== f.class || h.restriction !== f.restriction || JSON.stringify([...h.categories].sort()) !== JSON.stringify(f.categories)) err("PK-CLASSIFICATION", `${f.path} is classified differently than the policy classifies it`);
  }
  const sums = { files: listed.length, additions: listed.reduce((n, f) => n + (Number.isInteger(f.additions) ? f.additions : 0), 0), deletions: listed.reduce((n, f) => n + (Number.isInteger(f.deletions) ? f.deletions : 0), 0) };
  if (!cf.totals || cf.totals.files !== sums.files || cf.totals.additions !== sums.additions || cf.totals.deletions !== sums.deletions) err("PK-CHANGE", "the totals in changed-files.json do not match its list");
  if (manifest.change.files_changed !== sums.files || manifest.change.additions !== sums.additions || manifest.change.deletions !== sums.deletions || manifest.change.diff_bytes !== get("diff").length) err("PK-CHANGE", "the manifest's change summary does not match the packet");
  const cc = cf.classification;
  if (!cc || cc.class !== cls.class || cc.restriction !== cls.restriction || JSON.stringify(cc.control_plane_paths) !== JSON.stringify(cls.control_plane_paths) || JSON.stringify(cc.protected_paths) !== JSON.stringify(cls.protected_paths) || JSON.stringify(cc.immutable_paths) !== JSON.stringify(cls.immutable_paths) || JSON.stringify(cc.categories) !== JSON.stringify(cls.categories)) err("PK-CLASSIFICATION", "the overall classification in changed-files.json is not the one the policy computes");
  const inPatch = pathsInPatch(text(get("diff")));
  const same = inPatch.size === paths.length && paths.every((p) => inPatch.has(p));
  if (!same) err("PK-DIFF-FILES", "the files in diff.patch are not exactly the files in changed-files.json");

  // the CI evidence: schema, commit, and a verdict that its own data supports
  let ciAssessment = null;
  const es = validate(tool.schemas.evidence, parsed.ci_evidence);
  if (!es.valid) err("PK-EVIDENCE", `trusted/ci-evidence.json does not match its schema: ${es.errors[0]}`);
  else {
    // derived from the data inside the evidence, the changed paths computed above and the baseline's own workflow; the document's
    // verdict is only compared with the derivation
    const ci = deriveCi(parsed.ci_evidence, { expected: trustedExpectations(tool, manifest.subject.head_sha, parsed.ci_evidence.repository), changedPaths: paths, baseSha: manifest.subject.base_sha, mergeBaseSha: manifest.subject.merge_base_sha, headSha: manifest.subject.head_sha });
    ciAssessment = ci;
    if (parsed.ci_evidence.subject.head_sha !== manifest.subject.head_sha) err("PK-EVIDENCE", "the CI evidence is about another commit than the packet's head");
    if (!ci.present) err("PK-EVIDENCE", "the CI evidence holds no GitHub run data");
    else {
      if (ci.headSha !== manifest.subject.head_sha) err("PK-EVIDENCE", "the GitHub run in the evidence was for another commit than the packet's head");
      for (const p of ci.problems.filter((x) => x.kind === "inconsistent")) err("PK-EVIDENCE-INCONSISTENT", p.message);
      if (parsed.ci_evidence.verdict.ci_passed !== ci.passed) err("PK-EVIDENCE-INCONSISTENT", "the evidence's verdict says one thing and its own consistency checks say another");
      if (manifest.ci.ci_passed !== ci.passed || manifest.ci.run_id !== ci.runId || manifest.ci.conclusion !== ci.conclusion || manifest.ci.ci_trust_basis !== ci.trustBasis || manifest.ci.evidence_complete !== ci.complete || manifest.ci.evidence_legacy !== ci.legacy) err("PK-EVIDENCE-INCONSISTENT", "the manifest's CI summary does not match what is derived from the evidence");
    }
  }

  // the worker's report and commit list
  const rs = validate(tool.schemas.report, parsed.run_report);
  if (!rs.valid) err("PK-REPORT", `untrusted/run-report.json does not match the run-report schema: ${rs.errors[0]}`);
  else if (parsed.run_report.task_id !== taskId || parsed.run_report.attempt_id !== manifest.subject.attempt_id || parsed.run_report.head_sha !== manifest.subject.report_head_sha) err("PK-REPORT", "the run report is for another task, attempt or commit than the manifest names");
  if (!Array.isArray(parsed.commits) || parsed.commits.length === 0 || parsed.commits[0].sha !== manifest.subject.head_sha || !parsed.commits.every((c) => /^[0-9a-f]{40}$/.test(c.sha) && typeof c.subject === "string")) err("PK-COMMITS", "untrusted/commits.json does not start with the head commit");

  // defence in depth: the same scans as at build time, and the indicator counts must be reproducible
  for (const p of sensitiveProblems(files, parsed.policy)) err(p.code, p.message);
  if (JSON.stringify(indicatorList(files)) !== JSON.stringify(manifest.indicators)) err("PK-INDICATORS", "the manifest's instruction-like-text counts do not match the files");

  // the baseline's claims must agree with each other (the builder computed them from git; a verifier without the repository cannot)
  const tbm = manifest.trusted_baseline;
  const rel = tbm.relation_to_base;
  const prepared = rel === "is_base" || rel === "task_preparation_only";
  if ((rel === "is_base") !== (tbm.commit === manifest.subject.base_sha)) err("PK-BASELINE-INCONSISTENT", "the manifest's relation to the base contradicts its own commit ids: the baseline is the base exactly when the two commits are equal");
  if ((rel === "is_base" && tbm.commits_after_base !== 0) || (rel === "task_preparation_only" && tbm.commits_after_base < 1)) err("PK-BASELINE-INCONSISTENT", "the manifest's count of commits between the base and the baseline contradicts its relation to the base");
  if (prepared && (tbm.non_preparation_paths.length > 0 || !tbm.history_verified)) err("PK-BASELINE-INCONSISTENT", "the manifest calls the baseline the base or a task-definition preparation, but lists other paths in its history or says the history was not verified");
  if ((rel === "other_changes_in_history" && !tbm.history_verified) || (rel === "not_a_descendant_of_base" && tbm.history_verified)) err("PK-BASELINE-INCONSISTENT", "the manifest's claim about whether the baseline's history was read contradicts its relation to the base");
  if (tbm.independent !== (tbm.relation_to_head === "ancestor_of_head" && prepared && tbm.history_verified && tbm.reviewed_paths_in_baseline === 0)) err("PK-BASELINE-INCONSISTENT", "the manifest calls the baseline independent or not independent against its own relations, history and path count");
  if (tbm.exception !== null) {
    if (tbm.independent) err("PK-BASELINE-INCONSISTENT", "the manifest records a baseline exception for an independent baseline");
    if (!decisionRecorded(tool.humanDecisionsText, tbm.exception.approval_reference)) err("PK-BASELINE-EXCEPTION", `${tbm.exception.approval_reference} is not in this checkout's decision log`);
  }
  const evidenceTb = parsed.ci_evidence && parsed.ci_evidence.trusted_base;
  if (tbm.scope_established_by_evidence !== Boolean(evidenceTb && evidenceTb.task_scope && evidenceTb.task_scope.source === "base_revision")) err("PK-BASELINE-INCONSISTENT", "the manifest's scope claim does not match the evidence's trusted-base section");

  if (errors.length) return fail();
  return { ok: true, errors, manifest, data: { policy: parsed.policy, task: parsedTask.data, taskBody: parsedTask.body, report: parsed.run_report, evidence: parsed.ci_evidence, ci: ciAssessment, changedFiles: cf, commits: parsed.commits, classification: cls, tool } };
}
