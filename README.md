# approval-queue

Design & PR Approvals: a local SvelteKit app and a command that put a packet (one session hand-over of asks and routine parts) or a single item (a PR, a design, or a triage list) in front of Geoff and print his decision as JSON. The app serves on `127.0.0.1:7907`; set `APPROVAL_QUEUE_PORT` to use another port, which the command passes to the build, so a build serves only the port it was made with.

## Layout

- `approval-queue/` is the SvelteKit app (Svelte 5, DaisyUI, adapter-node).
- `bin/.local/bin/approval-queue` is the command: `approval-queue <pr|design|triage> <repo> <title> <source>`, `approval-queue packet [--check] <initiative> <file>`, `approval-queue blueprint <worktree> <title> <file> --description <file> [--notes <notes.json>] [--replies <replies.json>]`, `approval-queue page <worktree> <title> <file> --pr <owner/repo#n> --description <file> [--notes <notes.json>] [--replies <replies.json>]`, or `approval-queue change <owner/repo#n> <title> [--notes <notes.json>] [--replies <replies.json>]`. It checks the item's brief, the packet file, the blueprint, or the page, queues it under `~/.local/state/approval-queue/items/`, starts the app if it isn't up, prints `approval-queue: queued <id> at <url>` on stderr (stdout holds only the decision JSON), opens a tab, and waits for `decision.json`.
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

A packet is one session hand-over: a title, a description (a background paragraph, then one or two summary paragraphs), the plan, what the session did not check, at most three asks for Geoff, and a routine row for every other part with the session's verdict preselected. The file's grammar lives in `approval-queue/src/lib/packet.ts`, and the prose standard in the register at `~/.claude/docs/voice/approval-brief.md`.

```sh
approval-queue packet <initiative> <file>
```

`<initiative>` is `none` or the id of a record under `$APPROVAL_QUEUE_PROJECTS/initiatives` (default `~/Projects/initiatives`). The command parses the file, fetches each PR part at its current head, checks the file against that data, queues the packet, and waits for the decision. A refusal exits 2 and appends a line to `refusals.jsonl` in the state directory.

`--check` runs the same parser and refusals and stops before it queues anything, so a session can fix the file before it sends:

```sh
approval-queue packet --check <initiative> <file>
```

### Revisions

A packet that resends a part Geoff sent back is a revision. The command reads `decisions.jsonl` for each PR and design the packet names. A ref is sent back when its latest log line is a reject; a ref whose latest line is an approve, a hold, or a `send-back` verdict inside an approve is not, and a state directory with no log sends back nothing. When one or more refs are sent back, the packet must carry a `## What changed` section, placed after the description and before `## If you approve`: a bulleted list of at least one bullet, naming what the session changed in answer to Geoff. The command refuses (exit 2, before it fetches anything) a revising packet without the section, and a packet with the section that revises nothing; the message names the earlier item and the parts it sent back. `--check` applies the same rule.

A revising packet's `item.json` gains `revises`: `{item, revision, parts}`. `item` is the id of the latest sent-back item, `revision` is one more than the number of distinct send-back rounds since each part's latest approve (the first resend reads 2), and `parts` holds the head or `sha256` each sent-back part had.

For each PR part whose head moved since the send-back, the command asks GitHub for the compare between the old and new heads and saves what changed since. An old head still behind the new one writes the diff to `parts/<k>/since.patch`. A head that is no longer an ancestor (a force-push, or a commit GitHub cannot find) writes `parts/<k>/since.json` as `{"gone": true}`. A diff too large for GitHub to serve writes neither file, and the part shows its full file list as before; no case refuses a packet. A branch that merged its default branch since the send-back carries those merged changes in its since diff.

### The home page

The home page is the board of waiting packets, grouped by initiative, with the sort ("Asks first" or "Oldest first") kept in a cookie. A `pr`, `design`, or `triage` item waits under "Single items". The server rebuilds every part and ask from the stored packet, so a post cannot approve a part the packet does not hold.

### The decision JSON and the decision log

An approve prints one line of JSON that lists every part once, with each PR's `head` or each design's `sha256` joined from the stored copy, and each ask's chosen label. A reject prints `{"decision": "reject", "note": "<text>", "calls": [...]}` and merges nothing. `calls` holds Geoff's verdicts and ask picks as the screen held them when he sent it back: one `{ref, verdict}` per part, in the packet's order and steps included, then one `{ask, question, choice}` per ask (`ask` counts from 1). A `verdict` or `choice` is `null` when Geoff had not set it, or when the post named a value the packet does not hold. A send-back is never refused for its fields. A decision stored by an older build has no `calls` and prints `"calls": []`. A session merges each approved PR with `gh pr merge <n> --repo <repo> --merge --match-head-commit <head>`, stops at the first failure, and reports back.

