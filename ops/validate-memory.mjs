#!/usr/bin/env node
// Offline validator for the M1 project memory. Zero dependencies, no network, no credentials.
//
//   node ops/validate-memory.mjs                      validate the whole project memory
//   node ops/validate-memory.mjs --json               machine-readable result
//   node ops/validate-memory.mjs --file <path> [--kind task|report|decision]
//                                                     validate one task file, run report or reviewer decision
//   node ops/validate-memory.mjs --root <dir>         validate another checkout
//
// Exit codes: 0 valid, 1 validation errors, 2 usage or internal error.
//
// The validator is a library as well: validateMemory(), validateTaskDocument(), validateReportDocument()
// and validateDecisionDocument() are exported for tests and for the future orchestrator.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { lintSchema, validate } from "./lib/json-schema.mjs";
import {
  CLASS_ORDER,
  classifyPath,
  classifyPaths,
  matchesGlob,
  maxClass,
  pathPermission,
  staticPrefix,
  taskPreflight,
} from "./lib/policy.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = path.resolve(HERE, "..");
const MEM = "docs/project-memory";

export const PATHS = {
  policy: `${MEM}/policy/policy.json`,
  schemas: {
    task: `${MEM}/schemas/task.schema.json`,
    report: `${MEM}/schemas/run-report.schema.json`,
    decision: `${MEM}/schemas/review-decision.schema.json`,
    policy: `${MEM}/schemas/policy.schema.json`,
  },
  requirements: `${MEM}/requirements/MASTER_REQUIREMENTS.md`,
  architecture: `${MEM}/architecture/ARCHITECTURE.md`,
  adrDir: `${MEM}/architecture/adr`,
  roadmap: `${MEM}/roadmap/ROADMAP.md`,
  humanDecisions: `${MEM}/decisions/HUMAN_DECISIONS.md`,
  openQuestions: `${MEM}/decisions/OPEN_QUESTIONS.md`,
  tasksDir: `${MEM}/tasks`,
  runsDir: `${MEM}/runs`,
  reviewsDir: `${MEM}/reviews`,
  claudeMd: "CLAUDE.md",
};

/** Floors the policy file may not go below. Lowering one needs a change to this (control-plane) file too. */
const CATEGORY_FLOORS = {
  docs_only: "A", tests_only: "A",
  ui_public_site: "B", build_config: "B", dependencies: "B", ci_workflows: "B", ops_control_plane: "B", policy_or_schema: "B",
  auth_or_sessions: "B", database_schema: "B", rls_or_authorization: "B", loyalty_or_finance_logic: "B", customer_data: "B",
  external_api_integration: "B", scope_creep: "B", other: "B",
  secrets_or_credentials: "C", production_deploy: "C", billing_or_paid_service: "C", destructive_operation: "C", infrastructure_settings: "C",
};

/** Golden classification cases: the policy must keep classifying these paths exactly like this. */
const GOLDEN_PATHS = [
  [".github/workflows/ci.yml", "B", "control_plane"],
  ["ops/validate-memory.mjs", "B", "control_plane"],
  ["ops/tests/example.test.mjs", "B", "control_plane"],
  ["CLAUDE.md", "B", "control_plane"],
  ["docs/project-memory/policy/policy.json", "B", "control_plane"],
  ["docs/project-memory/schemas/task.schema.json", "B", "control_plane"],
  ["docs/project-memory/reviewer/REVIEWER_PROMPT.md", "B", "control_plane"],
  ["docs/project-memory/reviews/OPS-0001/OPS-0001-a1/review.json", "B", "protected"],
  ["docs/project-memory/requirements/MASTER_REQUIREMENTS.md", "B", "protected"],
  ["docs/project-memory/runs/OPS-0001/OPS-0001-a1/report.json", "A", "none"],
  ["docs/example-guide.md", "A", "none"],
  ["README.md", "A", "none"],
  ["src/app/page.tsx", "B", "protected"],
  ["public/builds/example.jpg", "B", "immutable"],
  ["public/logo.png", "B", "immutable"],
  ["package.json", "B", "protected"],
  ["package-lock.json", "B", "protected"],
  ["next.config.ts", "B", "protected"],
  [".env", "C", "immutable"],
  [".env.local", "C", "immutable"],
  [".env.example", "B", "protected"],
  ["vercel.json", "C", "protected"],
  ["supabase/migrations/0001_example.sql", "B", "protected"],
  ["creative/example/file.json", "B", "protected"],
  ["unclassified-area/file.bin", "B", "none"],
];

const STATUS_VOCABULARY = new Set(["not_started", "in_progress", "in_review", "done", "blocked"]);
const ADR_STATUSES = new Set(["proposed", "accepted", "superseded", "rejected"]);

/* ------------------------------------------------------------------ findings */

export class Findings {
  constructor() {
    this.items = [];
    this.files = new Set();
  }

  add(severity, code, file, message, line = null) {
    this.items.push({ severity, code, file, line, message });
  }

  error(code, file, message, line = null) {
    this.add("error", code, file, message, line);
  }

  warn(code, file, message, line = null) {
    this.add("warning", code, file, message, line);
  }

  get errors() {
    return this.items.filter((i) => i.severity === "error");
  }

  get warnings() {
    return this.items.filter((i) => i.severity === "warning");
  }
}

/* ------------------------------------------------------------------- helpers */

function readIfExists(root, rel) {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch {
    return null;
  }
}

function exists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

function listFiles(root, rel, accept = () => true) {
  const out = [];
  const start = path.join(root, rel);
  if (!fs.existsSync(start)) return out;
  const stat = fs.statSync(start);
  if (stat.isFile()) return accept(rel) ? [rel] : [];
  const walk = (dirRel) => {
    for (const entry of fs.readdirSync(path.join(root, dirRel), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const childRel = `${dirRel}/${entry.name}`;
      if (entry.isDirectory()) walk(childRel);
      else if (entry.isFile() && accept(childRel)) out.push(childRel);
    }
  };
  walk(rel.replace(/\/$/, ""));
  return out.sort();
}

function readJson(root, rel, findings) {
  const text = readIfExists(root, rel);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    findings.error("MEM-JSON-PARSE", rel, `not valid JSON: ${err.message}`);
    return null;
  }
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

/* ------------------------------------------------------------- task documents */

export function parseTaskFile(text) {
  const m = /^---json\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!m) return { error: 'the file must start with a "---json" front matter block closed by a line containing only "---"' };
  try {
    return { data: JSON.parse(m[1]), body: m[2] };
  } catch (err) {
    return { error: `the front matter is not valid JSON: ${err.message}` };
  }
}

/**
 * Cross-field and policy checks for one task document. `ctx` provides schemas, policy and the id sets.
 * Returns [{ code, message, severity }].
 */
