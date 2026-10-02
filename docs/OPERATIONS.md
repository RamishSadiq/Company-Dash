# Proposal review, usage and maintenance

## Verify a proposal before integrating

1. Open a task in review and read its report and proposed patch.
2. Under **Proposal verification**, choose the relevant check and **Test this proposal**. This captures a separate source copy. The original checkout and the agent workspace are not used as the test working directory.
3. Wait for the check and inspect its log under the task or **QA & verification**. Proposal and checkout checks are labelled separately.
4. Choose **Review integration**. It requires passing QA for the exact proposal fingerprint, accepted earlier handoffs, the latest successful report/patch, and an unchanged original checkout. It prepares a separate review copy and displays the cumulative patch. A passed architecture check does not imply that browser or API checks passed: select all checks appropriate to the change.
5. **Apply reviewed changes** explicitly applies that patch to the local checkout. It does not commit, push or deploy. Reviews expire after 15 minutes and are revalidated before applying. If original source changed, start a refreshed workflow rather than overwriting those changes.
6. Run checkout QA after integration. This is distinct evidence from proposal QA.

Developer and QA handoffs preserve the first snapshot baseline. A downstream patch includes preceding developer changes, not only the last agent's edits. The runner supplies every accepted ancestor report so QA can compare the implementation with the BA's acceptance inventory. Agent completion, accepted handoff, passing check and integrated checkout remain separate states.

Proposal frontend checks prepare independent dependencies. If `npmCli` points to an installed `npm-cli.js`, the runner uses `npm ci --ignore-scripts --no-audit --no-fund`. Otherwise, it copies the existing installation only when the proposal's package manifest and lockfile match the original checkout exactly. Dependency links outside that installation are rejected. No junction into the original dependencies is granted to an agent. Changed dependencies require a configured npm CLI; missing prerequisites produce a failed check, never a fabricated pass. Node dependency lifecycle scripts are disabled during installation; .NET build/test and the selected repository test runner execute trusted project code as the local operator.

The API suite receives the configured SQL Server instance through `NEXORA_TEST_SQLSERVER`; its migration/concurrency checks create disposable databases. Filtered copies also receive a task-named bootstrap connection string and local identity registration, with the development seed password empty. Test factories replace application database services; this bootstrap does not seed the shared development database. Browser checks use the existing disposable runner on 5095/3015. The database instance is shared; the application still serializes runs and cannot prevent unrelated external tools from occupying those ports.

## Usage thresholds

Optional settings in `config.local.json`:

```json
{
  "maxRunTokens": 0,
  "dailyTokenLimit": 0,
  "dailyUsdLimit": 0,
  "tokenRates": null,
  "retentionDays": 0
}
```

Zero disables a threshold. The dashboard records provider-reported input, cached-input and output token counts. Cached input is included in input, not counted twice. Missing usage is shown as unknown.

Token reporting arrives at turn completion, so these are **turn-boundary limits**, not a hard cap on an in-flight model request. Crossing a threshold stops further execution and blocks subsequent runs where applicable. Daily accounting uses UTC. An enabled budget fails closed when a previous run's usage is unknown. Historical runs without usage are not silently assumed free.

Dollar thresholds require explicit `tokenRates` with `input`, `cached` and `output` prices in USD per million tokens. These are operator estimates; they are not subscription charges or verified account billing. No pricing or model choice is invented. Update rates if the configured provider/model changes. See the [official Codex JSON event documentation](https://learn.chatgpt.com/docs/non-interactive-mode).

## Back up, restore and retain

**Workspace settings → Create backup** captures a consistent SQLite copy, agent workspaces and final output files under `data/backups`. A SHA-256 manifest records every included file. Backups require an idle queue. Dependency/test copies, integration previews, server locks and earlier backups are excluded; they can be recreated. Protect backups like source code and conversations. There is no automatic backup deletion.

Restore into a **new, nonexistent data directory**, then start with `COMMAND_CENTER_DATA` pointing to that directory:

```powershell
node server/restore.mjs '<backup-directory>' '<new-data-directory>'
$env:COMMAND_CENTER_DATA = '<new-data-directory>'
node server/main.mjs
```

The restore validates file checksums and database integrity, rebinds task workspace paths and invalidates pending integration previews. It never overwrites a running data directory. Old run paths in historical logs are evidence of the original execution, not current work locations.

Set `retentionDays` to a positive integer to enable the daily retention pass. **Review cleanup** lists eligible copies and offers **Back up and remove expired copies**. Only expired completed/cancelled task copies whose descendants are also closed, and expired finished proposal-test copies, are eligible. Active/review work and unresolved handoffs are protected. Cleanup first creates a backup and keeps task, message, run, report and audit history. Paths outside managed directories and external linked paths are rejected. The Nexora checkout is never a cleanup target.
