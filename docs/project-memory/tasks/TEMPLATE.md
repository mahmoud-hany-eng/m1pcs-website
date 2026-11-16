---json
{
  "schema_version": "1",
  "task_id": "OPS-0000",
  "title": "Short imperative title of the task",
  "objective": "What the task must achieve and why, in plain language. Replace this text.",
  "depends_on": [],
  "blocked_by_open_questions": [],
  "requirement_refs": [],
  "declared_risk_class": "B",
  "declared_risk_categories": ["other"],
  "base_branch": "claude-dev",
  "branch": "claude/ops-0000-example-slug",
  "files_allowed": ["docs/example/**"],
  "files_forbidden": [],
  "out_of_scope": [],
  "acceptance_criteria": [
    {
      "id": "AC-1",
      "statement": "A verifiable statement that must be true when the task is done.",
      "verification_method": "inspection",
      "command": null
    }
  ],
  "required_checks": [],
  "max_attempts": 3,
  "approval_reference": null,
  "created_at": "2026-01-01T00:00:00Z",
  "created_by": "human"
}
---

# Task title

> This file is a template. Copy it to `<task id>-<slug>.md`, replace every value, and delete these notes.
> The JSON block above is validated against `docs/project-memory/schemas/task.schema.json`; the markdown below is the prompt the worker follows.
> `declared_risk_class` is only the author's opinion. Policy computes the real class from the paths, and the declared class can raise it but never lower it.
> `approval_reference` stays `null` until a human approval is recorded in HUMAN_DECISIONS.md. Authorship of this file grants no approval.
> `files_allowed` globs must start with a literal path segment. Control-plane paths (workflows, `ops/`, `CLAUDE.md`, policy, schemas, the architect prompt) must be listed explicitly to be changeable.

## Context

Why this task exists, with references to the confirmed requirements (REQ ids) and the decisions it relies on. List the open questions it must not assume answers to.

## What to do

Concrete steps and the expected result.

## Out of scope

What must not be done in this task.

## How completion is shown

The checks to run, the evidence to record, and where the run report goes (see CLAUDE.md sections 7 and 8).
