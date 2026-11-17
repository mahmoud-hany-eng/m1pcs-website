# CI results as data (OPS-0003)

**Status: implemented on the branch `claude/ops-0003-trusted-ci`, pushed once (HD-0016); its first live run (44082419253, commit 50a46ca) succeeded and the tool processed the real GitHub responses of that run; not merged; advisory only.** Authorised for local implementation (HD-0015). Decision: [ADR-0012](adr/0012-trusted-base-verification-is-advisory-until-anchored.md) (proposed). The trusted-base check that fills one section is described in [TRUSTED_CI.md](TRUSTED_CI.md).

**Evidence tags:** **[D]** official GitHub documentation read on 2026-11-17. **[O]** observed through read-only GitHub access. **[T]** a test run in this environment. **[U]** not verified from here.

## 1. What a reviewer session needs

A later reviewer (STG-4) must obtain, without trusting the worker that produced the change: the workflow's actual conclusion; each job's and step's result; the commit that was evaluated; the run id; the validation outcomes; and whatever test evidence is available. A worker's own report is a claim (ADR-0006); these facts have to come from GitHub.

## 2. Sources: GitHub's own Actions and Checks APIs, no artifact, no new action

| Fact | GitHub source (REST) | Authoritative? |
|---|---|---|
| Workflow conclusion, event, branch, **evaluated commit**, **run id**, attempt, workflow file path | Workflow run (`GET /repos/{owner}/{repo}/actions/runs/{run_id}`) | Yes: written by GitHub |
| Job and **step** conclusions, job's commit and run id, runner labels | Workflow jobs (`GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs`) | Yes |
| The check that a branch rule would require, and the app that reported it | Check runs (`GET /repos/{owner}/{repo}/commits/{sha}/check-runs`) | Yes. The tool checks that each job has a check run of the same id, name, commit and conclusion reported by the `github-actions` app |
| Token permissions the job really had | The job log's `GITHUB_TOKEN Permissions` block (`GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs`) | GitHub writes that block, but it is inside a log that code under test also writes to, so it is used only as a read-only confirmation, never to establish a fact alone |
| Test counts, files checked, pages built | The same job log, from the step that prints them | **No: a claim** by the code under test (`authority: claim_by_output_of_the_code_under_test`) |

No `actions/upload-artifact` was added: it is not an approved action, and the Checks and Actions APIs already hold everything above. Whether an unauthenticated client may download a job log from a public repository was not verified at first **[U]**; it has since been **observed** for run 44082419253 **[O]**: the run, jobs, check-run and job-log responses were all fetched without authentication. The log is still optional and the document says when it was not given.

**No credential is stored or used by the repository.** The tool reads JSON files and git; it does not call GitHub. The party that fetches the GitHub data (a human, or a reviewer session using its own read access) does so itself and hands the responses over. A test asserts that the evidence library imports nothing but the YAML reader and contains no `process.env`, network or child-process use.

## 3. The document

`ops/ci-evidence.mjs` writes one JSON document, validated against [`ci-evidence.schema.json`](../schemas/ci-evidence.schema.json) before it is output (the schema is strict: no unknown field, fixed enums, full commit ids).

| Section | Content |
|---|---|
| `trust` | Always `level: "unauthenticated_tool_output"` and `authenticated_by_github: false`, with a note that a file cannot prove where it came from |
| `subject` | Head commit, base commit, merge-base commit, branch |
| `trusted_base` | The result of the trusted-base check (changed paths with classes, flags, control-plane/protected/immutable paths, package script changes, two rule runs, task scope, verdict), or `null` |
| `github_ci` | `workflow_run`, `jobs` with `steps`, `checks`, `token_permissions`, `test_evidence`, and a list of **consistency checks** (below), or `null` |
| `verdict` | `ci_passed`, `ci_trust_basis`, `control_plane_changed`, `human_review_required`, `evidence_complete`, `reasons` |

Only whitelisted fields are copied from GitHub's responses and every string is capped, so an unexpected field, a token or a commit message in the input cannot reach the output (tested with planted values). Test evidence is read only from the log segment of the step that prints it, and the last match wins within that segment: a forged summary printed by another step is ignored (tested).

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
| `checks.match_jobs_from_actions_app` | yes | A job has no check run of the same id, name, commit and conclusion from the `github-actions` app |
| `log.token_is_read_only` | yes | The log shows a token permission beyond `contents: read` and `metadata: read`, or no permission block |
| `log.tests_clean_as_printed` | no | The printed TAP summary shows failures or inconsistent counts: reported, but a log can never decide alone |

### How the verdict is formed

- `ci_passed` is true only when every blocking check passes.
- `ci_trust_basis` is `ci_definition_unchanged_from_base` only when a trusted-base section is present and the change did **not** touch the workflow, `ops/`, the policy, the schemas, a build input or a CI package script. Otherwise it is `ci_definition_modified_from_base`, `base_unchecked` (GitHub data without a base check) or `ci_not_collected`.
- `human_review_required` is true if the trusted-base verdict asks for it, or if CI data is present and CI did not pass or its definition is not shown to be unchanged. Incomplete evidence is reported in `evidence_complete`; asking for one section only is not itself a reason for a human.

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
- **It does not decide.** The deterministic policy, with a human where required, decides (ADR-0005). The document is an input.