export function validateTaskDocument(task, ctx, { filename = null, body = null } = {}) {
  const out = [];
  const err = (code, message) => out.push({ severity: "error", code, message });
  const warn = (code, message) => out.push({ severity: "warning", code, message });

  const schemaResult = validate(ctx.schemas.task, task);
  for (const m of schemaResult.errors) err("TASK-SCHEMA", m);
  if (!schemaResult.valid) return out;

  const { policy } = ctx;
  const prefix = task.task_id.split("-")[0];
  if (!policy.task_id_prefixes.includes(prefix)) err("TASK-PREFIX", `task id prefix "${prefix}" is not listed in policy.task_id_prefixes (${policy.task_id_prefixes.join(", ")})`);
  if (filename && !new RegExp(`^${task.task_id}-[a-z0-9]+(-[a-z0-9]+)*\\.md$`).test(filename)) {
    err("TASK-FILENAME", `file name "${filename}" must be "${task.task_id}-<slug>.md"`);
  }
  if (!task.branch.startsWith(`claude/${task.task_id.toLowerCase()}-`)) err("TASK-BRANCH", `branch "${task.branch}" must start with "claude/${task.task_id.toLowerCase()}-"`);
  if (task.max_attempts > policy.limits.max_attempts_per_task) err("TASK-LIMIT", `max_attempts ${task.max_attempts} exceeds policy.limits.max_attempts_per_task (${policy.limits.max_attempts_per_task})`);
  if (task.depends_on.includes(task.task_id)) err("TASK-DEPENDS", "a task cannot depend on itself");
  for (const dep of task.depends_on) if (ctx.taskIds && !ctx.taskIds.has(dep)) err("TASK-DEPENDS", `depends_on references unknown task ${dep}`);
  for (const q of task.blocked_by_open_questions) if (!ctx.oqIds.has(q)) err("TASK-REF", `blocked_by_open_questions references unknown ${q}`);
  for (const r of task.requirement_refs) if (!ctx.reqIds.has(r)) err("TASK-REF", `requirement_refs references unknown ${r}`);
  if (task.approval_reference !== null && !ctx.hdIds.has(task.approval_reference)) err("TASK-REF", `approval_reference ${task.approval_reference} does not exist in HUMAN_DECISIONS.md`);

  const dupAc = task.acceptance_criteria.map((a) => a.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (dupAc.length) err("TASK-DUPLICATE", `duplicate acceptance criterion ids: ${[...new Set(dupAc)].join(", ")}`);
  const dupCheck = task.required_checks.map((c) => c.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (dupCheck.length) err("TASK-DUPLICATE", `duplicate required check ids: ${[...new Set(dupCheck)].join(", ")}`);
  for (const ac of task.acceptance_criteria) {
    if (ac.verification_method === "command" && ac.command === null) err("TASK-ACCEPTANCE", `${ac.id}: verification_method "command" needs a command`);
  }

  for (const glob of task.files_allowed) {
    if (staticPrefix(glob) === "") err("TASK-GLOB-BROAD", `files_allowed "${glob}" starts with a wildcard; start every glob with a literal path segment`);
  }

  const pre = taskPreflight(task.files_allowed, policy);
  if (CLASS_ORDER[task.declared_risk_class] < CLASS_ORDER[pre.class]) {
    err("TASK-CLASS", `declared_risk_class ${task.declared_risk_class} is below the class ${pre.class} that policy computes from files_allowed (categories: ${pre.categories.join(", ")}). Risk classes come from policy, not from the task author`);
  }
  if (task.declared_risk_class === "C" || pre.class === "C") {
    err("TASK-CLASS-C", "class C work is never autonomous; do not author a runnable task file for it");
  }
  if (pre.restriction === "immutable") err("TASK-IMMUTABLE", "files_allowed overlaps an immutable path (credentials, original build photos or the logo)");
  const undeclared = pre.categories.filter((c) => !task.declared_risk_categories.includes(c));
  if (undeclared.length) warn("TASK-CATEGORIES", `declared_risk_categories omits categories the policy derives from files_allowed: ${undeclared.join(", ")}`);
  if (CLASS_ORDER[task.declared_risk_class] >= CLASS_ORDER.B && task.approval_reference === null) {
    warn("TASK-UNAPPROVED", "class B task without approval_reference: it is a proposal and must not be run until a human approval is recorded");
  }
  if (task.blocked_by_open_questions.length > 0) warn("TASK-BLOCKED", `task is blocked by ${task.blocked_by_open_questions.join(", ")}; it must not run until they are resolved`);
  if (body !== null && body.trim().length < 50) err("TASK-BODY", "the markdown body (the worker prompt) is missing or too short");
  return out;
}

/* -------------------------------------------------------------- run reports */

/** Cross-field and policy checks for one run report. `ctx.tasks` maps task id to task document. */
export function validateReportDocument(report, ctx, { location = null } = {}) {
  const out = [];
  const err = (code, message) => out.push({ severity: "error", code, message });
  const warn = (code, message) => out.push({ severity: "warning", code, message });

  const schemaResult = validate(ctx.schemas.report, report);
  for (const m of schemaResult.errors) err("REPORT-SCHEMA", m);
  if (!schemaResult.valid) return out;

  const { policy } = ctx;
  const attemptSuffix = Number(report.attempt_id.split("-a")[1]);
  if (!report.attempt_id.startsWith(`${report.task_id}-a`)) err("REPORT-IDS", `attempt_id ${report.attempt_id} must start with "${report.task_id}-a"`);
  else if (attemptSuffix !== report.attempt_number) err("REPORT-IDS", `attempt_number ${report.attempt_number} does not match attempt_id ${report.attempt_id}`);
  if (location) {
    const expected = `${PATHS.runsDir}/${report.task_id}/${report.attempt_id}/report.json`;
    if (location !== expected) err("REPORT-LOCATION", `report must live at ${expected}, found ${location}`);
  }
  if (report.attempt_number > policy.limits.max_attempts_per_task) err("REPORT-LIMIT", `attempt ${report.attempt_number} exceeds policy.limits.max_attempts_per_task (${policy.limits.max_attempts_per_task})`);

  if (Date.parse(report.finished_at) < Date.parse(report.started_at)) err("REPORT-TIME", "finished_at is earlier than started_at");
  if (report.commits.length > 0 && report.commits[report.commits.length - 1].sha !== report.head_sha) {
    err("REPORT-HEAD", "head_sha must equal the sha of the last work commit (the report is committed on top of head_sha, not included in it)");
  }
  if (report.outcome === "completed" && report.commits.length === 0) err("REPORT-OUTCOME", 'outcome "completed" with no work commits');

  // verification entries
  const seen = new Set();
  for (const v of report.verification) {
    if (seen.has(v.check_id)) err("REPORT-VERIFY", `duplicate verification check_id "${v.check_id}" (use distinct ids such as "lint-baseline" and "lint-after")`);
    seen.add(v.check_id);
    if (v.status === "passed" && v.exit_code !== 0) err("REPORT-VERIFY", `check "${v.check_id}" is marked passed but exit_code is ${v.exit_code}`);
    if (v.status === "failed" && (v.exit_code === null || v.exit_code === 0)) err("REPORT-VERIFY", `check "${v.check_id}" is marked failed but exit_code is ${v.exit_code}`);
    if ((v.status === "skipped" || v.status === "not_run") && v.exit_code !== null) err("REPORT-VERIFY", `check "${v.check_id}" is ${v.status} but has an exit_code`);
  }

  const task = ctx.tasks ? ctx.tasks.get(report.task_id) : undefined;
  if (!task) {
    err("REPORT-TASK", `no task file found for ${report.task_id}`);
    return out;
  }
  if (report.attempt_number > task.max_attempts) err("REPORT-LIMIT", `attempt ${report.attempt_number} exceeds the task's max_attempts (${task.max_attempts})`);
  if (report.branch !== task.branch) err("REPORT-BRANCH", `branch ${report.branch} differs from the task's branch ${task.branch}`);
  if (report.base_branch !== task.base_branch) err("REPORT-BRANCH", `base_branch ${report.base_branch} differs from the task's base_branch ${task.base_branch}`);

  for (const required of task.required_checks) {
    const entry = report.verification.find((v) => v.check_id === required.id);
    if (!entry) {
      (report.outcome === "completed" && required.must_pass ? err : warn)("REPORT-REQUIRED-CHECK", `required check "${required.id}" has no verification entry`);
    } else if (required.must_pass && report.outcome === "completed" && entry.status !== "passed") {
      err("REPORT-REQUIRED-CHECK", `required check "${required.id}" is ${entry.status} but the outcome is "completed"`);
    }
  }

  // classification and scope from the changed paths, computed by policy and not taken from the report
  const paths = report.changed_files.map((f) => f.path);
  const dupPaths = paths.filter((p, i) => paths.indexOf(p) !== i);
  if (dupPaths.length) err("REPORT-FILES", `duplicate changed_files entries: ${[...new Set(dupPaths)].join(", ")}`);
  const computed = classifyPaths(paths, policy);
  if (CLASS_ORDER[report.risk.declared_class] < CLASS_ORDER[computed.class]) {
    err("REPORT-CLASS", `risk.declared_class ${report.risk.declared_class} is below the class ${computed.class} that policy computes from the changed files. Self-classification can only raise the class`);
  }
  const undeclaredCats = computed.categories.filter((c) => !report.risk.categories.includes(c));
  if (undeclaredCats.length) warn("REPORT-CATEGORIES", `risk.categories omits categories derived from the changed files: ${undeclaredCats.join(", ")}`);
  const missingProtected = computed.protectedPaths.filter((p) => !report.protected_paths_touched.includes(p));
  if (missingProtected.length) err("REPORT-PROTECTED", `protected_paths_touched omits protected paths that were changed: ${missingProtected.join(", ")}`);

  const violations = [];
  for (const p of paths) {
    const perm = pathPermission(p, task, policy);
    if (!perm.allowed) violations.push(`${p} (${perm.reasons.join("; ")})`);
  }
  if (violations.length) err("REPORT-SCOPE", `changed paths the task does not permit: ${violations.join(" | ")}`);
  if (report.attestations.stayed_within_files_allowed && violations.length) err("REPORT-ATTEST", "attestations.stayed_within_files_allowed is true but the changed paths violate the task's scope; attestations are claims and are contradicted by the evidence");
  if (computed.immutablePaths.length && report.attestations.no_production_changes) {
    err("REPORT-ATTEST", `attestations.no_production_changes is true but immutable paths were changed: ${computed.immutablePaths.join(", ")}`);
  }
  return out;
}

/* ------------------------------------------------------- reviewer decisions */

export function validateDecisionDocument(decision, ctx, { location = null } = {}) {
  const out = [];
  const err = (code, message) => out.push({ severity: "error", code, message });
  const warn = (code, message) => out.push({ severity: "warning", code, message });

  const schemaResult = validate(ctx.schemas.decision, decision);
  for (const m of schemaResult.errors) err("DECISION-SCHEMA", m);
  if (!schemaResult.valid) return out;

  const { policy } = ctx;
  if (!decision.attempt_id.startsWith(`${decision.task_id}-a`)) err("DECISION-IDS", `attempt_id ${decision.attempt_id} must start with "${decision.task_id}-a"`);
  if (location) {
    const expected = `${PATHS.reviewsDir}/${decision.task_id}/${decision.attempt_id}/review.json`;
    if (location !== expected) err("REVIEW-LOCATION", `review must live at ${expected}, found ${location}`);
  }

  // role separation: a reviewer is never the worker's session, and reviews the work that was actually reported
  const runtimePolicy = policy.reviewer_runtime;
  if (!runtimePolicy.allowed.includes(decision.reviewer.runtime)) err("DECISION-RUNTIME", `reviewer runtime "${decision.reviewer.runtime}" is not in policy.reviewer_runtime.allowed`);
  if (runtimePolicy.selected === null) warn("DECISION-RUNTIME-UNDECIDED", "no reviewer runtime has been selected by a human yet (OQ-0031); this review is a trial and cannot be relied on");
  else if (decision.reviewer.runtime !== runtimePolicy.selected) err("DECISION-RUNTIME", `reviewer ran on "${decision.reviewer.runtime}" but the policy selects "${runtimePolicy.selected}"`);
  const report = ctx.reports ? ctx.reports.get(decision.attempt_id) : undefined;
  if (report) {
    if (decision.reviewed.head_sha !== report.head_sha) err("DECISION-HEAD", `reviewed.head_sha ${decision.reviewed.head_sha.slice(0, 7)} differs from the report's head_sha ${report.head_sha.slice(0, 7)}`);
    const dev = report.session.id;
    const rev = decision.reviewer.session.id;
    if (dev !== null && rev !== null && dev === rev) err("DECISION-SEPARATION", "the reviewer session is the same session that did the work; a reviewer must be a separate session");
    if (rev === null) warn("DECISION-SEPARATION-UNVERIFIED", "reviewer.session.id is null, so separation from the worker session cannot be verified");
  }

  const severe = decision.findings.filter((f) => f.severity === "blocker" || f.severity === "major");
  const ids = decision.findings.map((f) => f.id);
  if (new Set(ids).size !== ids.length) err("DECISION-FINDINGS", "finding ids must be unique");
  if (decision.verdict === "approve") {
    if (severe.length) err("DECISION-VERDICT", `verdict "approve" contradicts ${severe.length} blocker/major finding(s)`);
    if (decision.verification_assessment.ci_status === "failed") err("DECISION-VERDICT", 'verdict "approve" contradicts ci_status "failed"');
    if (decision.verification_assessment.report_consistency === "inconsistent") err("DECISION-VERDICT", 'verdict "approve" contradicts report_consistency "inconsistent"');
    if (decision.stop_reason !== null) err("DECISION-VERDICT", 'verdict "approve" cannot carry a stop_reason');
  }
  if (decision.verdict === "request_changes" && decision.findings.length === 0) err("DECISION-VERDICT", 'verdict "request_changes" needs at least one finding');
  if (decision.verdict === "needs_human" && decision.stop_reason === null && decision.questions_for_human.length === 0) {
    err("DECISION-VERDICT", 'verdict "needs_human" needs a stop_reason or at least one question_for_human');
  }

  const { action, next_task: nextTask } = decision.next_step;
  if ((action === "propose_next_task") !== (nextTask !== null)) err("DECISION-NEXT", 'next_step.next_task must be present exactly when action is "propose_next_task"');
  if (action === "merge_candidate" && decision.verdict !== "approve") err("DECISION-NEXT", 'action "merge_candidate" requires verdict "approve"');
  if (action === "revise_same_task" && decision.verdict !== "request_changes") err("DECISION-NEXT", 'action "revise_same_task" requires verdict "request_changes"');
  if (decision.stop_reason !== null && action !== "await_human" && action !== "stop") err("DECISION-NEXT", `stop_reason "${decision.stop_reason}" requires next_step.action "await_human" or "stop"`);

  // the reviewer may not advise a class below what its own listed categories imply
  const floor = maxClass(...decision.risk_assessment.categories.map((c) => policy.risk_categories[c].minimum_class));
  if (CLASS_ORDER[decision.risk_assessment.advised_class] < CLASS_ORDER[floor]) {
    err("DECISION-CLASS", `risk_assessment.advised_class ${decision.risk_assessment.advised_class} is below class ${floor} implied by its own categories. The reviewer cannot lower a class set by policy`);
  }

  const task = ctx.tasks ? ctx.tasks.get(decision.task_id) : undefined;
  if (task) {
    const known = new Set(task.acceptance_criteria.map((a) => a.id));
    for (const a of decision.verification_assessment.acceptance_criteria) {
      if (!known.has(a.id)) err("DECISION-CRITERIA", `acceptance criterion ${a.id} does not exist in task ${task.task_id}`);
    }
  }

  if (nextTask) {
    if (nextTask.max_attempts > policy.limits.max_attempts_per_task) err("DECISION-PROPOSAL", `proposed max_attempts ${nextTask.max_attempts} exceeds policy.limits.max_attempts_per_task`);
    for (const glob of nextTask.files_allowed) {
      if (staticPrefix(glob) === "") err("DECISION-PROPOSAL", `proposed files_allowed "${glob}" starts with a wildcard`);
    }
    const pre = taskPreflight(nextTask.files_allowed, policy);
    if (CLASS_ORDER[nextTask.declared_risk_class] < CLASS_ORDER[pre.class]) {
      err("DECISION-PROPOSAL", `proposed declared_risk_class ${nextTask.declared_risk_class} is below class ${pre.class} computed by policy from its files_allowed`);
    }
    if (nextTask.declared_risk_class === "C" || pre.class === "C") err("DECISION-PROPOSAL", "class C work is never proposed as an autonomous task");
    if (pre.restriction === "immutable") err("DECISION-PROPOSAL", "proposal overlaps an immutable path");
    for (const dep of nextTask.depends_on) if (ctx.taskIds && !ctx.taskIds.has(dep)) err("DECISION-PROPOSAL", `proposal depends on unknown task ${dep}`);
  }
  return out;
}

/* ------------------------------------------------------------------- policy */

function checkPolicy(policy, schemas, f) {
  const file = PATHS.policy;
  const err = (code, msg) => f.error(code, file, msg);

  const categories = Object.keys(policy.risk_categories);
  const enumOf = (schema) => (schema && schema.$defs && schema.$defs.risk_category ? schema.$defs.risk_category.enum : null);
  for (const [name, schema] of Object.entries(schemas)) {
    const e = enumOf(schema);
    if (e && JSON.stringify([...e].sort()) !== JSON.stringify([...categories].sort())) {
      err("POLICY-SCHEMA-SYNC", `risk categories in policy.json differ from the risk_category enum in the ${name} schema`);
    }
  }
  const classEnum = schemas.task && schemas.task.$defs ? schemas.task.$defs.risk_class.enum : null;
  if (classEnum && JSON.stringify(classEnum) !== JSON.stringify(Object.keys(policy.risk_classes))) err("POLICY-SCHEMA-SYNC", "risk classes in policy.json differ from the risk_class enum in the schemas");

  for (const [cat, floor] of Object.entries(CATEGORY_FLOORS)) {
    const entry = policy.risk_categories[cat];
    if (!entry) err("POLICY-INVARIANT", `risk category "${cat}" is missing`);
    else if (CLASS_ORDER[entry.minimum_class] < CLASS_ORDER[floor]) err("POLICY-INVARIANT", `risk category "${cat}" is class ${entry.minimum_class} but may not be below ${floor}`);
  }
  const unmatched = policy.risk_categories[policy.classification.unmatched_path_category];
  if (!unmatched) err("POLICY-INVARIANT", `classification.unmatched_path_category "${policy.classification.unmatched_path_category}" is not a risk category`);
  else if (CLASS_ORDER[unmatched.minimum_class] < CLASS_ORDER.B) err("POLICY-INVARIANT", "paths that match no rule must default to class B or higher");

  const ruleIds = policy.path_rules.map((r) => r.id);
  if (new Set(ruleIds).size !== ruleIds.length) err("POLICY-INVARIANT", "path_rules ids must be unique");
  for (const rule of policy.path_rules) {
    if (!policy.risk_categories[rule.category]) err("POLICY-INVARIANT", `${rule.id}: category "${rule.category}" is not a risk category`);
  }
  const prohibIds = policy.prohibited_operations.map((p) => p.id);
  if (new Set(prohibIds).size !== prohibIds.length) err("POLICY-INVARIANT", "prohibited_operations ids must be unique");
  if (new Set(policy.task_id_prefixes).size !== policy.task_id_prefixes.length) err("POLICY-INVARIANT", "task_id_prefixes must be unique");

  const { A, B, C } = policy.risk_classes;
  if (C.approval !== "never_autonomous" || C.runs_without_human_approval || C.may_auto_merge_to_integration) err("POLICY-INVARIANT", "class C must be never_autonomous and never auto-merged");
  if (B.runs_without_human_approval || B.may_auto_merge_to_integration) err("POLICY-INVARIANT", "class B must require a human before the run and before merge");
  if (!A.runs_without_human_approval) err("POLICY-INVARIANT", "class A is defined as the class that may run automatically");
  const never = policy.approval.never_autonomous_for_classes;
  if (!never.includes("C")) err("POLICY-INVARIANT", "approval.never_autonomous_for_classes must include C");
  for (const cls of ["B", "C"]) {
    if (!policy.approval.human_approval_before_run_for_classes.includes(cls)) err("POLICY-INVARIANT", `approval.human_approval_before_run_for_classes must include ${cls}`);
  }
  for (const r of ["protected", "control_plane", "immutable"]) {
    if (!policy.approval.human_approval_before_merge_for_restrictions.includes(r)) err("POLICY-INVARIANT", `approval.human_approval_before_merge_for_restrictions must include ${r}`);
  }

  const { branches } = policy;
  for (const must of [branches.production, branches.integration]) {
    if (!branches.worker_must_not_push.includes(must)) err("POLICY-INVARIANT", `worker_must_not_push must include "${must}"`);
    if (branches.worker_may_push.some((g) => matchesGlob(g, must))) err("POLICY-INVARIANT", `worker_may_push must not match "${must}"`);
  }
  if (!policy.kill_switch.on_trigger.includes("require_human_resume")) err("POLICY-INVARIANT", "kill_switch.on_trigger must include require_human_resume");
  if (policy.limits.max_concurrent_tasks > 1) f.warn("POLICY-LIMITS", file, "max_concurrent_tasks above 1 has not been reviewed in the architecture (ADR-0002 assumes one task in flight)");
  // Owner decision HD-0010: the existing Claude subscription only; no paid AI service of any kind.
  if (policy.budget.paid_ai_services_allowed !== false || policy.budget.api_billing_allowed !== false) {
    err("POLICY-INVARIANT", "budget must not allow paid AI services or API-key billing (owner decision HD-0010)");
  }
  if (!policy.budget.claude_subscription.extra_usage_must_stay_disabled) err("POLICY-INVARIANT", "budget.claude_subscription.extra_usage_must_stay_disabled must be true (metered overage is API-rate billing)");
  if (!policy.prohibited_operations.some((p) => /paid|metered/i.test(p.operation) && /AI/.test(p.operation))) {
    err("POLICY-INVARIANT", "prohibited_operations must forbid paid or metered AI services (owner decision HD-0010)");
  }
  const rt = policy.reviewer_runtime;
  if (rt.selected !== null && !rt.allowed.includes(rt.selected)) err("POLICY-INVARIANT", `reviewer_runtime.selected "${rt.selected}" is not in reviewer_runtime.allowed`);
  if (policy.limits.max_review_sessions_per_attempt < 1) err("POLICY-INVARIANT", "limits.max_review_sessions_per_attempt must be at least 1");

  for (const [p, cls, restriction] of GOLDEN_PATHS) {
    const got = classifyPath(p, policy);
    if (got.class !== cls || got.restriction !== restriction) {
      err("POLICY-GOLDEN", `"${p}" must classify as class ${cls} / ${restriction}, policy yields class ${got.class} / ${got.restriction} (rules: ${got.rules.join(", ") || "none"})`);
    }
  }
}

/* ---------------------------------------------------------- markdown parsing */

function parseRequirements(text, file, f) {
  const ids = new Map();
  text.split(/\r?\n/).forEach((line, i) => {
    if (!/^- \*\*REQ-/.test(line)) return;
    const m = /^- \*\*(REQ-[A-Z]{2,5}-\d{3})\*\* \(confirmed\) [—-] (.+)$/.exec(line);
    if (!m) {
      f.error("REQ-FORMAT", file, 'requirement lines must look like: - **REQ-<AREA>-<NNN>** (confirmed) — text', i + 1);
      return;
    }
    if (ids.has(m[1])) f.error("REQ-DUPLICATE", file, `duplicate requirement id ${m[1]} (first defined on line ${ids.get(m[1]).line})`, i + 1);
    else ids.set(m[1], { text: m[2], line: i + 1 });
  });
  return ids;
}

function parseRecommendations(text, file, f) {
  const ids = new Map();
  text.split(/\r?\n/).forEach((line, i) => {
    if (!/^- \*\*REC-/.test(line)) return;
    const m = /^- \*\*(REC-[A-Z]{3,5}-\d{3})\*\* \(recommendation\) [—-] (.+)$/.exec(line);
    if (!m) {
      f.error("REC-FORMAT", file, 'recommendation lines must look like: - **REC-<AREA>-<NNN>** (recommendation) — text', i + 1);
      return;
    }
    if (ids.has(m[1])) f.error("REC-DUPLICATE", file, `duplicate recommendation id ${m[1]}`, i + 1);
    else ids.set(m[1], { text: m[2], line: i + 1 });
  });
  return ids;
}

function parseEntries(text, idPattern) {
  const head = new RegExp(`^### (${idPattern}) [—-] (.+)$`);
  const entries = [];
  let current = null;
  text.split(/\r?\n/).forEach((line, i) => {
    const m = head.exec(line);
    if (m) {
      current = { id: m[1], title: m[2], line: i + 1, fields: {} };
      entries.push(current);
      return;
    }
    if (/^#{1,3} /.test(line)) {
      current = null;
      return;
    }
    if (current) {
      const fm = /^- \*\*([A-Za-z ]+):\*\* (.*)$/.exec(line);
      if (fm) current.fields[fm[1].trim().toLowerCase()] = fm[2].trim();
    }
  });
  return entries;
}

function checkEntries(entries, file, kind, required, f) {
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.id)) f.error(`${kind}-DUPLICATE`, file, `duplicate id ${e.id}`, e.line);
    seen.add(e.id);
    for (const field of required) {
      if (!e.fields[field]) f.error(`${kind}-FORMAT`, file, `${e.id} is missing the "**${field[0].toUpperCase()}${field.slice(1)}:**" line`, e.line);
    }
  }
}

