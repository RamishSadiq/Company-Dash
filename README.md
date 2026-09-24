# Nexora Command Center

A local maintenance workspace for the Nexora modular monolith. CRM, Portal, Website/CMS and platform work share one repository, task history and evidence trail.

## Start

Requires **Node.js 24 or newer**, Git and the target Nexora checkout. No npm dependencies or frontend build are required.

```powershell
node server/main.mjs
```

Open **http://127.0.0.1:8000**. The frontend is served by the backend; do not open the HTML file directly. VS Code also includes a **Nexora Command Center** F5 launch configuration.

Copy `config.example.json` to `config.local.json` if paths differ. The default checkout is `D:/Projects new/Nexora`. Configuration is intentionally local and excluded from Git. Supported environment overrides: `NEXORA_REPO_PATH`, `COMMAND_CENTER_DATA`, `PORT`, `CODEX_EXECUTABLE`.

For agent execution, install/sign into the Codex CLI (`codex login`). A `codexPath` pointing to an absolute executable can be configured. Agent execution uses the signed-in account and sends source context through that provider; this is not an offline/local-model implementation. It does not read or expose your authentication files. See the [official non-interactive execution documentation](https://learn.chatgpt.com/docs/non-interactive-mode).

## Daily workflow

1. Refresh the source index when Nexora changes.
2. Create a request for PM, BA, CRM Developer, Portal Developer, QA or Support. Select the Nexora product area and priority.
3. PM/BA requests can create a standard linked workflow. This is an explicit template, not a claim that an AI already planned the work.
4. Start the first agent. Runs queue serially and persist logs, baseline metadata and final reports.
5. Read the report and any proposed patch. Add a follow-up to request revision, or accept the handoff to unlock the next specialist.
6. Start the next role. Its isolated source copy includes the preceding accepted workspace and report.
7. Use QA & verification to run existing Nexora suites against the **current original checkout**. Agent-generated test proposals and checkout test evidence are explicitly separate. Review and integrate proposed changes manually before certifying them with checkout QA.

## Included capabilities

- Repository inventory and source/document viewer; path confinement and basic sensitive-file exclusions.
- Six specialized Codex roles, persistent per-task conversations and linked handoffs.
- SQLite task/run/message/artifact/activity history; interrupted runs identified after restart.
- Filtered isolated source copies including dirty/untracked source, rather than discarding current work or editing the target checkout.
- Read-only PM/BA/Support runs; sandboxed workspace-write developer/QA runs.
- Reviewable reports and downloadable Git patches; no automatic merge/push/deploy.
- Fixed QA command catalog mapped to Nexora's xUnit and Playwright runner, actual process logs/exit codes, cancellation and time limits.
- Responsive dashboard, work board, QA history, source search and configuration diagnostics.

## Boundaries and known limits

This release is **local and single-user**. The server binds only to loopback, checks Host/Origin and uses a per-process request token. It is not a multi-user authentication system and must not be exposed through a public proxy.

Source snapshots omit runtime configuration (`appsettings*.json`, `.env*`, VS Code launch configuration), likely credential filenames, binaries, dependency directories and build outputs. Exclusions are defense in depth, not a full secret scanner. Review your source before sharing it with a model. Snapshots include per-file content hashing and exclusions, but are not atomic against concurrent external edits. Builds inside filtered agent copies may need configuration/dependencies; the agents must report missing prerequisites rather than silently use the live checkout. Current QA buttons target the original checkout, not filtered proposals.

Workflow sequencing is deterministic. PM output is a reviewable artifact, not an unrestricted instruction to automatically create more agents or run arbitrary commands. There is one execution slot, a queue limit of 20 and a configurable per-agent time limit (20 minutes by default). Token/dollar budget enforcement and arbitrary remote repository cloning are not implemented.

Graceful shutdown stops the owned active process tree. A hard machine/process failure can leave child processes behind; after restart inspect interrupted run logs and local processes before retrying. The app does not kill unrelated applications. Cancelling a Nexora browser runner may interrupt its database cleanup; any remaining uniquely named disposable test database must be cleaned up deliberately.

Nexora production identity, email, payment, live scanner configuration and the disabled CRM assistant bridge are outside this app's scope. Agent completion, accepted handoff, passing checks and production deployment are separate concepts. Existing Nexora reports are viewable as documents; historical percentages are not presented as current verification.

## QA commands

Architecture: `dotnet test backend/tests/Nexora.Architecture.Tests/Nexora.Architecture.Tests.csproj`.

API: `dotnet test backend/tests/Nexora.Api.Tests/Nexora.Api.Tests.csproj`.

Browser: `node scripts/Test-Website.mjs` with `--crm`, `--portal`, or `--all`, plus `--production`. These use ports 5095/3015 and the runner's own disposable database. The configured SQL instance defaults to `.\SQLEXPRESS`. Existing Nexora dependencies and test runtime must be installed. Tests are serialized within this app; other tools can still contend for those ports.

## Test this command center

```powershell
node --test tests/*.test.mjs
```

Tests cover API request boundaries, path traversal and linked paths, source snapshots, persisted workflow dependencies, restart recovery, cancellation, process exit results and basic log redaction. Browser smoke verification is separate; see `docs/VERIFICATION.md` for the actual verified scope.

## Data

All generated state lives under ignored `data/`: SQLite history, isolated workspaces and agent reports. Back up this directory with the app stopped. Never commit runtime data or credentials. There is no automatic deletion or retention policy yet.
