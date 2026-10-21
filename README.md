# approval-queue

Design & PR Approvals: a local SvelteKit app and a command that put a packet (one session hand-over of asks and routine parts) or a single item (a PR, a design, or a triage list) in front of Geoff and print his decision as JSON. The app serves on `127.0.0.1:7907`; set `APPROVAL_QUEUE_PORT` to use another port, which the command passes to the build, so a build serves only the port it was made with.

## Layout

- `approval-queue/` is the SvelteKit app (Svelte 5, DaisyUI, adapter-node).
- `bin/.local/bin/approval-queue` is the command: `approval-queue <pr|design|triage> <repo> <title> <source>`, `approval-queue packet [--check] <initiative> <file>`, or `approval-queue blueprint <worktree> <title> <file> [--notes <notes.json>]`. It checks the item's brief, the packet file, or the blueprint, queues it under `~/.local/state/approval-queue/items/`, starts the app if it isn't up, opens a tab, and waits for `decision.json`.
- `bin/.local/bin/claude-approval-queue-reminder` is the PostToolUse hook script that reminds a session to include a new PR in its hand-over packet.
- `docs/decision-review/` holds the monthly decision review's prompt and its log.
- `tests/` holds the shell tests, and `tests/fixtures/e2e-brief.md` is the brief the end-to-end check hands over.

The command and the app find each other by path, so the command must be a link to this checkout, not a copy.

## Install

```sh
npm ci --prefix approval-queue
bash scripts/install.sh
```

`scripts/install.sh` links both commands into `~/.local/bin`. The command builds the app on first use when `approval-queue/build/index.js` is missing, so rebuild after an upgrade with `npm run build --prefix approval-queue` and restart the server (`pkill -f 'approval-queue/[b]uild'`).

The hook's `settings.json` entry lives in the workstation repo and calls `claude-approval-queue-reminder` by name.

## The packet kind

A packet is one session hand-over: a headline, a lede, background, the plan, what the session did not check, at most three asks for Geoff, and a routine row for every other part with the session's verdict preselected. The file's grammar lives in `approval-queue/src/lib/packet.ts`, and the prose standard in the register at `~/.claude/docs/voice/approval-brief.md`.

```sh
approval-queue packet <initiative> <file>
```

`<initiative>` is `none` or the id of a record under `$APPROVAL_QUEUE_PROJECTS/initiatives` (default `~/Projects/initiatives`). The command parses the file, fetches each PR part at its current head, checks the file against that data, queues the packet, and waits for the decision. A refusal exits 2 and appends a line to `refusals.jsonl` in the state directory.

`--check` runs the same parser and refusals and stops before it queues anything, so a session can fix the file before it sends:

```sh
approval-queue packet --check <initiative> <file>
```

The home page is the board of waiting packets, grouped by initiative, with the sort ("Asks first" or "Oldest first") kept in a cookie. A `pr`, `design`, or `triage` item waits under "Single items". The server rebuilds every part and ask from the stored packet, so a post cannot approve a part the packet does not hold.

### The decision JSON and the decision log

An approve prints one line of JSON that lists every part once, with each PR's `head` or each design's `sha256` joined from the stored copy, and each ask's chosen label. A reject prints `{"decision": "reject", "note": "<text>"}` and merges nothing. A session merges each approved PR with `gh pr merge <n> --repo <repo> --merge --match-head-commit <head>`, stops at the first failure, and reports back.

Every decision also appends one line per part, plus one per ask with no part, to `decisions.jsonl` in the state directory (`~/.local/state/approval-queue/` by default). The `pr` and `design` kinds log one line each with `"lane": "single"`. The log never authorizes or blocks a merge. The monthly decision review reads it, per `docs/decision-review/prompt.txt`.

## The blueprint kind

A blueprint is a page plan Geoff reads and edits in place. The screen opens the file in an editor with each note from the author or the fact check under the line it is about, and every pause in typing (or Ctrl+S) writes the file and commits it with `Edit <file> in review`.

```sh
approval-queue blueprint <worktree> <title> <file> [--notes <notes.json>]
```

`<worktree>` is the top of a git worktree, and `<file>` is relative to it. The command refuses a file that is not committed, a file with uncommitted changes, and a notes file that is not a JSON array of notes in the shape `{id, kind, anchor, title, body}`: `kind` is `info`, `decide`, or `question`, `body` is an array of paragraphs, and a note may add `was` and `now`, `sides` (`[{who, text}]`), and `choices` (`[{label, text?, done, edit?}]`). A `decide` or `question` note must carry choices. Each refusal names the problem and exits 2 before anything is queued.

A note's `anchor` names a place in the file: `<slug>.heading` for a heading, `<slug>.p<n>` for the nth bullet, numbered step, or `:::row` block under that heading, and `<slug>.p<n>.symptom`, `.cause`, or `.fix` for one part of a row. The slug is the heading with backticks dropped, lowercased, each run of characters outside a-z and 0-9 turned into one hyphen, and hyphens trimmed from the ends. A note whose anchor names no place shows at the top of the file.

Approve stays locked until every `decide` and `question` note has a choice. An approve prints:

```json
{"decision":"approve","file":"<file>","commit":"<HEAD at approval>","blob":"<git rev-parse commit:file>","calls":[{"id":"B3","choice":"<label>"}]}
```

A send-back prints `{"decision":"reject","note":"<text>"}`; the screen's button reads "Send back with note". Either way the decision log gains one line with `"kind": "blueprint"`, `"ref": "<repo>:<file>"`, the blob and commit, and `waived`: each `decide` note answered with a choice that leaves the line as it was, with that choice's `done` text as the reason.

### approved

```sh
approval-queue approved <file> <blob>
```

Exits 0 when the decision log under `$XDG_STATE_HOME/approval-queue/` holds an approve of `<file>` (matched on the part of the ref after the repo) at `<blob>`, and 1 otherwise. A tool that builds from a blueprint runs it against `git rev-parse HEAD:<file>`, so it builds only from the version Geoff approved.

## Gate

```sh
bash scripts/gate.sh
```

The gate runs the app's `check` and `test`, then every `tests/*.test.sh`, including the install test (which uses a temp `HOME`). The brief-register test reads `REGISTER`, defaulting to `~/.claude/docs/voice/approval-brief.md`, and fails when the file is absent.

## History

The code arrived from `glw907/workstation` with its history, including the `review-desk` era names.
