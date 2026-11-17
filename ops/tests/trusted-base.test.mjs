// Trusted-base verification: negative security tests on real temporary git repositories.
// The base is the real governed tree. Each test makes a branch (the "head"), changes it the way a hostile or careless
// change would, and checks what the base revision's rules say about it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { main } from "../ci-evidence.mjs";
import { buildEvidenceDocument } from "../lib/ci-evidence.mjs";
import { validate } from "../lib/json-schema.mjs";
import { TrustedBaseError, sanitizedEnv, trustedBaseCheck } from "../lib/trusted-base.mjs";
import { makeRepo } from "./git-fixture.mjs";
import { ROOT, readJson, sink } from "./helpers.mjs";

const repo = makeRepo();
after(() => repo.cleanup());

const POLICY = "docs/project-memory/policy/policy.json";
const POLICY_SCHEMA = "docs/project-memory/schemas/policy.schema.json";
const WORKFLOW = ".github/workflows/ci.yml";
const CHECKER = "ops/lib/workflow-safety.mjs";
const evidenceSchema = readJson("docs/project-memory/schemas/ci-evidence.schema.json");

// What CI on the branch itself would conclude: the BRANCH's own validator code, reading the branch's own files.
const selfValidates = (dir) => {
  try {
    execFileSync(process.execPath, [path.join(dir, "ops/validate-memory.mjs"), "--root", dir], { stdio: "ignore", env: sanitizedEnv() });
    return true;
  } catch {
    return false;
  }
};
const check = (head, opts = {}) => trustedBaseCheck({ repoDir: repo.dir, base: "main", head, ...opts });
const codes = (run) => run.sample.map((s) => s.code);
const throwsCode = (fn, code) => assert.throws(fn, (err) => err instanceof TrustedBaseError && err.code === code, `expected ${code}`);
const evidenceOf = (trustedBase) => buildEvidenceDocument({
  repository: "owner/name", headSha: trustedBase.evaluated.head_sha, baseSha: trustedBase.evaluated.base_sha, trustedBase,
  collector: { tool: "ops/ci-evidence.mjs", tool_source: "working_tree", role: "human" }, now: new Date("2026-01-02T03:04:05Z"),
});

test("a change that touches no control file is clean", () => {
  repo.branch("clean-docs", (r) => r.write("docs/example-guide.md", "# A guide\n"));
  const r = check("clean-docs");
  assert.equal(r.verdict.base_rules_pass, true);
  assert.equal(r.verdict.control_plane_changed, false);
  assert.equal(r.verdict.human_review_required, false, r.verdict.reasons.join("; "));
  assert.deepEqual(r.verdict.reasons, []);
  assert.deepEqual(r.changes.paths.map((p) => p.path), ["docs/example-guide.md"]);
  assert.equal(r.verdict.enforcement, "advisory_only");
  assert.ok(Object.values(r.flags).every((v) => v === false));
});

test("the result is always advisory, and the anchor is only a claim", () => {
  const r = check("clean-docs", { anchor: "protected_workflow" });
  assert.equal(r.verdict.enforcement, "advisory_only");
  assert.deepEqual(r.execution_context, { anchor: "protected_workflow", anchor_is_claim: true });
  throwsCode(() => check("clean-docs", { anchor: "trusted" }), "TB-ANCHOR");
});

test("THE GAP: a change that weakens CI, the policy and the schema together passes its own validation, and only the base catches it", () => {
  const selfCheck = repo.branch("weaken-in-lockstep", (r) => {
    r.edit(WORKFLOW, "permissions:\n  contents: read", "permissions:\n  contents: write");
    r.edit(POLICY, '"max_token_permissions": { "contents": "read" }', '"max_token_permissions": { "contents": "write" }');
    r.editJson(POLICY_SCHEMA, (s) => { delete s.properties.workflow_policy.properties.max_token_permissions.properties.contents.const; });
  }, { inspect: selfValidates });
  assert.equal(selfCheck, true, "the weakened branch must pass its OWN validation, otherwise this test shows nothing");

  const r = check("weaken-in-lockstep");
  assert.equal(r.verdict.base_rules_pass, false);
  assert.ok(codes(r.rules.head_data_under_base_policy).includes("WF-PERMISSIONS"), "the base policy must reject the head's workflow");
  assert.ok(codes(r.rules.head_policy_under_base_validator).includes("POLICY-SCHEMA"), "the base schema must reject the head's policy");
  assert.deepEqual([r.flags.workflow_files_changed, r.flags.policy_changed, r.flags.schemas_changed], [true, true, true]);
  assert.equal(r.verdict.control_plane_changed, true);
  assert.equal(r.verdict.human_review_required, true);
});