/* ------------------------------------------------------------- content scan */

const SECRET_PATTERNS = [
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["api-key-sk", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["slack-token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ["jwt", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["secret-assignment", /\b[A-Z0-9_]*(?:SERVICE_ROLE|SECRET|PASSWORD|TOKEN|API_KEY)[A-Z0-9_]*\s*[=:]\s*["']?[A-Za-z0-9_\-/+=]{16,}/],
  ["supabase-project-url", /https:\/\/[a-z0-9]{20}\.supabase\.co/],
  ["qatar-phone-number", /(?<![\d.])\+?974[\s-]?\d{4}[\s-]?\d{4}(?!\d)/],
];
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const TEXT_EXT = /\.(md|json|mjs|js|ts|tsx|txt|yml|yaml|sh)$/;

function scanContent(root, policy, f) {
  const cfg = policy.memory_contract.content_scan;
  if (!cfg.enabled) return;
  const allowed = new Set(cfg.allowed_emails.map((e) => e.toLowerCase()));
  for (const scanRoot of cfg.scan_roots) {
    for (const rel of listFiles(root, scanRoot, (p) => TEXT_EXT.test(p))) {
      let text;
      try {
        if (fs.statSync(path.join(root, rel)).size > 2_000_000) continue;
        text = fs.readFileSync(path.join(root, rel), "utf8");
      } catch {
        continue;
      }
      f.files.add(rel);
      text.split(/\r?\n/).forEach((line, i) => {
        for (const [id, re] of SECRET_PATTERNS) {
          // Report the pattern id and line only: never echo the matched text.
          if (re.test(line)) f.error("SCAN-SECRET", rel, `looks like a ${id}; this repository is public and must not contain secrets, customer data or business-sensitive values`, i + 1);
        }
        for (const m of line.matchAll(EMAIL_RE)) {
          const addr = m[0].toLowerCase();
          if (allowed.has(addr) || /@example\.(com|org|net)$/.test(addr)) continue;
          f.error("SCAN-EMAIL", rel, "contains an email address that is not on policy.memory_contract.content_scan.allowed_emails", i + 1);
        }
      });
    }
  }
}

/* ------------------------------------------------- provider neutrality (HD-0010) */

// Owner decision HD-0010: the active architecture uses only the existing Claude subscription, and the contracts stay
// provider-neutral. Contracts, policy, worker instructions and the active documents must therefore not depend on, or
// even name, an external AI provider. Records of the decision itself, and historical run reports, are exempt.
const EXTERNAL_AI_RE = /\b(?:openai|chatgpt|gpt(?:-[\w.]+)?)\b|responses api/i;
const NEUTRALITY_EXEMPT = [
  `${MEM}/decisions/`,
  `${MEM}/runs/`,
  PATHS.requirements,
  `${PATHS.adrDir}/0009-`,
];

function checkProviderNeutrality(root, f) {
  const files = [
    PATHS.claudeMd,
    PATHS.policy,
    ...Object.values(PATHS.schemas),
    ...listFiles(root, MEM, (p) => p.endsWith(".md")),
  ];
  for (const rel of [...new Set(files)]) {
    if (NEUTRALITY_EXEMPT.some((prefix) => rel === prefix || rel.startsWith(prefix))) continue;
    const text = readIfExists(root, rel);
    if (text === null) continue;
    text.split(/\r?\n/).forEach((line, i) => {
      if (EXTERNAL_AI_RE.test(line)) {
        f.error("PROVIDER-NEUTRAL", rel, "names an external AI provider or API; the active architecture uses only the existing Claude subscription and provider-neutral contracts (owner decision HD-0010). Record exclusions only in decision records", i + 1);
      }
    });
  }
}

/* ------------------------------------------------------------------ the run */

function loadSchemas(root, f) {
  const out = {};
  for (const [key, rel] of Object.entries(PATHS.schemas)) {
    const schema = readJson(root, rel, f);
    out[key] = schema;
    if (!schema) continue;
    f.files.add(rel);
    for (const problem of lintSchema(schema, { strict: true })) f.error("SCHEMA-LINT", rel, problem);
    if (!schema.properties || !schema.properties.schema_version || schema.properties.schema_version.const !== "1") {
      f.error("SCHEMA-VERSION", rel, 'property schema_version must be declared as {"const": "1"}');
    }
    // Found by an offline test of the installed CLI (OPS-0001B): its structured-output schema validator rejects a
    // schema that declares the 2020-12 dialect URI ("no schema with key or ref ...") but accepts the same schema without it.
    if (schema.$schema !== undefined) {
      f.error("SCHEMA-CLI-COMPAT", rel, 'remove the "$schema" keyword: the CLI\'s structured-output validator rejects schemas that declare the 2020-12 dialect URI, and the contracts are meant to be usable with it');
    }
  }
  const defs = new Map();
  for (const [key, schema] of Object.entries(out)) {
    if (!schema || !schema.$defs) continue;
    for (const [name, def] of Object.entries(schema.$defs)) {
      if (!defs.has(name)) defs.set(name, []);
      defs.get(name).push([key, JSON.stringify(def)]);
    }
  }
  for (const [name, list] of defs) {
    if (list.length > 1 && new Set(list.map(([, json]) => json)).size > 1) {
      f.error("SCHEMA-SHARED-DEFS", PATHS.schemas.task, `shared definition "${name}" differs between schemas (${list.map(([k]) => k).join(", ")}); shared definitions must be identical`);
    }
  }
  const { task, report, decision } = out;
  if (task && report && task.properties.branch.pattern !== report.properties.branch.pattern) {
    f.error("SCHEMA-SHARED-DEFS", PATHS.schemas.report, "the branch pattern of the run report differs from the task schema");
  }
  if (task && decision) {
    try {
      const proposal = decision.properties.next_step.properties.next_task.anyOf[0].properties;
      for (const [key, def] of Object.entries(proposal)) {
        if (key === "prompt_markdown") continue;
        if (!task.properties[key]) f.error("SCHEMA-PROPOSAL", PATHS.schemas.decision, `next_task.${key} does not exist in the task schema`);
        else if (JSON.stringify(task.properties[key]) !== JSON.stringify(def)) f.error("SCHEMA-PROPOSAL", PATHS.schemas.decision, `next_task.${key} differs from the task schema definition`);
      }
    } catch {
      f.error("SCHEMA-PROPOSAL", PATHS.schemas.decision, "next_step.next_task must be anyOf [task proposal, null]");
    }
  }
  return out;
}

function checkMarkdownLinks(root, files, f) {
  for (const rel of files) {
    const text = readIfExists(root, rel);
    if (text === null) continue;
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const clean = target.split("#")[0];
      if (!clean) continue;
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), clean));
      if (!exists(root, resolved)) f.error("LINK-BROKEN", rel, `relative link "${target}" does not resolve to a file`, lineOf(text, m.index));
    }
  }
}

