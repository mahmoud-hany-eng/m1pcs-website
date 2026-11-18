---json
{
  "schema_version": "1",
  "task_id": "OPS-0006",
  "title": "Evidence consumer integrity, task identifier compatibility and review baseline checks",
  "objective": "Close three gaps found after OPS-0005B. (1) The review packet builder, the packet verifier and the decision gate read evidence_complete and the trust basis from the evidence document and only partly recompute ci_passed, so a forged or earlier-shape document can look complete: make them derive completeness and the CI facts themselves from the embedded GitHub data and trusted expectations from the baseline, and fail closed. (2) The task, run-report, decision and manifest contracts reject ids such as OPS-0005B: accept one optional uppercase letter suffix, with the matching lowercase branch, everywhere, and nowhere else. (3) A review baseline that contains the reviewed code, or whose scope cannot be verified, is silently accepted: record the relation, refuse it unless an explicit exception is recorded, and make the exception visible to the gate and the human. Recommend, in the roadmap only, the M1 Business Platform as the next workstream. Local only: nothing is pushed, merged or deployed. The review baseline for this task is the commit that adds this file.",
  "depends_on": [
    "OPS-0004"
  ],
  "blocked_by_open_questions": [],
  "requirement_refs": [
    "REQ-OPS-001",
    "REQ-OPS-007",
    "REQ-OPS-008",
    "REQ-OPS-009",
    "REQ-OPS-010",
    "REQ-OPS-011",
    "REQ-OPS-012"
  ],
  "declared_risk_class": "B",
  "declared_risk_categories": [
    "ops_control_plane",
    "policy_or_schema",
    "tests_only",
    "docs_only"
  ],
  "base_branch": "claude/ops-0005b-evidence-hardening",
  "branch": "claude/ops-0006-consumer-integrity",
  "files_allowed": [
    "ops/lib/ids.mjs",
    "ops/lib/ci-evidence.mjs",
    "ops/lib/review-packet.mjs",
    "ops/lib/decision-gate.mjs",
    "ops/lib/trusted-base.mjs",
    "ops/review-packet.mjs",
    "ops/decision-gate.mjs",
    "ops/validate-memory.mjs",
    "ops/tests/**",
    "docs/project-memory/schemas/task.schema.json",
    "docs/project-memory/schemas/run-report.schema.json",
    "docs/project-memory/schemas/review-decision.schema.json",
    "docs/project-memory/schemas/review-packet-manifest.schema.json",
    "docs/project-memory/architecture/REVIEW_PACKET.md",
    "docs/project-memory/architecture/CI_EVIDENCE.md",
    "docs/project-memory/roadmap/ROADMAP.md",
    "docs/project-memory/tasks/OPS-0006-consumer-integrity.md",
    "docs/project-memory/runs/OPS-0006/**"
  ],
  "files_forbidden": [
    ".github/**",
    "src/**",
    "public/**",
    "creative/**",
    "CLAUDE.md",
    "package.json",
    "package-lock.json",
    "next.config.ts",
    "tsconfig.json",
    "vercel.json",
    ".env*",
    "docs/project-memory/decisions/**",
    "docs/project-memory/policy/**",
    "docs/project-memory/requirements/**",
    "docs/project-memory/reviewer/**",
    "docs/project-memory/schemas/policy.schema.json",
    "docs/project-memory/schemas/ci-evidence.schema.json",
    "docs/project-memory/roadmap/OPS-0005B-TASK.md",
    "docs/project-memory/runs/OPS-0005B/**"
  ],
  "out_of_scope": [
    "Pushing, merging, opening a pull request or deploying",
    "Changing GitHub account or repository settings, creating secrets or tokens, or activating a paid service or a new external integration",
    "Any change to HUMAN_DECISIONS.md, any new human-approval entry, and any change to the authority model; the governance model is described in the final report only",
    "Rewriting or amending any existing commit, and any change to the OPS-0005B branch, its task definition or its run record; normalising historical records is proposed in the final report, not done",
    "Any change to the policy, CLAUDE.md, the reviewer prompt, the evidence schema, .github/workflows/ci.yml, the production website or its build configuration",
    "Touching creative/, any Instagram asset or any of the eight unpublished Reel commits",
    "Implementing any M1 business feature (Supabase, authentication, accounts, admin, order tracking, loyalty, finance) or expanding the autonomous orchestration framework",
    "Treating a review packet that can be generated as proof that its baseline is independent",
    "Starting another task, a reviewer run, or a live CI run"
  ],
  "acceptance_criteria": [
    {
      "id": "AC-1",
      "statement": "Consumers derive, not trust. The packet builder, the packet verifier and the decision gate compute ci_passed, evidence_complete and the CI trust basis from the evidence's embedded GitHub and trusted-base data and from expectations taken from the baseline (its workflow, its policy and the mandatory check ids), never from the document's own verdict. A claimed value that the derivation does not support makes a current-shape document inconsistent and refused.",
      "verification_method": "command",
      "command": "node --test ops/tests/evidence-consumers.test.mjs"
    },
    {
      "id": "AC-2",
      "statement": "Mandatory checks. Every mandatory check id must be present, blocking and passed; the facts that can be recomputed from the embedded data (run, job, steps, check runs, token permissions) are recomputed with the collector's own check logic and must equal the recorded results; the checks that depend on the raw log must be present, blocking and passed and are reported as recorded, not recomputed. A missing, non-blocking, failed or contradicted check fails closed.",
      "verification_method": "command",
      "command": "node --test ops/tests/evidence-consumers.test.mjs"
    },
    {
      "id": "AC-3",
      "statement": "Forged evidence. Negative tests cover a verdict that claims complete or passed while mandatory checks are absent, while check runs or the job log are null, or while embedded data contradicts a recorded pass; removed mandatory ids; an emptied missing_evidence; a forged trust basis; and a document built for another commit. The builder refuses them, the verifier rejects a packet carrying them, and none can reach a valid gate result.",
      "verification_method": "command",
      "command": "node --test ops/tests/evidence-consumers.test.mjs"
    },
    {
      "id": "AC-4",
      "statement": "Legacy evidence. A document of the earlier shape (no missing_evidence) still validates, still builds and verifies a packet, and is reported as legacy and incomplete when mandatory checks are absent. The gate then returns requires-corrections with an explicit reason and never the valid result, so it cannot silently qualify for later automation.",
      "verification_method": "command",
      "command": "node --test ops/tests/evidence-consumers.test.mjs"
    },
    {
      "id": "AC-5",
      "statement": "Bindings and human authority are preserved. The head commit, the policy version, the prompt version and the evidence, report and diff hashes remain bound; the gate still always requires a human, never treats a reviewer approval as binding, never merges, deploys, authorises or launches, and keeps its human reasons for protected, control-plane and sensitive changes. The existing gate and packet tests pass.",
      "verification_method": "command",
      "command": "node --test ops/tests/decision-gate.test.mjs ops/tests/review-packet.test.mjs"
    },
    {
      "id": "AC-6",
      "statement": "Identifier contract. Task ids accept one optional uppercase letter suffix (OPS-0005B), attempt ids carry it (OPS-0005B-a1), and branches carry the matching lowercase letter (claude/ops-0005b-slug). The patterns come from one shared definition and appear identically in the task, run-report, decision and manifest schemas and in every code reader (packet builder, gate, trusted-base check). Every previously valid id stays valid.",
      "verification_method": "command",
      "command": "node --test ops/tests/identifiers.test.mjs"
    },
    {
      "id": "AC-7",
      "statement": "Identifier negatives. A lowercase suffix, two letters, a digit after the letter, a missing hyphen, a branch whose letter differs from its task's, an attempt of another task, an uppercase branch and a five-digit number are rejected by the schemas and the validator. A consistency test fails if any schema pattern differs from the shared definition.",
      "verification_method": "command",
      "command": "node --test ops/tests/identifiers.test.mjs"
    },
    {
      "id": "AC-8",
      "statement": "History is not rewritten. Valid earlier task files, run reports, decisions and manifests fixtures still validate; the OPS-0005B branch, its task definition and its run record are byte-identical to their state at 1243d896348a42a92af07a1ea345ee72b2657e4b; the proposed way to normalise them is described in the final report.",
      "verification_method": "inspection",
      "command": null
    },
    {
      "id": "AC-9",
      "statement": "Baseline checks. The packet builder records how the baseline relates to the head, how many reviewed paths already exist in it, whether the approved task definition is in the baseline and in the base, and whether the evidence's trusted-base check established the task's scope. It refuses a baseline that contains the reviewed code unless an exception naming an existing decision is recorded; the manifest shows it, and such a packet is never called independent.",
      "verification_method": "command",
      "command": "node --test ops/tests/baseline-checks.test.mjs"
    },
    {
      "id": "AC-10",
      "statement": "Baseline gate behaviour and tests. The gate warns and requires a human for a recorded exception and for a scope that the base could not establish, returns requires-corrections for a weak baseline without a recorded exception (including a forged manifest), and the verifier rejects a manifest whose independence claim contradicts its own fields. Tests cover independent, mid-work, descending, unrelated and task-less baselines and the exception path.",
      "verification_method": "command",
      "command": "node --test ops/tests/baseline-checks.test.mjs"
    },
    {
      "id": "AC-11",
      "statement": "Real evidence and the original decision. The stored real evidence of run 44082419253 still validates; with it, the original OPS-0005 reviewer decision is still judged as advice only (human required, not binding, no automation) and is reported as legacy-incomplete evidence rather than silently accepted; evidence collected again from the same real data is complete.",
      "verification_method": "command",
      "command": "node --test ops/tests/real-evidence.test.mjs ops/tests/evidence-consumers.test.mjs"
    },
    {
      "id": "AC-12",
      "statement": "Documentation. REVIEW_PACKET.md states how consumers derive completeness, how legacy evidence is treated and how the baseline is classified; CI_EVIDENCE.md names the consumer recomputation and no longer lists it as a gap. ROADMAP.md recommends the M1 Business Platform as the next workstream in the owner's five priorities, on isolated claude/** branches, integrated on claude-dev, released to main only with owner approval, and implements none of it.",
      "verification_method": "inspection",
      "command": null
    },
    {
      "id": "AC-13",
      "statement": "Lint, type check, project-memory validation, every automated test and the production build pass in a checkout that installed dependencies with npm ci --ignore-scripts, with exact test counts recorded. Local runs are never described as GitHub Actions runs.",
      "verification_method": "command",
      "command": "npm ci --ignore-scripts --no-audit --no-fund && npm run lint && npx tsc --noEmit && npm run ops:validate && npm run ops:test && npm run build"
    },
    {
      "id": "AC-14",
      "statement": "Boundaries. Nothing under src/, public/, creative/, .github/, CLAUDE.md, package.json, the policy, the reviewer files, the evidence schema, or any build or Vercel configuration differs from the base; HUMAN_DECISIONS.md is unmodified; none of the eight Reel commits is reachable; nothing is pushed; main, claude-dev and the OPS-0005B branch are unchanged.",
      "verification_method": "inspection",
      "command": null
    },
    {
      "id": "AC-15",
      "statement": "Review baseline. The commit that adds this file is the baseline for reviewing the implementation. It sits directly on 1243d896348a42a92af07a1ea345ee72b2657e4b, changes only this file, and contains none of the OPS-0006 implementation; every implementation commit descends from it. A schema-valid run report at runs/OPS-0006/OPS-0006-a1/report.json records its SHA.",
      "verification_method": "command",
      "command": "node ops/validate-memory.mjs --file docs/project-memory/runs/OPS-0006/OPS-0006-a1/report.json"
    }
  ],
  "required_checks": [
    {
      "id": "lint",
      "command": "npm run lint",
      "description": "ESLint over the repository",
      "must_pass": true
    },
    {
      "id": "typecheck",
      "command": "npx tsc --noEmit",
      "description": "TypeScript type check",
      "must_pass": true
    },
    {
      "id": "build",
      "command": "npm run build",
      "description": "Production build of the website",
      "must_pass": true
    },
    {
      "id": "ops-validate",
      "command": "npm run ops:validate",
      "description": "Offline project-memory and workflow validation",
      "must_pass": true
    },
    {
      "id": "ops-test",
      "command": "npm run ops:test",
      "description": "Validator, checker, parser, trusted-base, CI evidence, review packet, decision gate, consumer, identifier and baseline tests",
      "must_pass": true
    }
  ],
  "max_attempts": 3,
  "approval_reference": null,
  "created_at": "2026-11-18T01:40:00Z",
  "created_by": "worker"
}
---
# OPS-0006 — Evidence consumer integrity, task identifier compatibility and review baseline checks

