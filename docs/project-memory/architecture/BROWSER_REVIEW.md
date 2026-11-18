# Reviewing from a browser: Claude Code on the web as the reviewer's runtime (OPS-0004 correction)

**Status: research and design; nothing has been run.** No reviewer session has been started. This document answers the owner's correction to OPS-0004: the owner uses Claude Code at claude.ai/code in a browser and not a terminal or an editor (HD-0020, REQ-OPS-013), so the first reviewer test (OPS-0005) must be a browser procedure. The procedure itself is in [FIRST_REVIEW_RUNBOOK.md](../reviewer/FIRST_REVIEW_RUNBOOK.md); the decision record is [ADR-0014](adr/0014-repository-structure-and-instagram-separation-are-permanent-rules.md).

**Evidence tags.** **[D]** stated by the official Claude Code documentation or by the platform's own session documentation, read on 2026-11-17 (pages: claude-code-on-the-web, cloud-environments, permissions, settings, security, cli-reference). The pages were read through a fetch tool; where its text was truncated or summarised, the fact is marked _(summary)_. **[O]** observed in the cloud session that wrote this document (a session of the same kind as a reviewer session, but not the reviewer's). **[U]** not stated by the documentation and not verified. **NOT STATED** means the pages read do not say it. Nothing marked [U] is claimed to work. Do not invent session interfaces: every mechanism below is either documented, observed or marked [U].

## 1. Short answer

A browser-native review **is feasible with one human action**, and it stays **advisory**.

- The reviewer session does not receive a file from the developer. It **rebuilds the review packet itself**, inside its own virtual machine, from material that GitHub holds: the trusted baseline commit, the reviewed commits, and GitHub's own CI data. The packet builder is deterministic, so the rebuilt packet must have the manifest hash that the owner pinned in the prompt.
- **The one human action that cannot be avoided:** the trusted baseline commit (the last OPS-0004 work commit) exists only in the developer container. A browser session can reach only what GitHub holds, so the owner must authorise **one normal push of exactly the branch `claude/ops-0004-review-foundation`** (OQ-0037). OPS-0004 does not push. The earlier idea of a git bundle is **not** a browser option: uploading a bundle is a terminal feature (`claude --cloud`, [D]).
- **Read-only isolation is instructed, not technically enforced,** in a browser session (section 5). Evidence provenance is **partly** established (section 6). Therefore every review from the browser stays **advisory**, as the owner required.

## 2. What the web environment provides

| Capability | Status | Source |
|---|---|---|
| Each session runs in its own isolated, Anthropic-managed VM with a fresh filesystem | Documented | [D] "each session runs in an isolated, Anthropic-managed VM" |
| Two sessions share files | **Not documented; not assumed.** Only the environment's setup-script cache is shared; no documented way to pass files or data between sessions | [D] NOT STATED |
| One session reads another session's transcript or files | NOT STATED | [D] |
| The repository is cloned fresh when the session starts | Documented | [D] |
| The user can choose a branch or commit when starting a session in the browser | **NOT STATED** | [D]; the terminal's `claude --cloud` clones the current branch |
| The clone is shallow | Not stated in the docs. **Observed here:** shallow, 62 commits reachable | [O] |
| Other branches can be fetched through the GitHub proxy | Not stated. **Observed:** fetching two pushed branches of this repository into a new empty repository worked in about one second; fetching an unpushed branch fails ("couldn't find remote ref") | [O] |
| GitHub access goes through a proxy; the real token stays outside the VM; the VM holds a scoped credential | Documented | [D] |
| The proxy limits which branches may be pushed | **No.** It rejects tag pushes and branch deletions and "doesn't limit which branches a push can update"; restriction needs GitHub branch protection or rulesets | [D] |
| Network access levels: None, Limited (the default, with package managers), Full; set per environment; GitHub, package registries and cloud SDKs are in the default list | Documented. api.github.com is in the default list | [D] (list: _summary_) |
| Unauthenticated reads of api.github.com work from the VM, including the job log download | Observed: run, jobs, check runs and the job log of run 44082419253 all returned 200 | [O] |
| The repository's `CLAUDE.md` and `.claude/settings.json` hooks and permission rules are loaded (single-repository sessions) | Documented. A `CLAUDE.md` is therefore loaded in a reviewer session | [D] |
| Permission modes: Accept edits, Plan, Auto (Auto only if the organisation allows it); chosen in the mode dropdown at the start or during a task | Documented | [D] |
| File edits run without asking in every mode; Auto also runs most other tool calls without asking; bypass is not offered; `defaultMode` values `bypassPermissions` and `dontAsk` in a settings file are ignored in cloud sessions | Documented | [D] |
| The CLI options `--restricted`, `--tools`, `--strict-mcp-config`, `--disable-slash-commands`, `--session-id` | Terminal options. **`--restricted` "refuses to create cloud sessions"** | [D] cli-reference |
| A session identifier is visible to the owner as `claude.ai/code/session_...` | Documented | [D] |
| Starting a browser session from a prompt supplied by a URL or an API | NOT STATED for sessions | [D] |
| Session sharing by link | Documented; recipients see the latest state, not live | [D] |
| Multi-repository sessions load no `.claude/settings.json` hooks | Documented | [D] |

