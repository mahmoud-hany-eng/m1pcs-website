// CI results as data a reviewer can consume (OPS-0003). Zero dependencies, no network, NO credentials.
//
// This module never talks to GitHub. A trusted collector fetches the REST responses itself (workflow run, jobs, check
// runs, optionally the job log) and hands them over as JSON; this module turns them into one evidence document, copying
// only whitelisted fields, so a token or any unexpected field in the input can never reach the output.
//
// Two things are deliberately kept apart:
//   - what GitHub states: the run, job and step conclusions, the commit they were for, the workflow file path. These come
//     from the Actions and Checks APIs and are the only authoritative part;
//   - what the code under test printed: test counts, file counts, page counts. These are parsed from the job log, which is
//     written by code from the branch being judged, so they are labelled as claims and never decide anything alone.
//
// And one limit is stated in every document: a green run only says that the steps the workflow defined at that commit
// succeeded. If that definition (the workflow, ops/, the policy, the schemas, package scripts, build inputs) differs from
// the base revision's, the result is not evidence. The trusted-base section (ops/lib/trusted-base.mjs) is what shows that.

import { get, isMap, isScalar, isSeq, parseYaml, text } from "./mini-yaml.mjs";

export class EvidenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EvidenceError";
    this.code = code;
  }
}

const SHA_RE = /^[0-9a-f]{40}$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const PSEUDO_STEP = (name) => name === "Set up job" || name === "Complete job" || /^Post /.test(name);

/* -------------------------------------------------------- field extraction */

const str = (v, max = 400) => (typeof v === "string" ? v.slice(0, max) : null);
const intOrNull = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
const ts = (v) => (typeof v === "string" && TS_RE.test(v) ? v : null);

function need(cond, code, message) {
  if (!cond) throw new EvidenceError(code, message);
}

export function normalizeRun(run) {
  need(run && typeof run === "object" && !Array.isArray(run), "EV-SHAPE", "the workflow run must be a JSON object");
  need(Number.isInteger(run.id) && run.id >= 0, "EV-SHAPE", "the workflow run has no integer id");
  need(typeof run.head_sha === "string" && SHA_RE.test(run.head_sha), "EV-SHAPE", "the workflow run has no full head_sha");
  need(typeof run.event === "string" && typeof run.status === "string", "EV-SHAPE", "the workflow run has no event or status");
  const rawPath = str(run.path) ?? "";
  return {
    id: run.id,
    run_number: intOrNull(run.run_number) ?? 0,
    run_attempt: intOrNull(run.run_attempt) ?? 0,
    event: run.event.slice(0, 60),
    status: run.status.slice(0, 40),
    conclusion: str(run.conclusion, 40),
    head_branch: str(run.head_branch),
    head_sha: run.head_sha,
    workflow_path: rawPath.split("@")[0],
    workflow_name: str(run.name) ?? "",
    html_url: str(run.html_url) ?? "",
    created_at: ts(run.created_at),
    run_started_at: ts(run.run_started_at),
    updated_at: ts(run.updated_at),
    actor_login: str(run.actor && run.actor.login, 100),
    head_repository: str(run.head_repository && run.head_repository.full_name, 200),
  };
}

function jobList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.jobs)) return payload.jobs;
  if (payload && payload.jobs && Array.isArray(payload.jobs.jobs)) return payload.jobs.jobs;
  throw new EvidenceError("EV-SHAPE", "the jobs payload must be a list of jobs, or an object with a jobs list");
}

