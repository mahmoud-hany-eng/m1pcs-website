#!/usr/bin/env node
// Build or verify a review packet (OPS-0004). Offline: it reads a git repository and files and writes a directory.
// No network, no credential, no model. Run it from a checkout of the TRUSTED BASELINE.
//
//   node ops/review-packet.mjs build --repo-dir . --baseline <rev> --base <rev> --head <rev> \
//        --task OPS-0003 --attempt OPS-0003-a1 --evidence ci-evidence.json --out <new directory>
//        [--baseline-exception HD-nnnn]   only for a baseline that is NOT independent (it is, or descends from, the reviewed code);
//                                         names the decision that records why; the packet then says so and is never called independent
//   node ops/review-packet.mjs verify --packet <directory> [--expect-baseline <40-hex commit>]
//
// Exit codes: 0 = done / packet valid; 3 = the packet is not valid (reasons on standard error); 2 = bad usage or a refusal
// (the reason is named); 1 = internal error.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { PacketError, buildPacket, verifyPacket } from "./lib/review-packet.mjs";
import { TrustedBaseError } from "./lib/trusted-base.mjs";

const VALUE_OPTIONS = ["repo-dir", "baseline", "base", "head", "task", "attempt", "evidence", "out", "packet", "expect-baseline", "baseline-exception"];
class UsageError extends Error {}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a.startsWith("--") && VALUE_OPTIONS.includes(a.slice(2))) {
      if (rest[i + 1] === undefined) throw new UsageError(`${a} needs a value`);
      args[a.slice(2)] = rest[i + 1];
      i += 1;
    } else throw new UsageError(`unknown argument: ${a}`);
  }
  return args;
}

export function main(argv, out = process.stdout, errOut = process.stderr) {
  try {
    if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
      out.write("usage: node ops/review-packet.mjs build --repo-dir . --baseline <rev> --base <rev> --head <rev> --task <ID> --attempt <ID-aN> --evidence <file> --out <new dir> [--baseline-exception HD-nnnn]\n       node ops/review-packet.mjs verify --packet <dir> [--expect-baseline <sha>]\n");
      return argv.length === 0 ? 2 : 0;
    }
    const args = parseArgs(argv);
    if (args.command === "build") {
      for (const k of ["baseline", "base", "head", "task", "attempt", "evidence", "out"]) if (!args[k]) throw new UsageError(`--${k} is required`);
      const result = buildPacket({
        repoDir: path.resolve(args["repo-dir"] ?? "."),
        baseline: args.baseline, base: args.base, head: args.head, taskId: args.task, attemptId: args.attempt,
        evidenceFile: path.resolve(args.evidence), outDir: path.resolve(args.out), baselineException: args["baseline-exception"] ?? null,
      });
      out.write(`${JSON.stringify({ packet: result.outDir, manifest_sha256: result.manifestSha256, subject: result.manifest.subject, trusted_baseline: result.manifest.trusted_baseline, ci: result.manifest.ci, change: result.manifest.change, indicators: result.manifest.indicators }, null, 2)}\n`);
      errOut.write(`packet written to ${result.outDir}; manifest sha256 ${result.manifestSha256}\n`);
      const bl = result.manifest.trusted_baseline;
      errOut.write(bl.independent ? "baseline: independent (it predates the work and holds the approved task)\n" : `baseline: NOT independent (${bl.relation_to_head}); accepted only under ${bl.exception.approval_reference}; this is not independent verification\n`);
      if (!bl.scope_established_by_evidence) errOut.write("scope: the evidence's trusted-base check did not establish the task's scope from the base revision\n");
      if (!result.manifest.ci.evidence_complete) errOut.write(`evidence: NOT complete as derived${result.manifest.ci.evidence_legacy ? " (earlier shape)" : ""}; the gate will return requires-corrections\n`);
      return 0;
    }
    if (args.command === "verify") {
      if (!args.packet) throw new UsageError("--packet is required");
      const result = verifyPacket(path.resolve(args.packet), { expectBaseline: args["expect-baseline"] ?? null });
      if (!result.ok) {
        for (const e of result.errors) errOut.write(`${e.code}: ${e.message}\n`);
        return 3;
      }
      out.write(`${JSON.stringify({ valid: true, subject: result.manifest.subject, trusted_baseline: result.manifest.trusted_baseline, ci: result.manifest.ci, change: result.manifest.change, indicators: result.manifest.indicators }, null, 2)}\n`);
      return 0;
    }
    throw new UsageError("the first argument must be build or verify");
  } catch (err) {
    if (err instanceof UsageError || err instanceof PacketError || err instanceof TrustedBaseError) {
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