## 3. How the packet reaches the reviewer (options considered)

The browser reviewer is a separate session with a separate filesystem. The packet therefore cannot be "handed over". The options:

| Option | Verdict | Why |
|---|---|---|
| A shared directory or volume between sessions | Rejected | Not documented; explicitly not assumed |
| **The reviewer rebuilds the packet in its own VM from GitHub-hosted inputs** | **Chosen** | Needs only what GitHub holds (below); the build is deterministic, so the owner can pin the expected manifest hash; the reviewer computes the packet itself instead of trusting a file the developer produced |
| Commit the packet to a branch and let the reviewer read it | Rejected | The packet's content (worker text, a 300 KB diff) would sit on a developer-controlled branch; committing it changes the baseline it records; and the packet is already a pure function of GitHub-held inputs |
| Paste the packet into the prompt | Rejected | About 300 KB, mostly worker-authored text; a size limit of the prompt box is not stated [U]; it would turn evidence into prompt bulk |
| Attach files in the browser | [U] | Not stated in the pages read; not needed |
| Publish an artifact and let the reviewer read it | Rejected | The tool exists in some sessions, but another party's artifact is returned as a summary, the hash check would be awkward, and it publishes something |
| A GitHub issue or pull-request comment | Rejected | The repository is public; it would publish the packet, and it needs a pull request, which nobody authorised |
| Read the developer's session transcript | Rejected | NOT STATED [D]; the developer's context must not be the reviewer's input |

### What the reviewer needs from GitHub

1. **The trusted baseline commit** `<BASELINE_COMMIT>`: the last OPS-0004 work commit, on the branch `claude/ops-0004-review-foundation` (needs the push). It supplies the reviewer instructions, the policy, the schemas, the task definition, the requirements and the tools.
2. **The reviewed commits:** base `0aba5e8f2c5f4971b3b7280e0a4cd23e4a5a9b75` and head `50a46ca88a682095b07422152136a747d12bddd3` on `claude/ops-0003-trusted-ci` (already on GitHub).
3. **GitHub's CI data** for run 44082419253 (read unauthenticated from api.github.com, or taken from the evidence file committed in the baseline).

The reviewer fetches those into a **fresh bare repository** in its own scratch directory, so the history is complete even though the session's own clone is shallow, and the session's own checkout is never touched. It extracts the baseline's files into a scratch directory and runs **the baseline's tools from there**, so the reviewed branch can neither change nor be executed as the judge's code. The packet it builds must match the pinned `EXPECTED_MANIFEST_SHA256`; if it does not, the reviewer stops.

