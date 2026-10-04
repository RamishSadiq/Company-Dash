# Verification — 24 September 2026

## Implemented local release

This is a working local maintenance command center in the separate Company Dash repository. The connected target is `D:/Projects new/Nexora`, branch `main`, commit `102cfc05a33fb08066e2328d5c16e19832e9af3e`. Source inventory at verification contained 389 permitted files and 85 modified/untracked paths. Those numbers describe the checkout inspected at that time, not a future release baseline.

## Verified

- `node --test tests/*.test.mjs`: **7 passed, 0 failed.** Covers API origin/token validation, input validation, path traversal and linked-path rejection, current dirty source capture, exclusion of configuration/secret filenames, durable conversations and task dependencies, accepted handoff transitions, interruption recovery, queued cancellation, process exit-code capture, process-tree stop, and basic log redaction.
- A controlled test executor verifies structured complete/blocked reports, isolated implementation artifacts and cumulative diffs across revisions. This is a test fixture, not evidence that a live developer agent implemented a Nexora feature.
- `node tests/browser-smoke.mjs`: Edge headless, 1440-pixel desktop and 390-pixel mobile viewport. Created a four-role PM → BA → Portal Developer → QA workflow, added a follow-up, verified persistence after reload, searched actual Nexora docs and opened LOCAL-TESTING.md, verified six agent cards and six QA actions. No browser errors or document-level mobile overflow. Screenshots in ignored `artifacts/browser/` were visually inspected.
- **Real Nexora architecture execution through the dashboard:** run `run_b707637f-37c2-4765-b1ad-3713f6ad4936`, 2 passed, 0 failed, 0 skipped; process exit 0. The database retains command, commit, dirty-checkout metadata, raw log and QA artifact. This exercised the real test runner, not a simulated pass.
- **Real read-only Codex execution through the dashboard:** task `task_ac115222-93ef-47c9-a4f3-720b02a002d1`, successful run `run_9edee351-054b-4c23-a23b-fb7c0a44c2da`. The Support agent read AGENTS.md/package.json and listed backend modules/frontend location in an isolated source copy, with successful shell exit codes and a structured final report. It did not run application tests or change Nexora source.

## Issues caught and fixed during verification

- SQLite task insertion had an incorrect placeholder count; covered by workflow tests.
- Test cleanup needed to close SQLite before removing temporary directories on Windows.
- Form buttons needed separate submit handling; the general click handler had prevented native submission.
- Product-area selection needed an explicit accessible label.
- Source search results were inadvertently replaced by the subsequent dashboard refresh.
- Agent revisions now reuse their draft workspace so prior changes and the cumulative patch are retained.
- Codex on this Windows host needed an explicit `windows.sandbox="elevated"` setting when ignoring user configuration. The original blocked run is retained in history and its initial exit-zero classification was corrected to blocked with an audit event. Agents now return a validated `{status, report}` contract; a blocked deliverable remains blocked even when the process exits zero. No full-access fallback was added.

## Not verified / deliberately outside this release

The list below describes the initial release. The follow-up entry at the end records subsequent implementation and verification.

- Full API suite and CRM/Portal/CMS browser suites were not rerun. Their existing command integrations are present; their buttons do not claim fresh passing evidence.
- A live developer/QA agent modification, an entire multi-role AI workflow and any resulting patch integration have not been tested end-to-end. Only the live read-only role and deterministic workflow/diff tests are verified.
- Filtered agent workspaces exclude dependencies and runtime configuration, so a proposal may need dependency/configuration preparation before its own build/test verification. Checkout QA is labeled separately and cannot certify an unmerged proposal.
- No deployment, remote publishing, production identity, payments, external email, antivirus service setup, or change to Nexora’s disabled assistant CRM bridge.
- No network hosting/multi-user authentication, token/dollar budget enforcement, automatic merging or arbitrary remote cloning.

## Reproduce

Start with `node server/main.mjs` and open http://127.0.0.1:8000. The saved local config resolves this workstation's Codex and .NET executables. Check Workspace settings, open the runtime verification task, and view QA & verification → Architecture checks → Open log.

The browser smoke script uses an installed Playwright module (`PLAYWRIGHT_MODULE`) and Edge by default (`PLAYWRIGHT_CHANNEL` can override the channel). Test requests use a separate data directory and do not pollute the main work board.

## Follow-up — proposal operations, 24 September 2026

Implemented isolated proposal QA with source fingerprints, cumulative patches across handoffs, a reviewed local integration preview/apply flow, provider usage recording and optional turn-boundary thresholds, checksummed backup/restore, and opt-in retention of closed workspace copies. See [operations](OPERATIONS.md).

- Command Center tests: 13 passed; integration rejects missing/stale QA, changed original source and replayed reviews. Tests also cover inherited patches, isolated QA targets, backup tamper detection/restoration, dependent-work retention and split JSON usage reporting.
- Browser smoke: passed on desktop/mobile, including the new usage/maintenance view, backup creation and cleanup preview. Test state is separate from the live work board.
- Live dashboard API run `run_874872f6-e3a9-4550-9911-93b738ed6ffa`: **122 passed, 0 failed, 0 skipped**, SQL Express enabled; exit 0. This is actual checkout execution through Company Dash.
- A real four-role workflow is recorded under `task_e0e2c8aa-f9d6-48a5-ab4b-584db496808d`. Its bounded fix makes `Prepare-LocalTestData.mjs` create its output directory before writing the demo-data JSON. Only reviewed completed stages may be described as verified; live run records hold the current stage and report.

Limits remain explicit: local single-user operation, manual review before applying a patch, no push/deployment, no hard per-request model billing cap, no inferred subscription cost. Retention and budget limits default to disabled until configured. Backup retention is manual; task/report history is not automatically deleted.

