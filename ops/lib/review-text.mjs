// Text checks shared by the review packet builder and the decision gate (OPS-0004). Zero dependencies, offline, no model.
//
// These checks do not understand language. They look for a few shapes that matter here: credentials and addresses that must
// not be copied into a packet, text written by a worker that reads like an instruction to a reviewer, and commands that a
// proposed task must never contain. A hit is data for a human; it is never obeyed and it never grants anything.

import { EMAIL_RE, SECRET_PATTERNS } from "../validate-memory.mjs";

/** Lines that read like an instruction addressed to a reviewer. Worker-written text can never instruct the reviewer. */
export const INSTRUCTION_PATTERNS = [
  /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|any|the|your)\b[^.\n]{0,30}\b(?:instructions?|rules?|polic(?:y|ies)|guidelines?|prompt)\b/i,
  /\b(?:you are now|new instructions?:|system prompt|developer message)\b/i,
  /\b(?:approve|accept)\s+(?:this|the)\s+(?:change|changes|pr|pull request|work|review|attempt)\b/i,
  /\b(?:set|return|output|respond with)\b[^.\n]{0,30}\bverdict\b[^.\n]{0,20}\bapprove\b/i,
  /\b(?:do not|don't|never)\s+(?:mention|report|flag|tell)\b/i,
  /\bskip\s+(?:the\s+)?(?:checks?|review|policy|validation|tests?)\b/i,
  /\bmerge\s+(?:this\s+|it\s+)?(?:now|immediately|automatically)\b/i,
  /<\/?(?:system|assistant|instructions?)>/i,
];

/** Commands and operations a proposed task or acceptance criterion must never contain (production, publishing, destruction). */
export const PROHIBITED_COMMAND_PATTERNS = [
  ["git-push", /\bgit\s+push\b/i],
  ["git-merge", /\bgit\s+(?:merge|rebase|reset\s+--hard|checkout\s+--\s+\.|clean\s+-[a-z]*f)\b/i],
  ["force", /\s--force(?:-with-lease)?\b|\s-f\s+origin\b/i],
  ["github-cli", /\bgh\s+(?:pr|release|repo|secret|api|auth|workflow)\b/i],
  ["deploy", /\b(?:vercel|netlify|firebase|wrangler|flyctl|supabase)\s+(?:deploy|--prod|db\s+push|link|secrets|functions\s+deploy)\b|\bvercel\b[^\n]{0,20}--prod\b/i],
  ["publish", /\bnpm\s+(?:publish|login|token|adduser)\b/i],
  ["pipe-to-shell", /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/i],
  ["destructive", /\brm\s+-[a-z]*r[a-z]*f?\s+(?:\/|~|\*|\.\.?\b)|\bdrop\s+(?:table|database|schema)\b|\btruncate\s+table\b/i],
  ["privilege", /\bsudo\b|\bchmod\s+-R\b|\bchown\b/i],
  ["remote-shell", /\b(?:ssh|scp|sftp|nc|ncat|telnet)\s+\S/i],
];

/** Which credential-looking shapes appear in the text? Returns pattern ids only, never the matched text. */
export function secretShapes(text) {
  const found = new Set();
  for (const line of text.split(/\r?\n/)) {
    for (const [id, re] of SECRET_PATTERNS) if (re.test(line)) found.add(id);
  }
  return [...found].sort();
}

/** Email addresses other than the allowed ones. Returns the count, never the addresses. */
export function foreignEmailCount(text, allowed) {
  const ok = new Set(allowed.map((e) => e.toLowerCase()));
  let count = 0;
  for (const line of text.split(/\r?\n/)) {
    for (const m of line.matchAll(EMAIL_RE)) {
      const addr = m[0].toLowerCase();
      if (!ok.has(addr) && !/@example\.(?:com|org|net)$/.test(addr)) count += 1;
    }
  }
  return count;
}

/** Number of lines that read like an instruction to a reviewer. */
export function instructionLineCount(text) {
  let count = 0;
  for (const line of text.split(/\r?\n/)) if (INSTRUCTION_PATTERNS.some((re) => re.test(line))) count += 1;
  return count;
}

/** Number of lines of a unified diff that were ADDED and read like an instruction (removed and context lines are not the worker's new text). */
export function addedInstructionLineCount(diff) {
  let count = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++") && INSTRUCTION_PATTERNS.some((re) => re.test(line))) count += 1;
  }
  return count;
}

/** Ids of prohibited command shapes that occur in the text. */
export function prohibitedCommandIds(text) {
  const found = new Set();
  for (const [id, re] of PROHIBITED_COMMAND_PATTERNS) if (re.test(text)) found.add(id);
  return [...found].sort();
}
