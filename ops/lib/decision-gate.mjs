// Deterministic decision gate (OPS-0004). Offline: no model, no network, no credential, no clock, no randomness.
//
// Input: a review packet, a reviewer's structured decision, and the trusted policy of the checkout this runs from.
// Output: one result, computed only from those inputs, so the same inputs always give the same result.
//
//   REVIEW_INVALID                        the packet or the decision cannot be relied on (forged or stale binding, altered evidence,
//                                         same session, contradiction with the evidence, a lowered risk class, a prohibited proposal, ...)
//   REVIEW_REJECTED                       a valid review of work that must not go on (reviewer said reject, an immutable path or class C
//                                         work, no attempts left)
//   REQUIRES_CORRECTIONS                  a valid review of work that must be corrected (reviewer asked for changes, CI failed, files
//                                         outside the task's scope)
//   REVIEW_VALID_HUMAN_APPROVAL_REQUIRED  the review is valid. A human still decides everything that follows.
//
// The gate NEVER merges, deploys, authorises a sensitive change or starts a task, whatever the result: those fields are fixed
// false and a reviewer's "approve" is advice, recorded as not binding. It can only add reasons; it cannot remove one.

import fs from "node:fs";
import path from "node:path";
import { CLASS_ORDER, maxClass, matchesAny, pathPermission, staticPrefix, taskPreflight } from "./policy.mjs";
import { deriveCi, sha256, verifyPacket } from "./review-packet.mjs";
import { instructionLineCount, prohibitedCommandIds, secretShapes } from "./review-text.mjs";
import { DEFAULT_ROOT, PATHS, validateDecisionDocument } from "../validate-memory.mjs";

export const GATE_TOOL = { name: "ops/decision-gate", version: "1.0.0" };
export const RESULTS = {
  VALID: "REVIEW_VALID_HUMAN_APPROVAL_REQUIRED",
  REJECTED: "REVIEW_REJECTED",
  INVALID: "REVIEW_INVALID",
  CORRECTIONS: "REQUIRES_CORRECTIONS",
};
const DECISION_MAX_BYTES = 300_000;
const OUTCOME_ORDER = ["invalid", "rejected", "corrections"];
const OUTCOME_RESULT = { invalid: RESULTS.INVALID, rejected: RESULTS.REJECTED, corrections: RESULTS.CORRECTIONS, human: RESULTS.VALID };

/** The machinery that judges reviewers and controls CI. A reviewer may not propose work on it: a human writes those tasks. */
export const JUDGE_OWNED_GLOBS = [
  ".github/**",
  "CLAUDE.md",
  "docs/project-memory/policy/**",
  "docs/project-memory/schemas/**",
  "docs/project-memory/reviewer/**",
  "ops/validate-memory.mjs",
  "ops/decision-gate.mjs",
  "ops/review-packet.mjs",
  "ops/ci-evidence.mjs",
  "ops/lib/**",
];

/** Risk categories that always need a human: money, identity, data, security, production, spending, settings. */
const SENSITIVE_CATEGORIES = [
  "loyalty_or_finance_logic", "auth_or_sessions", "rls_or_authorization", "database_schema", "customer_data", "secrets_or_credentials",
  "production_deploy", "billing_or_paid_service", "infrastructure_settings", "destructive_operation", "external_api_integration",
];

function taskIdsOf(root) {
  const dir = path.join(root, PATHS.tasksDir);
  const ids = new Set();
  if (fs.existsSync(dir)) for (const n of fs.readdirSync(dir)) {
    const m = /^([A-Z]{3,5}-[0-9]{4})-/.exec(n);
    if (m) ids.add(m[1]);
  }
  return ids;
}

/** Does a proposed glob overlap a glob owned by the judging machinery? Conservative, by literal prefix, like the policy's own pre-flight. */
function overlapsJudgeOwned(glob) {
  const prefix = staticPrefix(glob);
  if (prefix === "") return true; // starts with a wildcard: could be anything
  return JUDGE_OWNED_GLOBS.some((owned) => {
    const op = staticPrefix(owned);
    return prefix.startsWith(op) || op.startsWith(prefix) || matchesAny([owned], prefix);
  });
}

