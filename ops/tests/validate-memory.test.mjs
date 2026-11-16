// Integration tests: validate the real project memory, then break copies of it in specific ways
// and check that the validator notices each break with a readable, coded message.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { main, validateMemory } from "../validate-memory.mjs";
import {
  ROOT, addFixtureReport, addFixtureTask, cleanup, copyTree, describeFindings, edit, editJson, fixture, has, read, sink, write,
} from "./helpers.mjs";

const MEM = "docs/project-memory";
const POLICY = `${MEM}/policy/policy.json`;
const REQS = `${MEM}/requirements/MASTER_REQUIREMENTS.md`;

/** Run `fn(tmpTree)` against a fresh copy, then validate it and clean up. */
function broken(fn, { extra } = {}) {
  const dir = copyTree();
  try {
    fn(dir);
    const result = validateMemory({ root: dir });
    if (extra) extra(result, dir);
    return result;
  } finally {
    cleanup(dir);
  }
}

test("the real project memory is valid", () => {
  const result = validateMemory({ root: ROOT });
  assert.equal(result.ok, true, describeFindings(result));
  assert.equal(result.findings.errors.length, 0);
  assert.ok(result.stats.files >= 25, `only ${result.stats.files} files were checked`);
});

test("a copy with the fixture task and report is valid", () => {
  const r = broken((d) => { addFixtureTask(d); addFixtureReport(d); });
  assert.equal(r.ok, true, describeFindings(r));
});

test("required files", async (t) => {
  await t.test("a missing required file is reported with its path", () => {
    const r = broken((d) => fs.rmSync(path.join(d, `${MEM}/roadmap/ROADMAP.md`)));
    assert.ok(has(r, "MEM-FILE-MISSING", { file: `${MEM}/roadmap/ROADMAP.md` }), describeFindings(r));
    assert.equal(r.ok, false);
  });
  await t.test("a missing CLAUDE.md is reported", () => {
    const r = broken((d) => fs.rmSync(path.join(d, "CLAUDE.md")));
    assert.ok(has(r, "MEM-FILE-MISSING", { file: "CLAUDE.md" }));
  });
  await t.test("a missing schema is reported", () => {
    const r = broken((d) => fs.rmSync(path.join(d, `${MEM}/schemas/run-report.schema.json`)));
    assert.ok(has(r, "MEM-FILE-MISSING", { file: `${MEM}/schemas/run-report.schema.json` }));
  });
});