/** Validate the whole project memory under `root`. Returns { findings, ok, stats }. */
export function validateMemory({ root = DEFAULT_ROOT } = {}) {
  const f = new Findings();

  // 1. policy and schemas (needed to know what else is required)
  const schemas = loadSchemas(root, f);
  const policy = readJson(root, PATHS.policy, f);
  if (policy) f.files.add(PATHS.policy);
  let policyUsable = false;
  if (policy && schemas.policy) {
    const result = validate(schemas.policy, policy);
    for (const m of result.errors) f.error("POLICY-SCHEMA", PATHS.policy, m);
    policyUsable = result.valid;
    if (policyUsable) checkPolicy(policy, schemas, f);
  }

  // 2. required files
  const required = policyUsable ? policy.memory_contract.required_files : [PATHS.policy, ...Object.values(PATHS.schemas), PATHS.claudeMd];
  for (const rel of required) {
    if (!exists(root, rel)) f.error("MEM-FILE-MISSING", rel, "required project-memory file is missing");
    else f.files.add(rel);
  }
  if (!policyUsable) {
    f.error("MEM-ABORT", PATHS.policy, "policy.json is missing or invalid, so the remaining consistency checks cannot run");
    return finish(f);
  }

  // 3. markdown documents and ids
  const reqFile = PATHS.requirements;
  const reqText = readIfExists(root, reqFile);
  const requirements = reqText === null ? new Map() : parseRequirements(reqText, reqFile, f);
  for (const id of policy.memory_contract.required_requirement_ids) {
    if (reqText !== null && !requirements.has(id)) f.error("REQ-MISSING", reqFile, `confirmed requirement ${id} is required by policy.memory_contract and is missing`);
  }
  for (const guard of policy.memory_contract.required_requirement_text) {
    const entry = requirements.get(guard.id);
    if (!entry) continue;
    for (const needle of guard.must_contain) {
      if (!entry.text.toLowerCase().includes(needle.toLowerCase())) {
        f.error("REQ-TEXT", reqFile, `${guard.id} must contain "${needle}"; confirmed facts may not be edited silently`, entry.line);
      }
    }
  }

  const archText = readIfExists(root, PATHS.architecture);
  const recommendations = archText === null ? new Map() : parseRecommendations(archText, PATHS.architecture, f);
  if (archText !== null && recommendations.size === 0) f.error("REC-MISSING", PATHS.architecture, "ARCHITECTURE.md defines no recommendations (REC ids)");

  const oqText = readIfExists(root, PATHS.openQuestions);
  const openQuestions = oqText === null ? [] : parseEntries(oqText, "OQ-\\d{4}");
  checkEntries(openQuestions, PATHS.openQuestions, "OQ", ["status", "blocks", "question", "source"], f);
  const oqIds = new Set(openQuestions.map((e) => e.id));
  const hdText = readIfExists(root, PATHS.humanDecisions);
  const humanDecisions = hdText === null ? [] : parseEntries(hdText, "HD-\\d{4}");
  checkEntries(humanDecisions, PATHS.humanDecisions, "HD", ["date", "decision", "source", "affects"], f);
  const hdIds = new Set(humanDecisions.map((e) => e.id));
  for (const e of humanDecisions) if (e.fields.date && !/^\d{4}-\d{2}-\d{2}$/.test(e.fields.date)) f.error("HD-FORMAT", PATHS.humanDecisions, `${e.id}: date must be YYYY-MM-DD`, e.line);
  for (const e of openQuestions) {
    if (e.fields.status && !["open", "resolved"].includes(e.fields.status)) f.error("OQ-FORMAT", PATHS.openQuestions, `${e.id}: status must be "open" or "resolved"`, e.line);
    if (e.fields.status === "resolved" && !(e.fields.resolution && hdIds.has(e.fields.resolution))) {
      f.error("OQ-FORMAT", PATHS.openQuestions, `${e.id}: a resolved question needs "**Resolution:** HD-<4 digits>" pointing to an existing human decision`, e.line);
    }
  }

  const roadmapText = readIfExists(root, PATHS.roadmap);
  const roadmapIds = new Set();
  if (roadmapText !== null) {
    roadmapText.split(/\r?\n/).forEach((line, i) => {
      const m = /^\| ((?:PH|STG)-\d+) \| (.+?) \| ([a-z_]+) \|/.exec(line);
      if (!m) return;
      if (roadmapIds.has(m[1])) f.error("ROADMAP-FORMAT", PATHS.roadmap, `duplicate roadmap id ${m[1]}`, i + 1);
      roadmapIds.add(m[1]);
      if (!STATUS_VOCABULARY.has(m[3])) f.error("ROADMAP-FORMAT", PATHS.roadmap, `${m[1]}: status "${m[3]}" is not one of ${[...STATUS_VOCABULARY].join(", ")}`, i + 1);
    });
    if (roadmapIds.size === 0) f.error("ROADMAP-FORMAT", PATHS.roadmap, "no roadmap rows found (| PH-<n> | name | status | ... |)");
  }

  // ADRs
  const adrFiles = listFiles(root, PATHS.adrDir, (p) => p.endsWith(".md"));
  const adrIds = new Set();
  const adrNumbers = [];
  for (const rel of adrFiles) {
    f.files.add(rel);
    const name = path.posix.basename(rel);
    const nm = /^(\d{4})-[a-z0-9]+(-[a-z0-9]+)*\.md$/.exec(name);
    if (!nm) {
      f.error("ADR-FORMAT", rel, 'ADR file names must look like "<NNNN>-<slug>.md"');
      continue;
    }
    adrNumbers.push(Number(nm[1]));
    adrIds.add(`ADR-${nm[1]}`);
    const text = readIfExists(root, rel);
    const heading = /^# ADR-(\d{4}): (.+)$/m.exec(text);
    if (!heading || heading[1] !== nm[1]) f.error("ADR-FORMAT", rel, `first heading must be "# ADR-${nm[1]}: <title>"`);
    const status = /^- \*\*Status:\*\* ([a-z]+)\b/m.exec(text);
    if (!status || !ADR_STATUSES.has(status[1])) f.error("ADR-FORMAT", rel, `needs "- **Status:** <${[...ADR_STATUSES].join("|")}>"`);
    for (const h of ["## Context", "## Decision", "## Consequences"]) {
      if (!text.includes(`\n${h}\n`)) f.error("ADR-FORMAT", rel, `missing section "${h}"`);
    }
  }
  adrNumbers.sort((a, b) => a - b).forEach((n, i) => {
    if (n !== i + 1) f.error("ADR-NUMBERING", PATHS.adrDir, `ADR numbers must be contiguous from 0001; expected ${String(i + 1).padStart(4, "0")} but found ${String(n).padStart(4, "0")}`);
  });
  if (adrFiles.length < policy.memory_contract.min_adr_count) f.error("ADR-MISSING", PATHS.adrDir, `needs at least ${policy.memory_contract.min_adr_count} ADRs, found ${adrFiles.length}`);

  // 4. references and links across the governed markdown
  const defined = new Set([
    ...requirements.keys(), ...recommendations.keys(), ...oqIds, ...hdIds, ...adrIds, ...roadmapIds,
    ...policy.prohibited_operations.map((p) => p.id), ...policy.path_rules.map((r) => r.id),
  ]);
  const mdFiles = [PATHS.claudeMd, ...listFiles(root, MEM, (p) => p.endsWith(".md") && !p.startsWith(`${PATHS.runsDir}/`) && !p.endsWith("/TEMPLATE.md"))].filter((p) => exists(root, p));
  const REF_RE = /\b(REQ-[A-Z]{2,5}-\d{3}|REC-[A-Z]{3,5}-\d{3}|ADR-\d{4}|OQ-\d{4}|HD-\d{4}|PH-\d+|STG-\d+|PROHIB-\d{3}|PATH-\d{3})\b/g;
  for (const rel of mdFiles) {
    const text = readIfExists(root, rel);
    f.files.add(rel);
    for (const m of text.matchAll(REF_RE)) {
      if (!defined.has(m[1])) f.error("REF-UNKNOWN", rel, `refers to ${m[1]}, which is not defined anywhere`, lineOf(text, m.index));
    }
  }
  checkMarkdownLinks(root, [...mdFiles, `${PATHS.tasksDir}/TEMPLATE.md`], f);

  // 5. CLAUDE.md contract
  const claudeText = readIfExists(root, PATHS.claudeMd);
  if (claudeText !== null) {
    const lines = new Set(claudeText.split(/\r?\n/));
    for (const heading of policy.memory_contract.claude_md_required_headings) {
      if (!lines.has(heading)) f.error("CLAUDE-MD", PATHS.claudeMd, `required section is missing: "${heading}"`);
    }
  }

  // 6. tasks
  const taskFiles = listFiles(root, PATHS.tasksDir, (p) => p.endsWith(".md") && !p.endsWith("/TEMPLATE.md"));
  const tasks = new Map();
  const parsedTasks = [];
  for (const rel of taskFiles) {
    f.files.add(rel);
    const parsed = parseTaskFile(readIfExists(root, rel));
    if (parsed.error) {
      f.error("TASK-FRONTMATTER", rel, parsed.error);
      continue;
    }
    if (parsed.data && typeof parsed.data.task_id === "string") {
      if (tasks.has(parsed.data.task_id)) f.error("TASK-DUPLICATE", rel, `duplicate task id ${parsed.data.task_id}`);
      else tasks.set(parsed.data.task_id, parsed.data);
    }
    parsedTasks.push({ rel, ...parsed });
  }
  const ctx = {
    schemas, policy, tasks, taskIds: new Set(tasks.keys()), reqIds: new Set(requirements.keys()), oqIds, hdIds, reports: new Map(),
  };

  // the reviewer runtime may only be selected by a recorded human decision (no invented approvals)
  const rr = policy.reviewer_runtime;
  if (!oqIds.has(rr.governing_question)) f.error("REVIEWER-RUNTIME", PATHS.policy, `reviewer_runtime.governing_question ${rr.governing_question} does not exist in OPEN_QUESTIONS.md`);
  if (rr.selected !== null && (rr.decision_reference === null || !hdIds.has(rr.decision_reference))) {
    f.error("REVIEWER-RUNTIME", PATHS.policy, `reviewer_runtime.selected is "${rr.selected}" but decision_reference does not point to an existing human decision; a runtime is chosen by a human, never by a worker`);
  }
  if (rr.selected === null && rr.decision_reference !== null) f.error("REVIEWER-RUNTIME", PATHS.policy, "reviewer_runtime.decision_reference is set although no runtime is selected");

  if (schemas.task) {
    for (const t of parsedTasks) {
      for (const issue of validateTaskDocument(t.data, ctx, { filename: path.posix.basename(t.rel), body: t.body })) f.add(issue.severity, issue.code, t.rel, issue.message);
    }
    const template = readIfExists(root, `${PATHS.tasksDir}/TEMPLATE.md`);
    if (template !== null) {
      const parsed = parseTaskFile(template);
      if (parsed.error) f.error("TASK-FRONTMATTER", `${PATHS.tasksDir}/TEMPLATE.md`, parsed.error);
      else {
        const result = validate(schemas.task, parsed.data);
        for (const m of result.errors) f.error("TASK-TEMPLATE", `${PATHS.tasksDir}/TEMPLATE.md`, `the template no longer conforms to the task schema: ${m}`);
      }
    }
  }
  // dependency cycles
  const visiting = new Set();
  const done = new Set();
  const visit = (id, trail) => {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      f.error("TASK-DEPENDS", PATHS.tasksDir, `dependency cycle: ${[...trail, id].join(" -> ")}`);
      return;
    }
    visiting.add(id);
    for (const dep of (tasks.get(id) && tasks.get(id).depends_on) || []) if (tasks.has(dep)) visit(dep, [...trail, id]);
    visiting.delete(id);
    done.add(id);
  };
  for (const id of tasks.keys()) visit(id, []);

  // 7. run reports and reviewer decisions (reports are loaded first so a review can be compared with its report)
  if (schemas.report) {
    for (const rel of listFiles(root, PATHS.runsDir, (p) => p.endsWith(".json"))) {
      f.files.add(rel);
      if (!rel.endsWith("/report.json")) {
        f.error("REPORT-LOCATION", rel, 'only "report.json" files belong under runs/<task id>/<attempt id>/');
        continue;
      }
      const report = readJson(root, rel, f);
      if (report && typeof report.attempt_id === "string") ctx.reports.set(report.attempt_id, report);
      if (report) for (const issue of validateReportDocument(report, ctx, { location: rel })) f.add(issue.severity, issue.code, rel, issue.message);
    }
  }
  if (schemas.decision) {
    for (const rel of listFiles(root, PATHS.reviewsDir, (p) => p.endsWith(".json"))) {
      f.files.add(rel);
      if (!rel.endsWith("/review.json")) {
        f.error("REVIEW-LOCATION", rel, 'only "review.json" files belong under reviews/<task id>/<attempt id>/');
        continue;
      }
      const decision = readJson(root, rel, f);
      if (decision) for (const issue of validateDecisionDocument(decision, ctx, { location: rel })) f.add(issue.severity, issue.code, rel, issue.message);
    }
  }

  // 8. public-repository content scan, and provider neutrality (HD-0010)
  scanContent(root, policy, f);
  checkProviderNeutrality(root, f);
  return finish(f);
}

