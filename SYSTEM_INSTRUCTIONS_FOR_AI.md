# Nexora Command Center — execution handoff

This is a separate local maintenance application, not a Nexora product module. Keep its code in this repository. The default target is `D:/Projects new/Nexora`; inspect its AGENTS.md before performing Nexora work.

1. Read README.md and local configuration. Use Node.js 24+.
2. Run `npm test` (uses Node's test runner with `--test-force-exit`).
3. Start `node server/main.mjs`; open http://127.0.0.1:8000.
4. Verify source index and Codex connection. Never read authentication files or print credentials.
5. Use actual command results as evidence. Do not seed fake successful tasks, generated reports or QA results.
6. Preserve all unrelated Nexora changes. Agent implementation happens only in isolated workspaces. Patches require review and separate integration.
7. Never initialize, commit or push the target Nexora repository merely to start this application.
8. Do not expose this local app to a network or imply it has production authentication.

Read `docs/VERIFICATION.md` for tested and unverified surfaces before describing the application as complete.