test("THE GAP, second form: a change that disables a checker rule and breaks the workflow passes its own validation", () => {
  const selfCheck = repo.branch("weaken-the-checker", (r) => {
    r.edit(CHECKER, "else if (value !== allowed[p.key]) add(", "else if (false) add(");
    r.edit(WORKFLOW, "permissions:\n  contents: read", "permissions:\n  contents: write");
  }, { inspect: selfValidates });
  assert.equal(selfCheck, true, "the branch's own (weakened) checker must accept its own workflow");
  const r = check("weaken-the-checker");
  assert.ok(codes(r.rules.head_data_under_base_policy).includes("WF-PERMISSIONS"));
  assert.equal(r.flags.ops_code_changed, true);
  assert.ok(r.control_plane_paths.includes(CHECKER));
  assert.equal(r.verdict.human_review_required, true);
});

test("a change to checker code alone cannot be judged by data rules, so it is always sent to a human", () => {
  repo.branch("checker-edit-only", (r) => r.write(CHECKER, `${r.read(CHECKER)}\n// harmless comment\n`));
  const r = check("checker-edit-only");
  assert.equal(r.verdict.base_rules_pass, true);
  assert.equal(r.flags.ops_code_changed, true);
  assert.equal(r.verdict.control_plane_changed, true);
  assert.equal(r.verdict.human_review_required, true);
  assert.ok(r.verdict.reasons.some((x) => /control-plane/.test(x)));
});

test("an honest addition under the schema directory is not a false alarm, but is still a control-plane change", () => {
  repo.branch("add-schema", (r) => {
    r.write("docs/project-memory/schemas/extra.schema.json", "{}\n");
    r.write("docs/project-memory/architecture/EXTRA.md", "# Extra\n\nSee [the schema](../schemas/extra.schema.json).\n");
  });
  const r = check("add-schema");
  assert.equal(r.verdict.base_rules_pass, true, JSON.stringify(r.rules));
  assert.equal(r.flags.schemas_changed, true);
  assert.equal(r.verdict.control_plane_changed, true);
  assert.equal(r.verdict.human_review_required, true);
});

test("deleting a rule does not remove it: the base's schema comes back, and the weakened policy is still rejected", () => {
  repo.branch("delete-schema", (r) => {
    r.remove("docs/project-memory/schemas/policy.schema.json");
    r.edit(POLICY, '"max_token_permissions": { "contents": "read" }', '"max_token_permissions": { "contents": "write" }');
    r.edit(WORKFLOW, "permissions:\n  contents: read", "permissions:\n  contents: write");
  });
  const r = check("delete-schema");
  assert.equal(r.verdict.base_rules_pass, false);
  assert.ok(codes(r.rules.head_policy_under_base_validator).includes("POLICY-SCHEMA"));
  assert.ok(r.changes.paths.some((p) => p.path === "docs/project-memory/schemas/policy.schema.json" && p.status === "D"));
});

test("a second workflow file is rejected by the base's allow-list and flagged", () => {
  repo.branch("extra-workflow", (r) => r.write(".github/workflows/deploy.yml", r.read(WORKFLOW)));
  const r = check("extra-workflow");
  assert.ok(codes(r.rules.head_data_under_base_policy).includes("WF-FILE-UNAPPROVED"));
  assert.equal(r.flags.workflow_files_changed, true);
  assert.equal(r.verdict.human_review_required, true);
});

test("a workflow hidden from `git archive` by .gitattributes export-ignore is still seen", () => {
  repo.branch("hidden-workflow", (r) => {
    r.write(".gitattributes", ".github/workflows/hidden.yml export-ignore\n");
    r.write(".github/workflows/hidden.yml", r.read(WORKFLOW));
  });
  const archive = execFileSync("git", ["-C", repo.dir, "archive", "--format=tar", "hidden-workflow", "--", ".github"], { maxBuffer: 64 * 1024 * 1024 });
  assert.ok(!archive.toString("latin1").includes("hidden.yml"), "the attack must be real: git archive really omits the file");
  const r = check("hidden-workflow");
  assert.ok(r.rules.head_data_under_base_policy.sample.some((s) => s.code === "WF-FILE-UNAPPROVED" && s.file.endsWith("hidden.yml")), "the check must still see the hidden workflow");
});