export function normalizeJobs(payload) {
  return jobList(payload).map((j) => {
    need(j && typeof j === "object", "EV-SHAPE", "a job must be an object");
    need(Number.isInteger(j.id) && typeof j.name === "string" && typeof j.head_sha === "string" && SHA_RE.test(j.head_sha), "EV-SHAPE", "a job has no id, name or full head_sha");
    need(Array.isArray(j.steps), "EV-SHAPE", `job ${j.id} has no steps list`);
    return {
      id: j.id,
      run_id: Number.isInteger(j.run_id) ? j.run_id : null, // used for the consistency check only; not part of the output
      name: j.name.slice(0, 400),
      status: str(j.status, 40) ?? "",
      conclusion: str(j.conclusion, 40),
      head_sha: j.head_sha,
      runner_labels: Array.isArray(j.labels) ? j.labels.filter((l) => typeof l === "string").map((l) => l.slice(0, 400)) : [],
      html_url: str(j.html_url) ?? "",
      started_at: ts(j.started_at),
      completed_at: ts(j.completed_at),
      steps: j.steps.map((s) => ({
        number: intOrNull(s && s.number) ?? 0,
        name: str(s && s.name) ?? "",
        status: str(s && s.status, 40) ?? "",
        conclusion: str(s && s.conclusion, 40),
      })),
    };
  });
}

export function normalizeChecks(payload) {
  const list = Array.isArray(payload) ? payload : payload && Array.isArray(payload.check_runs) ? payload.check_runs : null;
  need(list, "EV-SHAPE", "the check runs payload must be a list, or an object with a check_runs list");
  return list.map((c) => {
    need(c && Number.isInteger(c.id) && typeof c.name === "string" && typeof c.head_sha === "string" && SHA_RE.test(c.head_sha), "EV-SHAPE", "a check run has no id, name or full head_sha");
    return {
      id: c.id,
      name: c.name.slice(0, 400),
      status: str(c.status, 40) ?? "",
      conclusion: str(c.conclusion, 40),
      head_sha: c.head_sha,
      app_slug: str(c.app && c.app.slug, 100),
    };
  });
}

/* ------------------------------------------------------------- log parsing */

const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * Split a job log into the segments printed for each `Run <command>` step, and read the token permission block.
 *
 * The group markers are plain log text, and any step can print the same text, so the parser never lets later text overwrite or
 * join anything it has already read (OPS-0005B, finding F-1):
 *   - the FIRST permission block is the only one that is read, and only if it came before the first step header (the runner
 *     prints it while it sets the job up, before any step runs); every later block is counted, never read;
 *   - the FIRST header of a command opens that command's segment; a repeated header opens nothing, so the lines after it are
 *     not added to the earlier segment, and the repeat is recorded;
 *   - every step header is recorded in order, so the caller can compare them with the trusted workflow.
 * This is containment, not authentication: code that runs inside a step can still print anything inside its own segment.
 */
export function parseJobLog(logText) {
  need(typeof logText === "string", "EV-SHAPE", "the job log must be text");
  const lines = logText.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z /, "").replace(ANSI, ""));
  const segments = new Map();
  const runHeaders = [];
  const repeated = new Set();
  let current = null;
  let permissions = null;
  let permissionBlocks = 0;
  let firstBlockIsInitial = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const run = /^##\[group\]Run (.+)$/.exec(line);
    if (line.startsWith("##[group]GITHUB_TOKEN Permissions")) {
      permissionBlocks += 1;
      if (permissionBlocks === 1 && runHeaders.length === 0) {
        firstBlockIsInitial = true;
        permissions = [];
        for (let j = i + 1; j < lines.length && !lines[j].startsWith("##[endgroup]"); j += 1) {
          const m = /^([A-Za-z-]+): (\w+)$/.exec(lines[j].trim());
          if (m) permissions.push({ scope: m[1].toLowerCase(), access: m[2].toLowerCase() });
        }
      }
      current = null;
      continue;
    }
    if (run) {
      const header = run[1].replace(/\\"/g, '"');
      runHeaders.push(header);
      if (segments.has(header)) {
        repeated.add(header);
        current = null;
      } else {
        segments.set(header, []);
        current = header;
      }
      continue;
    }
    if (line.startsWith("##[group]Post ") || line.startsWith("##[group]Complete job")) {
      current = null;
      continue;
    }
    if (current !== null) segments.get(current).push(line);
  }
  return { segments, permissions, permission_blocks: permissionBlocks, permission_block_is_initial: firstBlockIsInitial, run_headers: runHeaders, repeated_run_headers: [...repeated] };
}

