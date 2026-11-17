// Shared helpers for the validator tests. Built-ins only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const POLICY_PATH = "docs/project-memory/policy/policy.json";

export function readJson(rel, root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
}

export function loadSchemas(root = ROOT) {
  return {
    task: readJson("docs/project-memory/schemas/task.schema.json", root),
    report: readJson("docs/project-memory/schemas/run-report.schema.json", root),
    decision: readJson("docs/project-memory/schemas/review-decision.schema.json", root),
    policy: readJson("docs/project-memory/schemas/policy.schema.json", root),
  };
}

export function loadPolicy(root = ROOT) {
  return readJson(POLICY_PATH, root);
}

export function fixture(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "ops", "tests", "fixtures", rel), "utf8"));
}

/** A validation context built around the fixture task OPS-9001. */
export function fixtureContext() {
  const task = fixture("valid/task.json");
  const report = fixture("valid/run-report.json");
  return {
    schemas: loadSchemas(),
    policy: loadPolicy(),
    tasks: new Map([[task.task_id, task]]),
    reports: new Map([[report.attempt_id, report]]),
    taskIds: new Set([task.task_id]),
    reqIds: new Set(),
    oqIds: new Set(),
    hdIds: new Set(),
  };
}

/** Copy the parts of the repository the validator reads into a temporary directory. */
export function copyTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m1-memory-"));
  for (const rel of ["CLAUDE.md", "docs/project-memory", "ops"]) {
    fs.cpSync(path.join(ROOT, rel), path.join(dir, rel), { recursive: true });
  }
  return dir;
}

export function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

export function write(dir, rel, text) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export function read(dir, rel) {
  return fs.readFileSync(path.join(dir, rel), "utf8");
}

export function edit(dir, rel, fn) {
  write(dir, rel, fn(read(dir, rel)));
}

export function editJson(dir, rel, fn) {
  const data = JSON.parse(read(dir, rel));
  fn(data);
  write(dir, rel, `${JSON.stringify(data, null, 2)}\n`);
}

/** Write the valid fixture task into a temporary tree as a real task file. */
export function addFixtureTask(dir, mutate = () => {}, name = "OPS-9001-fixture-task.md") {
  const task = fixture("valid/task.json");
  mutate(task);
  write(dir, `docs/project-memory/tasks/${name}`, `---json\n${JSON.stringify(task, null, 2)}\n---\n\n# Fixture task\n\nThis fixture task exists only inside tests. It asks the worker to add an example documentation page and record the result.\n`);
  return task;
}

export function addFixtureReport(dir, mutate = () => {}, rel = "docs/project-memory/runs/OPS-9001/OPS-9001-a1/report.json") {
  const report = fixture("valid/run-report.json");
  mutate(report);
  write(dir, rel, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

/** Does the result contain a finding with this code (and optionally a file and message fragment)? */
export function has(result, code, { file, contains, severity } = {}) {
  return result.findings.items.some(
    (i) => i.code === code && (!file || i.file === file) && (!contains || i.message.includes(contains)) && (!severity || i.severity === severity),
  );
}

export function describeFindings(result) {
  return result.findings.items.map((i) => `${i.severity} [${i.code}] ${i.file}${i.line ? `:${i.line}` : ""}: ${i.message}`).join("\n");
}

/** A writable stream stand-in that records what was written. */
export function sink() {
  const chunks = [];
  return { write: (s) => { chunks.push(s); return true; }, text: () => chunks.join("") };
}