test("changing the script that CI runs for validation is flagged", () => {
  repo.branch("neuter-validate-script", (r) => r.edit("package.json", '"ops:validate": "node ops/validate-memory.mjs"', '"ops:validate": "true"'));
  const r = check("neuter-validate-script");
  assert.equal(r.package_scripts.ci_entrypoints_changed, true);
  assert.deepEqual(r.package_scripts.changed_keys, ["ops:validate"]);
  assert.ok(r.protected_paths.includes("package.json"));
  assert.equal(r.verdict.human_review_required, true);
  assert.ok(r.verdict.reasons.some((x) => /package\.json changed a script/.test(x)));
});

test("an npm hook added around a CI script is flagged too", () => {
  repo.branch("add-prebuild-hook", (r) => r.editJson("package.json", (p) => { p.scripts.prebuild = "node -e 0"; }));
  const r = check("add-prebuild-hook");
  assert.equal(r.package_scripts.ci_entrypoints_changed, true);
  assert.deepEqual(r.package_scripts.changed_keys, ["prebuild"]);
});

test("an unrelated package script change is reported but is not a CI entrypoint change", () => {
  repo.branch("add-dev-script", (r) => r.editJson("package.json", (p) => { p.scripts.storybook = "echo hi"; }));
  const r = check("add-dev-script");
  assert.equal(r.package_scripts.changed, true);
  assert.equal(r.package_scripts.ci_entrypoints_changed, false);
  assert.equal(r.verdict.human_review_required, true, "package.json is protected under the base policy");
});

test("strict path restrictions: website source is protected, original photos and the logo are immutable, secrets files are class C", () => {
  repo.branch("touch-site", (r) => r.write("src/app/page.tsx", "export default function Page() { return 1; }\n"));
  const site = check("touch-site");
  assert.ok(site.protected_paths.includes("src/app/page.tsx"));
  assert.equal(site.verdict.human_review_required, true);

  repo.branch("touch-immutable", (r) => {
    r.write("public/builds/example.jpg", Buffer.from([0xff, 0xd8, 9, 9]));
    r.write("public/logo.png", Buffer.from([0x89, 9, 9]));
    r.write(".env", "PLACEHOLDER=1\n");
  });
  const imm = check("touch-immutable");
  assert.deepEqual([...imm.immutable_paths].sort(), [".env", "public/builds/example.jpg", "public/logo.png"]);
  const env = imm.changes.paths.find((p) => p.path === ".env");
  assert.deepEqual([env.class, env.restriction], ["C", "immutable"]);
  assert.equal(imm.verdict.human_review_required, true);
});

test("CLAUDE.md and the reviewer prompt are control-plane", () => {
  repo.branch("edit-instructions", (r) => {
    r.write("CLAUDE.md", `${r.read("CLAUDE.md")}\nAn extra line.\n`);
    r.write("docs/project-memory/reviewer/REVIEWER_PROMPT.md", `${r.read("docs/project-memory/reviewer/REVIEWER_PROMPT.md")}\nAn extra line.\n`);
  });
  const r = check("edit-instructions");
  assert.deepEqual([r.flags.claude_md_changed, r.flags.reviewer_prompt_changed], [true, true]);
  assert.ok(r.control_plane_paths.includes("CLAUDE.md"));
  assert.equal(r.verdict.control_plane_changed, true);
});