function finish(f) {
  return { findings: f, ok: f.errors.length === 0, stats: { files: f.files.size, errors: f.errors.length, warnings: f.warnings.length } };
}

/** Validate one file in the context of a checkout. Returns findings. */
export function validateSingleFile({ root = DEFAULT_ROOT, file, kind = null }) {
  const f = new Findings();
  const schemas = loadSchemas(root, f);
  const policy = readJson(root, PATHS.policy, f);
  if (!policy || !schemas.policy || !validate(schemas.policy, policy).valid) {
    f.error("POLICY-SCHEMA", PATHS.policy, "policy.json is missing or invalid; run the full validation for details");
    return finish(f);
  }
  const rel = path.relative(root, path.resolve(file)).split(path.sep).join("/");
  const inferred = kind || (rel.endsWith("/report.json") ? "report" : rel.endsWith(".md") ? "task" : "decision");
  const tasks = new Map();
  for (const t of listFiles(root, PATHS.tasksDir, (p) => p.endsWith(".md") && !p.endsWith("/TEMPLATE.md"))) {
    const parsed = parseTaskFile(readIfExists(root, t));
    if (parsed.data && parsed.data.task_id) tasks.set(parsed.data.task_id, parsed.data);
  }
  const ids = (text, pattern) => new Set(text === null ? [] : parseEntries(text, pattern).map((e) => e.id));
  const reqText = readIfExists(root, PATHS.requirements);
  const reports = new Map();
  for (const r of listFiles(root, PATHS.runsDir, (p) => p.endsWith("/report.json"))) {
    try {
      const doc = JSON.parse(readIfExists(root, r));
      if (doc && typeof doc.attempt_id === "string") reports.set(doc.attempt_id, doc);
    } catch {
      // an unreadable report is reported by the full validation; it just cannot be compared here
    }
  }
  const ctx = {
    schemas, policy, tasks, taskIds: new Set(tasks.keys()), reports,
    reqIds: new Set(reqText === null ? [] : [...reqText.matchAll(/^- \*\*(REQ-[A-Z]{2,5}-\d{3})\*\*/gm)].map((m) => m[1])),
    oqIds: ids(readIfExists(root, PATHS.openQuestions), "OQ-\\d{4}"),
    hdIds: ids(readIfExists(root, PATHS.humanDecisions), "HD-\\d{4}"),
  };
  const text = readIfExists(root, rel);
  if (text === null) {
    f.error("MEM-FILE-MISSING", rel, "file not found");
    return finish(f);
  }
  f.files.add(rel);
  let issues = [];
  if (inferred === "task") {
    const parsed = parseTaskFile(text);
    if (parsed.error) f.error("TASK-FRONTMATTER", rel, parsed.error);
    else issues = validateTaskDocument(parsed.data, ctx, { filename: path.posix.basename(rel), body: parsed.body });
  } else {
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      f.error("MEM-JSON-PARSE", rel, `not valid JSON: ${err.message}`);
      return finish(f);
    }
    issues = inferred === "report" ? validateReportDocument(data, ctx, { location: rel.startsWith(`${PATHS.runsDir}/`) ? rel : null }) : validateDecisionDocument(data, ctx, { location: rel.startsWith(`${PATHS.reviewsDir}/`) ? rel : null });
  }
  for (const issue of issues) f.add(issue.severity, issue.code, rel, issue.message);
  return finish(f);
}