function decisionStrings(decision) {
  const out = [decision.summary, decision.next_step.rationale, decision.risk_assessment.rationale, ...decision.questions_for_human, ...decision.memory_update_suggestions];
  for (const f of decision.findings) out.push(f.title, f.detail, f.recommendation, f.evidence_ref);
  for (const a of decision.verification_assessment.acceptance_criteria) out.push(a.note);
  const nt = decision.next_step.next_task;
  if (nt) {
    out.push(nt.title, nt.objective, nt.prompt_markdown, ...nt.out_of_scope);
    for (const a of nt.acceptance_criteria) out.push(a.statement, a.command ?? "");
    for (const c of nt.required_checks) out.push(c.description, c.command);
  }
  return out.filter((s) => typeof s === "string");
}

function checkProposal(nt, { policy, task, add, human }) {
  const commands = [...nt.acceptance_criteria.map((a) => a.command).filter((c) => typeof c === "string"), ...nt.required_checks.map((c) => c.command)];
  const prohibited = prohibitedCommandIds(commands.join("\n"));
  if (prohibited.length) add("invalid", "DG-PROPOSAL-PROHIBITED-OPERATION", `the proposed next task contains command shapes that a task may never contain (${prohibited.join(", ")}): pushing, merging, deploying, publishing, destructive or remote-shell operations belong to a human`);
  const promptText = [nt.title, nt.objective, nt.prompt_markdown, ...nt.out_of_scope].join("\n");
  if (instructionLineCount(promptText) > 0) add("invalid", "DG-PROPOSAL-INSTRUCTION-LIKE-TEXT", "the proposed next task's text contains instruction-like phrases aimed at a model (for example 'ignore the policy'); a proposal is data, not a way to carry instructions forward");
  const judge = nt.files_allowed.filter(overlapsJudgeOwned);
  if (judge.length) add("invalid", "DG-PROPOSAL-TOUCHES-JUDGE", `the proposed next task's files_allowed reaches the machinery that judges reviewers or controls CI (${judge.slice(0, 4).join(", ")}); a human writes tasks for those paths`);
  const pre = taskPreflight(nt.files_allowed, policy);
  if (pre.restriction === "protected" || pre.restriction === "control_plane") human("DG-HUMAN-PROPOSAL-SENSITIVE-SCOPE", `the proposed next task reaches ${pre.restriction.replace("_", "-")} paths, so a human must approve it before it runs`);
  if (!nt.depends_on.includes(task.task_id)) add("warning", "DG-PROPOSAL-INDEPENDENT", `the proposed next task does not depend on ${task.task_id}`);
}

/**
 * Evaluate one reviewer decision against one packet.
 * @param {object} o
 * @param {string} o.packetDir      the review packet directory
 * @param {string} o.decisionFile   the reviewer's decision (JSON)
 * @param {string} [o.toolRoot]     the checkout this runs from: it supplies the trusted policy, schemas, prompt and task file
 * @param {string|null} [o.expectBaseline]  the baseline commit the caller expects the packet to name
 */
