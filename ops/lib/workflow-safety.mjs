// Deterministic safety checker for GitHub Actions workflow files. Zero dependencies, no network, no model.
//
// It does not try to recognise "bad" workflows. It enforces ONE approved shape, taken from policy.workflow_policy,
// and rejects everything else (an allow-list is the only kind of check that an unexpected construct cannot slip past):
//   - every workflow file must be listed in the policy, and every required one must exist;
//   - only the policy's events, with exactly the policy's branch filters, may start a workflow;
//   - the only GITHUB_TOKEN permission is the policy's (contents: read), set once at the top, never per job;
//   - the job runs on a GitHub-hosted runner from the policy, with a bounded timeout;
//   - the only actions are the policy's approved ones, each pinned to the policy's full commit SHA, called with exactly
//     the policy's inputs (for example persist-credentials: false, and no dependency cache);
//   - the only commands that run are the policy's required commands, in the policy's order;
//   - no key outside the approved shape (environment, env, if, needs, strategy, container, services, ...);
//   - the ${{ }} expression syntax appears only in the concurrency group, and only for github.workflow and github.ref,
//     so no event data, secret or token can reach a command, an input or a name;
//   - no mention of credentials, deployment or release anywhere in names or values.
// The workflow is read with ops/lib/mini-yaml.mjs, which rejects every YAML construct it cannot interpret unambiguously.
//
// Limits (also recorded in the project memory): this checks the file, not what GitHub does with it; it cannot see
// repository settings or secrets; and when it runs in CI on a pull request that edits ops/ it is the pull request's own
// copy that runs, so changes to the checker itself need human review (they are control-plane files).

import fs from "node:fs";
import path from "node:path";
import { YamlError, entry, get, isMap, isScalar, isSeq, parseYaml, text } from "./mini-yaml.mjs";

const TOP_KEYS = new Set(["name", "on", "permissions", "concurrency", "jobs"]);
const JOB_KEYS = new Set(["name", "runs-on", "timeout-minutes", "steps"]);
const STEP_KEYS = new Set(["name", "uses", "with", "run"]);
const CONCURRENCY_KEYS = new Set(["group", "cancel-in-progress"]);

/** Why a commonly dangerous key is not part of the approved shape. */
const KEY_REASONS = {
  environment: "an environment gives a job deployment secrets and approvals; CI deploys nothing",
  env: "environment variables are how credentials reach commands; the approved commands need none",
  secrets: "no secret may be referenced",
  if: "a condition can silently skip a verification step",
  "continue-on-error": "it lets a failing check pass",
  needs: "the approved workflow has a single job",
  strategy: "matrices and retries change what is verified",
  container: "a job container runs an unreviewed image",
  services: "service containers run unreviewed images",
  outputs: "job outputs hand data to other jobs",
  defaults: "default shells and directories change how commands run",
  shell: "a custom shell changes how commands run",
  "working-directory": "commands run at the repository root",
  permissions: "permissions are set once at the top of the workflow and never per job",
  id: "step ids exist to pass outputs between steps",
  "timeout-minutes": "only a job may set a timeout",
};

const FORBIDDEN_TRIGGER_REASONS = {
  pull_request_target: "it runs with the base repository's secrets and a write token while handling code from an untrusted pull request",
  workflow_run: "it runs with the base repository's secrets and a write token on the output of another, possibly untrusted, run",
};

