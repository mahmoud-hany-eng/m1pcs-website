#!/usr/bin/env node
// Build one CI evidence document (OPS-0003). Offline: it reads files you give it, runs git on a local repository, and
// writes JSON. It holds no credentials and makes no network request; fetch the GitHub data in a trusted step first.
//
//   Trusted-base check (judge head with the rules of base):
//     node ops/ci-evidence.mjs --repository owner/name --repo-dir . --base <rev> --head <rev> [--task OPS-0003] [--branch <name>]
//   Add what GitHub reports about the run (files fetched from the REST API by a trusted collector):
//     ... --run run.json --jobs jobs.json [--checks check-runs.json] [--log job.log]
//   --checks and --log may be left out to look at a partial picture, but a complete assessment needs both: without them the
//   checks that depend on them are recorded as not run, ci_passed is false, evidence_complete is false and the missing
//   evidence is listed (OPS-0005B).
//   Without --base the expectations must come from trusted files you name:
//     node ops/ci-evidence.mjs --repository owner/name --head <40-hex sha> --run run.json --jobs jobs.json \
//          --workflow-file <trusted ci.yml> --policy-file <trusted policy.json>
//
// Run this script from the BASE revision (or another place the change cannot reach). Exit codes: 0 = evidence written and
// no human review needed; 3 = evidence written and a human must review; 2 = bad usage or unreadable input; 1 = internal error.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EvidenceError, buildEvidenceDocument, buildGithubCi, expectationsFromWorkflow } from "./lib/ci-evidence.mjs";
import { validate } from "./lib/json-schema.mjs";
import { TrustedBaseError, readBlobAtRevision, resolveCommit, trustedBaseCheck } from "./lib/trusted-base.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(HERE, "..", "docs", "project-memory", "schemas", "ci-evidence.schema.json");
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const VALUE_OPTIONS = ["repository", "repo-dir", "base", "head", "branch", "task", "anchor", "run", "jobs", "checks", "log", "workflow-file", "policy-file", "role", "tool-source", "out"];

class UsageError extends Error {}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a.startsWith("--") && VALUE_OPTIONS.includes(a.slice(2))) {
      if (argv[i + 1] === undefined) throw new UsageError(`${a} needs a value`);
      args[a.slice(2)] = argv[i + 1];
      i += 1;
    } else throw new UsageError(`unknown argument: ${a}`);
  }
  return args;
}

function readInput(file, label) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new UsageError(`${label}: cannot read ${file}`);
  }
  if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) throw new UsageError(`${label}: ${file} is not a regular file under ${MAX_INPUT_BYTES} bytes`);
  return fs.readFileSync(file, "utf8");
}

function readJsonInput(file, label) {
  try {
    return JSON.parse(readInput(file, label));
  } catch (err) {
    if (err instanceof UsageError) throw err;
    throw new UsageError(`${label}: ${file} is not valid JSON`);
  }
}

