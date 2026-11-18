#!/usr/bin/env node
// Judge a reviewer's decision against a review packet (OPS-0004). Offline, deterministic, no model, no network, no credential.
// Run it from a checkout of the TRUSTED BASELINE: the policy, schemas, reviewer prompt and task file it uses are that checkout's.
//
//   node ops/decision-gate.mjs --packet <directory> --decision <review.json> [--expect-baseline <40-hex commit>]
//
// Result (standard output, JSON) and exit code:
//   REVIEW_VALID_HUMAN_APPROVAL_REQUIRED  0   the review is valid; a human still decides everything that follows
//   REQUIRES_CORRECTIONS                  3
//   REVIEW_REJECTED                       4
//   REVIEW_INVALID                        5
// Exit 2 is bad usage, 1 an internal error. Exit 0 NEVER means "approved": the gate merges, deploys, authorises and launches nothing.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { RESULTS, evaluateDecision } from "./lib/decision-gate.mjs";

const EXIT = { [RESULTS.VALID]: 0, [RESULTS.CORRECTIONS]: 3, [RESULTS.REJECTED]: 4, [RESULTS.INVALID]: 5 };
const VALUE_OPTIONS = ["packet", "decision", "expect-baseline"];
class UsageError extends Error {}

export function main(argv, out = process.stdout, errOut = process.stderr) {
  try {
    if (argv.includes("--help") || argv.includes("-h")) {
      out.write("usage: node ops/decision-gate.mjs --packet <dir> --decision <review.json> [--expect-baseline <sha>]\n");
      return 0;
    }
    const args = {};
    for (let i = 0; i < argv.length; i += 1) {
      const a = argv[i];
      if (a.startsWith("--") && VALUE_OPTIONS.includes(a.slice(2))) {
        if (argv[i + 1] === undefined) throw new UsageError(`${a} needs a value`);
        args[a.slice(2)] = argv[i + 1];
        i += 1;
      } else throw new UsageError(`unknown argument: ${a}`);
    }
    if (!args.packet || !args.decision) throw new UsageError("--packet and --decision are required");
    if (args["expect-baseline"] !== undefined && !/^[0-9a-f]{40}$/.test(args["expect-baseline"])) throw new UsageError("--expect-baseline must be a full 40-character commit id");
    const result = evaluateDecision({ packetDir: path.resolve(args.packet), decisionFile: path.resolve(args.decision), expectBaseline: args["expect-baseline"] ?? null });
    out.write(`${JSON.stringify(result, null, 2)}\n`);
    errOut.write(`${result.result}${result.result === RESULTS.VALID ? " (a human still decides; this is not an approval)" : ""}\n`);
    for (const r of result.reasons) errOut.write(`  - [${r.outcome}] ${r.code}: ${r.message}\n`);
    return EXIT[result.result];
  } catch (err) {
    if (err instanceof UsageError) {
      errOut.write(`usage: ${err.message}\n`);
      return 2;
    }
    errOut.write(`internal error: ${err && err.stack ? err.stack : err}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
