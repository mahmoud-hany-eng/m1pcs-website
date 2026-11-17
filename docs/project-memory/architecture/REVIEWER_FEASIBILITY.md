# Reviewer feasibility: a Claude-only review loop

**Assessed:** 2026-11-17, for OPS-0001B. **Question:** can the owner's seven-step process run on the existing Claude subscription alone, using only documented interfaces (HD-0010, ADR-0009)? **Decision it supports:** OQ-0031, OQ-0032, OQ-0033. Nothing here selects a runtime or approves anything.

## 1. Verdict

**The process as worded is not fully supported by documented features. A close variant is.**

| Question | Answer |
|---|---|
| Can every step be done with the subscription only, with no API billing? | Yes, if no API key exists in the environment (section 4.8). |
| Is each step supported by official documentation? | Steps 1, 3, 4, 5 and 6: yes, with the caveats below. Step 2: yes, but only as a restricted Claude session **run by the official GitHub Action inside a CI job**, not as a Claude **cloud** session. Step 7: only through an **experimental** interface, or by a human starting the session. |
| Is a reviewer that is a true Claude cloud session, started by GitHub Actions, supported? | Only through the experimental fire endpoint. It works with the subscription, but it cannot be restricted to read-only per task, it acts under the owner's own GitHub identity (the same as the worker), and it has no status, completion callback or idempotency key. Not recommended as the primary design. |
| Simplest documented alternative that fits the subscription-only rule | Run the reviewer (and, if wanted later, the worker) as restricted sessions through the official GitHub Action with a subscription token. Keep cloud sessions for sessions a human starts. |
| Was anything tested live? | No. Nothing was created: no scheduled task, token, secret, workflow or push. Two offline tests were run (section 2). |

## 2. How this was assessed

Evidence tags used below:

- **[D]** official documentation, read on 2026-11-16 and 2026-11-17 (list in section 7). Some long pages were returned only partly verbatim by the fetch tool, and the rest summarised; claims that rest on a summarised part are marked **[D-partial]**.
- **[S]** a support article, paraphrased (not an approved source for quotation).
- **[T]** an offline test run in this environment, described in this section.
- **[U]** not stated by the documentation, or not verified. Nothing marked [U] is claimed to work.

**Offline tests run (no network, no usage, nothing created):**

1. **[T] The installed CLI (2.1.326) exposes the flags the reviewer design depends on:** `--json-schema`, `--tools`, `--allowedTools`, `--disallowedTools`, `--permission-mode`, `--restricted` (removes the tools that run code and web fetch, and ignores user, project and local settings files), `--bare`, `--no-session-persistence`, `--cloud`, and `--max-budget-usd` (documented as a limit on "API calls", print mode only). `claude setup-token` is described as "requires Claude subscription".
2. **[T] Structured-output schema acceptance.** The CLI was run with the model endpoint pointed at an unreachable local port, so nothing could be sent. A deliberately invalid schema failed at once with a schema error, exactly as documented. A trivial valid schema passed validation and only then stalled on the network. **The project's own four contract schemas were rejected** ("no schema with key or ref ... 2020-12") because they declared the 2020-12 dialect URI. After removing the `$schema` keyword, all four were accepted (so was the same schema with the draft-07 URI). The contracts were corrected, and the validator now rejects a `$schema` keyword in them (SCHEMA-CLI-COMPAT). This shows the CLI's schema validator accepts the contract; it does **not** show that a model will produce valid output. That needs a live run.

## 3. The owner's seven steps

