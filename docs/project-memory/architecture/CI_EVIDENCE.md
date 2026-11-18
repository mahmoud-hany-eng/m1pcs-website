# CI results as data (OPS-0003)

**Status: implemented on the branch `claude/ops-0003-trusted-ci`, pushed once (HD-0016); its first live run (44082419253, commit 50a46ca) succeeded and the tool processed the real GitHub responses of that run; not merged; advisory only.** Authorised for local implementation (HD-0015). Decision: [ADR-0012](adr/0012-trusted-base-verification-is-advisory-until-anchored.md) (proposed). The trusted-base check that fills one section is described in [TRUSTED_CI.md](TRUSTED_CI.md). **OPS-0005B (local branch `claude/ops-0005b-evidence-hardening`, not pushed) corrected the two weaknesses that the first independent review found: the job-log parser now fails closed on forged or repeated markers (F-1), and evidence can no longer read complete or passed while mandatory checks never ran (F-2). The two subsections at the end of section 3 explain how.**

**Evidence tags:** **[D]** official GitHub documentation read on 2026-11-17. **[O]** observed through read-only GitHub access. **[T]** a test run in this environment. **[U]** not verified from here.

## 1. What a reviewer session needs

A later reviewer (STG-4) must obtain, without trusting the worker that produced the change: the workflow's actual conclusion; each job's and step's result; the commit that was evaluated; the run id; the validation outcomes; and whatever test evidence is available. A worker's own report is a claim (ADR-0006); these facts have to come from GitHub.

## 2. Sources: GitHub's own Actions and Checks APIs, no artifact, no new action

| Fact | GitHub source (REST) | Authoritative? |
|---|---|---|
| Workflow conclusion, event, branch, **evaluated commit**, **run id**, attempt, workflow file path | Workflow run (`GET /repos/{owner}/{repo}/actions/runs/{run_id}`) | Yes: written by GitHub |
| Job and **step** conclusions, job's commit and run id, runner labels | Workflow jobs (`GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs`) | Yes |
| The check that a branch rule would require, and the app that reported it | Check runs (`GET /repos/{owner}/{repo}/commits/{sha}/check-runs`) | Yes. The tool checks that each job has a check run of the same id, name, commit and conclusion reported by the `github-actions` app |
| Token permissions the job really had | The job log's `GITHUB_TOKEN Permissions` block (`GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs`) | GitHub writes that block, but it is inside a log that code under test also writes to, so it is used only as a read-only confirmation, never to establish a fact alone, and only when it is the single block printed before the first step header (see the parsing rules below) |
| Test counts, files checked, pages built | The same job log, from the step that prints them | **No: a claim** by the code under test (`authority: claim_by_output_of_the_code_under_test`) |

No `actions/upload-artifact` was added: it is not an approved action, and the Checks and Actions APIs already hold everything above. Whether an unauthenticated client may download a job log from a public repository was not verified at first **[U]**; it has since been **observed** for run 44082419253 **[O]**: the run, jobs, check-run and job-log responses were all fetched without authentication. The check runs and the log are optional inputs to the tool, but a complete assessment needs both: when one is not given, the document says so in `verdict.missing_evidence`, the checks that depend on it are recorded as not run, and `ci_passed` is false (see the last subsection of section 3).

**No credential is stored or used by the repository.** The tool reads JSON files and git; it does not call GitHub. The party that fetches the GitHub data (a human, or a reviewer session using its own read access) does so itself and hands the responses over. A test asserts that the evidence library imports nothing but the YAML reader and contains no `process.env`, network or child-process use.

## 3. The document

`ops/ci-evidence.mjs` writes one JSON document, validated against [`ci-evidence.schema.json`](../schemas/ci-evidence.schema.json) before it is output (the schema is strict: no unknown field, fixed enums, full commit ids).

| Section | Content |
|---|---|
| `trust` | Always `level: "unauthenticated_tool_output"` and `authenticated_by_github: false`, with a note that a file cannot prove where it came from |
| `subject` | Head commit, base commit, merge-base commit, branch |
| `trusted_base` | The result of the trusted-base check (changed paths with classes, flags, control-plane/protected/immutable paths, package script changes, two rule runs, task scope, verdict), or `null` |
| `github_ci` | `workflow_run`, `jobs` with `steps`, `checks`, `token_permissions`, `test_evidence`, and a list of **consistency checks** (below), or `null` |
| `verdict` | `ci_passed`, `ci_trust_basis`, `control_plane_changed`, `human_review_required`, `evidence_complete`, `missing_evidence`, `reasons` |