Every decision also appends one line per part, plus one per ask with no part, to `decisions.jsonl` in the state directory (`~/.local/state/approval-queue/` by default). The `pr` and `design` kinds log one line each with `"lane": "single"`. The log never authorizes or blocks a merge. The monthly decision review reads it, per `docs/decision-review/prompt.txt`.

### Comments and replies

On the blueprint, page, and change kinds, Geoff can select text and comment on it. Each comment is saved to the item when he presses Save, and it goes to the author with either decision. The text of a box still open is not saved. Both the approve and the send-back JSON carry two fields:

- `comments`: every comment Geoff left, always present and possibly empty. A comment is `{id, text, anchor}`.
- `threads`: `[{id, reply}]`, one for each of the author's replies that Geoff answered. A reply he resolved without answering, or left alone, is not listed: it resolves at the decision.

An anchor is `{quote, prefix, suffix, from, to, commit, file?}`. `quote` is the selected text, `prefix` and `suffix` are up to 32 characters on each side of it, and `from` and `to` are its offsets, end exclusive, into the file with its line endings read as LF. `commit` is the commit the file was read at: HEAD when the comment was saved, for a blueprint or page, and the PR head the item was queued at, for a change. `file` names the document on a change and is absent otherwise. An anchor is never moved at decision time. The author re-places it in the current file by the same steps the screen uses:

1. The offsets, if the text between them is still `quote`.
2. The one place where `prefix + quote + suffix` occurs.
3. The occurrence of `quote` nearest the old `from`.
4. Nowhere: the text is gone.

The author answers every comment, after a send-back or before acting on an approve. A send-back's answers come back when the author queues the item again with `--replies <replies.json>`, a JSON array of threads:

```json
[{"id":"C1","status":"done","text":"<the author's reply>","quote":"<the comment's quote>","anchor":{"quote":"...","prefix":"...","suffix":"...","from":120,"to":168,"commit":"<sha>"}}]
```

`id`, `quote`, and `anchor` are the comment's own, copied from the decision. `status` is `done` (the author made the change), `kept` (the author left the text as it was, and says why in `text`), or `answered` (the comment was a question, and `text` answers it). Each thread on a change names its document in `anchor.file`, and that document must be one the change carries. The command refuses a file that is not an array of threads in this shape, or that uses an id twice, and accepts an empty array. The screen shows each reply on its comment's card, placed by the steps above, and a thread whose text is gone shows its original quote. Only Geoff resolves a thread. A new comment on the re-queued item takes an id past every thread's, so the ids never collide.

A blueprint approve's answers come back on the page review. When the author queues the drafted page, it passes `page ... --replies <replies.json>` with one thread per blueprint comment. `id` and `quote` are the blueprint comment's. `anchor` is made against the page file at the commit the page is queued from, on the passage where the comment was applied, by the same `quote`, `prefix`, `suffix`, offset, and `commit` rules as above. Each reply then shows level with that passage. A thread whose comment changed nothing on the page anchors at the passage closest to it.

The decision log line of each of these kinds gains `comments`, the number of comments, and `replies`, the number of `threads`.

## The blueprint kind

A blueprint is a page plan Geoff reads and edits in place. The screen opens the file in an editor with each note from the author or the fact check under the line it is about, and every pause in typing (or Ctrl+S) writes the file and commits it with `Edit <file> in review`.

```sh
approval-queue blueprint <worktree> <title> <file> --description <file> [--notes <notes.json>] [--replies <replies.json>]
```

`<worktree>` is the top of a git worktree, and `<file>` is relative to it. The command refuses a file that is not a regular file committed at HEAD (a directory or a symlink is refused), a file with uncommitted changes, and a notes file that is not a JSON array of notes in the shape `{id, kind, anchor, title, body}`: `kind` is `info`, `decide`, or `question`, `body` is an array of paragraphs, and a note may add `was` and `now`, `sides` (`[{who, text}]`), and `choices` (`[{label, text?, done, edit?}]`). A `decide` or `question` note must carry choices. Each refusal names the problem and exits 2 before anything is queued.

A note's `anchor` names a place in the file: `<slug>.heading` for a heading, `<slug>.p<n>` for the nth bullet, numbered step, or `:::row` block under that heading, and `<slug>.p<n>.symptom`, `.cause`, or `.fix` for one part of a row. The slug is the heading with backticks dropped, lowercased, each run of characters outside a-z and 0-9 turned into one hyphen, and hyphens trimmed from the ends. A note whose anchor names no place shows at the top of the file.

`--replies` takes the author's answers to the comments of an earlier send-back, in the shape "Comments and replies" sets.

### The description

`--description <file>` is required on the blueprint and page kinds. The file holds a background paragraph, then one or two summary paragraphs, as the packet's description does, and the screen shows them under the title, ahead of the status line. The title follows a packet's rule: a heading, no closing punctuation, at most 80 characters. A missing flag, a path that is not a file, a description with the wrong number of paragraphs, or a bad title exits 2 before anything is queued. The command saves the file as the item's `description.md`.