/**
 * Compare the step headers a log printed with the ones the trusted workflow's steps produce. Repeated headers are reported by
 * the parser; here: a header that no trusted step produces, and headers whose first occurrences are out of the workflow's order.
 * A header a trusted step should have produced but that is missing is NOT a failure: nobody can forge an absence, and GitHub's
 * own step data (steps.exactly_the_expected_sequence, steps.all_succeeded) is what says whether each step ran.
 */
export function compareRunHeaders(logHeaders, expectedHeaders) {
  if (!Array.isArray(expectedHeaders) || expectedHeaders.length === 0) {
    return { ok: false, unexpected: [], out_of_order: [], detail: "the trusted expectations carry no step headers to compare the log with" };
  }
  const first = [...new Set(logHeaders)];
  const unexpected = first.filter((h) => !expectedHeaders.includes(h));
  const outOfOrder = [];
  let position = -1;
  for (const h of first) {
    const at = expectedHeaders.indexOf(h);
    if (at === -1) continue;
    if (at < position) outOfOrder.push(h);
    else position = at;
  }
  const short = (h) => (h.length > 60 ? `${h.slice(0, 57)}...` : h);
  const parts = [];
  if (unexpected.length) parts.push(`header(s) of no step in the trusted workflow: ${unexpected.slice(0, 3).map((h) => JSON.stringify(short(h))).join(", ")}`);
  if (outOfOrder.length) parts.push(`header(s) out of the trusted workflow's order: ${outOfOrder.slice(0, 3).map((h) => JSON.stringify(short(h))).join(", ")}`);
  return {
    ok: parts.length === 0,
    unexpected,
    out_of_order: outOfOrder,
    detail: parts.length ? parts.join("; ") : `${first.length} step header(s), each a step of the trusted workflow and in its order`,
  };
}

const lastMatch = (lines, re) => {
  let found = null;
  for (const l of lines) {
    const m = re.exec(l);
    if (m) found = m;
  }
  return found;
};

/** Test, validation and build evidence, each read only from the segment of the step that prints it (last match wins). */
export function testEvidence(parsed, commands) {
  const seg = (cmd) => parsed.segments.get(cmd) ?? [];
  const tap = seg(commands.test);
  const n = (name) => {
    const m = lastMatch(tap, new RegExp(`^# ${name} (\\d+)$`));
    return m ? Number(m[1]) : null;
  };
  const v = lastMatch(seg(commands.validate), /^OK: checked (\d+) file\(s\); \d+ warning\(s\)\.$/);
  const b = lastMatch(seg(commands.build), /Generating static pages \((\d+)\/(\d+)\)/);
  return {
    source: "job_log_parse",
    authority: "claim_by_output_of_the_code_under_test",
    tests: n("tests"),
    pass: n("pass"),
    fail: n("fail"),
    cancelled: n("cancelled"),
    skipped: n("skipped"),
    validate_files_checked: v ? Number(v[1]) : null,
    build_static_pages: b ? Number(b[2]) : null,
  };
}

/* ------------------------------------------------------------ expectations */

/**
 * What a correct run looks like, from the TRUSTED workflow file (the base revision's) and the trusted policy.
 * Never derive these from the run being judged.
 */
