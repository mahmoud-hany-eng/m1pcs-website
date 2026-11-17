// Trusted-base verification (OPS-0003). Zero dependencies, no network, no credentials.
//
// Question answered: "if I judge the proposed change (head) with the validation logic and the policy of an ESTABLISHED
// revision (base), instead of with the logic the change itself carries, what do I find?"
//
// Why it exists: a pull request or a worker branch can edit the checker, the policy, the schemas and the workflow that
// judge it, so its own green CI proves nothing about those files. This module reads the rules from the base revision and
// reads the head revision only as DATA. It never imports, executes or follows anything that comes from the head:
//   - trees are read with `git ls-tree` and `git cat-file`, never `git archive` (a head `.gitattributes` export-ignore
//     could otherwise hide a file from the check) and never a checkout (no filters, no hooks, no smudge);
//   - symbolic links and submodules inside the governed paths are refused, not followed;
//   - every git and node child process gets a minimal environment with no token, key or secret-looking variable;
//   - the base's validator runs in a child process with a timeout.
//
// What it is NOT: independent enforcement. This code only judges anything if somebody runs it from the base revision,
// and a pull request that can rewrite the workflow can also stop that workflow from running it. Until the run is anchored
// somewhere the change cannot reach (see docs/project-memory/architecture/TRUSTED_CI.md), its verdict is advisory data
// and control-plane changes still need a human. The result says so (verdict.enforcement is always "advisory_only").

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export class TrustedBaseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TrustedBaseError";
    this.code = code;
  }
}

/** Where the rules come from in the base revision. */
export const TRUSTED_LOGIC_PATHS = ["ops", "docs/project-memory/policy", "docs/project-memory/schemas"];
/** What of the head revision is read, as data. */
export const GOVERNED_PATHS = ["CLAUDE.md", ".github", "docs/project-memory", "ops", "package.json"];
const REQUIRED_BASE_FILES = ["ops/validate-memory.mjs", "ops/lib/policy.mjs", "docs/project-memory/policy/policy.json"];
const POLICY_DIR = "docs/project-memory/policy";
const SCHEMAS_DIR = "docs/project-memory/schemas";
const CI_SCRIPT_NAMES = ["lint", "build", "ops:validate", "ops:test"];
const BUILD_INPUTS = [
  "package.json", "package-lock.json", "next.config.ts", "next.config.js", "next.config.mjs", "tsconfig.json", "eslint.config.mjs",
  "postcss.config.mjs", "tailwind.config.ts", ".npmrc", ".nvmrc", ".node-version", "vercel.json",
];

const LIMITS = { blobBytes: 5 * 1024 * 1024, totalBytes: 64 * 1024 * 1024, files: 5000, changes: 20000, reportedPaths: 300, reportedFindings: 40, childMs: 120_000 };

export const TOOL = { name: "ops/trusted-base", version: "1.0.0" };

/* ------------------------------------------------------------------ processes */

/** An environment for child processes: nothing that looks like a credential, nothing that can redirect git. */
export function sanitizedEnv(source = process.env) {
  const env = {};
  for (const key of ["PATH", "LANG", "LC_ALL", "TZ", "SystemRoot", "TMPDIR"]) if (source[key] !== undefined) env[key] = source[key];
  env.HOME = os.tmpdir();
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = os.devNull;
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_OPTIONAL_LOCKS = "0";
  env.LC_ALL = "C";
  return env;
}

