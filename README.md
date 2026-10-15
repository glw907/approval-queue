# approval-queue

Design & PR Approvals: a local SvelteKit app and a command that put one item (a PR, a design, or a triage list) in front of Geoff and print his decision as JSON. The app serves on `127.0.0.1:7907`.

## Layout

- `approval-queue/` is the SvelteKit app (Svelte 5, DaisyUI, adapter-node).
- `bin/.local/bin/approval-queue` is the command: `approval-queue <pr|design|triage> <repo> <title> <source>`. It checks the item's brief, queues it under `~/.local/state/approval-queue/items/`, starts the app if it isn't up, opens a tab, and waits for `decision.json`.
- `bin/.local/bin/claude-approval-queue-reminder` is the PostToolUse hook script that reminds a session to hand over a new PR.
- `tests/` holds the shell tests, and `tests/fixtures/e2e-brief.md` is the brief the end-to-end check hands over.

The command and the app find each other by path, so the command must be a link to this checkout, not a copy.

## Install

```sh
npm ci --prefix approval-queue
bash scripts/install.sh
```

`scripts/install.sh` links both commands into `~/.local/bin`. The command builds the app on first use when `approval-queue/build/index.js` is missing, so rebuild after an upgrade with `npm run build --prefix approval-queue` and restart the server (`pkill -f 'approval-queue/[b]uild'`).

The hook's `settings.json` entry lives in the workstation repo and calls `claude-approval-queue-reminder` by name.

## Gate

```sh
bash scripts/gate.sh
```

The gate runs the app's `check` and `test`, then every `tests/*.test.sh`, including the install test (which uses a temp `HOME`). The brief-register test reads `REGISTER`, defaulting to `~/.claude/docs/voice/approval-brief.md`, and fails when the file is absent.

## History

The code arrived from `glw907/workstation` with its history, including the `review-desk` era names.
