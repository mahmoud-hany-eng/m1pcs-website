// A throwaway git repository for the trusted-base tests: the real governed files plus a few stand-ins for the website.
// Built once per test file; each test makes a branch from `main`, changes the working tree, commits, and returns to main.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FROZEN_POLICY_PATH, FROZEN_WORKFLOW_PATH, ROOT } from "./helpers.mjs";

const GIT_ENV = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: os.devNull, GIT_TERMINAL_PROMPT: "0" };
for (const k of Object.keys(GIT_ENV)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE)$/.test(k)) delete GIT_ENV[k];

export function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "m1-tb-test-"));
  const git = (...args) => execFileSync("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  for (const rel of ["CLAUDE.md", "docs/project-memory", "ops", ".github", "package.json"]) {
    fs.cpSync(path.join(ROOT, rel), path.join(dir, rel), { recursive: true, filter: (src) => !src.includes(`${path.sep}node_modules`) });
  }
  const put = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  // The fixture repository holds the CI definition the recorded real runs executed, not the live one (fixtures/frozen/README.md).
  put(".github/workflows/ci.yml", fs.readFileSync(FROZEN_WORKFLOW_PATH, "utf8"));
  put("docs/project-memory/policy/policy.json", fs.readFileSync(FROZEN_POLICY_PATH, "utf8"));
  put("src/app/page.tsx", "export default function Page() { return null; }\n");
  put("public/logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  put("public/builds/example.jpg", Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]));
  put("README.md", "# fixture\n");
  git("add", "-A");
  git("commit", "-q", "-m", "base");

  const api = {
    dir,
    git,
    read: (rel) => fs.readFileSync(path.join(dir, rel), "utf8"),
    write: put,
    remove: (rel) => fs.rmSync(path.join(dir, rel), { recursive: true, force: true }),
    edit(rel, from, to) {
      const text = api.read(rel);
      if (typeof from === "string" && !text.includes(from)) throw new Error(`fixture edit: ${JSON.stringify(from)} not found in ${rel}`);
      put(rel, text.replace(from, to));
    },
    editJson(rel, fn) {
      const data = JSON.parse(api.read(rel));
      fn(data);
      put(rel, `${JSON.stringify(data, null, 2)}\n`);
    },
    symlink(rel, target) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.symlinkSync(target, path.join(dir, rel));
    },
    /** Branch from `from`, apply `mutate`, optionally inspect the working tree (the head), commit, return to main. */
    branch(name, mutate, { from = "main", inspect = null } = {}) {
      git("switch", "-q", "-c", name, from);
      try {
        mutate(api);
        const inspected = inspect ? inspect(dir) : undefined;
        git("add", "-A");
        git("commit", "-q", "--allow-empty", "-m", name);
        return inspected;
      } finally {
        git("switch", "-q", "main");
      }
    },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
  return api;
}