| # | Step | Documented support | Status |
|---|---|---|---|
| 1 | GitHub receives a completed developer run | A worker session pushes to a `claude/` branch [D]. Pushes by a user identity trigger workflows through ordinary GitHub behaviour. Anthropic documents **no completion signal**: the run history shows only "Succeeded", "Failed" or "Cancelled", which describes how the session ended, not whether the work was done [D]. Our completion signal is a report commit on the branch, which depends on the worker following its instructions. | **Supported by design.** The signal is ours, not Anthropic's; a watchdog covers a silent worker. |
| 2a | GitHub Actions starts a separate reviewer session, as a session inside the CI job | The official action supports a subscription token (`claude_code_oauth_token`) and says "runs use your Claude subscription instead of API billing" [D]. It runs in automation mode on any event given a `prompt`, and its notes cover the `workflow_run` event [D]. | **Supported by documentation.** It is a CI-hosted session, not a cloud session. |
| 2b | GitHub Actions starts a reviewer as a cloud session | Only the fire endpoint: a POST with a per-task bearer token, an optional text field of at most 65,536 characters, a response with a session id and URL. Documented as **experimental** [D]. | **Experimental.** See 4.1. |
| 2c | A reviewer cloud session starts from a pull-request event, with no Actions | A GitHub trigger exists for pull-request, release and issue events, with filters on author, head branch, labels and draft state [D]. No push trigger and no check-completed trigger exist [D]. Whether a pull request opened by a bot or by the workflow token fires it is not stated [U]. | **Starts: documented. Safe as a reviewer: not established** (see 4.4). |
| 3 | The reviewer reads the approved task, the diff, the tests and the report | In 2a our trusted steps prepare these as files [design]. Cloud sessions have built-in GitHub tools to read issues, list pull requests, fetch diffs and post comments [D]. Reading CI check results in a routine is not stated [U]. | **2a: supported by design. Cloud: partly unestablished.** |
| 4 | The reviewer creates a structured review artifact | The action turns `--json-schema` in its arguments into a `structured_output` step output and says the result is "validated against your schema" [D]. If a run ends without valid output, the field is absent [D]. The schema flag is documented for print mode [D]. No platform-enforced schema exists for a cloud session; it would have to write a file and push [D, design]. | **2a: supported.** **Cloud: not platform-enforced** (our validator would be the only check). |
| 5 | GitHub Actions validates the artifact | `ops/validate-memory.mjs --file <review.json>` exists and is tested offline (144 tests plus new ones). | **Implemented offline; not yet wired into any workflow.** |
| 6 | The deterministic policy engine decides whether another task may begin | Risk classification, path permissions and role-separation checks are implemented and tested. The full decision logic (merge and next-task eligibility, limits, the kill switch) is not built. | **Partly implemented.** The rest is future work (STG-3 onwards). |
| 7 | A new Claude developer session receives the next approved task | A human can start a cloud session [D]. Automatic start: only the experimental fire endpoint (no idempotency, no status, 30 starts per hour per task, 100 per hour per account) [D]. A worker could also run as a restricted session in the action, as in 2a [D]. | **Automatic cloud start: experimental only.** Human start: supported. CI-hosted worker: supported by documentation. |

## 4. The points the owner asked to examine

### 4.1 Reviewer session invocation

- **Action [D]:** a workflow step that uses the official action, with `claude_code_oauth_token`, a `prompt`, and `claude_args` for the CLI options (schema, tools, permission mode, turn limit). The token is created with `claude setup-token`; it is valid for one year, can only make model requests, and requires a subscription plan [D].
- **Fire endpoint [D]:** one POST per start. The token is per task, shown once, and only fires that task. The text is delivered wrapped as **untrusted** data and the saved prompt must explicitly use it. There is **no idempotency key**: a retry creates a second session. Limits: 30 per hour per task and 100 per hour per account. The documentation calls it experimental and says shapes and limits may change.
- **No other documented way** to start a cloud session from outside, and the documentation lists GitHub Actions only as a related resource [D].

### 4.2 Reliable completion detection

- **Cloud sessions [D]:** no status API, no events, no webhook, no list of sessions. The run history in the web UI is the only view. Completion must be detected from an artifact the session leaves in GitHub.
- **Action [D]:** the job conclusion, the `conclusion` output, and the presence of `structured_output`. The CLI exits non-zero on failure, and the result carries an error flag and a subtype [D]. A "success" subtype alone is not an answer: a missing structured output must be treated as failure [D].
- **Design:** for a review, completion is a schema-valid `review.json` for the attempt. A missing or invalid one after the timeout is a failed review.

### 4.3 Separate developer and reviewer identities or roles