test("policy", async (t) => {
  await t.test("malformed JSON stops the run with a clear message", () => {
    const r = broken((d) => write(d, POLICY, "{ not json"));
    assert.ok(has(r, "MEM-JSON-PARSE", { file: POLICY }));
    assert.ok(has(r, "MEM-ABORT"));
  });
  await t.test("a missing section is a schema error", () => {
    const r = broken((d) => editJson(d, POLICY, (p) => { delete p.limits; }));
    assert.ok(has(r, "POLICY-SCHEMA", { contains: 'missing required property "limits"' }), describeFindings(r));
  });
  await t.test("lowering a floor (secrets below class C) is rejected", () => {
    const r = broken((d) => editJson(d, POLICY, (p) => { p.risk_categories.secrets_or_credentials.minimum_class = "B"; }));
    assert.ok(has(r, "POLICY-INVARIANT", { contains: "may not be below C" }), describeFindings(r));
  });
  await t.test("removing the workflow rule breaks the golden classification", () => {
    const r = broken((d) => editJson(d, POLICY, (p) => { p.path_rules = p.path_rules.filter((x) => x.id !== "PATH-001"); }));
    assert.ok(has(r, "POLICY-GOLDEN", { contains: ".github/workflows/ci.yml" }), describeFindings(r));
  });
  await t.test("making the logo mutable breaks the golden classification", () => {
    const r = broken((d) => editJson(d, POLICY, (p) => { p.path_rules = p.path_rules.filter((x) => x.id !== "PATH-031"); }));
    assert.ok(has(r, "POLICY-GOLDEN", { contains: "public/logo.png" }));
  });
  await t.test("the kill switch must fail closed", () => {
    const r = broken((d) => editJson(d, POLICY, (p) => { p.kill_switch.default_when_unset = "enabled"; }));
    assert.ok(has(r, "POLICY-SCHEMA", { contains: "default_when_unset" }));
  });
  await t.test("a worker may not be allowed to push the production branch", () => {
    const r = broken((d) => editJson(d, POLICY, (p) => { p.branches.worker_may_push = ["claude/**", "main"]; }));
    assert.ok(has(r, "POLICY-INVARIANT", { contains: 'worker_may_push must not match "main"' }), describeFindings(r));
  });
  await t.test("class C cannot be made autonomous", () => {
    const r = broken((d) => editJson(d, POLICY, (p) => { p.risk_classes.C.runs_without_human_approval = true; }));
    assert.ok(has(r, "POLICY-INVARIANT", { contains: "class C must be never_autonomous" }));
  });
  await t.test("class B cannot be made automatic", () => {
    const r = broken((d) => editJson(d, POLICY, (p) => { p.risk_classes.B.may_auto_merge_to_integration = true; }));
    assert.ok(has(r, "POLICY-INVARIANT", { contains: "class B must require a human" }));
  });
  await t.test("paths that match no rule must default to class B or higher", () => {
    const r = broken((d) => editJson(d, POLICY, (p) => { p.classification.unmatched_path_category = "docs_only"; }));
    assert.ok(has(r, "POLICY-INVARIANT", { contains: "default to class B" }));
  });
  await t.test("OpenAI cannot be enabled without a model, a cap and a provider limit", () => {
    const r = broken((d) => editJson(d, POLICY, (p) => { p.budget.openai.enabled = true; }));
    assert.ok(has(r, "POLICY-INVARIANT", { contains: "budget.openai cannot be enabled" }));
  });
  await t.test("a model-declared class that is not in the schemas is a drift error", () => {
    const r = broken((d) => editJson(d, POLICY, (p) => { p.risk_categories.brand_new = { minimum_class: "A", description: "invented category" }; }));
    assert.equal(r.ok, false);
  });
});

test("schemas", async (t) => {
  const TASK = `${MEM}/schemas/task.schema.json`;
  await t.test("a keyword the validator cannot enforce is rejected", () => {
    const r = broken((d) => editJson(d, TASK, (s) => { s.properties.title.format = "date-time"; }));
    assert.ok(has(r, "SCHEMA-LINT", { contains: 'unsupported keyword "format"' }), describeFindings(r));
  });
  await t.test("a schema that stops requiring a property is rejected", () => {
    const r = broken((d) => editJson(d, TASK, (s) => { s.required = s.required.filter((k) => k !== "objective"); }));
    assert.ok(has(r, "SCHEMA-LINT", { contains: "not required: objective" }), describeFindings(r));
  });
  await t.test("a schema that allows extra properties is rejected", () => {
    const r = broken((d) => editJson(d, TASK, (s) => { s.additionalProperties = true; }));
    assert.ok(has(r, "SCHEMA-LINT", { contains: "additionalProperties to false" }));
  });
  await t.test("shared definitions that drift apart are rejected", () => {
    const r = broken((d) => editJson(d, `${MEM}/schemas/run-report.schema.json`, (s) => { s.$defs.sha.pattern = "^[0-9a-f]{7,40}$"; }));
    assert.ok(has(r, "SCHEMA-SHARED-DEFS", { contains: 'shared definition "sha" differs' }), describeFindings(r));
  });
  await t.test("a risk category missing from the schemas but present in policy is rejected", () => {
    const r = broken((d) => {
      for (const f of ["task", "run-report", "architect-decision"]) {
        editJson(d, `${MEM}/schemas/${f}.schema.json`, (s) => { s.$defs.risk_category.enum = s.$defs.risk_category.enum.filter((c) => c !== "other"); });
      }
    });
    assert.ok(has(r, "POLICY-SCHEMA-SYNC"), describeFindings(r));
  });
  await t.test("the architect proposal must stay in step with the task schema", () => {
    const r = broken((d) => editJson(d, `${MEM}/schemas/architect-decision.schema.json`, (s) => {
      s.properties.next_step.properties.next_task.anyOf[0].properties.max_attempts.maximum = 9;
    }));
    assert.ok(has(r, "SCHEMA-PROPOSAL", { contains: "max_attempts" }), describeFindings(r));
  });
  await t.test("the schema version cannot be dropped", () => {
    const r = broken((d) => editJson(d, TASK, (s) => { s.properties.schema_version = { type: "string", description: "x" }; }));
    assert.ok(has(r, "SCHEMA-VERSION"));
  });
});

