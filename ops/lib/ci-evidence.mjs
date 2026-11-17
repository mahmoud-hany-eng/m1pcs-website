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

import { get, isMap, isSeq, parseYaml, text } from "./mini-yaml.mjs";

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

/** Split a job log into the segments printed for each `Run <command>` step, and read the token permission block. */
export function parseJobLog(logText) {
  need(typeof logText === "string", "EV-SHAPE", "the job log must be text");
  const lines = logText.replace(/^﻿/, "").split(/\r?\n/).map((l) => l.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z /, "").replace(ANSI, ""));
  const segments = new Map();
  let current = null;
  let permissions = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const run = /^##\[group\]Run (.+)$/.exec(line);
    if (line.startsWith("##[group]GITHUB_TOKEN Permissions")) {
      permissions = [];
      for (let j = i + 1; j < lines.length && !lines[j].startsWith("##[endgroup]"); j += 1) {
        const m = /^([A-Za-z-]+): (\w+)$/.exec(lines[j].trim());
        if (m) permissions.push({ scope: m[1].toLowerCase(), access: m[2].toLowerCase() });
      }
      current = null;
      continue;
    }
    if (run) {
      current = run[1].replace(/\\"/g, '"');
      if (!segments.has(current)) segments.set(current, []);
      continue;
    }
    if (line.startsWith("##[group]Post ") || line.startsWith("##[group]Complete job")) {
      current = null;
      continue;
    }
    if (current !== null) segments.get(current).push(line);
  }
  return { segments, permissions };
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
  const wp = policy.workflow_policy;
  const root = parseYaml(workflowText);
  const jobs = get(root, "jobs");
  need(isMap(jobs) && jobs.entries.length === 1, "EV-WORKFLOW", "the trusted workflow must have exactly one job");
  const job = jobs.entries[0];
  const steps = get(job.value, "steps");
  need(isSeq(steps), "EV-WORKFLOW", "the trusted workflow's job has no steps");
  const stepNames = steps.items.map((s, i) => text(get(s, "name")) ?? `(unnamed step ${i + 1})`);
  const find = (cmd) => wp.required_commands.find((c) => c === cmd) ?? cmd;
  return {
    repository,
    head_sha: headSha,
    branch,
    workflow_path: wp.required_workflow_files[0],
    job_name: text(get(job.value, "name")) ?? job.key,
    step_names: stepNames,
    allowed_events: Object.keys(wp.allowed_triggers),
    commands: { test: find("npm run ops:test"), validate: find("npm run ops:validate"), build: find("npm run build") },
  };
}

/* --------------------------------------------------------------- GitHub CI */

/**
 * Normalise and cross-check the GitHub data for one run.
 * @returns the `github_ci` section (including its consistency checks)
 */