export function expectationsFromWorkflow(workflowText, policy, { repository, headSha, branch = null }) {
  const wp = policy && policy.workflow_policy;
  need(
    wp && Array.isArray(wp.required_workflow_files) && wp.required_workflow_files.length > 0 && wp.allowed_triggers && typeof wp.allowed_triggers === "object" && Array.isArray(wp.required_commands),
    "EV-WORKFLOW", "the trusted policy defines no workflow policy (required workflow files, allowed triggers and required commands), so it cannot say what a correct CI run looks like",
  );
  const root = parseYaml(workflowText);
  const jobs = get(root, "jobs");
  need(isMap(jobs) && jobs.entries.length === 1, "EV-WORKFLOW", "the trusted workflow must have exactly one job");
  const job = jobs.entries[0];
  const steps = get(job.value, "steps");
  need(isSeq(steps), "EV-WORKFLOW", "the trusted workflow's job has no steps");
  const stepNames = steps.items.map((s, i) => text(get(s, "name")) ?? `(unnamed step ${i + 1})`);
  // The header the runner prints for each step: "Run <first line of the command>" or "Run <action>@<ref>". A step whose header
  // cannot be derived makes the whole list null, and the header check then fails closed instead of guessing.
  const stepHeaders = steps.items.map((s) => {
    const run = get(s, "run");
    if (isScalar(run) && !run.empty && typeof run.value === "string") return run.value.split(/\r?\n/)[0].trim() || null;
    return text(get(s, "uses")) ?? null;
  });
  const find = (cmd) => wp.required_commands.find((c) => c === cmd) ?? cmd;
  return {
    repository,
    head_sha: headSha,
    branch,
    workflow_path: wp.required_workflow_files[0],
    job_name: text(get(job.value, "name")) ?? job.key,
    step_names: stepNames,
    step_headers: stepHeaders.every((h) => typeof h === "string" && h.length > 0) ? stepHeaders : null,
    allowed_events: Object.keys(wp.allowed_triggers),
    commands: { test: find("npm run ops:test"), validate: find("npm run ops:validate"), build: find("npm run build") },
  };
}

/* --------------------------------------------------------------- GitHub CI */

const NOT_RUN = "not run: ";
const LOG_MANDATORY_CHECK_IDS = ["log.permission_block_is_single_and_initial", "log.token_is_read_only", "log.run_headers_not_repeated", "log.run_headers_are_expected_and_in_order"];

/**
 * The consistency checks that a complete assessment needs and that exist only because an optional input was supplied: the check
 * runs for the first, the job log for the rest. A document is complete only if every one of them ran. They are blocking, and
 * when their input is missing they are recorded as failed instead of being left out.
 */
export const MANDATORY_CHECK_IDS = Object.freeze(["checks.match_jobs_from_actions_app", ...LOG_MANDATORY_CHECK_IDS]);

/** What the first collector (OPS-0003) already made mandatory. Documents written then lack the three log-structure checks. */
export const EARLIER_MANDATORY_CHECK_IDS = Object.freeze(["checks.match_jobs_from_actions_app", "log.token_is_read_only"]);

/**
 * The consistency checks that need only normalised GitHub data: the run, the jobs, the steps and the check runs. The collector
 * runs them on the data it has just normalised; a consumer runs the SAME function on the data embedded in a document and compares
 * the answers with the recorded ones, so a recorded result that the embedded data does not support is found (OPS-0006).
 * Jobs embedded in a document carry no run id; a missing run id is treated as "not reported", as for an unreported one.
 */