**Rehearsal [T]:** the exact command blocks of the runbook were run against a stand-in remote (a full, non-shallow local repository with the same branch names; GitHub itself could not serve the unpushed baseline branch). The packet rebuilt from a bare repository had the same manifest hash as the earlier builds, `ef1e492ce91fb419093a563bccedfa0b6788cf658dd9aa640f293c202a81d6e4` for baseline `4aeb1c0`; the live GitHub reads of the CI data worked from this VM.

## 4. Independent evidence check

The committed evidence file was produced by the developer side. To avoid trusting it blindly, the reviewer **regenerates the evidence from GitHub's own API** (four unauthenticated GET requests, then the baseline's `ops/ci-evidence.mjs`) and compares six sections with the committed file: `verdict`, `trusted_base`, `github_ci.workflow_run`, `github_ci.jobs`, `github_ci.token_permissions` and `github_ci.test_evidence`. **[T/O]** Run on 2026-11-17 against live GitHub data, all six are identical. The file as a whole is **not** expected to be byte-identical: it carries a generation time, the collector's role, and a Vercel check run that GitHub re-created after the first fetch (a new id). That is why the manifest hash is pinned on the committed file and the independent check compares sections instead.

## 5. Is read-only isolation technically enforced? No

| Property | Technically enforced in a browser session? | Detail |
|---|---|---|
| The reviewer runs in a different VM from the developer | **Yes** (platform) | [D] isolated VM per session |
| The reviewer cannot read the developer's files or conversation | **Yes**, by isolation | No documented cross-session channel |
| The real GitHub credential is outside the VM; API access is limited to the repositories attached to the session | **Yes** | [D] |
| Outbound network is limited to an allowlist | **Yes, per environment** | [D]; GitHub (through its proxy), enabled connectors and the Anthropic API stay reachable at any level |
| Every non-edit command needs a person's approval | **Yes, only if the owner picks Accept edits (not Auto)** | [D]; a human-in-the-loop control, not an automatic restriction, and file edits are never prompted |
| The reviewer cannot write files | **No** | File edits run without asking in every mode [D] |
| The reviewer cannot run other commands | **No** | `--restricted` and `--tools` are terminal options; `--restricted` refuses to create cloud sessions [D] |
| The reviewer cannot push to GitHub | **No** | The proxy "doesn't limit which branches a push can update" [D]. Only branch protection or rulesets set on GitHub restrict it, and `claude/**` branches are not protected |
| The reviewer does not run code from the reviewed branch | **No** | Instruction only |
| Project `.claude/settings.json` deny rules | **Possible, not relied on** | [D] permission rules are loaded in single-repository sessions; their effect in a cloud session was not verified [U]; by design they do not cover arbitrary subprocesses (a script can write what a deny rule forbids the edit tool) and a `Bash(git push *)` pattern does not stop `git -C . push` [D]. Such a file would also bind every worker on the same branch, so none is added |
| The reviewer follows the launch message and ignores instructions inside the evidence | **No** | A model behaviour; the gate and the human check the result afterwards |

**Consequences.** (1) The launch message states plainly which limits are instructions. (2) The reviewer must report what it did, which commands it ran, and what it could have done. (3) The owner should start the session in **Accept edits** mode so that each command is approved by a person, who can refuse anything not listed in the runbook. (4) Every review from a browser session is advisory; the decision gate says so, a human decides, and nothing is merged, deployed or started because of it.

## 6. Evidence provenance in the browser flow