Only whitelisted fields are copied from GitHub's responses and every string is capped, so an unexpected field, a token or a commit message in the input cannot reach the output (tested with planted values). Test evidence is read only from the log segment of the step that prints it, and the last match wins within that segment. A forged summary printed by another step without a forged header is ignored (tested); a forged *header* is a different attack, and the rules in the job-log subsection below reject it (OPS-0005B).

### Consistency checks (`github_ci.consistency`)

The expectations come from the **trusted** workflow and policy (the base revision's, or files the caller names), never from the run being judged.

| Check | Blocking | Fails when |
|---|---|---|
| `run.head_sha_is_expected` | yes | The run was for another commit |
| `run.workflow_path_is_expected` | yes | The run is of a different workflow file, whatever its name says |
| `run.event_is_allowed` | yes | The event is not one the policy approves (`pull_request_target`, `workflow_dispatch`, `workflow_run`, `schedule`, ... fail) |
| `run.branch_is_expected` | yes | A branch was named and the run is on another |
| `run.completed_successfully` | yes | Not `completed` with `success` |
| `run.first_attempt` | no | A re-run (reported, with a reason to ask why the first attempt did not count) |
| `run.not_from_fork` | no | The head repository is not this repository |
| `jobs.exactly_one_expected_job` | yes | More or fewer jobs than the trusted workflow defines, or another name |
| `jobs.bound_to_run_and_commit` | yes | A job belongs to another run or commit |
| `jobs.completed_successfully` | yes | The job did not succeed |
| `steps.exactly_the_expected_sequence` | yes | The steps are not exactly those of the trusted workflow: none missing, none added, none renamed, none reordered (a branch that rewrote its own workflow does not change what is expected; tested) |
| `steps.all_succeeded` | yes | Any step is not `success` (a skipped step is not a success) |
| `checks.match_jobs_from_actions_app` | yes | A job has no check run of the same id, name, commit and conclusion from the `github-actions` app, **or no check-run data was supplied** (recorded as *not run*, which fails) |
| `log.permission_block_is_single_and_initial` | yes | The log does not have exactly one `GITHUB_TOKEN Permissions` block, or the first one came after a step header, or no job log was supplied (*not run*) |
| `log.token_is_read_only` | yes | The log shows a token permission beyond `contents: read` and `metadata: read`, or there is no *verified* permission block, or no job log was supplied (*not run*). Only the first block is read, and only if it is the initial one |
| `log.run_headers_not_repeated` | yes | Any `Run <command>` step header appears more than once in the log, or no job log was supplied (*not run*) |
| `log.run_headers_are_expected_and_in_order` | yes | A header belongs to no step of the trusted workflow, or the first occurrences of the headers are not in the trusted workflow's order, or the trusted expectations carry no step headers, or no job log was supplied (*not run*) |
| `log.tests_clean_as_printed` | no | The printed TAP summary shows failures or inconsistent counts: reported, but a log can never decide alone |

### How the verdict is formed

- `ci_passed` is true only when every blocking check **ran and passed**, including the mandatory checks that need the check runs and the job log. A mandatory check whose input was not supplied is recorded as a failed blocking check (its detail begins `not run:`), so `ci_passed` is false: not established as passed is not passed. It is `null` only when no GitHub run data was supplied at all.
- `evidence_complete` is true only when every mandatory input was supplied (`missing_evidence` is empty), every mandatory check ran, and no blocking check failed.
- `missing_evidence` lists, in a fixed order, the mandatory inputs that were not supplied: `trusted_base`, `github_run_data`, `check_runs`, `job_log`.
- `ci_trust_basis` is `ci_definition_unchanged_from_base` only when a trusted-base section is present and the change did **not** touch the workflow, `ops/`, the policy, the schemas, a build input or a CI package script. Otherwise it is `ci_definition_modified_from_base`, `base_unchecked` (GitHub data without a base check) or `ci_not_collected`.
- `human_review_required` is true if the trusted-base verdict asks for it, or if CI data is present and CI did not pass or its definition is not shown to be unchanged. Asking for the trusted-base section alone, with no GitHub data, is not itself a reason for a human. GitHub data that lacks the check runs or the log always is, because `ci_passed` is then false.

### Job-log parsing: its limits and the fail-closed rules (OPS-0005B, finding F-1)

**The limit.** A job log is plain text. The runner prints it, and so does every piece of code that a step runs, with the same timestamps. The group markers (`##[group]GITHUB_TOKEN Permissions`, `##[group]Run <command>`) are text too: a step can print the same bytes, and nothing in the log says who printed a line. The parser therefore cannot authenticate any log text, and no rule below tries to. GitHub's job and step conclusions from the API remain the evidence that each step ran and succeeded; the log is a confirmation and a source of claims (counts), and it never decides success alone.

**What the parser refuses to believe** (each is a failing blocking check, so `ci_passed` is false, and each is tested on mutated copies of the real logs):

| Rule | Reason |
|---|---|
| The first `GITHUB_TOKEN Permissions` block is the only one read, and only if it came before the first step header; later blocks are counted, never read | The runner prints the block while it sets the job up, before any step runs, so nothing a step prints can precede it. A second block, or a block after a step started, cannot be the runner's |
| Exactly one such block must exist | The genuine and a forged block are byte-identical, so two blocks cannot be told apart; the tool fails closed instead of guessing |
| The first `Run <command>` header opens that command's segment; a repeated header opens nothing, so the lines after it never join the earlier segment, and the repeat fails the evidence | The runner prints a step's header once, before that step's output. A repeated header is the only way for code to append text to another step's segment, for example a forged TAP summary to the test step's |
| Every header must belong to a step of the trusted workflow (the first line of its `run` command, or its `uses` value, taken from the base's file) and the first occurrences must follow the workflow's order | A header of no known step, or a step out of order, cannot come from a run of that workflow |
| A header that is **absent** is not a failure | Nobody can forge an absence, and GitHub's step data (`steps.exactly_the_expected_sequence`, `steps.all_succeeded`) already says whether the step ran |

Earlier parsing results are never overwritten: the first block and the first segment of each command win. A repeated header ends the attribution of the lines that follow it (they belong to no segment); that costs nothing, because the evidence has failed by then.

**What remains true.** Code inside a step can still print anything inside that step's own segment, for example a false TAP summary from the test step itself, so counts stay claims (`claim_by_output_of_the_code_under_test`). Forged lines do not need a flagged path to be printed: any code that a step runs, such as the build, can print them. What limits their effect is what each forged line can achieve: a forged permission block matters only if the real token had more than read access, which needs a change to the workflow file (flagged by the trusted-base check as a changed CI definition); forged test counts reach only `log.tests_clean_as_printed`, a non-blocking claim. The rules assume the structure the runner printed in the logs that were examined (runs 43995081483, 44082419253 and 44200515736 **[O]**, plus mutations of them **[T]**); if a future runner changes that structure, the checks fail closed and a person looks.

### What a complete assessment needs, and what a passing CI result is not (OPS-0005B, finding F-2)

| Input | Used for | Listed in `missing_evidence` as |
|---|---|---|
| The base revision and the head (the trusted-base check) | What the change touches, whether CI's own definition changed, the task's scope | `trusted_base` |
| The workflow run and its jobs, from the Actions API | The run's, jobs' and steps' conclusions, the commit and the workflow file | `github_run_data` |
| The check runs for the commit | That the `github-actions` app reported each job (`checks.match_jobs_from_actions_app`) | `check_runs` |
| The job log | The token's permissions and the step headers (the three `log.*` blocking checks), and the claims (counts) | `job_log` |

If an input is missing, the tool still reports what it was given (the run, the jobs, the steps, the check runs or the log, whichever were supplied), records each mandatory check that could not run as a failed blocking check with a detail that begins `not run:`, adds one reason that names what is missing, sets `ci_passed` to false and `evidence_complete` to false, and lists the gap in `missing_evidence`. A `github_ci` section that comes from elsewhere and lacks one of the mandatory checks gets the same result, so an absent check can never read as a passed one.

**Why `ci_passed` is false and not null.** (1) `null` already means that no GitHub run data was supplied; using it for partial data would blur two different states. (2) The review packet builder and the decision gate recompute `ci_passed` from the blocking consistency checks and refuse a document whose own verdict disagrees; a `null` verdict would disagree with their derivation unless they were changed, and changing them is outside this correction and would touch the gate. (3) False and null are both "not true", so for every consumer that tests for `true` they fail closed alike, and false needs no change in them: the gate already answers `DG-CI-FAILED` and `DG-EVIDENCE-INCOMPLETE`, and a reviewer's approval of such evidence cannot produce a valid result (tested). The cost is that false does not say whether CI failed or was not established; a consumer must read `missing_evidence` and `reasons`, which say it.

**Compatibility.** The schema keeps `schema_version` 1. The current verdict shape requires `missing_evidence`; the earlier shape, which lacks it, is still valid (an `anyOf` of the two), so evidence written before this change, such as the stored real evidence of run 44082419253, still validates and still builds a packet that the gate judges as it did. A consumer that finds `missing_evidence` absent must not assume that nothing is missing; it relies on `evidence_complete`, which in an earlier document only meant that a trusted-base section and GitHub data were present.

**CI success is not authorization to proceed.** A complete, green document says that GitHub reports the steps of the base's workflow succeeded on this commit and that a few cross-checks held. It does not say that the change may be merged, deployed or built on. That is decided by the deterministic policy and, where it requires, a person (ADR-0005): control-plane and protected paths, class B and C work, merging, deploying, anything touching money, identity, data or production. `ci_passed: true` is a necessary input and never a permission. `human_review_required` stays true whenever CI's own definition changed, and the decision gate always reports that a human is required and that nothing was merged, deployed, authorised or launched. Even a complete document is unauthenticated tool output.

## 4. A real run as the first fixture

The data of the first live run (run 43995081483, job 133745025105, commit 0aba5e8, branch `claude/ops-0002-ci-baseline`, event `push`, conclusion `success`) is stored in `ops/tests/fixtures/ci/`:

| File | Provenance |
|---|---|
| `live-run-43995081483.run.json`, `.jobs.json` | Real GitHub API data, reduced to the public fields |
| `live-run-43995081483.job.log.txt` | A real 83-line excerpt of the job log, including the token permission block, `OK: checked 93 file(s); 0 warning(s).`, the TAP summary `# tests 353`, `# pass 353`, `# fail 0` and `Generating static pages (56/56)` |
| `live-run-43995081483.check-runs.synthetic.json` | **Synthetic.** The shape of the Checks API response. Its id, name, status and conclusion equal the real check run (it was observed through the check-run tool); the app slug `github-actions` was not observed at that time. The check runs of the later real run (44082419253) confirm the shape and the `github-actions` slug **[O]** |

From it the tool reads: workflow conclusion `success`, one job `verify` with nine expected steps all `success`, token permissions `contents: read` and `metadata: read`, 353 of 353 tests passing as printed, 93 files checked, 56 static pages. With a base check showing no change to the CI definition, the verdict is "CI passed; the CI definition is unchanged; no human review required by the evidence".

## 5. What this does not give

- **No authentication of the document.** Anyone can write a file that looks like one; the consumer must fetch the GitHub data and run the tool itself, from the base. Signing it would need a secret or an attestation action, neither of which is approved.
- **Live evidence is one run.** The tool has processed the real, unmodified GitHub responses of one run of this branch (44082419253; stored in `ops/tests/fixtures/ci/real-run-44082419253.*`, with a real-versus-synthetic table in that directory's README). The workflow does not run the tool, and it has not been tried against a failing run, a re-run or a pull-request event on GitHub; those cases are tested only on fixtures and throwaway repositories.
- **Test counts are not verified facts.** A branch could print any TAP summary; the counts matter only because the step that printed them succeeded under a CI definition that is unchanged from the base.
- **The consumers do not yet recompute completeness.** The review packet builder and the decision gate recompute `ci_passed` from the consistency checks, but they read `evidence_complete` and `missing_evidence` from the document. A hand-written document that simply omits the mandatory checks would pass their derivation. This tool never produces one, but closing the gap needs a change to those components, which was outside OPS-0005B and is proposed in its report.
- **It does not decide.** The deterministic policy, with a human where required, decides (ADR-0005). The document is an input.