## Follow-up — live BA through QA, 28 September 2026

Resumed the existing workflow `task_e0e2c8aa-f9d6-48a5-ab4b-584db496808d` after its earlier BA attempt stopped at the provider usage limit. The configured Codex executable no longer existed after an application update; updated the ignored local configuration to the currently installed executable and verified signed-in status.

- Command Center regression: `node --test --test-force-exit tests/*.test.mjs` — 13 passed, 0 failed.
- BA run `run_d69688cd-c32a-409a-a992-8ab023742ce7` completed source-backed requirements and acceptance criteria; its report was reviewed and accepted.
- Developer run `run_8965c45d-6d90-49dd-ae9f-75edcdbeae05` produced exactly one insertion in `scripts/Prepare-LocalTestData.mjs`: recursive creation of `artifacts` immediately before the existing JSON write. Patch reviewed and handoff accepted.
- QA run `run_c7523f94-c6cc-4e2c-b17d-9780944464fc` independently inspected the inherited cumulative patch. `node --check scripts/Prepare-LocalTestData.mjs` and `git diff HEAD --check` both passed with exit 0. QA made no additional changes; its report was reviewed and accepted.

All four workflow roles are now completed, including the previously accepted PM stage. This verifies real model execution, isolated implementation, report review, dependency unlocking and cumulative developer-to-QA patch transfer. It does not verify database-backed seeder execution, missing-directory runtime behavior, proposal integration or deployment. The proposed Nexora change remains in isolated workspaces and has not been applied to the original checkout. No fresh browser acceptance run was performed for this follow-up.

## Follow-up — Nexora Support Agent, 29 September 2026

Expanded the existing support role while retaining its persisted ID and task history. It now covers Nexora issue classification, impact, reproduction evidence, safe guidance, redacted diagnostics and draft responses for review. It remains read-only and does not send customer communications. Support defaults to standalone triage; optionally create Support → BA → area-specific developer → QA with existing acceptance gates.

- `node --test --test-force-exit tests/*.test.mjs`: 14 passed, 0 failed, including standalone support, CRM/Portal/CMS routing and blocked downstream execution before acceptance.
- `node tests/browser-smoke.mjs`: passed, including support selection, unchecked but enabled workflow by default, and its four-role workflow creation.
- A live model run using the expanded support instructions has not been performed. These checks verify configuration, API sequencing and browser controls, not resolution of a real support incident.
- Restart of the existing dashboard listener was rejected by execution policy. Source changes are verified in the test server; the existing listener still needs a restart to load them.

## Follow-up — resume verification, 29 September 2026

- Command Center regression: `node --test --test-force-exit tests/*.test.mjs` — 13 passed, 0 failed outside the restricted sandbox. The sandbox attempt stalled after five tests; it is not passing evidence.
- Executed the actual two-line output block from the accepted QA workspace against an isolated temporary directory. Both absent-directory creation and repeat execution with an existing directory passed, with JSON contents checked. This verifies filesystem behavior only; the API/database-backed seeder and browser acceptance were not run.
- Read-only comparison found the workflow baseline fingerprint `9f74ceca712a9ee1d5253cd76cfb59a6466df62a269175a8438da4eff34e2371` differs from the current Nexora fingerprint `60c7639c18d5b5fd18913e442b28b946b17c500f791021d21103d7c54bd41fdc`. The old proposal therefore cannot pass the integration freshness gate. The original script still lacks the directory creation line.
- Integration remains pending: refresh the proposal against current source, obtain exact-source proposal QA, and prepare a new reviewed integration. No original Nexora files were changed.

## Follow-up — outstanding work, 1 October 2026

The dashboard was restarted with the current Support Agent and operations code.
`node --test --test-force-exit tests/*.test.mjs` passed all 15 regression groups;
desktop/mobile browser smoke passed. A real Support Agent investigation was
reviewed and accepted. Backup filtering, installed Next guidance preparation,
ancestor handoff context, API-test bootstrap configuration and checkout result
isolation were corrected and covered by meaningful checks.

The refreshed seven-file Nexora proposal passed focused lint, control-preservation
review and both architecture tests. Its broad API run recorded 132 passed and 13
failed; the browser run stopped before Playwright on pending model changes.
Concurrent source changes require a further refreshed proposal. Full execution
evidence and remaining integration work are recorded in
[the completion record](COMPLETION-2026-10-01.md). This follow-up does not certify
the earlier failed proposal as integrated or production ready.

## Follow-up — current-source completion, 4 October 2026

The outstanding Nexora work was refreshed against the current dirty checkout,
implemented in an independent proposal and applied locally after exact-source
review. The final patch includes CRM association presentation, demo output-directory
creation, restricted CRM/Portal dual-access coverage and a local access runbook.
Existing Nexora work is preserved. Historical failed agent runs remain failed.

The dashboard now recovers a removed managed Codex executable after desktop
updates and allows the full API suite up to 60 minutes. All 16 dashboard regression
tests pass, desktop/mobile smoke passes, and the completed 10,665-file backup has
independently verified checksums and SQLite integrity. Proposal checks passed all
256 API tests, 2 architecture tests and 7 production CRM browser journeys.

Exact fingerprints, checkout verification and integration boundaries are recorded
in [the current completion record](COMPLETION-2026-10-04.md). Independent checkout
QA through the live dashboard also passed all 256 API tests, 2 architecture tests
and 7 production CRM journeys, with the same integrated source fingerprint.
The superseded blocked stages are closed with completion evidence. Nexora remains
locally modified; no Nexora commit, push or deployment is implied.