A blueprint or page queued again after a send-back is a revision of it. The command looks up its log ref, `<repo>:<file>`, and writes `revises: {item, revision}` into `item.json`, and the screen shows "Revision N". These kinds need no `## What changed` section: their replies already answer each comment.

Approve stays locked until every `decide` and `question` note has a choice. An approve prints:

```json
{"decision":"approve","file":"<file>","commit":"<HEAD at approval>","blob":"<git rev-parse commit:file>","calls":[{"id":"B3","choice":"<label>"}],"comments":[],"threads":[]}
```

A send-back prints `{"decision":"reject","note":"<text>","calls":[...],"comments":[...],"threads":[...]}`, where `calls` holds the calls Geoff made before sending it back; the screen's button reads "Send back with note". Either way the decision log gains one line with `"kind": "blueprint"`, `"ref": "<repo>:<file>"`, the blob and commit, the `comments` and `replies` counts, and `waived`: each `decide` note answered with a choice that leaves the line as it was, with that choice's `done` text as the reason.

### approved

```sh
approval-queue approved [--kind blueprint|page] <file> <blob>
```

Exits 0 when the decision log under `$XDG_STATE_HOME/approval-queue/` holds an approve of `<file>` (matched on the part of the ref after the repo) at `<blob>`, and 1 otherwise. Without `--kind` it matches only `"kind": "blueprint"` lines, which is the check a tool runs before it drafts from a blueprint; `--kind page` matches only page lines. A tool that builds from a document runs it against `git rev-parse HEAD:<file>`, so it builds only from the version Geoff approved.

## The page kind

A page is a drafted page Geoff reads and edits in place, riding with a pull request. The screen is the blueprint screen with the PR and its head shown, and the same editor, notes, and save-by-commit.

```sh
approval-queue page <worktree> <title> <file> --pr <owner/repo#n> --description <file> [--notes <notes.json>] [--replies <replies.json>]
```

The refusals and `--replies` are the blueprint's, plus a `--pr` that is not `owner/repo#n`; a PR whose head `gh pr view <n> -R <owner/repo> --json headRefOid` cannot read exits 1. A page's notes anchor with `<slug>.heading` for a heading and `<slug>.p<n>` for the nth paragraph, list item, or table under that heading, counting from 0 (a list item runs through its indented continuation; front matter, blank lines, code blocks, directive containers, and rules count for nothing). An approve prints the PR head read at approval:

```json
{"decision":"approve","file":"<file>","commit":"<HEAD at approval>","blob":"<blob>","pr":"<owner/repo#n>","head":"<PR head at approval>","calls":[{"id":"D1","choice":"<label>"}],"comments":[],"threads":[]}
```

A send-back prints the blueprint's send-back JSON. The log line is the blueprint's with `"kind": "page"`, the `pr`, and, on an approve, the `head`. A head that cannot be read at approval fails the command with nothing logged.

## The change kind

A change is one review of a code PR that also edits blueprints and pages. The screen shows each changed document read-only as it is at the PR head, with its notes inline, the lines the change edited marked, and its own diff behind a row; the rest of the PR shows as the PR screen's Files row. Geoff decides the PR, and its author makes any edits.

```sh
approval-queue change <owner/repo#n> <title> [--notes <notes.json>] [--replies <replies.json>]
```

A changed file is a document when it is `blueprints/**/*.blueprint.md`, `.yaml`, or `.yml`, or a `.md` or `.mdx` file under `docs/` outside `docs/internal/`; a PR with none is refused (queue it with `pr`). The notes take the blueprint's shape plus a required `file` naming the document each anchors into, and a choice may not carry `text` or `edit`. A PR already waiting in the queue is refused. `--replies` takes the blueprint's shape, and each thread's `anchor.file` must name a document the change carries. An approve prints:

```json
{"decision":"approve","pr":"<owner/repo#n>","head":"<PR head at approval>","calls":[{"id":"Q1","choice":"<label>"}],"comments":[],"threads":[]}
```

A send-back prints the blueprint's send-back JSON. The log line has `"kind": "change"`, `"ref": "<owner/repo#n>"`, the `head` (at approval, or as queued for a send-back), the `comments` and `replies` counts, and, on an approve, the `calls`.

## Gate

```sh
bash scripts/gate.sh
```

The gate runs the app's `check` and `test`, then every `tests/*.test.sh`, including the install test (which uses a temp `HOME`). The brief-register test reads `REGISTER`, defaulting to `~/.claude/docs/voice/approval-brief.md`, and fails when the file is absent.

## History

The code arrived from `glw907/workstation` with its history, including the `review-desk` era names.