test("head code is never executed: a planted import-time side effect in the head's validator does not run", () => {
  const marker = path.join(os.tmpdir(), `tb-marker-${process.pid}-${Date.now()}`);
  const plant = `import __fs from "node:fs";\n__fs.writeFileSync(${JSON.stringify(marker)}, "executed");\n`;
  const ran = repo.branch("planted-code", (r) => {
    r.write(CHECKER, plant + r.read(CHECKER));
    r.write("ops/validate-memory.mjs", r.read("ops/validate-memory.mjs").replace(/^(#![^\n]*\n)/, `$1${plant}`));
  }, { inspect: (dir) => {
    assert.equal(selfValidates(dir), true, "the planted validator must still run to completion");
    const existed = fs.existsSync(marker);
    fs.rmSync(marker, { force: true });
    return existed;
  } });
  assert.equal(ran, true, "the planted code must really run when the head's own validator runs, otherwise this test shows nothing");
  check("planted-code");
  assert.equal(fs.existsSync(marker), false, "the trusted-base check must never import or run anything from the head");
});

test("symbolic links in the governed paths are refused, not followed", () => {
  repo.branch("symlink-policy", (r) => r.symlink("docs/project-memory/policy/extra.json", "/etc/passwd"));
  throwsCode(() => check("symlink-policy"), "TB-SYMLINK");
  repo.branch("symlink-ops", (r) => r.symlink("ops/lib/link.mjs", "../validate-memory.mjs"));
  throwsCode(() => check("symlink-ops"), "TB-SYMLINK");
});

test("a symbolic link inside the BASE's own validation logic is refused too: the rules must be real files", () => {
  repo.branch("base-with-link", (r) => r.symlink("ops/lib/sneaky.mjs", "../validate-memory.mjs"));
  // the head has no link at all, so only the check on the base can refuse this
  throwsCode(() => check("clean-docs", { base: "base-with-link" }), "TB-SYMLINK");
});

test("build inputs are flagged, because they change what `npm run build` and the type check mean", () => {
  repo.branch("touch-build-inputs", (r) => {
    r.write("next.config.ts", "export default {};\n");
    r.write("tsconfig.json", "{}\n");
  });
  const b = check("touch-build-inputs");
  assert.equal(b.flags.build_inputs_changed, true);
  assert.equal(b.flags.workflow_files_changed, false);
  assert.equal(check("add-dev-script").flags.build_inputs_changed, true, "package.json is a build input");
  assert.equal(check("clean-docs").flags.build_inputs_changed, false);
});

test("revisions are validated: option injection, newlines, unknown names and unrelated histories are refused", () => {
  for (const bad of ["--output=/tmp/x", "-1", "main\nmain", "", "no-such-branch", "x".repeat(300)]) throwsCode(() => check(bad), "TB-REV");
  throwsCode(() => trustedBaseCheck({ repoDir: repo.dir, base: "--upload-pack=x", head: "main" }), "TB-REV");
  repo.git("switch", "-q", "--orphan", "unrelated");
  repo.write("lonely.txt", "x");
  repo.git("add", "-A");
  repo.git("commit", "-q", "-m", "unrelated");
  repo.git("switch", "-q", "main");
  throwsCode(() => check("unrelated"), "TB-NO-MERGE-BASE");
});

test("a base revision that holds no validation logic cannot be used as a source of rules", () => {
  repo.branch("nologic", (r) => r.remove("ops"));
  repo.branch("child-of-nologic", (r) => r.write("docs/x.md", "x\n"), { from: "nologic" });
  throwsCode(() => check("child-of-nologic", { base: "nologic" }), "TB-BASE-NO-LOGIC");
});

test("only the head's own changes are judged when the base has moved on", () => {
  repo.branch("base-moved", (r) => r.write("docs/base-only.md", "x\n"));
  repo.branch("head-from-old-base", (r) => r.write("docs/head-only.md", "x\n"));
  const r = check("head-from-old-base", { base: "base-moved" });
  assert.deepEqual(r.changes.paths.map((p) => p.path), ["docs/head-only.md"]);
  assert.notEqual(r.evaluated.merge_base_sha, r.evaluated.base_sha);
});

test("task scope comes from the BASE revision: a head that widens its own task file is still judged by the base's version", () => {
  repo.branch("out-of-scope", (r) => {
    r.write("src/app/page.tsx", "export default function Page() { return 2; }\n");
    r.write("docs/project-memory/README.md", `${r.read("docs/project-memory/README.md")}\n`);
  });
  const r = check("out-of-scope", { taskId: "OPS-0002" });
  assert.equal(r.task_scope.source, "base_revision");
  assert.deepEqual(r.task_scope.violations.map((v) => v.path), ["src/app/page.tsx"]);
  assert.ok(r.verdict.reasons.some((x) => /outside the scope of task OPS-0002/.test(x)));

  repo.branch("widen-own-task", (r) => {
    r.write("src/app/page.tsx", "export default function Page() { return 3; }\n");
    const task = "docs/project-memory/tasks/OPS-0002-ci-baseline.md";
    r.edit(task, '"src/**",\n    "public/**",', '"docs/**",');
    r.edit(task, '"files_allowed": [', '"files_allowed": [\n    "src/**",');
  });
  const w = check("widen-own-task", { taskId: "OPS-0002" });
  assert.ok(w.task_scope.violations.some((v) => v.path === "src/app/page.tsx"), "widening the scope inside the head must not help");
});

test("a task with no approved file in the base has no established scope", () => {
  const r = check("clean-docs", { taskId: "OPS-9999" });
  assert.equal(r.task_scope.source, "not_found_in_base");
  assert.equal(r.verdict.human_review_required, true);
  throwsCode(() => check("clean-docs", { taskId: "../../etc" }), "TB-TASK");
});

test("a very large change is reported with a cap, not rejected", () => {
  repo.branch("many-files", (r) => { for (let i = 0; i < 350; i += 1) r.write(`docs/many/f${i}.md`, `${i}\n`); });
  const r = check("many-files");
  assert.equal(r.changes.total, 350);
  assert.equal(r.changes.truncated, true);
  assert.equal(r.changes.paths.length, 300);
});

test("the check changes nothing: the repository is untouched and its temporary files are removed", () => {
  const snapshot = () => [repo.git("status", "--porcelain"), repo.git("for-each-ref"), repo.git("stash", "list")].join("|");
  const before = snapshot();
  // A private temporary directory, so that another process using the shared one (a parallel test run) cannot disturb the listing.
  const priv = fs.mkdtempSync(path.join(os.tmpdir(), "m1-tb-private-"));
  const savedTmp = process.env.TMPDIR;
  process.env.TMPDIR = priv;
  try {
    check("weaken-in-lockstep");
    assert.deepEqual(fs.readdirSync(priv), []);
  } finally {
    if (savedTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = savedTmp;
    fs.rmSync(priv, { recursive: true, force: true });
  }
  assert.equal(snapshot(), before);
});

test("the result is deterministic and conforms to the evidence schema", () => {
  const a = check("weaken-in-lockstep");
  const b = check("weaken-in-lockstep");
  assert.deepEqual(a, b);
  for (const head of ["clean-docs", "weaken-in-lockstep", "touch-immutable", "out-of-scope"]) {
    const doc = evidenceOf(check(head, head === "out-of-scope" ? { taskId: "OPS-0002" } : {}));
    const result = validate(evidenceSchema, doc);
    assert.deepEqual(result.errors, [], head);
  }
});

test("child processes get no credential and nothing that can redirect git", () => {
  const env = sanitizedEnv({
    PATH: "/usr/bin", GITHUB_TOKEN: "x", ANTHROPIC_API_KEY: "x", CLAUDE_CODE_OAUTH_TOKEN: "x", AWS_SECRET_ACCESS_KEY: "x", GIT_DIR: "/elsewhere", GIT_WORK_TREE: "/elsewhere", GIT_ASKPASS: "x", SSH_AUTH_SOCK: "x", NPM_TOKEN: "x", HOME: "/home/someone",
  });
  assert.deepEqual(Object.keys(env).filter((k) => /TOKEN|KEY|SECRET|ASKPASS|SSH_AUTH|^GIT_DIR$|^GIT_WORK_TREE$/.test(k)), []);
  assert.equal(env.PATH, "/usr/bin");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(env.HOME, os.tmpdir());
});

test("the command line: exit codes tell clean, needs-a-human, and bad usage apart", () => {
  const run = (args) => {
    const out = sink();
    const err = sink();
    const code = main(args, out, err, { now: new Date("2026-01-02T03:04:05Z") });
    return { code, out: out.text(), err: err.text() };
  };
  const base = ["--repository", "owner/name", "--repo-dir", repo.dir, "--base", "main"];
  const clean = run([...base, "--head", "clean-docs"]);
  assert.equal(clean.code, 0, clean.err);
  assert.deepEqual(validate(evidenceSchema, JSON.parse(clean.out)).errors, []);
  const risky = run([...base, "--head", "weaken-in-lockstep"]);
  assert.equal(risky.code, 3);
  assert.match(risky.err, /human review required: YES/);
  assert.equal(JSON.parse(risky.out).verdict.human_review_required, true);
  assert.equal(run([...base, "--head", "--output=x"]).code, 2);
  assert.equal(run([]).code, 2);
  assert.equal(run(["--repository", "owner/name", "--head", "clean-docs"]).code, 2);
  assert.equal(run([...base, "--head", "clean-docs", "--bogus", "1"]).code, 2);
});

test("this repository's own tree is judged clean against itself (sanity check on the real files)", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "ops/lib/trusted-base.mjs")));
  repo.branch("noop", () => {});
  const r = check("noop");
  assert.equal(r.changes.total, 0);
  assert.equal(r.verdict.base_rules_pass, true, JSON.stringify(r.rules, null, 1).slice(0, 600));
  assert.equal(r.verdict.human_review_required, false);
});