This file records the task that closes the three gaps left after OPS-0005B. It was transcribed by a worker session from the owner's instruction "M1 Gaming PCs — OPS-0006: Evidence Consumer Integrity & Task Contract Compatibility" (received on 2026-11-18); the instruction, not this file, is the authority. `approval_reference` is `null` on purpose: that instruction forbids editing the human-decision log in this task, and authorship of this file grants no approval. The validator therefore reports `TASK-UNAPPROVED`; that warning is accurate and expected.

## Context

OPS-0005B corrected the evidence collector: a mandatory check that cannot run is recorded as failed, `evidence_complete` and `ci_passed` are false without check runs and the job log, and the job-log parser is fail-closed. Its report listed what remained:

- **The consumers do not recompute completeness.** The review packet builder and the decision gate recompute `ci_passed` from the recorded blocking checks, but they read `evidence_complete` and the CI trust basis from the document. A document that omits the mandatory checks, or an earlier-shape document, can read as complete.
- **Identifier contracts reject OPS-0005B.** The task, run-report, decision and manifest schemas allow only `OPS-0001`-style ids and `claude/ops-0001-…` branches, so OPS-0005B had no schema-valid task file or report; its definition and record are Markdown files with the schemas' structure.
- **A baseline can contain the code under review.** OPS-0003 was reviewed from a baseline that descended from the reviewed head (a recorded exception, HD-0017), and nothing in the packet or the gate made that visible.