- **Roles (design, enforced mechanically):** the review records the reviewer's session identifier and runtime; the validator rejects a review whose session identifier equals the worker's (DECISION-SEPARATION), warns when it cannot tell, and rejects a review of a different head commit than the worker reported (DECISION-HEAD). This is a consistency check, not a security boundary.
- **Identities, action [D]:** by default the action authenticates as the Claude GitHub App with a short-lived repository-scoped token. If the workflow token is passed instead, "the auto-generated workflow token is scoped to the job's declared permissions" and comments appear under a different username. So a reviewer can have a genuinely different GitHub identity (the workflow's own bot) with only the permissions the job declares.
- **Identities, cloud [D]:** a scheduled task belongs to the owner's account, and commits, pull requests and comments "carry your GitHub user". Two tasks with different identities: **not stated [U]**. A cloud reviewer therefore cannot be told apart from the worker by GitHub identity.

### 4.4 Reviewer permissions

- **Action [D]:** tool access is set through the CLI options in `claude_args`. Documented controls: a list of allowed tools, a list of denied tools (a bare name removes the tool from the model's context), `--tools` to restrict the built-in set (an empty value disables all), and permission modes. By default the action runs in **auto mode**, which the documentation calls "a review, not a boundary"; for a strict list it says to use a stricter mode such as `default`. With no tool granted, a plain-text prompt has no shell or GitHub API access [D]. The CLI also has `--restricted`, which removes the code-running tools and web fetch and ignores settings files [T]; passing it through the action is **not documented [U]**.
- **A reviewer job can run with `contents: read`** and still comment: this is the documented code-review example [D]. Fully disabling the shell by name is not stated as a documented option for the action [U], so the design uses the restricted tool list and tests it.
- **Cloud [D]:** a scheduled-task session starts in auto mode and the owner does not choose the mode. A per-task tool restriction or read-only option is **not stated [U]**. The only documented control is removing connectors and limiting the environment's network. A push is allowed to any branch of the repository by the proxy ("It doesn't limit which branches a push can update"), so branch protection on GitHub is the only control. The repository's shared project settings (including deny rules) and its CLAUDE.md are read from the clone, but they apply to every session in that repository, the worker's too.
- **A hazard that shapes the design [D]:** a non-interactive session that is not in bare mode "runs the hooks in a project's `.claude/settings.json` and connects the servers in its `.mcp.json`, even in a folder you've never trusted". Bare mode cannot use a subscription token. A pull-request-triggered cloud session starts from the **pull request's head commit** [D], so it would load the worker's own settings and instructions. The action says it restores `.claude/`, `.mcp.json`, `CLAUDE.md` and similar files from the base branch for pull requests [D], but that is not stated for other events. Hence REC-OPS-016: the reviewer works in a trusted checkout of the base branch and receives the worker's branch only as data.

### 4.5 Claude subscription usage limits

- Cloud scheduled tasks "draw down subscription usage the same way interactive sessions do". Hourly limits: 100 scheduled runs per account; 30 per task for run-now, fire and re-arm; 100 fires per account. These have no overage. The number of GitHub-event runs allowed is not stated, and events over the cap are dropped [D].
- Daily limits per plan are stated by a launch announcement but not by the current documentation, so they are **unconfirmed [U]**; the owner must read the real figure (OQ-0022).
- Subscription windows: a rolling five-hour window and a weekly window, shared across Claude and Claude Code [D for team plans, S for individual plans]. At a limit, work stops unless metered "extra usage" is on [S].
- Action runs: "runs use your Claude subscription instead of API billing" [D]; any separate quota for action runs is **not stated [U]**. Whether automated use of a subscription token is otherwise permitted is **not stated [U]** (OQ-0032).
- The loop must therefore be throttled by policy and stop at a limit (REC-OPS-014).

### 4.6 Structured review artifacts

- The action exposes the CLI's validated JSON as a single `structured_output` string, to be parsed in a later step and passed to scripts through environment variables, not inline expressions [D].
- The SDK documentation says the agent's output is validated and re-prompted on mismatch, up to a retry limit, after which the result is an error [D]. The CLI page says only "validated JSON output" [D]; its retry behaviour is **not stated [U]**.
- **[T]** The contract schema is accepted by the CLI's schema validator once `$schema` is removed (section 2).
- The reviewer's output is then checked again by our validator; the platform's validation is a convenience, not the control.

### 4.7 Retry handling

- **Review (read-only):** safe to repeat. Policy allows up to two reviewer sessions per attempt; after that a human decides.
- **Worker launch:** never retried automatically. The fire endpoint has no idempotency key, so a retry after a lost response would run the work twice. A launch with an unknown outcome is held for a human (REC-OPS-007).
- Cloud runs: automatic retry is **not stated [U]**; the documentation says to run again manually [D]. Action retry: **not stated [U]**.

### 4.8 Avoiding API billing

- Order of authentication [D]: an API key in the environment is used **in preference to** a subscription token in non-interactive mode, and the documentation says this "can cause" unwanted use. The official action passes `ANTHROPIC_API_KEY` through from its input or from the environment. So a single stray key silently moves the runs to API billing.
- Controls: no API key may be defined anywhere in the automation's environment; a guard step fails a job if one is; workflows must never reference an API-key input; metered extra usage on the account stays off; `PROHIB-016` and the policy constants forbid paid AI services (REC-OPS-015, ADR-0009).
- `--max-budget-usd` is documented as a limit on "API calls", so it is **not** relied on to limit subscription usage [U].
- Cloud sessions "always use your subscription credentials" [D].

### 4.9 Avoiding undocumented interfaces

The design uses only: the official action and its documented inputs and outputs; documented CLI flags; the fire endpoint (documented but experimental, used only if the owner chooses it); git pushes to `claude/` branches; GitHub's own events and API. It does **not** use: any session-status or listing API (none is documented); a callback from a cloud session (none); the session-management tools visible in this development environment's tool list (they are not in the public documentation read, so they are not a basis for the system); sending a follow-up message to a running session (documented only as an interactive command, not for CI).

## 5. Recommended design, if the owner accepts it

Recommended for OQ-0031 and not yet approved. All of it is future work.

1. **Worker.** A human starts it, through STG-5. The choice of automatic start waits for OQ-0033.
2. **Evidence.** CI (OPS-0002) runs unprivileged on the worker's branch.
3. **Reviewer, as `actions_hosted_session`:**
   - Trigger from the CI workflow's completion, running the default branch's workflow definition, and only for a same-repository `claude/` branch whose task the trusted state says is running.
   - **Job A, no Claude:** prepare the trusted and untrusted input folders from the base branch, the repository host's API and the worker's report (data only; no branch code is checked out or run).
   - **Job B, Claude:** checkout of the base branch (so its settings and instructions are trusted); the official action with the subscription token; `permissions: contents: read`; the workflow token passed explicitly so the identity is the workflow's own; a read-only tool list; a turn limit; the contract schema; a guard that no API key exists.
   - **Job C, no Claude:** write `structured_output` to `review.json`, run the validator, and hand the result to the policy engine.
4. **Policy engine.** Decides eligibility with no model. Class B and C always wait for a human.

## 6. What is still unverified, and what would settle it

Each needs the owner's authorisation, because each creates a credential, a secret, a workflow or a push.

| Test | Settles | Needs |
|---|---|---|
| T1. A scratch review run on a throwaway branch | That the schema flag works through the action and yields valid `structured_output` | OPS-0002 merged; OQ-0032; a push |
| T2. A reviewer given a hostile worker report and diff | That a read-only reviewer cannot run shell commands or read the token, and that injected text does not change its verdict | T1 |
| T3. Check that `--restricted` (or an equivalent tool list) works through the action's arguments | Whether the restriction is enforceable | T1 |
| T4. Measure the subscription usage of one review | Whether the loop fits the plan's limits (OQ-0022) | T1 |
| T5. A pull request opened by the workflow token, against a pull-request-triggered cloud task | Whether such events trigger it | A scheduled task and a push; only if 2c is considered |
| T6. Two fire requests for the same attempt | How the experimental interface behaves on duplicates | A scheduled task and its token; only if 2b is considered |
| T7. Owner confirmation of terms of use for automated subscription-token use | The residual terms question | The owner |

## 7. Sources (official, read 2026-11-16 and 2026-11-17)

- [Scheduled tasks (routines)](https://code.claude.com/docs/en/routines)
- [Trigger a routine through the API](https://platform.claude.com/docs/en/api/claude-code/routines-fire)
- [Claude Code on the web](https://code.claude.com/docs/en/claude-code-on-the-web) and [cloud environments](https://code.claude.com/docs/en/cloud-environments)
- [Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions), and the [action repository](https://github.com/anthropics/claude-code-action) (README, `action.yml`, usage, security and FAQ notes)
- [CLI reference](https://code.claude.com/docs/en/cli-reference), [headless mode](https://code.claude.com/docs/en/headless), [SDK structured outputs](https://code.claude.com/docs/en/agent-sdk/structured-outputs)
- [Permissions](https://code.claude.com/docs/en/permissions), [permission modes](https://code.claude.com/docs/en/permission-modes), [settings](https://code.claude.com/docs/en/settings), [authentication](https://code.claude.com/docs/en/authentication), [security](https://code.claude.com/docs/en/security), [costs](https://code.claude.com/docs/en/costs)
- Support articles on extra usage and on using Claude Code with a paid plan (paraphrased only)
