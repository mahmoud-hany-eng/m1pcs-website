# OPS-0006 — run record, attempt 2 (corrections to the findings of Review B)

**Local only. Nothing was pushed, merged or deployed.** This record carries the structure of a worker run report (`docs/project-memory/schemas/run-report.schema.json`) in the JSON block at the end, which is valid against that schema. It is a Markdown file and not `report.json` because the validator requires a report's `branch` and `base_branch` to equal the task's single `branch` and `base_branch` (`REPORT-BRANCH`, confirmed by trial), and attempt 2 runs on another branch. As a consequence the packet builder, which requires a `report.json` for the attempt (`PK-NO-REPORT`), cannot build a packet for attempt 2 either: its independent review has to be a written advisory review anchored to the baseline. Changing that is a design decision for the owner and a separate task.

## Baseline and commits

| Role | Commit |
|---|---|
| **Review baseline: the published OPS-0006 tip, which precedes every correction of this attempt** | `9cec0ddeea8c9bb1e67905ea6871c6f2c1517a67` |
| Scope record (`ATTEMPT-2-SCOPE.md`, not a task file) | `6ff8c925bae62a825601fc36ad8ca104dd09d8d9` |
| F-1: strict evidence-base matching | `6f15662c1729152519941403911d8c1a5d44aece` |
| F-2: baseline provenance read from history | `a388a1bdacc54b29a47ce1cd72d7e70ba1832cec` |
| Tests and documentation (last work commit, `head_sha`) | `d530cf02a8116d7ffc8363ecfe96ed267dd8668e` |

The branch is `claude/ops-0006-review-fixes`, created locally from the published tip. `claude/ops-0006-consumer-integrity` (`9cec0ddeea8c9bb1e67905ea6871c6f2c1517a67`) and `claude/ops-0005b-evidence-hardening` are unchanged. The baseline is the published tip and not the scope commit on purpose: under the F-2 rule a baseline that differs from the base by anything other than the task definition is not independent, and the scope file is not the task definition. The approved task definition (`tasks/OPS-0006-consumer-integrity.md`) is unchanged and is the only task file for OPS-0006, so packet discovery is unaffected.

## What changed

- **F-1.** `deriveCi` ran the cross-check of the changed paths against the CI trust basis only when `evidence.subject.base_sha` equalled the packet's base. `bindComparison` now requires, for the builder and the verifier alike, that the evidence subject's and the trusted-base evaluation's base, merge-base and head equal what the consumer computed, that the recorded changed paths equal the computed ones (a truncated list by membership and count), and that the CI-definition flags equal flags recomputed from the consumer's own paths. A mismatch is inconsistent: refused (`PK-EVIDENCE`), reported (`PK-EVIDENCE-INCONSISTENT`) and judged invalid by the gate. No other base is substituted. The evidence schema is unchanged.
- **F-2.** `baselineProvenance` reads every commit between the base and the baseline. The baseline is independent only if it is an ancestor of the head and either is the base or every commit between them changes nothing but the task definition the review uses. Other paths, merge commits, a non-descendant, or a history that cannot be read (over 200 commits) are not independent. The manifest records `relation_to_base`, `commits_after_base`, `non_preparation_paths` and `history_verified`; the verifier checks that they agree with each other and with the commit ids; the gate says why. The human exception mechanism is unchanged.
- **Documentation.** Only `REVIEW_PACKET.md`: strict evidence-base matching, verified baseline provenance, the residual limits of offline verification, why an approved reviewer decision cannot authorise a sensitive operation, and the test and mutation results.

## Results

561 of 561 tests (540 + 21), lint, type check, project-memory validation and the production build (56 of 56 pages) pass in a clean-environment **local simulation, not a GitHub Actions run**. The new tests fail against the code of the published tip (7 of 9 F-1 tests and 12 baseline tests: the old code builds the packet silently) and pass against the corrected code. Targeted mutation: 37 weakenings, 33 caught on the first run, two real test gaps closed (35 caught), two equivalent mutants. The real stored evidence of runs 44082419253 and 44289023798 still builds and verifies for its own comparison and is refused for any other. `main`, `claude-dev`, the eight Reel commits, `src/`, `public/`, `creative/`, `.github/` and `HUMAN_DECISIONS.md` are untouched.

## Structured record