test("requirements, recommendations and ids", async (t) => {
  await t.test("a confirmed requirement cannot be deleted silently", () => {
    const r = broken((d) => edit(d, REQS, (x) => x.split("\n").filter((l) => !l.startsWith("- **REQ-LOY-005**")).join("\n")));
    assert.ok(has(r, "REQ-MISSING", { contains: "REQ-LOY-005" }), describeFindings(r));
  });
  await t.test("the confirmed loyalty numbers cannot be edited silently", () => {
    const r = broken((d) => edit(d, REQS, (x) => x.replace("1 point per QAR 10 spent", "1 point per QAR 5 spent")));
    assert.ok(has(r, "REQ-TEXT", { contains: "QAR 10" }), describeFindings(r));
  });
  await t.test("the point value cannot be edited silently", () => {
    const r = broken((d) => edit(d, REQS, (x) => x.replace("QAR 0.10", "QAR 0.20")));
    assert.ok(has(r, "REQ-TEXT", { contains: "QAR 0.10" }));
  });
  await t.test("a duplicate requirement id is rejected", () => {
    const r = broken((d) => edit(d, REQS, (x) => `${x}\n- **REQ-LOY-002** (confirmed) — A second definition of the same id.\n`));
    assert.ok(has(r, "REQ-DUPLICATE", { contains: "REQ-LOY-002" }));
  });
  await t.test("a requirement that is not marked confirmed is rejected", () => {
    const r = broken((d) => edit(d, REQS, (x) => x.replace("**REQ-ACCT-001** (confirmed)", "**REQ-ACCT-001** (draft)")));
    assert.ok(has(r, "REQ-FORMAT"), describeFindings(r));
  });
  await t.test("a reference to an id that does not exist is rejected", () => {
    const r = broken((d) => edit(d, `${MEM}/README.md`, (x) => `${x}\nSee OQ-9999 for details.\n`));
    assert.ok(has(r, "REF-UNKNOWN", { contains: "OQ-9999" }), describeFindings(r));
  });
  await t.test("a broken relative link is rejected", () => {
    const r = broken((d) => edit(d, `${MEM}/README.md`, (x) => `${x}\nSee [missing](does/not/exist.md).\n`));
    assert.ok(has(r, "LINK-BROKEN", { contains: "does/not/exist.md" }));
  });
  await t.test("a recommendation with the wrong status word is rejected", () => {
    const r = broken((d) => edit(d, `${MEM}/architecture/ARCHITECTURE.md`, (x) => x.replace("**REC-PLAT-001** (recommendation)", "**REC-PLAT-001** (decided)")));
    assert.ok(has(r, "REC-FORMAT"));
  });
});