/* ----------------------------------------------------------------------- CLI */

function formatText(result, root) {
  const { findings, stats } = result;
  const lines = [`M1 project-memory validation (root: ${root})`];
  const order = (a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1);
  for (const item of [...findings.items].sort(order)) {
    const where = item.line ? `${item.file}:${item.line}` : item.file;
    lines.push(`${item.severity === "error" ? "ERROR  " : "WARNING"} [${item.code}] ${where}\n          ${item.message}`);
  }
  lines.push(result.ok
    ? `OK: checked ${stats.files} file(s); ${stats.warnings} warning(s).`
    : `FAILED: ${stats.errors} error(s), ${stats.warnings} warning(s) across ${stats.files} checked file(s).`);
  return lines.join("\n");
}

export function main(argv, out = process.stdout, errOut = process.stderr) {
  const args = { root: DEFAULT_ROOT, json: false, file: null, kind: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") args.json = true;
    else if (a === "--root" || a === "--file" || a === "--kind") {
      const value = argv[i + 1];
      if (value === undefined) {
        errOut.write(`${a} needs a value\n`);
        return 2;
      }
      args[a.slice(2)] = value;
      i += 1;
    } else if (a === "--help" || a === "-h") {
      out.write("usage: node ops/validate-memory.mjs [--root <dir>] [--json] [--file <path> [--kind task|report|decision]]\n");
      return 0;
    } else {
      errOut.write(`unknown argument: ${a}\n`);
      return 2;
    }
  }
  if (args.kind && !["task", "report", "decision"].includes(args.kind)) {
    errOut.write("--kind must be task, report or decision\n");
    return 2;
  }
  const root = path.resolve(args.root);
  const result = args.file ? validateSingleFile({ root, file: args.file, kind: args.kind }) : validateMemory({ root });
  if (args.json) {
    out.write(`${JSON.stringify({ ok: result.ok, stats: result.stats, errors: result.findings.errors, warnings: result.findings.warnings }, null, 2)}\n`);
  } else {
    out.write(`${formatText(result, root)}\n`);
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`internal error: ${err && err.stack ? err.stack : err}\n`);
    process.exitCode = 2;
  }
}