export function coreChecks(r, js, cs, expected) {
  const checks = [];
  const add = (id, passed, detail, blocking = true) => checks.push({ id, passed: Boolean(passed), blocking, detail: String(detail).slice(0, 400) });

  add("run.head_sha_is_expected", r.head_sha === expected.head_sha, `run ${r.head_sha.slice(0, 12)} vs expected ${expected.head_sha.slice(0, 12)}`);
  add("run.workflow_path_is_expected", r.workflow_path === expected.workflow_path, `${JSON.stringify(r.workflow_path)} vs ${JSON.stringify(expected.workflow_path)}`);
  add("run.event_is_allowed", expected.allowed_events.includes(r.event), `event ${JSON.stringify(r.event)}; allowed ${expected.allowed_events.join(", ")}`);
  if (expected.branch !== null) add("run.branch_is_expected", r.head_branch === expected.branch, `${JSON.stringify(r.head_branch)} vs ${JSON.stringify(expected.branch)}`);
  add("run.completed_successfully", r.status === "completed" && r.conclusion === "success", `status ${r.status}, conclusion ${r.conclusion}`);
  add("run.first_attempt", r.run_attempt === 1, `attempt ${r.run_attempt}${r.run_attempt > 1 ? " (a re-run: ask why the first attempt did not count)" : ""}`, false);
  add("run.not_from_fork", r.head_repository === null || r.head_repository === expected.repository, `head repository ${r.head_repository ?? "(not reported)"}`, false);

  const named = js.filter((j) => j.name === expected.job_name);
  add("jobs.exactly_one_expected_job", js.length === 1 && named.length === 1, `${js.length} job(s): ${js.map((j) => j.name).join(", ") || "none"}; expected exactly one named ${JSON.stringify(expected.job_name)}`);
  add("jobs.bound_to_run_and_commit", js.every((j) => (j.run_id === null || j.run_id === undefined || j.run_id === r.id) && j.head_sha === expected.head_sha), "every job's run id and commit match the run and the expected commit");
  const job = named[0] ?? null;
  add("jobs.completed_successfully", job !== null && job.status === "completed" && job.conclusion === "success", job ? `status ${job.status}, conclusion ${job.conclusion}` : "no expected job");
  const userSteps = job ? job.steps.filter((s) => !PSEUDO_STEP(s.name)) : [];
  add("steps.exactly_the_expected_sequence", job !== null && JSON.stringify(userSteps.map((s) => s.name)) === JSON.stringify(expected.step_names), job ? `${userSteps.length} step(s) vs ${expected.step_names.length} expected in the trusted workflow` : "no expected job");
  const notOk = userSteps.filter((s) => !(s.status === "completed" && s.conclusion === "success")).map((s) => `${s.name}: ${s.conclusion ?? s.status}`);
  add("steps.all_succeeded", job !== null && userSteps.length > 0 && notOk.length === 0, notOk.length ? notOk.join("; ") : "every expected step concluded success (a skipped step is not success)");

  // Mandatory checks are never silently absent (OPS-0005B, finding F-2): when their input was not supplied, each is recorded as a
  // failed blocking check whose detail starts with NOT_RUN, so ci_passed cannot be true and the gap is visible in the document.
  if (cs !== null) {
    const bad = js.filter((j) => !cs.some((c) => c.id === j.id && c.app_slug === "github-actions" && c.head_sha === j.head_sha && c.conclusion === j.conclusion && c.name === j.name)).map((j) => j.name);
    add("checks.match_jobs_from_actions_app", js.length > 0 && bad.length === 0, bad.length ? `no matching check run from the github-actions app for: ${bad.join(", ")}` : "each job has a check run of the same id, name, commit and conclusion, reported by the github-actions app");
  } else add("checks.match_jobs_from_actions_app", false, `${NOT_RUN}no check-run data was supplied, so nothing shows that the github-actions app reported these jobs`);
  return checks;
}

/**
 * Normalise and cross-check the GitHub data for one run.
 * @returns the `github_ci` section (including its consistency checks)
 */