test("ADRs, questions, decisions and roadmap", async (t) => {
  const ADR3 = `${MEM}/architecture/adr/0003-privilege-separation.md`;
  await t.test("an ADR without a Decision section is rejected", () => {
    const r = broken((d) => edit(d, ADR3, (x) => x.replace("\n## Decision\n", "\n## Choice\n")));
    assert.ok(has(r, "ADR-FORMAT", { contains: '"## Decision"' }), describeFindings(r));
  });
  await t.test("an ADR with an unknown status is rejected", () => {
    const r = broken((d) => edit(d, ADR3, (x) => x.replace("- **Status:** proposed", "- **Status:** maybe")));
    assert.ok(has(r, "ADR-FORMAT", { contains: "Status" }));
  });
  await t.test("a gap in ADR numbering is rejected", () => {
    const r = broken((d) => {
      const dir = path.join(d, `${MEM}/architecture/adr`);
      fs.renameSync(path.join(dir, "0004-branch-model-and-promotion.md"), path.join(dir, "0009-branch-model-and-promotion.md"));
    });
    assert.ok(has(r, "ADR-NUMBERING"), describeFindings(r));
  });
  await t.test("too few ADRs is rejected", () => {
    const r = broken((d) => {
      const dir = path.join(d, `${MEM}/architecture/adr`);
      for (const f of fs.readdirSync(dir).filter((n) => /^000[5-8]/.test(n))) fs.rmSync(path.join(dir, f));
    });
    assert.ok(has(r, "ADR-MISSING"), describeFindings(r));
  });
  await t.test("a resolved question must point to a human decision", () => {
    const r = broken((d) => edit(d, `${MEM}/decisions/OPEN_QUESTIONS.md`, (x) => x.replace(/(### OQ-0001[^]*?- \*\*Status:\*\* )open/, "$1resolved")));
    assert.ok(has(r, "OQ-FORMAT", { contains: "Resolution" }), describeFindings(r));
  });
  await t.test("a resolved question with a real resolution is accepted", () => {
    const r = broken((d) => edit(d, `${MEM}/decisions/OPEN_QUESTIONS.md`, (x) => x.replace(/(### OQ-0001[^]*?- \*\*Status:\*\* )open/, "$1resolved\n- **Resolution:** HD-0001")));
    assert.equal(r.ok, true, describeFindings(r));
  });
  await t.test("a question missing a required line is rejected", () => {
    const r = broken((d) => edit(d, `${MEM}/decisions/OPEN_QUESTIONS.md`, (x) => x.replace(/(### OQ-0004[^]*?)- \*\*Question:\*\*[^\n]*\n/, "$1")));
    assert.ok(has(r, "OQ-FORMAT", { contains: "OQ-0004" }), describeFindings(r));
  });
  await t.test("a human decision with a malformed date is rejected", () => {
    const r = broken((d) => edit(d, `${MEM}/decisions/HUMAN_DECISIONS.md`, (x) => x.replace("**Date:** 2026-11-16", "**Date:** 16/11/2026")));
    assert.ok(has(r, "HD-FORMAT", { contains: "YYYY-MM-DD" }));
  });
  await t.test("a roadmap row with an unknown status is rejected", () => {
    const r = broken((d) => edit(d, `${MEM}/roadmap/ROADMAP.md`, (x) => x.replace("| PH-1 | Foundations: CI, tests, visual baselines, security headers, dependency patches, `.env.example` | not_started |", "| PH-1 | Foundations | someday |")));
    assert.ok(has(r, "ROADMAP-FORMAT", { contains: "someday" }), describeFindings(r));
  });
});

test("CLAUDE.md contract", async (t) => {
  await t.test("a missing required section is rejected", () => {
    const r = broken((d) => edit(d, "CLAUDE.md", (x) => x.replace("## 9. Reports are claims; verified evidence comes from the orchestrator", "## 9. Notes")));
    assert.ok(has(r, "CLAUDE-MD", { contains: "## 9. Reports are claims" }), describeFindings(r));
  });
});

test("task files", async (t) => {
  const TASKS = `${MEM}/tasks`;
  await t.test("a task without front matter is rejected", () => {
    const r = broken((d) => write(d, `${TASKS}/OPS-9001-fixture-task.md`, "# Just a title\n\nNo front matter here.\n"));
    assert.ok(has(r, "TASK-FRONTMATTER"), describeFindings(r));
  });
  await t.test("front matter that is not JSON is rejected", () => {
    const r = broken((d) => write(d, `${TASKS}/OPS-9001-fixture-task.md`, "---json\n{ oops\n---\n\nbody\n"));
    assert.ok(has(r, "TASK-FRONTMATTER", { contains: "not valid JSON" }));
  });
  await t.test("a task that breaks the schema is rejected", () => {
    const r = broken((d) => addFixtureTask(d, (task) => { delete task.title; }));
    assert.ok(has(r, "TASK-SCHEMA", { contains: 'missing required property "title"' }), describeFindings(r));
  });
  await t.test("the file name must match the task id", () => {
    const r = broken((d) => addFixtureTask(d, () => {}, "OPS-9002-wrong-name.md"));
    assert.ok(has(r, "TASK-FILENAME"), describeFindings(r));
  });
  await t.test("two files with the same task id are rejected", () => {
    const r = broken((d) => { addFixtureTask(d); addFixtureTask(d, () => {}, "OPS-9001-second-copy.md"); });
    assert.ok(has(r, "TASK-DUPLICATE", { contains: "OPS-9001" }), describeFindings(r));
  });
  await t.test("a dependency on an unknown task is rejected", () => {
    const r = broken((d) => addFixtureTask(d, (task) => { task.depends_on = ["OPS-9999"]; }));
    assert.ok(has(r, "TASK-DEPENDS", { contains: "OPS-9999" }), describeFindings(r));
  });
  await t.test("a dependency cycle is rejected", () => {
    const r = broken((d) => {
      addFixtureTask(d, (task) => { task.task_id = "OPS-9101"; task.branch = "claude/ops-9101-a"; task.depends_on = ["OPS-9102"]; }, "OPS-9101-a.md");
      addFixtureTask(d, (task) => { task.task_id = "OPS-9102"; task.branch = "claude/ops-9102-b"; task.depends_on = ["OPS-9101"]; }, "OPS-9102-b.md");
    });
    assert.ok(has(r, "TASK-DEPENDS", { contains: "dependency cycle" }), describeFindings(r));
  });
  await t.test("an approval that does not exist is rejected", () => {
    const r = broken((d) => addFixtureTask(d, (task) => { task.approval_reference = "HD-9999"; }));
    assert.ok(has(r, "TASK-REF", { contains: "HD-9999" }));
  });
  await t.test("a reference to an unknown requirement is rejected", () => {
    const r = broken((d) => addFixtureTask(d, (task) => { task.requirement_refs = ["REQ-NOPE-001"]; }));
    assert.ok(has(r, "TASK-REF", { contains: "REQ-NOPE-001" }));
  });
  await t.test("a declared class below the policy-computed class is rejected", () => {
    const r = broken((d) => addFixtureTask(d, (task) => { task.files_allowed = ["package.json"]; task.declared_risk_categories = ["dependencies"]; }));
    assert.ok(has(r, "TASK-CLASS", { contains: "below the class B" }), describeFindings(r));
  });
  await t.test("a task blocked by an open question is allowed to exist but is flagged", () => {
    const r = broken((d) => addFixtureTask(d, (task) => { task.blocked_by_open_questions = ["OQ-0006"]; }));
    assert.equal(r.ok, true, describeFindings(r));
    assert.ok(has(r, "TASK-BLOCKED", { severity: "warning" }));
  });
  await t.test("a class B task without an approval is flagged as a proposal", () => {
    const r = broken((d) => addFixtureTask(d, (task) => { task.declared_risk_class = "B"; }));
    assert.equal(r.ok, true, describeFindings(r));
    assert.ok(has(r, "TASK-UNAPPROVED", { severity: "warning" }));
  });
  await t.test("an empty prompt body is rejected", () => {
    const r = broken((d) => {
      const task = fixture("valid/task.json");
      write(d, `${TASKS}/OPS-9001-fixture-task.md`, `---json\n${JSON.stringify(task, null, 2)}\n---\n\nhi\n`);
    });
    assert.ok(has(r, "TASK-BODY"));
  });
  await t.test("the template must keep conforming to the task schema", () => {
    const r = broken((d) => edit(d, `${TASKS}/TEMPLATE.md`, (x) => x.replace('"task_id": "OPS-0000"', '"task_id": "bad id"')));
    assert.ok(has(r, "TASK-TEMPLATE"), describeFindings(r));
  });
});

test("run reports inside the tree", async (t) => {
  await t.test("a report for a task that does not exist is rejected", () => {
    const r = broken((d) => addFixtureReport(d));
    assert.ok(has(r, "REPORT-TASK", { contains: "OPS-9001" }), describeFindings(r));
  });
  await t.test("a report in the wrong place is rejected", () => {
    const r = broken((d) => { addFixtureTask(d); addFixtureReport(d, () => {}, `${MEM}/runs/OPS-9001/report.json`); });
    assert.ok(has(r, "REPORT-LOCATION", { contains: "OPS-9001-a1/report.json" }), describeFindings(r));
  });
  await t.test("a stray JSON file under runs is rejected", () => {
    const r = broken((d) => { addFixtureTask(d); write(d, `${MEM}/runs/OPS-9001/notes.json`, "{}\n"); });
    assert.ok(has(r, "REPORT-LOCATION", { contains: "report.json" }));
  });
  await t.test("a report that claims to be verified is rejected", () => {
    const r = broken((d) => { addFixtureTask(d); addFixtureReport(d, (rep) => { rep.trust.verified_by_orchestrator = true; }); });
    assert.ok(has(r, "REPORT-SCHEMA", { contains: "must be false" }), describeFindings(r));
  });
  await t.test("a report whose files break the task's scope is rejected", () => {
    const r = broken((d) => {
      addFixtureTask(d);
      addFixtureReport(d, (rep) => {
        rep.changed_files.push({ path: ".github/workflows/ci.yml", change_type: "added", additions: 5, deletions: 0 });
        rep.risk.declared_class = "B";
        rep.protected_paths_touched = [".github/workflows/ci.yml"];
      });
    });
    assert.ok(has(r, "REPORT-SCOPE", { contains: ".github/workflows/ci.yml" }), describeFindings(r));
    assert.ok(has(r, "REPORT-ATTEST"));
  });
});

test("public-repository content scan", async (t) => {
  // The fake values are assembled at run time so this file itself contains nothing that looks like a secret.
  const cases = [
    ["an API key", `key: ${"sk-"}${"A1b2C3d4".repeat(4)}`],
    ["a GitHub token", `token ${"ghp_"}${"a".repeat(36)}`],
    ["a JWT", `jwt ${"eyJ"}${"a".repeat(14)}.${"b".repeat(14)}.${"c".repeat(14)}`],
    ["a private key block", `${"-----BEGIN "}${"RSA PRIVATE KEY-----"}`],
    ["a secret assignment", `${"SERVICE_ROLE"}_KEY=${"x9Y8".repeat(6)}`],
    ["a project URL", `${"https://"}${"abcdefghij0123456789"}${".supabase.co"}`],
    ["a Qatar phone number", `call ${"+974"} ${"5555"} ${"1234"}`],
  ];
  for (const [label, line] of cases) {
    await t.test(`${label} is flagged, and its value is never echoed`, () => {
      const r = broken((d) => edit(d, `${MEM}/README.md`, (x) => `${x}\n${line}\n`));
      assert.ok(has(r, "SCAN-SECRET", { file: `${MEM}/README.md` }), describeFindings(r));
      const output = describeFindings(r);
      const value = line.split(" ").pop();
      assert.ok(!output.includes(value), "the finding must not repeat the matched value");
    });
  }
  await t.test("an unlisted email address is flagged", () => {
    const r = broken((d) => edit(d, `${MEM}/README.md`, (x) => `${x}\nwrite to ${"someone"}@${"mail.test"}\n`));
    assert.ok(has(r, "SCAN-EMAIL"), describeFindings(r));
  });
  await t.test("allow-listed and reserved example addresses are accepted", () => {
    const r = broken((d) => edit(d, `${MEM}/README.md`, (x) => `${x}\nCo-authored by noreply@anthropic.com or person@example.com\n`));
    assert.equal(r.ok, true, describeFindings(r));
  });
  await t.test("environment variable names without values are fine", () => {
    const r = broken((d) => edit(d, `${MEM}/README.md`, (x) => `${x}\nThe variable NEXT_PUBLIC_SITE_URL and the SUPABASE_SERVICE_ROLE_KEY name are documented, never their values.\n`));
    assert.equal(r.ok, true, describeFindings(r));
  });
});

test("command line interface", async (t) => {
  await t.test("--json on the real repository returns ok", () => {
    const out = sink();
    const code = main(["--json"], out, sink());
    assert.equal(code, 0);
    const parsed = JSON.parse(out.text());
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.errors, []);
  });
  await t.test("an unknown argument is a usage error (exit 2)", () => {
    const err = sink();
    assert.equal(main(["--bogus"], sink(), err), 2);
    assert.match(err.text(), /unknown argument/);
  });
  await t.test("a bad --kind is a usage error (exit 2)", () => {
    assert.equal(main(["--kind", "nonsense"], sink(), sink()), 2);
  });
  await t.test("a broken tree exits 1 and prints coded, readable messages", () => {
    const dir = copyTree();
    try {
      fs.rmSync(path.join(dir, `${MEM}/roadmap/ROADMAP.md`));
      const out = sink();
      assert.equal(main(["--root", dir], out, sink()), 1);
      assert.match(out.text(), /ERROR\s+\[MEM-FILE-MISSING\] docs\/project-memory\/roadmap\/ROADMAP\.md/);
      assert.match(out.text(), /FAILED: \d+ error\(s\)/);
    } finally {
      cleanup(dir);
    }
  });
  await t.test("--file validates one report and says what is wrong", () => {
    const dir = copyTree();
    try {
      addFixtureTask(dir);
      const good = `${MEM}/runs/OPS-9001/OPS-9001-a1/report.json`;
      addFixtureReport(dir);
      assert.equal(main(["--root", dir, "--file", path.join(dir, good)], sink(), sink()), 0);
      addFixtureReport(dir, (rep) => { rep.verification[0].exit_code = 1; });
      const out = sink();
      assert.equal(main(["--root", dir, "--file", path.join(dir, good)], out, sink()), 1);
      assert.match(out.text(), /REPORT-VERIFY/);
      assert.match(out.text(), /marked passed but exit_code is 1/);
    } finally {
      cleanup(dir);
    }
  });
  await t.test("--file validates a task file", () => {
    const dir = copyTree();
    try {
      addFixtureTask(dir);
      assert.equal(main(["--root", dir, "--file", path.join(dir, `${MEM}/tasks/OPS-9001-fixture-task.md`)], sink(), sink()), 0);
      assert.equal(main(["--root", dir, "--file", path.join(dir, `${MEM}/tasks/missing.md`)], sink(), sink()), 1);
    } finally {
      cleanup(dir);
    }
  });
  await t.test("the script runs as a real process and its exit code reflects validity", () => {
    const script = path.join(ROOT, "ops/validate-memory.mjs");
    const good = spawnSync(process.execPath, [script], { encoding: "utf8" });
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.match(good.stdout, /^M1 project-memory validation/);
    const dir = copyTree();
    try {
      write(dir, `${MEM}/policy/policy.json`, "{");
      const bad = spawnSync(process.execPath, [path.join(dir, "ops/validate-memory.mjs"), "--root", dir], { encoding: "utf8" });
      assert.equal(bad.status, 1);
      assert.match(bad.stdout, /MEM-JSON-PARSE/);
    } finally {
      cleanup(dir);
    }
    assert.equal(read(ROOT, "package.json").includes('"ops:test"'), true);
  });
});