The branch is stacked on the completed local OPS-0005B branch (1243d896348a42a92af07a1ea345ee72b2657e4b), which is not pushed or merged, because the owner instructed it. This records neither approval to integrate nor approval to deploy. The permanent rules apply unchanged: `claude/**` is feature development, `claude-dev` is staging and integration testing, `main` is production and changes only with the owner's approval; Instagram assets never go into this repository; no additional paid AI service; the eight unpublished Reel commits stay untouched.

## What to do

1. Create the branch and a separate worktree from the OPS-0005B tip. Commit this file alone. That commit is the baseline.
2. Consumers: add one pure derivation of the evidence facts from the embedded data, sharing the collector's own check logic; use it in the packet builder, the verifier and the gate; take the expectations from the baseline; fail closed on absent, non-blocking, failed or contradicted mandatory checks; treat earlier-shape documents as legacy and incomplete; add negative tests with forged documents.
3. Identifiers: one shared definition, the same patterns in the four schemas and every reader, with a consistency test and positive and negative tests.
4. Baseline: compute and record the relation of the baseline to the head, the reviewed paths already in it, the task definition in the baseline and in the base, and whether the task's scope was established; refuse a weak baseline unless an exception naming an existing decision is recorded; show it in the manifest and the gate.
5. Update `REVIEW_PACKET.md`, `CI_EVIDENCE.md` and `ROADMAP.md` only, plus this task's run report. Do not edit `HUMAN_DECISIONS.md`.
6. Verify, commit locally in small commits, and write the run report as a separate final commit that records the baseline SHA. Do not push.

## Out of scope

See the front matter. A correction that turns out to need a file outside `files_allowed` is reported with a proposal and not made.

## How completion is shown

The five required checks with exact test counts, the new test files, targeted mutation testing of the new rules, the real evidence and the original OPS-0005 decision judged by the new consumers, the identifier results on old and new ids, the boundary checks, and the schema-valid run report at `docs/project-memory/runs/OPS-0006/OPS-0006-a1/report.json`. A local simulation of the workflow's commands is not a GitHub Actions run and is never reported as one.