export function buildGithubCi({ run, jobs, checkRuns = null, jobLog = null, expected }) {
  const r = normalizeRun(run);
  const js = normalizeJobs(jobs);
  const cs = checkRuns === null ? null : normalizeChecks(checkRuns);
  const checks = coreChecks(r, js, cs, expected);
  const add = (id, passed, detail, blocking = true) => checks.push({ id, passed: Boolean(passed), blocking, detail: String(detail).slice(0, 400) });

  let tokenPermissions = null;
  let tests = null;
  if (jobLog !== null) {
    const parsed = parseJobLog(jobLog);
    add(
      "log.permission_block_is_single_and_initial",
      parsed.permission_blocks === 1 && parsed.permission_block_is_initial,
      parsed.permission_blocks === 1 && parsed.permission_block_is_initial
        ? "exactly one GITHUB_TOKEN Permissions block, printed before the first step header"
        : `${parsed.permission_blocks} GITHUB_TOKEN Permissions block(s)${parsed.permission_blocks > 0 && !parsed.permission_block_is_initial ? ", the first after a step header" : ""}; a genuine log has exactly one, before any step runs, so the log cannot be relied on for the token's permissions`,
    );
    if (parsed.permissions) {
      tokenPermissions = { source: "job_log", permissions: parsed.permissions };
      const extra = parsed.permissions.filter((p) => !(p.access === "read" && (p.scope === "contents" || p.scope === "metadata")));
      add("log.token_is_read_only", extra.length === 0, extra.length ? `unexpected token permission(s): ${extra.map((p) => `${p.scope}: ${p.access}`).join(", ")}` : "the job's token had contents: read and metadata: read only");
    } else add("log.token_is_read_only", false, parsed.permission_blocks === 0 ? "the log has no GITHUB_TOKEN Permissions block" : "no verified GITHUB_TOKEN Permissions block: the first one came after a step header");
    add("log.run_headers_not_repeated", parsed.repeated_run_headers.length === 0, parsed.repeated_run_headers.length ? `repeated step header(s): ${parsed.repeated_run_headers.slice(0, 3).map((h) => JSON.stringify(h.length > 60 ? `${h.slice(0, 57)}...` : h)).join(", ")}; the runner prints each header once, so text after a repeat was not attributed to the earlier step` : "no step header appears twice");
    const order = compareRunHeaders(parsed.run_headers, expected.step_headers);
    add("log.run_headers_are_expected_and_in_order", order.ok, order.detail);
    tests = testEvidence(parsed, expected.commands);
    add("log.tests_clean_as_printed", tests.tests !== null && tests.tests > 0 && tests.fail === 0 && tests.pass === tests.tests, tests.tests === null ? "no TAP summary in the test step's log segment" : `tests ${tests.tests}, pass ${tests.pass}, fail ${tests.fail} (a claim by the code under test)`, false);
  } else {
    for (const id of LOG_MANDATORY_CHECK_IDS) add(id, false, `${NOT_RUN}no job log was supplied`);
  }

  return {
    workflow_run: r,
    jobs: js.map((j) => ({
      id: j.id, name: j.name, status: j.status, conclusion: j.conclusion, head_sha: j.head_sha, runner_labels: j.runner_labels,
      html_url: j.html_url, started_at: j.started_at, completed_at: j.completed_at, steps: j.steps,
    })),
    checks: cs,
    token_permissions: tokenPermissions,
    test_evidence: tests,
    consistency: checks,
  };
}

/* ------------------------------------------------------- evidence document */

const CI_DEFINITION_FLAGS = ["workflow_files_changed", "ops_code_changed", "policy_changed", "schemas_changed", "build_inputs_changed"];

/** Whether CI's own definition is the base's, from the trusted-base section: the one rule, used by the collector and by its consumers. */
export function trustBasisOf(trustedBase, githubCi) {
  if (!githubCi) return "ci_not_collected";
  if (!trustedBase) return "base_unchecked";
  const changed = CI_DEFINITION_FLAGS.some((f) => trustedBase.flags[f]) || trustedBase.package_scripts.ci_entrypoints_changed;
  return changed ? "ci_definition_modified_from_base" : "ci_definition_unchanged_from_base";
}

const MISSING_LABEL = { trusted_base: "the trusted-base check", github_run_data: "GitHub run and job data", check_runs: "check-run data", job_log: "the job log" };

/**
 * Which mandatory inputs of a complete assessment were not supplied, in a fixed order. `job_log` is missing exactly when no test
 * evidence was parsed (it is set whenever a log was supplied), and `check_runs` exactly when no check-run list was kept.
 */
export function missingEvidenceOf(trustedBase, githubCi) {
  const out = [];
  if (trustedBase === null) out.push("trusted_base");
  if (githubCi === null) out.push("github_run_data", "check_runs", "job_log");
  else {
    if (githubCi.checks === null) out.push("check_runs");
    if (githubCi.test_evidence === null) out.push("job_log");
  }
  return out;
}