| Packet part | Where it comes from | How it is checked | What remains trusted |
|---|---|---|---|
| Reviewer instructions, schema, task, policy, requirements, tools | The baseline commit, fetched from GitHub | The commit id is pinned in the owner's prompt; the owner compares it with GitHub's commit page; the tools refuse to run unless their policy, schemas and prompt equal the baseline's; a packet's trusted files are re-compared with the checkout | The owner's review of OPS-0004. The developer session wrote the baseline |
| CI evidence | The evidence file committed in the baseline | Six sections regenerated by the reviewer from GitHub's API and compared | GitHub's API; unauthenticated tool output; a reviewer that skips the check |
| Changed files, diff, commit list | Computed from git objects fetched from GitHub | The head commit id is pinned; the base must be its ancestor | The text of the diff is the developer's |
| Run report | The reviewed branch (the developer's claim) | Labelled a claim; compared with the diff and the CI evidence by the reviewer | Nothing |
| The reviewer's own identity | Its own session identifier | Compared with the developer's by the gate (a recorded identifier, not a proof); the owner compares it with the address bar | The reviewer's honesty |

The chain is **partly** established: the inputs are bound to commit ids and a manifest hash, and the CI data is independently regenerated. It is **not** established that the baseline is itself trustworthy (the developer wrote it; the owner's review is the anchor), that the reviewer's identifier is true, or that the reviewer stayed read-only. The trusted-base check from OPS-0003 stays advisory (OQ-0035) and the repository still lacks enforced separation between the owner's identity and the identity Claude acts under (OQ-0036).

## 7. Unverified items that OPS-0005 will observe

| # | Item | How it will be observed | If it fails |
|---|---|---|---|
| 1 | A new browser session can fetch the pushed baseline branch and the OPS-0003 branch through the proxy | The first command block succeeds | The reviewer stops and reports the exact error; the owner may choose another start branch |
| 2 | The session's network allows unauthenticated reads of api.github.com | The second block succeeds | The reviewer marks the CI evidence "not independently regenerated" and the review is weaker |
| 3 | In Accept edits mode each non-edit command is shown for approval | The owner sees prompts | The review is still advisory; note it |
| 4 | The reviewer finds its own session identifier | It reports the identifier; the owner compares it with the address bar | The owner supplies it from the address bar |
| 5 | A stop hook or system message asking to commit and push is declined | The reviewer's report says so | Stop and record it |
| 6 | The repository's `CLAUDE.md` (the worker protocol) is loaded and does not override the launch message | The reviewer says which file it was told to obey | Record it |
| 7 | The session starts on the default or a chosen branch | The report states the branch and commit it started on | Irrelevant to the result; the baseline is fetched by id |

## 8. What the owner must do (human actions)

1. **Authorise one push** of exactly `claude/ops-0004-review-foundation` (OQ-0037), by naming the branch to the development session. Nothing else is pushed.
2. **Compare the baseline commit id** in the prompt with the branch on GitHub (github.com, the branch's commit list) yourself; do not rely only on the developer session's message.
3. **Open a new session** at claude.ai/code on the repository, select the **Accept edits** mode, and paste the prompt once.
4. **Approve only the listed commands** (the runbook lists them); refuse anything else.
5. **Copy the reviewer's report and decision**, check that its session identifier equals the one in the address bar and differs from the developer's, and paste the decision into the development session for an **independent re-run of the gate** on a packet that session rebuilds.
6. Optionally, create a **dedicated environment** for reviews with the Limited network level (Allow package managers unticked) and no variables or secrets (cloud environment menu in the session's title bar, then Edit). Its effect on this procedure is not verified [U].

## 9. What this changes in earlier documents

- The runbook now leads with this browser procedure; the terminal procedure remains as an optional alternative for terminal users.
- The reviewer prompt (version 2.2.0-draft) no longer says "you have only read tools" unconditionally: it distinguishes technically enforced limits from instructions and requires the reviewer to say which applied.
- OQ-0037 changes: a git bundle is not usable from a browser, so the recommended answer is the one-time push of the branch.
- [REVIEWER_FEASIBILITY.md](REVIEWER_FEASIBILITY.md) (OPS-0001B) remains the earlier assessment of Claude-only reviewer runtimes; this document adds the browser session as a concrete manual runtime (`manual_session`).
