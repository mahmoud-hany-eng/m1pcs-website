# CI fixtures: what is real and what is not

| Files | Origin |
|---|---|
| `real-run-44082419253.run.json`, `.jobs.json`, `.check-runs.json` | **Real.** The unmodified responses of GitHub's REST API (workflow run, jobs, check runs for the commit) for run 44082419253 of this repository, commit `50a46ca`, fetched without authentication |
| `real-run-44082419253.job.log.excerpt.txt` | **Real, reduced.** Selected lines of the real 2,843-line job log (the token permission block, the command headers, the validation, test and build summary lines), kept with their original timestamps |
| `real-run-44082419253.evidence.json` | **Real.** The output of `ops/ci-evidence.mjs` on the real responses and the full real log, against base `0aba5e8`. The tests rebuild its `github_ci` section from the files above and require an exact match |
| `live-run-43995081483.run.json`, `.jobs.json`, `.job.log.txt` | **Real, reduced.** Data of the first live run (OPS-0002), reduced to the fields the tool reads |
| `live-run-43995081483.check-runs.synthetic.json` | **Synthetic in shape.** Written by hand from the real check run's id, name, status and conclusion. The real check run of the later run (above) confirms the shape and the `github-actions` app slug |

The real responses are stored unmodified, so they contain whatever GitHub returned: the owner's public account name, the commit message with its attribution trailer, and the preview deployment's public address. No credential, email address of a person or business data is in them (the content scan of the validator covers this directory).

Nothing in this directory is a mock of a security decision: tests that need a reviewer decision build one in memory, and say so.