export function buildEvidenceDocument({ repository, headSha, baseSha = null, branch = null, trustedBase = null, githubCi = null, collector, now = new Date() }) {
  need(typeof repository === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), "EV-ARGS", "repository must look like owner/name");
  need(SHA_RE.test(headSha), "EV-ARGS", "head must be a full 40-character commit id");
  need(trustedBase !== null || githubCi !== null, "EV-ARGS", "give a base revision, GitHub run data, or both");
  const reasons = [];

  // ci_passed is true only when GitHub's data was consistent AND every mandatory check actually ran and held. A mandatory check that
  // never ran is recorded as a failed blocking check by buildGithubCi; a github_ci section from elsewhere that lacks one of them is
  // treated the same way here, so absence can never read as success. ci_passed stays null only when no GitHub data was supplied.
  const blockingFailed = githubCi ? githubCi.consistency.filter((c) => c.blocking && !c.passed) : [];
  const absentMandatory = githubCi ? MANDATORY_CHECK_IDS.filter((id) => !githubCi.consistency.some((c) => c.id === id)) : [];
  const ciPassed = githubCi ? blockingFailed.length === 0 && absentMandatory.length === 0 : null;
  for (const c of blockingFailed) if (!c.detail.startsWith(NOT_RUN)) reasons.push(`CI evidence check failed: ${c.id} (${c.detail})`);
  for (const id of absentMandatory) reasons.push(`CI evidence check missing: ${id} (the mandatory check is not in the document)`);

  const missing = missingEvidenceOf(trustedBase, githubCi);
  const skipped = githubCi ? githubCi.consistency.filter((c) => c.blocking && !c.passed && c.detail.startsWith(NOT_RUN)).map((c) => c.id) : [];
  if (githubCi && (missing.includes("check_runs") || missing.includes("job_log"))) {
    reasons.push(`mandatory evidence missing: ${missing.filter((m) => m === "check_runs" || m === "job_log").map((m) => MISSING_LABEL[m]).join(" and ")}; ci_passed cannot be true and the evidence is not complete without it (${skipped.length} mandatory check(s) did not run)`);
  }

  const basis = trustBasisOf(trustedBase, githubCi);
  if (githubCi) {
    if (basis === "base_unchecked") reasons.push("no base revision was checked, so nothing shows that the CI definition is the established one");
    if (basis === "ci_definition_modified_from_base") reasons.push("the change modifies what CI runs (workflow, ops code, policy, schemas, package scripts or build inputs); its green result is not evidence about those changes");
  }
  if (trustedBase) for (const r of trustedBase.verdict.reasons) reasons.push(r);
  if (ciPassed === false && blockingFailed.length === 0) reasons.push("CI did not pass");

  const complete = missing.length === 0 && absentMandatory.length === 0;
  if (trustedBase === null) reasons.push("evidence is incomplete: no trusted-base check");
  else if (githubCi === null) reasons.push("evidence is incomplete: no GitHub CI data");

  // Incomplete evidence is reported (evidence_complete) but is not by itself a reason for a human: a caller may ask for only one
  // section. Anything that was collected and is not clean is.
  const humanReviewRequired =
    (trustedBase ? trustedBase.verdict.human_review_required : false) ||
    (githubCi ? ciPassed !== true || basis !== "ci_definition_unchanged_from_base" : false);

  return {
    schema_version: "1",
    evidence_kind: "ci_evidence",
    generated_at: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    collector: { tool: collector.tool, tool_source: collector.tool_source, role: collector.role },
    trust: {
      level: "unauthenticated_tool_output",
      authenticated_by_github: false,
      note: "A file cannot prove where it came from. Obtain the GitHub data yourself, run this tool yourself from the base revision, and never accept an evidence file produced by the branch under review.",
    },
    repository,
    subject: { head_sha: headSha, base_sha: baseSha, merge_base_sha: trustedBase ? trustedBase.evaluated.merge_base_sha : null, branch },
    trusted_base: trustedBase,
    github_ci: githubCi,
    verdict: {
      ci_passed: ciPassed,
      ci_trust_basis: basis,
      control_plane_changed: trustedBase ? trustedBase.verdict.control_plane_changed : null,
      human_review_required: humanReviewRequired,
      evidence_complete: complete && blockingFailed.length === 0,
      missing_evidence: missing,
      reasons: [...new Set(reasons)],
    },
  };
}