function git(repoDir, args, { input, maxBuffer = 256 * 1024 * 1024 } = {}) {
  try {
    return execFileSync("git", ["-c", `core.hooksPath=${os.devNull}`, "-c", "core.fsmonitor=false", "-c", "core.pager=cat", "-C", repoDir, ...args], {
      env: sanitizedEnv(),
      input,
      maxBuffer,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString("utf8").trim().slice(0, 300) : String(err.message).slice(0, 300);
    throw new TrustedBaseError("TB-GIT", `git ${args[0]} failed: ${stderr}`);
  }
}

/* --------------------------------------------------------------- revisions */

export function resolveCommit(repoDir, rev, label) {
  if (typeof rev !== "string" || rev === "" || rev.length > 255 || rev.startsWith("-") || /[\0\r\n]/.test(rev)) {
    throw new TrustedBaseError("TB-REV", `${label} revision ${JSON.stringify(String(rev).slice(0, 40))} is not an acceptable revision name`);
  }
  let out;
  try {
    out = git(repoDir, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${rev}^{commit}`]).toString("utf8").trim();
  } catch {
    throw new TrustedBaseError("TB-REV", `${label} revision ${JSON.stringify(rev)} does not resolve to a commit in this repository`);
  }
  if (!/^[0-9a-f]{40}$/.test(out)) throw new TrustedBaseError("TB-REV", `${label} revision ${JSON.stringify(rev)} did not resolve to a full commit id`);
  return out;
}

function mergeBaseOf(repoDir, a, b) {
  try {
    const out = git(repoDir, ["merge-base", a, b]).toString("utf8").trim();
    if (/^[0-9a-f]{40}$/.test(out)) return out;
  } catch {
    // fall through to the explicit error below
  }
  throw new TrustedBaseError("TB-NO-MERGE-BASE", "base and head have no common history, so there is no meaningful set of changes to judge");
}

/* ------------------------------------------------------------------- trees */

function safeRelPath(p) {
  if (typeof p !== "string" || p === "" || p.startsWith("/") || p.includes("\\") || /[\0-\x1f\x7f]/.test(p) || p.includes("�") || p.includes("//")) return false;
  return p.split("/").every((seg) => seg !== "" && seg !== "." && seg !== ".." && seg.toLowerCase() !== ".git");
}

/** Read the entries of a tree. Returns { files, links } where links are symlinks and submodules (never materialised). */
function readTree(repoDir, commit, paths) {
  const raw = git(repoDir, ["ls-tree", "-r", "-z", "--full-tree", commit, "--", ...paths]).toString("utf8");
  const files = [];
  const links = [];
  for (const rec of raw.split("\0")) {
    if (rec === "") continue;
    const m = /^(\d{6}) (\w+) ([0-9a-f]{40}|[0-9a-f]{64})\t([\s\S]+)$/.exec(rec);
    if (!m) throw new TrustedBaseError("TB-TREE", "unrecognised tree entry in git ls-tree output");
    const [, mode, type, sha, rel] = m;
    if (!safeRelPath(rel)) throw new TrustedBaseError("TB-PATH", `unsafe path in the tree: ${JSON.stringify(rel.slice(0, 80))}`);
    if (type === "blob" && (mode === "100644" || mode === "100755")) files.push({ path: rel, mode, sha });
    else links.push({ path: rel, mode, type });
  }
  if (files.length > LIMITS.files) throw new TrustedBaseError("TB-TOO-LARGE", `more than ${LIMITS.files} files in the governed paths`);
  const seen = new Map();
  for (const f of files) {
    const key = f.path.toLowerCase();
    if (seen.has(key) && seen.get(key) !== f.path) throw new TrustedBaseError("TB-PATH-COLLISION", `paths differ only by letter case: ${seen.get(key)} and ${f.path}`);
    seen.set(key, f.path);
  }
  return { files, links };
}

/** Fetch blob contents in one `git cat-file --batch` call. */
function readBlobs(repoDir, files) {
  if (files.length === 0) return new Map();
  const out = git(repoDir, ["cat-file", "--batch"], { input: `${files.map((f) => f.sha).join("\n")}\n` });
  const contents = new Map();
  let offset = 0;
  let total = 0;
  for (const f of files) {
    const eol = out.indexOf(0x0a, offset);
    if (eol === -1) throw new TrustedBaseError("TB-GIT", "truncated git cat-file output");
    const header = out.subarray(offset, eol).toString("utf8").split(" ");
    if (header[1] !== "blob") throw new TrustedBaseError("TB-GIT", `object for ${f.path} is not a blob`);
    const size = Number(header[2]);
    if (!Number.isInteger(size) || size > LIMITS.blobBytes) throw new TrustedBaseError("TB-TOO-LARGE", `${f.path} is larger than ${LIMITS.blobBytes} bytes`);
    total += size;
    if (total > LIMITS.totalBytes) throw new TrustedBaseError("TB-TOO-LARGE", "the governed paths are larger than the allowed total size");
    contents.set(f.path, out.subarray(eol + 1, eol + 1 + size));
    offset = eol + 1 + size + 1;
  }
  return contents;
}

function writeFiles(dir, contents) {
  for (const [rel, buf] of contents) {
    const file = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buf, { mode: 0o644, flag: "wx" });
  }
}

function manifestHash(contents) {
  const h = crypto.createHash("sha256");
  for (const rel of [...contents.keys()].sort()) h.update(`${rel}\0${crypto.createHash("sha256").update(contents.get(rel)).digest("hex")}\n`);
  return h.digest("hex");
}

/**
 * Head files as data, with the base's version of every file under `replacePrefixes`.
 * A file the head ADDS under those directories is kept: it cannot override a base file, and the base validator only loads
 * the schema and policy files it already names, so an added file cannot change the rules. Keeping it stops an honest
 * addition (a new schema that the head's documents link to) from being reported as a broken link. A file the head
 * DELETES comes back from the base, so deleting a rule does not remove it.
 */
function overlayRoot(dir, headContents, baseContents, replacePrefixes) {
  const inReplaced = (rel) => replacePrefixes.some((p) => rel.startsWith(`${p}/`));
  const merged = new Map();
  for (const [rel, buf] of headContents) merged.set(rel, buf);
  for (const [rel, buf] of baseContents) if (inReplaced(rel)) merged.set(rel, buf);
  fs.mkdirSync(dir, { recursive: true });
  writeFiles(dir, merged);
}

/* ------------------------------------------------------------- the changes */

function changedPaths(repoDir, from, to) {
  const raw = git(repoDir, ["diff", "--raw", "-z", "--no-renames", "--no-abbrev", from, to]).toString("utf8").split("\0");
  const out = [];
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const meta = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z])\d*$/.exec(raw[i]);
    if (!meta) continue;
    const rel = raw[i + 1];
    if (!safeRelPath(rel)) throw new TrustedBaseError("TB-PATH", `unsafe changed path: ${JSON.stringify(rel.slice(0, 80))}`);
    out.push({ path: rel, status: meta[3], mode_old: meta[1], mode_new: meta[2] });
    if (out.length > LIMITS.changes) throw new TrustedBaseError("TB-TOO-LARGE", `more than ${LIMITS.changes} changed paths`);
  }
  return out;
}

/** One file of one revision, as bytes, or null if it does not exist there. */
export function readBlobAtRevision(repoDir, commit, rel) {
  try {
    return git(repoDir, ["cat-file", "blob", `${commit}:${rel}`]);
  } catch {
    return null;
  }
}

function scriptsOf(buf) {
  if (buf === null) return { present: false, scripts: {} };
  try {
    const pkg = JSON.parse(buf.toString("utf8"));
    return { present: true, scripts: pkg && typeof pkg.scripts === "object" && pkg.scripts !== null ? pkg.scripts : {} };
  } catch {
    return { present: true, scripts: null };
  }
}

/** Did the package scripts that CI runs (or the npm hooks around them) change? */
function packageScriptChanges(repoDir, mergeBase, head) {
  const before = scriptsOf(readBlobAtRevision(repoDir, mergeBase, "package.json"));
  const after = scriptsOf(readBlobAtRevision(repoDir, head, "package.json"));
  if (before.scripts === null || after.scripts === null) return { changed: true, changed_keys: ["(package.json is not valid JSON)"], ci_entrypoints_changed: true };
  const keys = [...new Set([...Object.keys(before.scripts), ...Object.keys(after.scripts)])].sort();
  const changed = keys.filter((k) => before.scripts[k] !== after.scripts[k]);
  const relevant = (k) => CI_SCRIPT_NAMES.includes(k) || CI_SCRIPT_NAMES.some((n) => k === `pre${n}` || k === `post${n}`) || /^(pre|post)?(install|prepare|publish|prepublishOnly)$/.test(k);
  return { changed: changed.length > 0, changed_keys: changed.slice(0, 40), ci_entrypoints_changed: changed.some(relevant) };
}

/* ------------------------------------------------------- the trusted worker */

// Runs in a child process, from the base revision's own files. It imports only base code.
const WORKER_SOURCE = `
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const input = JSON.parse(fs.readFileSync(0, "utf8"));
const load = (rel) => import(pathToFileURL(path.join(input.baseDir, rel)).href);
const validator = await load("ops/validate-memory.mjs");
const policyLib = await load("ops/lib/policy.mjs");
const policy = JSON.parse(fs.readFileSync(path.join(input.baseDir, "docs/project-memory/policy/policy.json"), "utf8"));
const run = (root) => {
  try {
    const r = validator.validateMemory({ root });
    return { ok: r.ok, stats: r.stats, items: r.findings.items };
  } catch (err) {
    return { ok: false, stats: { files: 0, errors: 1, warnings: 0 }, items: [{ severity: "error", code: "TB-VALIDATOR-CRASH", file: "(validator)", line: null, message: String((err && err.message) || err).slice(0, 300) }] };
  }
};
const out = { runA: run(input.rootA), runB: run(input.rootB) };
const paths = input.changed.map((c) => c.path);
out.classification = policyLib.classifyPaths(paths, policy);
out.approval = policy.approval;
out.taskScope = null;
if (input.task) {
  out.taskScope = { task_id: input.task.id, source: input.task.text === null ? "not_found_in_base" : "base_revision", violations: [] };
  if (input.task.text !== null) {
    const parsed = validator.parseTaskFile(input.task.text);
    if (parsed.error || !parsed.data) out.taskScope.violations.push({ path: "(task file)", reasons: ["the base revision's task file cannot be parsed"] });
    else for (const p of paths) {
      const r = policyLib.pathPermission(p, parsed.data, policy);
      if (!r.allowed) out.taskScope.violations.push({ path: p, reasons: r.reasons });
    }
  }
}
process.stdout.write(JSON.stringify(out));
`;

function runWorker(input) {
  try {
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", WORKER_SOURCE], {
      env: sanitizedEnv(),
      input: JSON.stringify(input),
      timeout: LIMITS.childMs,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return JSON.parse(out.toString("utf8"));
  } catch (err) {
    const why = err.killed || err.signal ? "timed out" : (err.stderr ? err.stderr.toString("utf8").trim().slice(0, 300) : String(err.message).slice(0, 300));
    throw new TrustedBaseError("TB-WORKER", `the base revision's validation logic could not be run: ${why}`);
  }
}

/* ------------------------------------------------------------------ result */

function summariseRun(run) {
  const errors = run.items.filter((i) => i.severity === "error");
  return {
    ok: run.ok,
    errors: errors.length,
    warnings: run.items.length - errors.length,
    files_checked: run.stats && Number.isInteger(run.stats.files) ? run.stats.files : 0,
    sample: errors.slice(0, LIMITS.reportedFindings).map((i) => ({ code: String(i.code).slice(0, 60), file: String(i.file).slice(0, 200), message: String(i.message).slice(0, 300) })),
    truncated: errors.length > LIMITS.reportedFindings,
  };
}

const startsWithAny = (p, prefixes) => prefixes.some((x) => p === x || p.startsWith(`${x}/`));

/**
 * Judge the change base..head with the validation logic and the policy of `base`.
 * @param {object} o
 * @param {string} o.repoDir  a git repository (or worktree) that contains both revisions
 * @param {string} o.base     the established revision: the source of the rules and of the task scope
 * @param {string} o.head     the proposed revision: read only as data
 * @param {string|null} [o.taskId]  judge the changed paths against this task's scope as recorded in `base`
 * @param {"unanchored"|"protected_workflow"} [o.anchor]  a CLAIM by the caller about where this is being run; it is recorded, never trusted
 */
export function trustedBaseCheck({ repoDir, base, head, taskId = null, anchor = "unanchored" }) {
  if (!fs.existsSync(repoDir)) throw new TrustedBaseError("TB-REPO", "the repository directory does not exist");
  if (taskId !== null && !/^[A-Z]{2,5}-\d{4}$/.test(taskId)) throw new TrustedBaseError("TB-TASK", `${JSON.stringify(String(taskId).slice(0, 20))} is not a task id`);
  if (!["unanchored", "protected_workflow"].includes(anchor)) throw new TrustedBaseError("TB-ANCHOR", "anchor must be unanchored or protected_workflow");

  const baseSha = resolveCommit(repoDir, base, "base");
  const headSha = resolveCommit(repoDir, head, "head");
  const mergeBaseSha = mergeBaseOf(repoDir, baseSha, headSha);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m1-trusted-base-"));
  try {
    // 1. the rules, from the base revision
    const baseTree = readTree(repoDir, baseSha, TRUSTED_LOGIC_PATHS);
    if (baseTree.links.length) throw new TrustedBaseError("TB-SYMLINK", `the base revision has a symbolic link or submodule inside its validation logic: ${baseTree.links[0].path}`);
    const baseContents = readBlobs(repoDir, baseTree.files);
    for (const required of REQUIRED_BASE_FILES) {
      if (!baseContents.has(required)) throw new TrustedBaseError("TB-BASE-NO-LOGIC", `the base revision has no ${required}, so it holds no trusted validation logic to apply`);
    }
    const baseDir = path.join(tmp, "base");
    fs.mkdirSync(baseDir);
    writeFiles(baseDir, baseContents);

    // 2. the change, from the head revision, as data
    const headTree = readTree(repoDir, headSha, GOVERNED_PATHS);
    if (headTree.links.length) throw new TrustedBaseError("TB-SYMLINK", `the head revision adds a symbolic link or submodule inside the governed paths (${headTree.links[0].path}); links are refused, not followed`);
    const headContents = readBlobs(repoDir, headTree.files);

    const rootB = path.join(tmp, "head-under-base-policy");
    const rootA = path.join(tmp, "head-policy-under-base-validator");
    overlayRoot(rootB, headContents, baseContents, [POLICY_DIR, SCHEMAS_DIR]);
    overlayRoot(rootA, headContents, baseContents, [SCHEMAS_DIR]);

    const changed = changedPaths(repoDir, mergeBaseSha, headSha);
    const linkChange = changed.find((c) => c.status !== "D" && (c.mode_new === "120000" || c.mode_new === "160000"));

    // 3. the task scope, from the base revision
    let task = null;
    if (taskId !== null) {
      const names = git(repoDir, ["ls-tree", "-r", "--name-only", "-z", baseSha, "--", "docs/project-memory/tasks"]).toString("utf8").split("\0").filter((n) => new RegExp(`^docs/project-memory/tasks/${taskId}-[a-z0-9-]+\\.md$`).test(n));
      const blob = names.length === 1 ? readBlobAtRevision(repoDir, baseSha, names[0]) : null;
      task = { id: taskId, text: blob === null ? null : blob.toString("utf8") };
    }

    // 4. judge, with the base's own code, in a child process
    const worker = runWorker({ baseDir, rootA, rootB, changed, task });
    const cls = worker.classification;
    const needsApproval = new Set(worker.approval.human_approval_before_merge_for_restrictions);
    const classesNeedingApproval = new Set(worker.approval.human_approval_before_run_for_classes);

    const paths = changed.map((c) => c.path);
    const flags = {
      workflow_files_changed: paths.some((p) => startsWithAny(p, [".github"])),
      policy_changed: paths.some((p) => startsWithAny(p, [POLICY_DIR])),
      schemas_changed: paths.some((p) => startsWithAny(p, [SCHEMAS_DIR])),
      ops_code_changed: paths.some((p) => startsWithAny(p, ["ops"])),
      claude_md_changed: paths.includes("CLAUDE.md"),
      reviewer_prompt_changed: paths.some((p) => startsWithAny(p, ["docs/project-memory/reviewer"])),
      build_inputs_changed: paths.some((p) => BUILD_INPUTS.includes(p)),
      link_or_submodule_added: Boolean(linkChange),
    };
    const pkg = packageScriptChanges(repoDir, mergeBaseSha, headSha);

    const reasons = [];
    const A = summariseRun(worker.runA);
    const B = summariseRun(worker.runB);
    const baseRulesPass = A.ok && B.ok;
    if (!B.ok) reasons.push("the head's files fail the base revision's rules (policy, schemas and validator of the base)");
    if (!A.ok) reasons.push("the head's own policy fails the base revision's validator (rules were changed in a way the base does not accept)");
    const hitRestrictions = cls.hits.filter((h) => needsApproval.has(h.restriction));
    if (hitRestrictions.length) reasons.push(`${hitRestrictions.length} changed path(s) are protected, control-plane or immutable under the base policy`);
    if (classesNeedingApproval.has(cls.class)) reasons.push(`the base policy computes class ${cls.class} for these paths, and that class needs human approval before a run and before a merge`);
    if (pkg.ci_entrypoints_changed) reasons.push("package.json changed a script that CI or npm runs around CI (lint, build, ops:validate, ops:test or their hooks)");
    if (flags.link_or_submodule_added) reasons.push("a symbolic link or submodule was added");
    const taskScope = worker.taskScope;
    if (taskScope && taskScope.source === "not_found_in_base") reasons.push(`task ${taskScope.task_id} has no approved task file in the base revision, so its scope cannot be established`);
    if (taskScope && taskScope.violations.length) reasons.push(`${taskScope.violations.length} changed path(s) are outside the scope of task ${taskScope.task_id} as recorded in the base revision`);

    const controlPlaneChanged = cls.controlPlanePaths.length > 0 || flags.workflow_files_changed || flags.policy_changed || flags.schemas_changed || flags.ops_code_changed || flags.claude_md_changed || flags.reviewer_prompt_changed;
    const humanReviewRequired = reasons.length > 0;

    return {
      tool: TOOL,
      trusted_logic: { source_commit: baseSha, file_count: baseContents.size, manifest_sha256: manifestHash(baseContents) },
      evaluated: { base_sha: baseSha, head_sha: headSha, merge_base_sha: mergeBaseSha },
      execution_context: { anchor, anchor_is_claim: true },
      changes: {
        total: changed.length,
        truncated: changed.length > LIMITS.reportedPaths,
        paths: changed.slice(0, LIMITS.reportedPaths).map((c) => {
          const hit = cls.hits.find((h) => h.path === c.path);
          return { path: c.path, status: c.status, mode_new: c.mode_new, class: hit.class, restriction: hit.restriction, categories: hit.categories };
        }),
      },
      flags,
      control_plane_paths: cls.controlPlanePaths.slice(0, LIMITS.reportedPaths),
      protected_paths: cls.protectedPaths.slice(0, LIMITS.reportedPaths),
      immutable_paths: cls.immutablePaths.slice(0, LIMITS.reportedPaths),
      package_scripts: pkg,
      rules: { head_data_under_base_policy: B, head_policy_under_base_validator: A },
      task_scope: taskScope,
      verdict: {
        base_rules_pass: baseRulesPass,
        control_plane_changed: controlPlaneChanged,
        human_review_required: humanReviewRequired,
        enforcement: "advisory_only",
        reasons,
      },
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