const SECRET_RE = /(?:\bsecrets?\s*[.[]|github\.token|GITHUB_TOKEN|ANTHROPIC|OAUTH|CLAUDE_CODE|API[_-]?KEY|AUTH[_-]?TOKEN|VERCEL|SUPABASE|SERVICE[_-]?ROLE|PASSWORD|PRIVATE[_-]?KEY)/i;
const DEPLOY_RE = /\b(?:deploy\w*|vercel|netlify|release[sd]?|publish\w*|promote\w*|production|rollout)\b/i;
const EXPRESSION_RE = /\$\{\{/;
const GROUP_RE = /^(?:[A-Za-z0-9._-]|\$\{\{ github\.(?:workflow|ref) \}\})+$/;

/** Dangerous tokens that must not appear anywhere outside comments, even if the structured checks pass. */
const RAW_DANGER = [
  [/\bpull_request_target\b/, "pull_request_target"],
  [/\bworkflow_run\b/, "workflow_run"],
  [/\bself-hosted\b/, "self-hosted runner"],
  [/\bid-token\b/, "id-token permission"],
  [/\bsecrets\s*[.[]/, "a secrets reference"],
  [/github\.token|GITHUB_TOKEN/, "the workflow token by name"],
  [/\benvironment\s*:/, "an environment"],
  [/\bwrite-all\b|\bread-all\b/, "a blanket permission"],
];

const commentFree = (line) => line.replace(/^\s*#.*$/, "").replace(/(^|\s)#.*$/, "$1");

/**
 * Check one workflow's text against policy.workflow_policy.
 * Returns an array of { code, line, message }; empty means the workflow matches the approved shape.
 */
export function checkWorkflowText(source, policy) {
  const wp = policy.workflow_policy;
  const issues = [];
  const add = (code, line, message) => issues.push({ code, line: line ?? null, message });

  let root;
  try {
    root = parseYaml(source);
  } catch (err) {
    if (err instanceof YamlError) return [{ code: "WF-SYNTAX", line: err.line || null, message: `${err.message}. This checker reads only plain block-style workflows, so that no other YAML reader can interpret the file differently` }];
    throw err;
  }
  if (!isMap(root)) return [{ code: "WF-SYNTAX", line: root.line ?? 1, message: "a workflow must be a mapping at the top level" }];

  const approvedCommands = new Set(wp.required_commands);

  /* ---- every key and value: expressions, credentials, deployment words */
  const visit = (node, trail) => {
    if (isMap(node)) {
      for (const e of node.entries) {
        scanText(e.key, e.line, [...trail, e.key], true);
        visit(e.value, [...trail, e.key]);
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, i) => visit(item, [...trail, String(i)]));
    } else if (isScalar(node) && !node.empty) {
      if (!approvedCommands.has(node.value)) scanText(node.value, node.line, trail, false);
    }
  };
  const scanText = (value, line, trail, isKey) => {
    const where = isKey ? `the key "${value}"` : `the value ${JSON.stringify(value.length > 50 ? `${value.slice(0, 47)}...` : value)}`;
    if (SECRET_RE.test(value)) {
      add("WF-SECRETS", line, `${where} names a credential, token or secret store. CI runs unprivileged: no secret, token, key or provider credential may be referenced`);
    }
    if (EXPRESSION_RE.test(value)) {
      const onlyGroup = trail.length === 2 && trail[0] === "concurrency" && trail[1] === "group" && !isKey && GROUP_RE.test(value);
      if (!onlyGroup) add("WF-EXPRESSION", line, `${where} uses the \${{ }} expression syntax. It is allowed only in the concurrency group, and only for github.workflow and github.ref, because expressions can place event data from an untrusted pull request into a command`);
    }
    if (DEPLOY_RE.test(value)) add("WF-DEPLOY", line, `${where} mentions deployment, release or production. CI never deploys and never touches production`);
  };
  visit(root, []);

  /* ---- top-level keys */
  for (const e of root.entries) {
    if (!TOP_KEYS.has(e.key)) add("WF-KEYS", e.line, `top-level key "${e.key}" is not part of the approved workflow shape (${[...TOP_KEYS].join(", ")})${KEY_REASONS[e.key] ? `: ${KEY_REASONS[e.key]}` : ""}`);
  }

  /* ---- triggers */
  const onEntry = entry(root, "on");
  if (!onEntry) add("WF-TRIGGER", root.line, 'the workflow has no "on:" section');
  else if (!isMap(onEntry.value)) add("WF-TRIGGER", onEntry.line, '"on:" must be a mapping of the approved events with their branch filters (a bare event name or a list is not accepted)');
  else {
    const seen = new Set();
    for (const t of onEntry.value.entries) {
      seen.add(t.key);
      if (wp.forbidden_triggers.includes(t.key)) {
        add("WF-TRIGGER", t.line, `the event "${t.key}" is forbidden${FORBIDDEN_TRIGGER_REASONS[t.key] ? `: ${FORBIDDEN_TRIGGER_REASONS[t.key]}` : " by policy"}`);
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(wp.allowed_triggers, t.key)) {
        add("WF-TRIGGER", t.line, `the event "${t.key}" is not approved (approved: ${Object.keys(wp.allowed_triggers).join(", ")})`);
        continue;
      }
      if (!isMap(t.value)) {
        add("WF-TRIGGER", t.line, `"${t.key}" must be a mapping with a "branches" list`);
        continue;
      }
      for (const f of t.value.entries) {
        if (f.key !== "branches") add("WF-TRIGGER", f.line, `the filter "${f.key}" on "${t.key}" is not approved: only "branches" is allowed, because paths and types change what gets verified`);
      }
      const branches = get(t.value, "branches");
      const want = [...wp.allowed_triggers[t.key]].sort();
      if (!isSeq(branches) || !branches.items.every((b) => text(b) !== null)) {
        add("WF-TRIGGER", t.line, `"${t.key}" needs a "branches" list of plain names`);
        continue;
      }
      const got = branches.items.map((b) => b.value);
      if (new Set(got).size !== got.length || JSON.stringify([...got].sort()) !== JSON.stringify(want)) {
        add("WF-TRIGGER", branches.line, `"${t.key}" branches must be exactly ${JSON.stringify(wp.allowed_triggers[t.key])}, found ${JSON.stringify(got)}`);
      }
    }
    for (const name of Object.keys(wp.allowed_triggers)) {
      if (!seen.has(name)) add("WF-TRIGGER", onEntry.line, `the approved event "${name}" is missing`);
    }
  }

  /* ---- permissions */
  const perms = entry(root, "permissions");
  if (!perms) add("WF-PERMISSIONS", root.line, 'there is no top-level "permissions:" block; without it the token gets the repository default, which may include write access');
  else if (!isMap(perms.value)) add("WF-PERMISSIONS", perms.line, '"permissions:" must list explicit scopes; a blanket value such as read-all or write-all is not accepted');
  else {
    const allowed = wp.max_token_permissions;
    for (const p of perms.value.entries) {
      const value = text(p.value);
      if (!Object.prototype.hasOwnProperty.call(allowed, p.key)) add("WF-PERMISSIONS", p.line, `the permission "${p.key}" is not allowed (anything not listed in the policy is none)`);
      else if (value !== allowed[p.key]) add("WF-PERMISSIONS", p.line, `the permission "${p.key}" must be "${allowed[p.key]}", found ${JSON.stringify(value)}`);
    }
    for (const name of Object.keys(allowed)) {
      if (!entry(perms.value, name)) add("WF-PERMISSIONS", perms.line, `the permission "${name}: ${allowed[name]}" must be stated explicitly`);
    }
  }

  /* ---- concurrency */
  const conc = entry(root, "concurrency");
  if (!conc) add("WF-CONCURRENCY", root.line, 'there is no "concurrency:" block; superseded runs must be cancelled so that repeated pushes cannot pile up');
  else if (!isMap(conc.value)) add("WF-CONCURRENCY", conc.line, '"concurrency:" must be a mapping with "group" and "cancel-in-progress"');
  else {
    for (const c of conc.value.entries) if (!CONCURRENCY_KEYS.has(c.key)) add("WF-CONCURRENCY", c.line, `the key "${c.key}" is not part of the approved concurrency block`);
    const group = text(get(conc.value, "group"));
    if (group === null || !GROUP_RE.test(group)) add("WF-CONCURRENCY", conc.line, 'concurrency "group" must be plain text that may contain only ${{ github.workflow }} and ${{ github.ref }}');
    if (text(get(conc.value, "cancel-in-progress")) !== "true") add("WF-CONCURRENCY", conc.line, '"cancel-in-progress" must be true');
  }

  /* ---- the job */
  const jobs = entry(root, "jobs");
  if (!jobs || !isMap(jobs.value) || jobs.value.entries.length !== 1) {
    add("WF-JOBS", jobs ? jobs.line : root.line, 'the approved workflow has exactly one job under "jobs:"');
  } else {
    const job = jobs.value.entries[0];
    if (!/^[a-z][a-z0-9_-]*$/.test(job.key)) add("WF-JOBS", job.line, `the job id "${job.key}" must be lower-case letters, digits, "-" or "_"`);
    if (!isMap(job.value)) add("WF-JOBS", job.line, "the job must be a mapping");
    else {
      for (const k of job.value.entries) {
        if (!JOB_KEYS.has(k.key)) add("WF-KEYS", k.line, `job key "${k.key}" is not part of the approved workflow shape (${[...JOB_KEYS].join(", ")})${KEY_REASONS[k.key] ? `: ${KEY_REASONS[k.key]}` : ""}`);
      }
      const runsOn = text(get(job.value, "runs-on"));
      if (runsOn === null) add("WF-RUNNER", job.line, '"runs-on" must be one plain runner label');
      else if (/self-hosted/i.test(runsOn)) add("WF-RUNNER", job.line, "self-hosted runners are forbidden: they keep state between runs and would execute untrusted code on infrastructure that someone owns");
      else if (!wp.runners.includes(runsOn)) add("WF-RUNNER", job.line, `the runner "${runsOn}" is not approved (approved: ${wp.runners.join(", ")})`);
      const timeout = text(get(job.value, "timeout-minutes"));
      if (timeout === null || !/^[1-9][0-9]*$/.test(timeout) || Number(timeout) > wp.max_timeout_minutes) {
        add("WF-TIMEOUT", job.line, `"timeout-minutes" must be a whole number from 1 to ${wp.max_timeout_minutes}, found ${JSON.stringify(timeout)}`);
      }
      checkSteps(get(job.value, "steps"), job.line);
    }
  }

  function checkSteps(steps, jobLine) {
    if (!isSeq(steps) || steps.items.length === 0) {
      add("WF-STEPS", jobLine, 'the job needs a "steps:" list');
      return;
    }
    const matchedActions = [];
    const matchedCommands = [];
    const sequence = []; // approved items in the order they appear: an action's index, or 100 + a command's index
    for (const step of steps.items) {
      if (!isMap(step)) {
        add("WF-STEPS", step.line, "every step must be a mapping");
        continue;
      }
      for (const k of step.entries) {
        if (!STEP_KEYS.has(k.key)) add("WF-KEYS", k.line, `step key "${k.key}" is not part of the approved workflow shape (${[...STEP_KEYS].join(", ")})${KEY_REASONS[k.key] ? `: ${KEY_REASONS[k.key]}` : ""}`);
      }
      const usesE = entry(step, "uses");
      const runE = entry(step, "run");
      if ((usesE ? 1 : 0) + (runE ? 1 : 0) !== 1) {
        add("WF-STEPS", step.line, 'a step must have exactly one of "uses" or "run"');
        continue;
      }
      if (usesE) {
        const idx = checkUses(step, usesE);
        if (idx !== null) {
          matchedActions.push(idx);
          sequence.push(idx);
        }
      } else {
        if (entry(step, "with")) add("WF-STEPS", step.line, '"with" belongs to "uses" steps only');
        const cmd = text(runE.value);
        if (cmd === null) add("WF-RUN", runE.line, 'a "run" step must be one plain single-line command (multi-line scripts are not approved)');
        else if (!wp.required_commands.includes(cmd)) add("WF-RUN", runE.line, `the command ${JSON.stringify(cmd.length > 60 ? `${cmd.slice(0, 57)}...` : cmd)} is not approved. Only the policy's required commands may run`);
        else if (matchedCommands.includes(wp.required_commands.indexOf(cmd))) add("WF-RUN", runE.line, `the command ${JSON.stringify(cmd)} appears more than once`);
        else {
          matchedCommands.push(wp.required_commands.indexOf(cmd));
          sequence.push(100 + wp.required_commands.indexOf(cmd));
        }
      }
    }
    wp.approved_actions.forEach((a, i) => {
      if (!matchedActions.includes(i)) add("WF-REQUIRED", steps.line, `the approved action ${a.repository} is missing`);
    });
    wp.required_commands.forEach((c, i) => {
      if (!matchedCommands.includes(i)) add("WF-REQUIRED", steps.line, `the required command ${JSON.stringify(c)} is missing`);
    });
    if (JSON.stringify(sequence) !== JSON.stringify([...sequence].sort((a, b) => a - b))) {
      add("WF-ORDER", steps.line, "actions and commands must appear in the policy's order (checkout, Node setup, then the commands in order), so that every check runs on the code that was checked out");
    }
  }

  function checkUses(step, usesE) {
    const value = text(usesE.value);
    if (value === null) {
      add("WF-ACTIONS", usesE.line, '"uses" must be one plain "owner/name@<full commit sha>" reference');
      return null;
    }
    if (value.startsWith("./") || value.startsWith("../")) {
      add("WF-ACTIONS", usesE.line, "local actions are not approved: they run unreviewed code from the branch being checked");
      return null;
    }
    if (value.startsWith("docker://")) {
      add("WF-ACTIONS", usesE.line, "container actions are not approved");
      return null;
    }
    const at = value.lastIndexOf("@");
    if (at <= 0) {
      add("WF-ACTIONS", usesE.line, `"${value}" has no version: pin every action to a full commit SHA`);
      return null;
    }
    const repo = value.slice(0, at);
    const ref = value.slice(at + 1);
    const idx = wp.approved_actions.findIndex((a) => a.repository === repo);
    if (idx === -1) {
      add("WF-ACTIONS", usesE.line, `the action "${repo}" is not approved (approved: ${wp.approved_actions.map((a) => a.repository).join(", ")})`);
      return null;
    }
    const approved = wp.approved_actions[idx];
    if (!/^[0-9a-f]{40}$/.test(ref)) {
      add("WF-ACTIONS", usesE.line, `"${repo}@${ref}" is not pinned to a full 40-character commit SHA. Tags and branches can be moved to different code after review`);
    } else if (ref !== approved.sha) {
      add("WF-ACTIONS", usesE.line, `"${repo}" is pinned to ${ref.slice(0, 12)}..., which is not the commit approved in the policy (${approved.version} = ${approved.sha.slice(0, 12)}...)`);
    }
    const comment = usesE.value.comment;
    if (comment === null || !(comment === approved.version || comment.startsWith(`${approved.version} `))) {
      add("WF-ACTIONS", usesE.line, `write the version in a trailing comment so reviewers can compare it with the pin: "# ${approved.version}"`);
    }
    const withE = entry(step, "with");
    const given = new Map();
    if (withE) {
      if (!isMap(withE.value)) add("WF-ACTIONS", withE.line, '"with" must be a mapping');
      else for (const w of withE.value.entries) given.set(w.key, { value: text(w.value), line: w.line });
    }
    for (const [name, g] of given) {
      if (!approved.required_inputs.some((r) => r.name === name)) add("WF-ACTIONS", g.line, `the input "${name}" of ${repo} is not approved (approved inputs: ${approved.required_inputs.map((r) => r.name).join(", ")})`);
    }
    for (const r of approved.required_inputs) {
      const g = given.get(r.name);
      if (!g) add("WF-ACTIONS", usesE.line, `${repo} must set "${r.name}: ${r.value}"`);
      else if (g.value !== r.value) add("WF-ACTIONS", g.line, `${repo} input "${r.name}" must be "${r.value}", found ${JSON.stringify(g.value)}`);
    }
    return idx;
  }

  /* ---- independent last line of defence: dangerous tokens anywhere outside comments */
  const onLines = new Set(issues.map((i) => i.line));
  source.split(/\r?\n/).forEach((line, i) => {
    const code = commentFree(line);
    for (const [re, label] of RAW_DANGER) {
      if (re.test(code) && !onLines.has(i + 1)) {
        add("WF-RAW", i + 1, `contains ${label}`);
        onLines.add(i + 1);
      }
    }
  });

  return issues.sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

/**
 * Check every workflow file under a checkout. Returns an array of { file, code, line, message }.
 */
export function checkWorkflowFiles(root, policy) {
  const wp = policy.workflow_policy;
  const out = [];
  const dir = path.join(root, wp.workflow_dir);
  const present = [];
  if (fs.existsSync(dir)) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && /\.ya?ml$/i.test(e.name)) present.push(`${wp.workflow_dir}/${e.name}`);
    }
  }
  present.sort();
  for (const rel of present) {
    if (!wp.allowed_workflow_files.includes(rel)) {
      out.push({ file: rel, code: "WF-FILE-UNAPPROVED", line: null, message: "this workflow file is not listed in policy.workflow_policy.allowed_workflow_files. A new workflow needs a policy change that a human approves" });
      continue;
    }
    for (const issue of checkWorkflowText(fs.readFileSync(path.join(root, rel), "utf8"), policy)) out.push({ file: rel, ...issue });
  }
  for (const rel of wp.required_workflow_files) {
    if (!present.includes(rel)) out.push({ file: rel, code: "WF-FILE-MISSING", line: null, message: "the required workflow file is missing" });
  }
  const actionsDir = path.join(root, ".github", "actions");
  if (fs.existsSync(actionsDir)) {
    out.push({ file: ".github/actions", code: "WF-LOCAL-ACTION", line: null, message: "local actions are not approved: they run unreviewed code from the branch being checked" });
  }
  return out;
}
