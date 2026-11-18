import assert from "node:assert/strict";
import test from "node:test";
import { classifyPath, classifyPaths, globToRegExp, matchesGlob, maxClass, pathPermission, staticPrefix, taskPreflight } from "../lib/policy.mjs";
import { loadPolicy } from "./helpers.mjs";

const policy = loadPolicy();

test("glob matching follows gitignore-style rules", () => {
  assert.ok(matchesGlob("src/**", "src/app/page.tsx"));
  assert.ok(!matchesGlob("src/**", "srcx/app/page.tsx"));
  assert.ok(matchesGlob("**/*.test.*", "a/b/c.test.ts"));
  assert.ok(matchesGlob("**/*.test.*", "c.test.ts"));
  assert.ok(!matchesGlob("*.md", "docs/readme.md"));
  assert.ok(matchesGlob("next.config.*", "next.config.ts"));
  assert.ok(matchesGlob(".env.*", ".env.local"));
  assert.ok(!matchesGlob(".env.*", ".env"));
  assert.ok(matchesGlob("CLAUDE.md", "CLAUDE.md"));
  assert.ok(!matchesGlob("CLAUDE.md", "docs/CLAUDE.md"));
  assert.ok(globToRegExp("a?c").test("abc"));
  assert.ok(!globToRegExp("a?c").test("a/c"));
});

test("staticPrefix is the literal leading part of a glob", () => {
  assert.equal(staticPrefix("docs/project-memory/**"), "docs/project-memory/");
  assert.equal(staticPrefix("CLAUDE.md"), "CLAUDE.md");
  assert.equal(staticPrefix("**/*.test.*"), "");
  assert.equal(staticPrefix("next.config.*"), "next.config.");
});

test("maxClass picks the most restrictive class", () => {
  assert.equal(maxClass("A", "B"), "B");
  assert.equal(maxClass("C", "A", "B"), "C");
  assert.equal(maxClass(), "A");
});

test("single paths classify exactly as the policy intends", () => {
  const expect = (path, cls, restriction) => {
    const got = classifyPath(path, policy);
    assert.equal(got.class, cls, `${path}: class`);
    assert.equal(got.restriction, restriction, `${path}: restriction`);
  };
  expect("docs/notes.md", "A", "none");
  expect("README.md", "A", "none");
  expect("docs/project-memory/runs/OPS-0001/OPS-0001-a1/report.json", "A", "none");
  expect("docs/project-memory/policy/policy.json", "B", "control_plane");
  expect("docs/project-memory/requirements/MASTER_REQUIREMENTS.md", "B", "protected");
  expect(".github/workflows/ci.yml", "B", "control_plane");
  expect("ops/tests/x.test.mjs", "B", "control_plane");
  expect("src/app/page.tsx", "B", "protected");
  expect("public/builds/a.jpg", "B", "immutable");
  expect("public/logo.png", "B", "immutable");
  expect(".env", "C", "immutable");
  expect(".env.local", "C", "immutable");
  expect(".env.example", "B", "protected");
  expect("vercel.json", "C", "protected");
  expect("some/unknown/file.bin", "B", "none");
});

test("a set of paths classifies as the maximum of its members", () => {
  const result = classifyPaths(["docs/notes.md", "package.json"], policy);
  assert.equal(result.class, "B");
  assert.deepEqual(result.protectedPaths, ["package.json"]);
  const onlyDocs = classifyPaths(["docs/a.md", "docs/b.md"], policy);
  assert.equal(onlyDocs.class, "A");
  assert.equal(onlyDocs.protectedPaths.length, 0);
  assert.equal(classifyPaths([".env"], policy).class, "C");
});

test("pre-flight classification of file globs is conservative", () => {
  assert.equal(taskPreflight(["docs/guides/**"], policy).class, "A");
  assert.equal(taskPreflight(["docs/project-memory/runs/**"], policy).class, "A");
  assert.equal(taskPreflight(["docs/project-memory/policy/**"], policy).class, "B");
  assert.equal(taskPreflight(["docs/project-memory/policy/**"], policy).restriction, "control_plane");
  assert.equal(taskPreflight(["package.json"], policy).class, "B");
  assert.equal(taskPreflight(["src/components/**"], policy).class, "B");
  assert.equal(taskPreflight([".env.local"], policy).class, "C");
  assert.equal(taskPreflight(["brand-new-area/**"], policy).class, "B");
  assert.ok(taskPreflight(["**/*.md"], policy).notes[0].includes("wildcard"));
});

test("control-plane paths need an explicit, specific files_allowed entry", () => {
  const task = (allowed, forbidden = []) => ({ files_allowed: allowed, files_forbidden: forbidden });
  const policyFile = "docs/project-memory/policy/policy.json";
  assert.equal(pathPermission(policyFile, task(["docs/**"]), policy).allowed, false);
  assert.match(pathPermission(policyFile, task(["docs/**"]), policy).reasons.join(" "), /control-plane/);
  assert.equal(pathPermission(policyFile, task(["docs/project-memory/**"]), policy).allowed, false);
  assert.equal(pathPermission(policyFile, task(["docs/project-memory/policy/**"]), policy).allowed, true);
  assert.equal(pathPermission("CLAUDE.md", task(["CLAUDE.md"]), policy).allowed, true);
  assert.equal(pathPermission("ops/validate-memory.mjs", task(["ops/**"]), policy).allowed, true);
});

test("immutable paths, forbidden paths and out-of-scope paths are never permitted", () => {
  const broad = { files_allowed: ["public/**", "docs/**"], files_forbidden: ["docs/private/**"] };
  assert.equal(pathPermission("public/builds/a.jpg", broad, policy).allowed, false);
  assert.match(pathPermission("public/builds/a.jpg", broad, policy).reasons.join(" "), /immutable/);
  assert.equal(pathPermission("docs/private/x.md", broad, policy).allowed, false);
  assert.equal(pathPermission("src/app/page.tsx", broad, policy).allowed, false);
  assert.equal(pathPermission("docs/guide.md", broad, policy).allowed, true);
});
