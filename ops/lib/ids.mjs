// The identifiers of the development workflow, defined ONCE (OPS-0006). Zero dependencies.
//
//   task id     OPS-0006     3 to 5 capital letters, a hyphen, four digits, and at most ONE capital letter after the digits
//                            (OPS-0005B is a correction of OPS-0005; OPS-0005BC and OPS-0005b are not ids)
//   attempt id  OPS-0006-a1  a task id, then -a and a number from 1 to 99
//   branch      claude/ops-0006-consumer-integrity
//               claude/, the task id in lower case (the optional letter included), a hyphen and a slug of lower-case words
//
// The JSON schemas (task, run report, review decision, packet manifest) cannot import this file, so they carry the same
// patterns as literal text; ops/tests/identifiers.test.mjs fails if any of them differs from the definitions below.
// Every code reader of an identifier imports these helpers instead of writing its own expression.

export const TASK_ID_PATTERN = "^[A-Z]{3,5}-[0-9]{4}[A-Z]?$";
export const ATTEMPT_ID_PATTERN = "^[A-Z]{3,5}-[0-9]{4}[A-Z]?-a[1-9][0-9]?$";
export const BRANCH_PATTERN = "^claude/[a-z]{3,5}-[0-9]{4}[a-z]?-[a-z0-9]+(-[a-z0-9]+)*$";

const TASK_ID_RE = new RegExp(TASK_ID_PATTERN);
const ATTEMPT_ID_RE = new RegExp(ATTEMPT_ID_PATTERN);
const BRANCH_RE = new RegExp(BRANCH_PATTERN);
const ATTEMPT_PARTS_RE = /^(.+)-a([1-9][0-9]?)$/;
const TASK_FILE_RE = /^([A-Z]{3,5}-[0-9]{4}[A-Z]?)-[a-z0-9]+(-[a-z0-9]+)*\.md$/;

export const isTaskId = (value) => typeof value === "string" && TASK_ID_RE.test(value);
export const isAttemptId = (value) => typeof value === "string" && ATTEMPT_ID_RE.test(value);
export const isTaskBranch = (value) => typeof value === "string" && BRANCH_RE.test(value);

/** `claude/ops-0005b-`: what every branch of a task starts with. The optional letter is part of the task's identity. */
export const branchPrefix = (taskId) => `claude/${taskId.toLowerCase()}-`;

/** A valid branch that belongs to this task and not to the task with the same digits and another (or no) letter. */
export const branchBelongsToTask = (branch, taskId) => isTaskId(taskId) && isTaskBranch(branch) && branch.startsWith(branchPrefix(taskId));

/** The task id inside an attempt id, or null when it is not an attempt id. */
export const taskIdOfAttempt = (attemptId) => (isAttemptId(attemptId) ? ATTEMPT_PARTS_RE.exec(attemptId)[1] : null);

/** The attempt number inside an attempt id, or null. */
export const attemptNumberOf = (attemptId) => (isAttemptId(attemptId) ? Number(ATTEMPT_PARTS_RE.exec(attemptId)[2]) : null);

/** The task id a task file name starts with (`OPS-0005B-evidence-hardening.md` gives OPS-0005B), or null. */
export const taskIdOfFileName = (name) => {
  const m = typeof name === "string" ? TASK_FILE_RE.exec(name) : null;
  return m ? m[1] : null;
};

/** The pattern of the task files of one task: `<task id>-<slug>.md`. */
export const taskFileNameRegex = (taskId) => new RegExp(`^${taskId}-[a-z0-9]+(-[a-z0-9]+)*\\.md$`);