```json
{
  "schema_version": "1",
  "report_kind": "worker_run_report",
  "task_id": "OPS-0006",
  "attempt_id": "OPS-0006-a2",
  "attempt_number": 2,
  "trust": {
    "level": "unverified_worker_claim",
    "verified_by_orchestrator": false
  },
  "session": {
    "id": "session_01JfqSpyHPxpWCRiwr546Nt4",
    "url": "https://claude.ai/code/session_01JfqSpyHPxpWCRiwr546Nt4"
  },
  "branch": "claude/ops-0006-review-fixes",
  "base_branch": "claude/ops-0006-consumer-integrity",
  "base_sha": "9cec0ddeea8c9bb1e67905ea6871c6f2c1517a67",
  "head_sha": "d530cf02a8116d7ffc8363ecfe96ed267dd8668e",
  "started_at": "2026-11-18T13:05:00Z",
  "finished_at": "2026-11-18T13:41:41Z",
  "outcome": "completed",
  "summary": "Corrected the two major findings of the independent Review B of OPS-0006 attempt 1. F-1: evidence collected for another comparison could skip the cross-check of the changed paths against the CI trust basis; the evidence's base, merge-base, head, recorded changed paths and CI-definition flags must now equal what the consumer computed itself, or the evidence is inconsistent and refused, and no other base is substituted. F-2: baseline independence was decided from final file contents; the commits between the approved base and the baseline are now read one by one, and a baseline is independent only if it is the base or differs from it solely by commits that touch the task definition. The pre-implementation baseline is the published OPS-0006 tip 9cec0ddeea8c9bb1e67905ea6871c6f2c1517a67. Nothing was pushed, merged or deployed; HUMAN_DECISIONS.md, the evidence schema and every forbidden path are unchanged.",
  "commits": [
    {
      "sha": "6ff8c925bae62a825601fc36ad8ca104dd09d8d9",
      "subject": "OPS-0006 attempt 2: record the approved scope of the corrections (not a task file)"
    },
    {
      "sha": "6f15662c1729152519941403911d8c1a5d44aece",
      "subject": "OPS-0006 attempt 2, F-1: evidence must describe the packet's own comparison (fail closed)"
    },
    {
      "sha": "a388a1bdacc54b29a47ce1cd72d7e70ba1832cec",
      "subject": "OPS-0006 attempt 2, F-2: independence is read from the baseline's history, not its final contents"
    },
    {
      "sha": "d530cf02a8116d7ffc8363ecfe96ed267dd8668e",
      "subject": "OPS-0006 attempt 2: close two test gaps found by mutation testing; document the corrections"
    }
  ],
  "changed_files": [
    {
      "path": "docs/project-memory/architecture/REVIEW_PACKET.md",
      "change_type": "modified",
      "additions": 16,
      "deletions": 3
    },
    {
      "path": "docs/project-memory/runs/OPS-0006/OPS-0006-a2/ATTEMPT-2-SCOPE.md",
      "change_type": "added",
      "additions": 77,
      "deletions": 0
    },
    {
      "path": "docs/project-memory/schemas/review-packet-manifest.schema.json",
      "change_type": "modified",
      "additions": 34,
      "deletions": 1
    },
    {
      "path": "ops/lib/decision-gate.mjs",
      "change_type": "modified",
      "additions": 4,
      "deletions": 3
    },
    {
      "path": "ops/lib/review-packet.mjs",
      "change_type": "modified",
      "additions": 147,
      "deletions": 24
    },
    {
      "path": "ops/review-packet.mjs",
      "change_type": "modified",
      "additions": 3,
      "deletions": 2
    },
    {
      "path": "ops/tests/baseline-checks.test.mjs",
      "change_type": "modified",
      "additions": 188,
      "deletions": 4
    },
    {
      "path": "ops/tests/evidence-consumers.test.mjs",
      "change_type": "modified",
      "additions": 179,
      "deletions": 2
    },
    {
      "path": "ops/tests/review-fixture.mjs",
      "change_type": "modified",
      "additions": 29,
      "deletions": 13
    }
  ],
  "verification": [
    {
      "check_id": "install-clean-env",
      "command": "npm ci --ignore-scripts --no-audit --no-fund",
      "exit_code": 0,
      "status": "passed",
      "duration_seconds": 11.4,
      "output_excerpt": "added 385 packages in 11s\nnpm warn deprecated eslint@9.39.5: This version is no longer supported. Please see https://eslint.org/version-support for other options.",
      "output_sha256": "a3144e5c10cf698a443a850cbe7ed40e427b8d622af614290e4c9543ab47ec15",
      "notes": "Run by a local simulation of .github/workflows/ci.yml's steps, in a clean git export of the last work commit with an otherwise empty environment (PATH, a private HOME, CI=true, LANG and proxy/CA settings only; no token). It is NOT a GitHub Actions run."
    },
    {
      "check_id": "lint",
      "command": "npm run lint",
      "exit_code": 0,
      "status": "passed",
      "duration_seconds": 5.6,
      "output_excerpt": "> m1-gaming-pcs@0.1.0 lint\n> eslint .",
      "output_sha256": "e9215c66afe27346477fece39068f6dc7a1fa4a63b4f7d7efd545ddcffd6e85d",
      "notes": "Run by a local simulation of .github/workflows/ci.yml's steps, in a clean git export of the last work commit with an otherwise empty environment (PATH, a private HOME, CI=true, LANG and proxy/CA settings only; no token). It is NOT a GitHub Actions run."
    },
    {
      "check_id": "typecheck",
      "command": "npx tsc --noEmit",
      "exit_code": 0,
      "status": "passed",
      "duration_seconds": 5.1,
      "output_excerpt": "(no output)",
      "output_sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "notes": "Run by a local simulation of .github/workflows/ci.yml's steps, in a clean git export of the last work commit with an otherwise empty environment (PATH, a private HOME, CI=true, LANG and proxy/CA settings only; no token). It is NOT a GitHub Actions run."
    },
    {
      "check_id": "ops-validate",
      "command": "npm run ops:validate",
      "exit_code": 0,
      "status": "passed",
      "duration_seconds": 0.2,
      "output_excerpt": "M1 project-memory validation (root: <local scratch directory>)\nWARNING [TASK-UNAPPROVED] docs/project-memory/tasks/OPS-0006-consumer-integrity.md\n          class B task without approval_reference: it is a proposal and must not be run until a human approval is recorded\nOK: checked 145 file(s); 1 warning(s).",
      "output_sha256": "42c3754cf3ea5a6f22c63ef350ddaa7efaea137548f3c3aa555f844eb1a9358d",
      "notes": "Run by a local simulation of .github/workflows/ci.yml's steps, in a clean git export of the last work commit with an otherwise empty environment (PATH, a private HOME, CI=true, LANG and proxy/CA settings only; no token). It is NOT a GitHub Actions run. One expected warning: TASK-UNAPPROVED."
    },
    {
      "check_id": "ops-test",
      "command": "npm run ops:test",
      "exit_code": 0,
      "status": "passed",
      "duration_seconds": 53.4,
      "output_excerpt": "1..317\n# tests 561\n# suites 0\n# pass 561\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n# duration_ms 53228.660628",
      "output_sha256": "315ef46dd16e9e57590503b09408929ae38ee7d71afc397cf20e0e90af1010a8",
      "notes": "Run by a local simulation of .github/workflows/ci.yml's steps, in a clean git export of the last work commit with an otherwise empty environment (PATH, a private HOME, CI=true, LANG and proxy/CA settings only; no token). It is NOT a GitHub Actions run. 561 tests: the 540 of attempt 1 and 21 new ones."
    },
    {
      "check_id": "build",
      "command": "npm run build",
      "exit_code": 0,
      "status": "passed",
      "duration_seconds": 33.3,
      "output_excerpt": "ttps://monepcs.qa for canonical, sitemap and Open Graph URLs. Set it on the Vercel Production environment to the exact live origin.\n[m1-config] Missing environment variable(s): NEXT_PUBLIC_WHATSAPP_NUMBER, NEXT_PUBLIC_CONTACT_EMAIL, NEXT_PUBLIC_CONTACT_PHONE — the corresponding contact UI will be hidden rather than show placeholder data. Set these before going live.\n[m1-config] NEXT_PUBLIC_SITE_URL is not set — falling back to https://monepcs.qa for canonical, sitemap and Open Graph URLs. Set it on the Vercel Production environment to the exact live origin.\n[m1-config] Missing environment variable(s): NEXT_PUBLIC_WHATSAPP_NUMBER, NEXT_PUBLIC_CONTACT_EMAIL, NEXT_PUBLIC_CONTACT_PHONE — the corresponding contact UI will be hidden rather than show placeholder data. Set these before going live.",
      "output_sha256": "824afa9e3c579ebad2f445ff4a7702b5735e3e63ad6fc877b92413560c90aebc",
      "notes": "Run by a local simulation of .github/workflows/ci.yml's steps, in a clean git export of the last work commit with an otherwise empty environment (PATH, a private HOME, CI=true, LANG and proxy/CA settings only; no token). It is NOT a GitHub Actions run. The usual missing-environment-variable notices are printed, as in CI."
    },
    {
      "check_id": "new-tests-against-old-code",
      "command": "node --test evidence-consumers.test.mjs baseline-checks.test.mjs in a scratch copy whose review-packet.mjs, decision-gate.mjs, CLI and manifest schema are those of the published tip",
      "exit_code": 0,
      "status": "passed",
      "duration_seconds": 60.0,
      "output_excerpt": "Against the published implementation: evidence-consumers 37 tests, 30 pass, 7 fail (the F-1 tests); baseline-checks 21 tests, 9 pass, 12 fail. The key tests fail with 'Missing expected exception': the old code builds the packet silently. Against the corrected code all pass.",
      "output_sha256": "bdde69c11d96cad22842af4a64bd2760c036af10a915b632114c7f61d8985e3b",
      "notes": "Local scratch run. The failures are the point: they show that the tests detect the findings."
    },
    {
      "check_id": "mutation-a2",
      "command": "python3 mutate-a2.py (scratch, not committed): 37 weakenings of the F-1 and F-2 rules, one at a time",
      "exit_code": 0,
      "status": "passed",
      "duration_seconds": 1500.0,
      "output_excerpt": "killed 33 of 37 on the first run. Survivors: F1-05 and F2-10 (real test gaps, fixed), F2-08 and F2-09 (equivalent mutants).",
      "output_sha256": "884d7350e5996db2db41572df685a14d8c9c63db36338af2e17ad74573bf0b6c",
      "notes": "Local simulation. See mutation-recheck."
    },
    {
      "check_id": "mutation-recheck",
      "command": "python3 recheck-a2.py (scratch): F1-05 and F2-10 against the strengthened tests, with unmutated controls",
      "exit_code": 0,
      "status": "passed",
      "duration_seconds": 90.0,
      "output_excerpt": "CONTROL (unmutated) evidence-consumers.test.mjs pass\nCONTROL (unmutated) baseline-checks.test.mjs pass\nKILLED   F1-05 the subject's head is not compared | F-1: every identity in the evidence is checked on its own: a changed base, merge\nKILLED   F2-10 independence ignores the relation to the head | F-2 case 7: a baseline that is unrelated to the base, or descends from the revie",
      "output_sha256": "35b48f609df33660eedb58e87dbc794d52894a1eb540c21f46d72e2918aa3161",
      "notes": "Local simulation. After the two tests were added, 35 of 37 weakenings are caught and 2 are equivalent mutants."
    },
    {
      "check_id": "real-evidence-regression",
      "command": "bash real-regression-a2.sh (scratch): the real, unmodified evidence of GitHub runs 44082419253 and 44289023798 and the original OPS-0005 decision, through the corrected tools",
      "exit_code": 0,
      "status": "passed",
      "duration_seconds": 40.0,
      "output_excerpt": "Real OPS-0003 evidence: builds and verifies for its own comparison (still legacy and incomplete; original OPS-0005 decision still REQUIRES_CORRECTIONS, advisory flags unchanged); refused for another base (EV-BASE-MISMATCH). Real OPS-0006 evidence: builds, complete; refused for another base.",
      "output_sha256": "6d2434ef25c150b257645e1817ee8f645d7d3016b7e86e3b8271d0b950194310",
      "notes": "Uses stored real GitHub responses, not a new GitHub Actions run. Nothing in this branch has run on GitHub."
    }
  ],
  "risk": {
    "declared_class": "B",
    "categories": [
      "ops_control_plane",
      "policy_or_schema",
      "tests_only",
      "docs_only"
    ],
    "rationale": "The work changes the review control plane (the packet builder, verifier and gate), the manifest schema and the tests that guard them, so policy computes class B and every changed path is protected. It adds no write capability, workflow, secret, dependency or website file; it only makes the consumers stricter."
  },
  "protected_paths_touched": [
    "docs/project-memory/architecture/REVIEW_PACKET.md",
    "docs/project-memory/schemas/review-packet-manifest.schema.json",
    "ops/lib/decision-gate.mjs",
    "ops/lib/review-packet.mjs",
    "ops/review-packet.mjs",
    "ops/tests/baseline-checks.test.mjs",
    "ops/tests/evidence-consumers.test.mjs",
    "ops/tests/review-fixture.mjs"
  ],
  "deviations": [
    {
      "description": "This run record is Markdown and not a schema-valid report.json, although the owner asked for a separate schema-valid Attempt 2 report 'when supported'.",
      "reason": "It is not supported: the validator requires a report's branch and base_branch to equal the task's single branch and base_branch (REPORT-BRANCH, confirmed by trial), and attempt 2 runs on another branch. The structured block below is valid against run-report.schema.json."
    },
    {
      "description": "The review baseline is the published OPS-0006 tip, not the scope commit, so the Attempt 2 scope file is part of the reviewed range and not of the baseline.",
      "reason": "The owner allowed the published tip. A baseline that included the scope file would differ from the base by something other than the task definition, which is what the F-2 rule treats as not independent."
    },
    {
      "description": "One OPS-0006 test (base_has_task_file) was corrected, two assertions on the gate's computed baseline gained two fields, and the test fixture gained collectEvidence and writeEvidence helpers.",
      "reason": "The test had offered the builder evidence for another base, which the old code tolerated and F-1 now refuses; the gate's computed baseline now carries relation_to_base and commits_after_base."
    },
    {
      "description": "The mutation run and the old-code run are scratch tools and are not committed.",
      "reason": "Consistent with earlier tasks; the lists and results are in this record and REVIEW_PACKET.md."
    }
  ],
  "unresolved_issues": [
    {
      "severity": "major",
      "category": "ops_control_plane",
      "description": "Attempt 2 cannot be reviewed through the packet and the gate: the packet builder requires docs/project-memory/runs/OPS-0006/OPS-0006-a2/report.json (PK-NO-REPORT), and the validator refuses a report on a branch other than the task's (REPORT-BRANCH). The review has to be a written advisory review anchored to the baseline. Letting a task name additional attempt branches is a design decision for the owner and a separate task."
    },
    {
      "severity": "major",
      "category": "ops_control_plane",
      "description": "The evidence file is still an unauthenticated document; the three log-structure checks cannot be recomputed from it; a forger who invents a self-consistent document with fabricated GitHub data passes every offline check (OQ-0035)."
    },
    {
      "severity": "minor",
      "category": "ops_control_plane",
      "description": "The approved base is an argument to the builder: a worker who names a late commit as both the base and the baseline gets a clean-looking history. The owner pins the base and the baseline in the reviewer's launch message."
    },
    {
      "severity": "minor",
      "category": "ops_control_plane",
      "description": "The preparation commits are judged by the paths they touch, not by what the task definition says in them; the offline verifier checks that the manifest's claims agree with each other, not that the git facts are true."
    },
    {
      "severity": "minor",
      "category": "ops_control_plane",
      "description": "The tools a reviewer runs from baseline 9cec0dd are the attempt-1 tools, which contain the two flaws this attempt corrects; the gate cannot confirm the corrections. The reviewer must read the code and tests."
    },
    {
      "severity": "minor",
      "category": "other",
      "description": "This branch has not run on GitHub; the clean-environment results are local simulations. There is no decision record for OPS-0006 (TASK-UNAPPROVED remains)."
    }
  ],
  "assumptions": [
    "started_at and finished_at are approximate: the scope commit is at 2026-11-18T13:07:24Z.",
    "The pre-implementation baseline is the published OPS-0006 tip 9cec0ddeea8c9bb1e67905ea6871c6f2c1517a67; the scope commit 6ff8c92 is its direct child and changes one file, the Attempt 2 scope.",
    "The Review B report itself was not available to me; the two findings were taken from the owner's description and checked against the published source.",
    "The clean-environment simulation, the old-code run, the mutation run and the real-data regression are local; they do not replace a GitHub Actions run."
  ],
  "questions_for_human": [
    "Do you authorize one normal push of exactly claude/ops-0006-review-fixes so the CI workflow runs on it (no merge, no deploy)?",
    "Should a task be allowed to name additional attempt branches, so that a schema-valid report.json (and so a packet and gate review) is possible for a later attempt? That is a separate task.",
    "Do you want an HD record for OPS-0006 (it clears TASK-UNAPPROVED)?"
  ],
  "attestations": {
    "no_secrets_committed": true,
    "no_production_changes": true,
    "no_unauthorized_pushes": true,
    "stayed_within_files_allowed": true
  },
  "next_step_recommendation": {
    "action": "review",
    "rationale": "The corrections are complete and verified locally. A written independent review of attempt 2 against the pinned baseline 9cec0dd, after the owner approves a push so that a real CI run exists, is the next step. No further implementation is recommended before it.",
    "suggested_next_task_title": "OPS-0006 attempt 2: live CI check and independent written review (no new features)"
  }
}
```
