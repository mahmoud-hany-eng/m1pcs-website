# Frozen CI definition used by the evidence tests

`ci.yml` and `policy.json` here are the workflow and the policy as they were when the recorded real runs in `../ci/` were executed
(the OPS-0002/OPS-0003 baseline CI: lint, type check, validate, ops tests, build).

The CI-evidence tools judge a recorded GitHub run against the workflow that ran it ("expectations come from the trusted workflow"):
a run of a workflow that has since changed is, by design, not evidence about the new workflow. The tests that replay those
recordings therefore read THIS copy. The live `.github/workflows/ci.yml` and the live policy are checked by `workflow-safety.test.mjs`
and by `npm run ops:validate`, not by these replays. Do not edit these files to follow the live CI.