export function buildGithubCi({ run, jobs, checkRuns = null, jobLog = null, expected }) {
  const r = normalizeRun(run);
  const js = normalizeJobs(jobs);
  const cs = checkRuns === null ? null : normalizeChecks(checkRuns);
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
  add("jobs.bound_to_run_and_commit", js.every((j) => (j.run_id === null || j.run_id === r.id) && j.head_sha === expected.head_sha), "every job's run id and commit match the run and the expected commit");
  const job = named[0] ?? null;
  add("jobs.completed_successfully", job !== null && job.status === "completed" && job.conclusion === "success", job ? `status ${job.status}, conclusion ${job.conclusion}` : "no expected job");
  const userSteps = job ? job.steps.filter((s) => !PSEUDO_STEP(s.name)) : [];
  add("steps.exactly_the_expected_sequence", job !== null && JSON.stringify(userSteps.map((s) => s.name)) === JSON.stringify(expected.step_names), job ? `${userSteps.length} step(s) vs ${expected.step_names.length} expected in the trusted workflow` : "no expected job");
  const notOk = userSteps.filter((s) => !(s.status === "completed" && s.conclusion === "success")).map((s) => `${s.name}: ${s.conclusion ?? s.status}`);
  add("steps.all_succeeded", job !== null && userSteps.length > 0 && notOk.length === 0, notOk.length ? notOk.join("; ") : "every expected step concluded success (a skipped step is not success)");

  if (cs !== null) {
    const bad = js.filter((j) => !cs.some((c) => c.id === j.id && c.app_slug === "github-actions" && c.head_sha === j.head_sha && c.conclusion === j.conclusion && c.name === j.name)).map((j) => j.name);
    add("checks.match_jobs_from_actions_app", js.length > 0 && bad.length === 0, bad.length ? `no matching check run from the github-actions app for: ${bad.join(", ")}` : "each job has a check run of the same id, name, commit and conclusion, reported by the github-actions app");
  }

  let tokenPermissions = null;
  let tests = null;
  if (jobLog !== null) {
    const parsed = parseJobLog(jobLog);
    if (parsed.permissions) {
      tokenPermissions = { source: "job_log", permissions: parsed.permissions };
      const extra = parsed.permissions.filter((p) => !(p.access === "read" && (p.scope === "contents" || p.scope === "metadata")));
      add("log.token_is_read_only", extra.length === 0, extra.length ? `unexpected token permission(s): ${extra.map((p) => `${p.scope}: ${p.access}`).join(", ")}` : "the job's token had contents: read and metadata: read only");
    } else add("log.token_is_read_only", false, "the log has no GITHUB_TOKEN Permissions block");
    tests = testEvidence(parsed, expected.commands);
    add("log.tests_clean_as_printed", tests.tests !== null && tests.tests > 0 && tests.fail === 0 && tests.pass === tests.tests, tests.tests === null ? "no TAP summary in the test step's log segment" : `tests ${tests.tests}, pass ${tests.pass}, fail ${tests.fail} (a claim by the code under test)`, false);
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

export function buildEvidenceDocument({ repository, headSha, baseSha = null, branch = null, trustedBase = null, githubCi = null, collector, now = new Date() }) {
  need(typeof repository === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository), "EV-ARGS", "repository must look like owner/name");
  need(SHA_RE.test(headSha), "EV-ARGS", "head must be a full 40-character commit id");
  need(trustedBase !== null || githubCi !== null, "EV-ARGS", "give a base revision, GitHub run data, or both");
  const reasons = [];

  const blockingFailed = githubCi ? githubCi.consistency.filter((c) => c.blocking && !c.passed) : [];
  const ciPassed = githubCi ? blockingFailed.length === 0 : null;
  for (const c of blockingFailed) reasons.push(`CI evidence check failed: ${c.id} (${c.detail})`);

  let basis = "ci_not_collected";
  if (githubCi) {
    if (!trustedBase) basis = "base_unchecked";
    else {
      const changed = CI_DEFINITION_FLAGS.some((f) => trustedBase.flags[f]) || trustedBase.package_scripts.ci_entrypoints_changed;
      basis = changed ? "ci_definition_modified_from_base" : "ci_definition_unchanged_from_base";
    }
    if (basis === "base_unchecked") reasons.push("no base revision was checked, so nothing shows that the CI definition is the established one");
    if (basis === "ci_definition_modified_from_base") reasons.push("the change modifies what CI runs (workflow, ops code, policy, schemas, package scripts or build inputs); its green result is not evidence about those changes");
  }
  if (trustedBase) for (const r of trustedBase.verdict.reasons) reasons.push(r);
  if (ciPassed === false && blockingFailed.length === 0) reasons.push("CI did not pass");

  const complete = trustedBase !== null && githubCi !== null;
  if (!complete) reasons.push(trustedBase === null ? "evidence is incomplete: no trusted-base check" : "evidence is incomplete: no GitHub CI data");

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
      reasons: [...new Set(reasons)],
    },
  };
}