export function main(argv, out = process.stdout, errOut = process.stderr, { now = new Date() } = {}) {
  try {
    const args = parseArgs(argv);
    if (args.help) {
      out.write("usage: node ops/ci-evidence.mjs --repository owner/name --head <rev> [--base <rev> --repo-dir <dir> [--task ID] [--anchor unanchored|protected_workflow]] [--run run.json --jobs jobs.json [--checks f] [--log f] [--workflow-file f --policy-file f]] [--branch b] [--role r] [--tool-source s] [--out file]\n");
      return 0;
    }
    if (!args.repository || !args.head) throw new UsageError("--repository and --head are required");
    const haveGithub = Boolean(args.run || args.jobs);
    if (haveGithub && !(args.run && args.jobs)) throw new UsageError("--run and --jobs go together");
    if (!args.base && !haveGithub) throw new UsageError("give --base (trusted-base check), --run and --jobs (GitHub data), or both");
    const repoDir = path.resolve(args["repo-dir"] ?? ".");

    let headSha = args.head;
    let baseSha = null;
    let trustedBase = null;
    if (args.base) {
      baseSha = resolveCommit(repoDir, args.base, "base");
      headSha = resolveCommit(repoDir, args.head, "head");
      trustedBase = trustedBaseCheck({ repoDir, base: baseSha, head: headSha, taskId: args.task ?? null, anchor: args.anchor ?? "unanchored" });
    } else if (!/^[0-9a-f]{40}$/.test(headSha)) throw new UsageError("without --base, --head must be a full 40-character commit id");

    let githubCi = null;
    if (haveGithub) {
      let workflowText;
      let policy;
      if (baseSha) {
        const policyBlob = readBlobAtRevision(repoDir, baseSha, "docs/project-memory/policy/policy.json");
        if (policyBlob === null) throw new UsageError("the base revision has no policy to take expectations from");
        try {
          policy = JSON.parse(policyBlob.toString("utf8"));
        } catch {
          throw new UsageError("the base revision's policy is not valid JSON");
        }
        const workflowFiles = policy && policy.workflow_policy && policy.workflow_policy.required_workflow_files;
        if (!Array.isArray(workflowFiles) || workflowFiles.length === 0 || typeof workflowFiles[0] !== "string") {
          throw new UsageError("the base revision's policy defines no workflow policy, so it cannot say what a correct CI run looks like (the base predates the CI baseline)");
        }
        const wfBlob = readBlobAtRevision(repoDir, baseSha, workflowFiles[0]);
        if (wfBlob === null) throw new UsageError("the base revision has no CI workflow to take expectations from");
        workflowText = wfBlob.toString("utf8");
      } else {
        if (!args["workflow-file"] || !args["policy-file"]) throw new UsageError("without --base, name trusted files with --workflow-file and --policy-file");
        workflowText = readInput(args["workflow-file"], "--workflow-file");
        policy = readJsonInput(args["policy-file"], "--policy-file");
      }
      const expected = expectationsFromWorkflow(workflowText, policy, { repository: args.repository, headSha, branch: args.branch ?? null });
      githubCi = buildGithubCi({
        run: readJsonInput(args.run, "--run"),
        jobs: readJsonInput(args.jobs, "--jobs"),
        checkRuns: args.checks ? readJsonInput(args.checks, "--checks") : null,
        jobLog: args.log ? readInput(args.log, "--log") : null,
        expected,
      });
    }

    const doc = buildEvidenceDocument({
      repository: args.repository,
      headSha,
      baseSha,
      branch: args.branch ?? null,
      trustedBase,
      githubCi,
      collector: { tool: "ops/ci-evidence.mjs", tool_source: args["tool-source"] ?? "unknown", role: args.role ?? "unknown" },
      now,
    });
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
    const result = validate(schema, doc);
    if (!result.valid) {
      errOut.write(`internal error: the evidence document does not match its own schema:\n${result.errors.slice(0, 10).join("\n")}\n`);
      return 1;
    }
    const json = `${JSON.stringify(doc, null, 2)}\n`;
    if (args.out) fs.writeFileSync(args.out, json);
    else out.write(json);
    errOut.write(`human review required: ${doc.verdict.human_review_required ? "YES" : "no"}; ci passed: ${doc.verdict.ci_passed}; ci trust basis: ${doc.verdict.ci_trust_basis}; evidence complete: ${doc.verdict.evidence_complete}\n`);
    if (doc.verdict.missing_evidence.length) errOut.write(`missing mandatory evidence: ${doc.verdict.missing_evidence.join(", ")}\n`);
    for (const reason of doc.verdict.reasons) errOut.write(`  - ${reason}\n`);
    return doc.verdict.human_review_required ? 3 : 0;
  } catch (err) {
    if (err instanceof UsageError || err instanceof EvidenceError || err instanceof TrustedBaseError) {
      errOut.write(`${err instanceof UsageError ? "usage" : err.code}: ${err.message}\n`);
      return 2;
    }
    errOut.write(`internal error: ${err && err.stack ? err.stack : err}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