export function evaluateDecision({ packetDir, decisionFile, toolRoot = DEFAULT_ROOT, expectBaseline = null }) {
  const reasons = [];
  const warnings = [];
  const humanReasons = [];
  const add = (outcome, code, message) => (outcome === "warning" ? warnings.push({ code, message }) : reasons.push({ outcome, code, message }));
  const human = (code, message) => humanReasons.push({ code, message });
  let manifestSha = null;
  let decisionSha = null;
  let manifest = null;
  let decision = null;
  let computed = null;

  const finish = () => {
    const outcome = OUTCOME_ORDER.find((o) => reasons.some((r) => r.outcome === o)) ?? "human";
    const rank = (r) => OUTCOME_ORDER.indexOf(r.outcome);
    reasons.sort((a, b) => rank(a) - rank(b) || (a.code < b.code ? -1 : a.code > b.code ? 1 : a.message < b.message ? -1 : a.message > b.message ? 1 : 0));
    warnings.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : a.message < b.message ? -1 : 1));
    humanReasons.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : a.message < b.message ? -1 : 1));
    return {
      gate: GATE_TOOL,
      result: OUTCOME_RESULT[outcome],
      task_id: manifest ? manifest.subject.task_id : null,
      attempt_id: manifest ? manifest.subject.attempt_id : null,
      head_sha: manifest ? manifest.subject.head_sha : null,
      reviewer_verdict: decision ? decision.verdict : null,
      reasons,
      warnings,
      human_approval_required: true,
      human_approval_reasons: humanReasons,
      reviewer_approval_is_binding: false,
      automation: { merge: false, deploy: false, authorize_sensitive_change: false, launch_task: false },
      computed,
      packet_manifest_sha256: manifestSha,
      decision_sha256: decisionSha,
    };
  };

  human("DG-HUMAN-ALWAYS", "the gate only validates: merging, deploying, authorising a sensitive change and starting another task are never done by it, and a reviewer's approval is advice");

  // 1. the packet must be what its manifest says, and its trusted files must be this checkout's
  const pv = verifyPacket(packetDir, { toolRoot, expectBaseline });
  if (!pv.ok) {
    for (const e of pv.errors) add("invalid", e.code, e.message);
    return finish();
  }
  manifest = pv.manifest;
  manifestSha = sha256(fs.readFileSync(path.join(packetDir, "MANIFEST.json")));
  const { policy, task, report, evidence, changedFiles, classification, tool } = pv.data;

  // 2. the decision: readable, bounded, a regular file
  let buf = null;
  try {
    const st = fs.lstatSync(decisionFile);
    if (!st.isFile() || st.isSymbolicLink()) add("invalid", "DG-DECISION-READ", "the decision must be a regular file");
    else if (st.size > DECISION_MAX_BYTES) add("invalid", "DG-DECISION-TOO-LARGE", `the decision is larger than ${DECISION_MAX_BYTES} bytes`);
    else buf = fs.readFileSync(decisionFile);
  } catch {
    add("invalid", "DG-DECISION-READ", "the decision file cannot be read");
  }
  if (buf === null) return finish();
  decisionSha = sha256(buf);
  try {
    decision = JSON.parse(buf.toString("utf8"));
  } catch {
    add("invalid", "DG-DECISION-PARSE", "the decision is not valid JSON");
    return finish();
  }
  if (decision === null || typeof decision !== "object" || Array.isArray(decision)) {
    add("invalid", "DG-DECISION-PARSE", "the decision must be a JSON object");
    decision = null;
    return finish();
  }

  // 3. the project's own decision validator: schema, ids, runtime, verdict and next-step consistency, class floor, task proposals
  const ctx = { schemas: tool.schemas, policy, tasks: new Map([[task.task_id, task]]), taskIds: new Set([...taskIdsOf(toolRoot), task.task_id]) };
  const findings = validateDecisionDocument(decision, ctx);
  for (const f of findings) add(f.severity === "error" ? "invalid" : "warning", f.code, f.message);
  if (findings.some((f) => f.code === "DECISION-SCHEMA")) {
    decision = { verdict: null };
    return finish();
  }

  // 4. binding: this decision is about THIS packet
  const file = (role) => manifest.files.find((f) => f.role === role);
  const subj = manifest.subject;
  if (decision.task_id !== subj.task_id) add("invalid", "DG-BIND-TASK", "the decision is about another task than the packet");
  if (decision.attempt_id !== subj.attempt_id) add("invalid", "DG-BIND-ATTEMPT", "the decision is about another attempt than the packet");
  if (decision.reviewed.head_sha !== subj.head_sha) add("invalid", "DG-BIND-HEAD", "the decision names another commit than the packet's head (a forged or stale reference)");
  if (decision.reviewed.report_sha256 !== file("run_report").sha256) add("invalid", "DG-BIND-REPORT", "the decision's report hash is not the hash of the packet's run report");
  if (decision.reviewed.diff_sha256 !== file("diff").sha256) add("invalid", "DG-BIND-DIFF", "the decision's diff hash is not the hash of the packet's diff");
  if (decision.reviewed.ci_result_sha256 !== file("ci_evidence").sha256) add("invalid", "DG-BIND-CI", "the decision's CI evidence hash is not the hash of the packet's CI evidence");
  if (decision.reviewed.policy_version !== manifest.trusted_baseline.policy_version) add("invalid", "DG-BIND-POLICY", "the decision was made under another policy version than the packet's");
  if (decision.reviewed.prompt_version !== manifest.trusted_baseline.prompt_version) add("invalid", "DG-BIND-PROMPT", "the decision was made under another reviewer prompt version than the packet's");

  // 5. role separation, from the identifiers: a mechanical check, not a boundary
  const rev = decision.reviewer.session;
  const dev = report.session;
  if (!rev.id || !dev.id) add("invalid", "DG-SESSION-UNVERIFIED", "the reviewer's or the worker's session identifier is missing, so separation between them cannot be verified");
  else if (rev.id === dev.id || (rev.url && dev.url && rev.url === dev.url)) add("invalid", "DG-SESSION-SAME", "the reviewer session is the session that did the work; a reviewer must be a separate session");

  // 6. what GitHub's data says, recomputed, against what the reviewer claims
  const ci = deriveCi(evidence);
  const ciStatus = ci.passed ? "passed" : "failed";
  if (decision.verification_assessment.ci_status !== ciStatus) add("invalid", "DG-CI-CONTRADICTION", `the decision says CI ${decision.verification_assessment.ci_status}, but the evidence (GitHub's data, recomputed) says ${ciStatus}`);
  if (evidence.verdict.ci_trust_basis !== "ci_definition_unchanged_from_base") human("DG-HUMAN-CI-DEFINITION", `CI's own definition is not shown to be unchanged from the base (${evidence.verdict.ci_trust_basis}), so a green result is not evidence about those changes`);
  if (!evidence.verdict.evidence_complete) add("warning", "DG-EVIDENCE-INCOMPLETE", "the CI evidence is incomplete (it lacks the trusted-base section or the GitHub data)");

  // 7. risk: the policy computes it from the actual changed paths; the reviewer may raise it, never lower it
  const computedClass = maxClass(classification.class, task.declared_risk_class, report.risk.declared_class);
  if (CLASS_ORDER[decision.risk_assessment.advised_class] < CLASS_ORDER[computedClass]) add("invalid", "DG-CLASS-DOWNGRADE", `the reviewer advised class ${decision.risk_assessment.advised_class}, below class ${computedClass} that the policy computes from the actual changed paths and the declared classes`);
  const missingCategories = classification.categories.filter((c) => !decision.risk_assessment.categories.includes(c));
  if (missingCategories.length) add("warning", "DG-CATEGORIES-MISSING", `the reviewer did not list categories that the policy derives from the changed paths: ${missingCategories.join(", ")}`);

  // 8. facts about the work, computed from the packet, whatever the reviewer concluded
  if (classification.immutable_paths.length) add("rejected", "DG-IMMUTABLE-PATH", `the change touches ${classification.immutable_paths.length} immutable path(s) (credentials, original build photos or the logo); a worker may never change them`);
  if (computedClass === "C") add("rejected", "DG-CLASS-C", "the work is class C, which is never autonomous");
  const outOfScope = [];
  for (const f of changedFiles.files) {
    const p = pathPermission(f.path, task, policy);
    if (!p.allowed) outOfScope.push(`${f.path} (${p.reasons.join("; ")})`);
  }
  if (outOfScope.length) add("corrections", "DG-SCOPE", `${outOfScope.length} changed path(s) are outside the task's scope: ${outOfScope.slice(0, 5).join(" | ")}`);
  if (!ci.passed) add("corrections", "DG-CI-FAILED", "GitHub's data shows the CI run did not succeed");
  const attemptNumber = Number(/-a([0-9]+)$/.exec(subj.attempt_id)[1]);
  const maxAttempts = Math.min(task.max_attempts, policy.limits.max_attempts_per_task);
  if (attemptNumber > maxAttempts) add("rejected", "DG-ATTEMPT-LIMIT", `attempt ${attemptNumber} exceeds the limit of ${maxAttempts} attempts for this task`);
  const asksForRework = decision.verdict === "request_changes" || decision.next_step.action === "revise_same_task" || !ci.passed || outOfScope.length > 0;
  if (asksForRework && attemptNumber >= maxAttempts) add("rejected", "DG-NO-ATTEMPTS-LEFT", `the work needs correcting but attempt ${attemptNumber} of ${maxAttempts} was the last one allowed`);
  const reportedPaths = new Set(report.changed_files.map((c) => c.path));
  const reportPath = `${PATHS.runsDir}/${subj.task_id}/${subj.attempt_id}/report.json`;
  const actual = changedFiles.files.map((f) => f.path).filter((p) => p !== reportPath);
  if (actual.length !== reportedPaths.size || actual.some((p) => !reportedPaths.has(p))) add("warning", "DG-REPORT-FILES", "the worker's list of changed files is not the list git computed (the report is a claim)");
  if (report.base_sha !== subj.base_sha) add("warning", "DG-REPORT-BASE", "the worker's report names another base commit than the packet");
  if (manifest.indicators.length) {
    const n = manifest.indicators.reduce((s, i) => s + i.count, 0);
    add("warning", "DG-WORKER-TEXT-INSTRUCTION-LIKE", `${n} line(s) of worker-written text read like instructions to a reviewer; they were treated as data and the reviewer must have reported them`);
    human("DG-HUMAN-INSTRUCTION-LIKE-TEXT", "worker-written text contains instruction-like phrases; a human should look at them");
  }
  if (!manifest.trusted_baseline.task_file_matches_head) add("warning", "DG-TASK-CHANGED-BY-WORKER", "the task file at the head differs from the baseline's: the worker changed its own task definition (the baseline's was used)");

  // 9. the reviewer's verdict is advice; it maps to a result and never to an action
  if (decision.verdict === "reject") add("rejected", "DG-REVIEWER-REJECTED", "the reviewer rejected the work");
  else if (decision.verdict === "request_changes") add("corrections", "DG-REVIEWER-REQUESTED-CHANGES", "the reviewer asked for changes");
  else if (decision.verdict === "needs_human") human("DG-HUMAN-REVIEWER-NEEDS-HUMAN", "the reviewer says a decision belongs to a person");
  else human("DG-HUMAN-REVIEWER-APPROVE-IS-ADVICE", "the reviewer found no problem in the evidence it was given; that is advice, not an approval");

  // 10. what a human must approve, from the policy: a reviewer's approval cannot remove any of these
  if (policy.approval.human_approval_before_run_for_classes.includes(computedClass)) human("DG-HUMAN-CLASS", `class ${computedClass} work needs human approval before the run and before any merge`);
  for (const r of ["immutable", "control_plane", "protected"]) {
    const n = changedFiles.files.filter((f) => f.restriction === r).length;
    if (n > 0 && policy.approval.human_approval_before_merge_for_restrictions.includes(r)) human(`DG-HUMAN-${r.toUpperCase()}-PATHS`, `${n} changed path(s) are ${r.replace("_", "-")} under the policy, which a human must approve before any merge`);
  }
  const sensitive = [...new Set([...classification.categories, ...decision.risk_assessment.categories])].filter((c) => SENSITIVE_CATEGORIES.includes(c)).sort();
  if (sensitive.length) human("DG-HUMAN-SENSITIVE-CATEGORY", `the change or the review touches money, identity, data, security, production or spending categories (${sensitive.join(", ")}); a human must approve`);

  // 11. nothing the reviewer wrote may carry a credential, and a proposed next task is checked as if it were hostile input
  const secrets = secretShapes(decisionStrings(decision).join("\n"));
  if (secrets.length) add("invalid", "DG-SECRET-IN-DECISION", `the decision contains text shaped like a credential (${secrets.join(", ")})`);
  if (decision.next_step.next_task) checkProposal(decision.next_step.next_task, { policy, task, add, human });

  computed = {
    risk_class: computedClass,
    restriction: classification.restriction,
    categories: classification.categories,
    changed_files: changedFiles.files.length,
    attempt: { number: attemptNumber, max: maxAttempts },
    ci: { passed: ci.passed, run_id: ci.runId, conclusion: ci.conclusion, trust_basis: evidence.verdict.ci_trust_basis },
  };
  return finish();
}
