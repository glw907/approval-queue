# approval-queue

Approval Queue: a local SvelteKit app and a command that put a packet (one session hand-over of asks and routine parts) or a single item (a PR, a design, or a triage list) in front of Geoff and print his decision as JSON. The app serves on `127.0.0.1:7907`; set `APPROVAL_QUEUE_PORT` to use another port, which the command passes to the build, so a build serves only the port it was made with.

## Layout

- `approval-queue/` is the SvelteKit app (Svelte 5, DaisyUI, adapter-node).
- `bin/.local/bin/approval-queue` is the command: `approval-queue <pr|design|triage> <repo> <title> <source>`, `approval-queue packet [--check] <initiative> <file>`, `approval-queue blueprint <worktree> <title> <file> --description <file> [--notes <notes.json>] [--replies <replies.json>]`, `approval-queue page <worktree> <title> <file> --pr <owner/repo#n> --description <file> [--notes <notes.json>] [--replies <replies.json>]`, `approval-queue change <owner/repo#n> <title> [--notes <notes.json>] [--replies <replies.json>]`, `approval-queue withdraw <id>`, or `approval-queue collect <id>`. The queuing forms check the item's brief, the packet file, the blueprint, or the page, queues it under `~/.local/state/approval-queue/items/`, starts the app if it isn't up, prints `approval-queue: queued <id> at <url>` on stderr (stdout holds only the decision JSON), opens a tab, and waits for `decision.json`.
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

A packet that resends a part Geoff sent back is a revision. The command reads `decisions.jsonl` for each PR and design the packet names. A ref is sent back when its latest log line is a reject that counts; a ref whose latest line is an approve, a hold, or a `send-back` verdict inside an approve is not, and a state directory with no log sends back nothing. A packet send-back logs `sentBack: true` on each part Geoff set to send back and `sentBack: false` on every other part. A reject line counts unless its `sentBack` is `false` and another line of the same packet has it `true`: a part Geoff marked approve inside a packet where he sent another part back is not sent back. A send-back with no part set to send back (a note alone) counts every part, and so does a line written before the field existed. So a resend of only the parts he marked approve is a fresh packet, which takes no `## What changed` section and shows plain rows, and a resend that mixes them with a sent-back part is a revision whose since diff covers the sent-back part alone. When one or more refs are sent back, the packet must carry a `## What changed` section, placed after the description and before `## If you approve`: a bulleted list of at least one bullet, naming what the session changed in answer to Geoff. The command refuses (exit 2, before it fetches anything) a revising packet without the section, and a packet with the section that revises nothing; the message names the earlier item and the parts it sent back. `--check` applies the same rule.

A revising packet's `item.json` gains `revises`: `{item, revision, parts}`. `item` is the id of the latest sent-back item, `revision` is one more than the number of distinct send-back rounds since each part's latest approve, counting only rounds whose reject lines count (the first resend reads 2), and `parts` holds the head or `sha256` each sent-back part had; a part Geoff marked approve is not listed.

For each PR part whose head moved since the send-back, the command asks GitHub for the compare between the old and new heads and saves what changed since. An old head still behind the new one writes the diff to `parts/<k>/since.patch`. A head that is no longer an ancestor (a force-push, or a commit GitHub cannot find) writes `parts/<k>/since.json` as `{"gone": true}`. A diff too large for GitHub to serve writes neither file, and the part shows its full file list as before; no case refuses a packet. A branch that merged its default branch since the send-back carries those merged changes in its since diff.

### The home page

The home page is the board of waiting packets, grouped by initiative, with the sort ("Asks first" or "Oldest first") kept in a cookie. A `pr`, `design`, or `triage` item waits under "Single items". The server rebuilds every part and ask from the stored packet, so a post cannot approve a part the packet does not hold.

### The decision JSON and the decision log

An approve prints one line of JSON that lists every part once, with each PR's `head` or each design's `sha256` joined from the stored copy, and each ask's chosen label. A reject prints `{"decision": "reject", "note": "<text>", "calls": [...]}` and merges nothing. `calls` holds Geoff's verdicts and ask picks as the screen held them when he sent it back: one `{ref, verdict}` per part, in the packet's order and steps included, then one `{ask, question, choice}` per ask (`ask` counts from 1). A `verdict` or `choice` is `null` when Geoff had not set it, or when the post named a value the packet does not hold. A send-back is never refused for its fields. A decision stored by an older build has no `calls` and prints `"calls": []`. A send-back's log lines also carry `sentBack` per part (see "Revisions"). A session merges each approved PR with `gh pr merge <n> --repo <repo> --merge --match-head-commit <head>`, stops at the first failure, and reports back.

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

## After a hand-over: pid, withdraw, defer, collect, and the claim

**The pid.** Every `item.json` the command writes carries `pid` and `pidStart`: the command's process id and its start time in clock ticks since boot (field 22 of `/proc/<pid>/stat`). The id already ends in the same pid. A pid counts as the waiting session only when `/proc/<pid>/stat` exists, its start time equals `pidStart`, and its state is not `Z`, so a pid another process reused never reads as the waiter. An item queued before the pass has no `pid` and reads as unknown: no board mark, and `withdraw` refuses it.

**withdraw.**

```sh
approval-queue withdraw <id>
```

Takes a session's queued item off the board. It sends TERM to the waiting command, whose exit trap removes `item.json`, and waits up to 5 seconds for the file to go. When the pid is gone, or the item is deferred (its waiter may still be printing the defer line), it removes `item.json` itself. It prints nothing and exits 0. It exits 2 for an id that is not `YYYYMMDDTHHMMSS-<pid>`, an id with no `item.json`, an item with a `decision.json` ("decided; collect it instead"), and an item with no `pid`. It exits 1 when `item.json` stays, or when a decision landed while it waited (run `collect`).

**Defer.** Geoff can defer any item but a triage. The app writes `deferred.json` (`{"at": "<ISO 8601 UTC>"}`). The waiting command prints `{"decision":"defer","id":"<id>"}` and exits 0; nothing is logged, and `item.json` stays. The board lists a deferred item under "Deferred", after "Single items". A decision never opens it next. The item still counts as waiting, so a packet that resends its PRs is refused as "already in the waiting item" until the item is withdrawn or decided. If Geoff later approves or sends back a deferred item, the app writes `decision.json` as for any other, and the decision waits for `collect`.

**collect.**

```sh
approval-queue collect <id>
```

Prints and logs the decision of an item whose queuing command is gone, exactly as the queuing command would have. It waits for `decision.json` when there is none yet (a deferral does not end its wait), and its exit trap never removes `item.json`. The decision is logged once: before it appends, `collect` and the queuing command both look in `decisions.jsonl` for a line whose `packet` is the item's id, under the queue lock, so a second `collect`, or a `collect` racing the queuing command, prints the decision again and logs nothing more. It exits 2 for an id that does not match the id pattern or has no `item.json`, and 1 where the queuing command would (a head that moved, a worktree removed since the queue).

**The board mark.** An item whose pid is recorded but is not the waiting session, and that is not deferred, shows "No session is waiting for this." on the board: its decision is kept, and `collect` prints it.

**The claim.** Only a browser that visited `/claim` counts as Geoff's open tab. `/claim` makes `claim.token` in the state directory on its first visit (32 random bytes as hex, mode 0600) and sets the `desk-claim` cookie to it. A poll that carries the cookie touches `tab.seen` and sets the cookie again, which pushes its 400-day lifetime out from the last use; a poll without it touches nothing. So a browser an agent drives never takes a new item's tab, and while no browser is claimed the command opens a tab for each new item, as it does when no tab is live. The token belongs to the state directory, so a throwaway instance never matches the live queue's cookie.

## The blueprint kind

A blueprint is a page plan Geoff reads and edits in place. The screen opens the file in an editor with each note from the author or the fact check under the line it is about, and every pause in typing (or Ctrl+S) writes the file and commits it with `Edit <file> in review`.

```sh
approval-queue blueprint <worktree> <title> <file> --description <file> [--notes <notes.json>] [--replies <replies.json>]
```

`<worktree>` is the top of a git worktree, and `<file>` is relative to it. The command refuses a file that is not a regular file committed at HEAD (a directory or a symlink is refused), a file with uncommitted changes, and a notes file that is not a JSON array of notes in the shape `{id, kind, anchor, title, body}`: `kind` is `info`, `decide`, or `question`, `body` is an array of paragraphs, and a note may add `was` and `now`, `sides` (`[{who, text}]`), and `choices` (`[{label, text?, done, edit?}]`). A `decide` or `question` note must carry choices. A note's `anchor` is a non-empty string, or an object `{quote, prefix?, suffix?}` with a non-empty `quote` and string `prefix` and `suffix`; the command refuses an empty quote, a `prefix` or `suffix` that is not a string, and any other key. Each refusal names the problem and exits 2 before anything is queued.

A note's `anchor` is a name or a quote.

A name is a string: `<slug>.heading` for a heading, `<slug>.p<n>` for the nth bullet, numbered step, or `:::row` block under that heading, counting from 0, and `<slug>.p<n>.symptom`, `.cause`, or `.fix` for one part of a row. A name counts items, so it moves when an item above it is added or removed.

A quote is an object, `{"quote": "...", "prefix": "...", "suffix": "..."}`, with `quote` required and `prefix` and `suffix` optional strings. It can sit on any line, including a line inside a `:::reader` block, and it stays on its text when items move. The screen places it by the steps a comment uses, minus the offsets:

1. The one place where `prefix + quote + suffix` occurs.
2. The first occurrence of `quote`.
3. Nowhere: the note shows at the top of the file.

Quote text that occurs once, or add a `prefix` or `suffix` that settles it. A quote that repeats, with no context, takes its first occurrence.

The slug is the heading's text as the page renders it (inline Markdown dropped), run through `github-slugger`, the rule cairn's pages use for heading ids: lowercased, punctuation deleted, each space turned into a hyphen. An apostrophe is deleted, not turned into a hyphen, so `Set a section's starting state` is `set-a-sections-starting-state`. A heading that repeats an earlier slug takes `-1`, then `-2`, and a blueprint's `page` title takes the first slug, so a heading that repeats the title takes `-1`. The first version of this tool turned each run of characters outside a-z and 0-9 into one hyphen (`set-a-section-s-starting-state`); notes written with that spelling still resolve, unless a heading's current slug holds the name. A note whose anchor names no place shows at the top of the file.

`approval-queue anchors <file>` prints a file's heading anchors, one per line, as `<slug>.heading`, a tab, and the heading's text, skipping front matter, code, and directive containers. A file ending in `.blueprint.md` is slugged as a blueprint; any other file as a page. It needs the app's `node_modules` (run `npm ci` in the app directory), which the other subcommands do not.

`--replies` takes the author's answers to the comments of an earlier send-back, in the shape "Comments and replies" sets.

### The description

`--description <file>` is required on the blueprint and page kinds. The file holds a background paragraph, then one or two summary paragraphs, as the packet's description does, and the screen shows them under the title, ahead of the status line. The title follows a packet's rule: a heading, no closing punctuation, at most 80 characters. A missing flag, a path that is not a file, a description with the wrong number of paragraphs, or a bad title exits 2 before anything is queued. The command saves the file as the item's `description.md`.

A blueprint or page queued again after a send-back is a revision of it. The command looks up its log ref, `<repo>:<file>`, and writes `revises: {item, revision}` into `item.json`, and the screen shows "Revision N". These kinds need no `## What changed` section: their replies already answer each comment.

Approve stays locked until every `decide` and `question` note has a choice. An approve prints:

```json
{"decision":"approve","file":"<file>","commit":"<HEAD at approval>","blob":"<git rev-parse commit:file>","calls":[{"id":"B3","choice":"<label>"}],"comments":[],"threads":[]}
```

A send-back prints `{"decision":"reject","note":"<text>","calls":[...],"comments":[...],"threads":[...]}`, where `calls` holds the calls Geoff made before sending it back; the screen's button reads "Send back with note". Either way the decision log gains one line with `"kind": "blueprint"`, `"ref": "<repo>:<file>"`, the blob and commit, the `comments` and `replies` counts, and `waived`: each `decide` note answered with a choice that leaves the line as it was, with that choice's `done` text as the reason.

### The amend review

A blueprint or page queued after an approve of the same file, and of the same kind, is an amend review. The command reads `decisions.jsonl` for the latest approve whose `kind` is the item's kind and whose `ref` is `<repo>:<file>`. When the worktree still holds that approve's blob, the command saves its text as `approved.md` in the item directory and writes `amends: <blob>` into `item.json`; a blob the worktree lacks queues a full review. The screen then shows what changed since the approved text, with the unchanged runs folded away. An amend can also be a revision, and both apply. Both the approve and the send-back JSON carry `"amends": "<blob>"` for an amend review. The log lines do not change.

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

The refusals and `--replies` are the blueprint's, plus a `--pr` that is not `owner/repo#n`; a PR whose head `gh pr view <n> -R <owner/repo> --json headRefOid` cannot read exits 1. A page's notes anchor by a name or a quote, as a blueprint's do (the slug rule, the alias, the quote steps, and `approval-queue anchors` are the same, except that a page's slugs take no title seed). A name is `<slug>.heading` for a heading or `<slug>.p<n>` for the nth paragraph, list item, or table under that heading, counting from 0 (a list item runs through its indented continuation; front matter, blank lines, code blocks, directive containers, and rules count for nothing). An approve prints the PR head read at approval:

```json
{"decision":"approve","file":"<file>","commit":"<HEAD at approval>","blob":"<blob>","pr":"<owner/repo#n>","head":"<PR head at approval>","calls":[{"id":"D1","choice":"<label>"}],"comments":[],"threads":[]}
```

A send-back prints the blueprint's send-back JSON. The log line is the blueprint's with `"kind": "page"`, the `pr`, and, on an approve, the `head`. A head that cannot be read at approval fails the command with nothing logged.

## The change kind

A change is one review of a code PR that also edits blueprints and pages. The screen shows each changed document read-only as it is at the PR head, with its notes inline, the lines the change edited marked, and its own diff behind a row; the rest of the PR shows as the PR screen's Files row. Geoff decides the PR, and its author makes any edits.

```sh
approval-queue change <owner/repo#n> <title> [--notes <notes.json>] [--replies <replies.json>]
```

A changed file is a document when it is `blueprints/**/*.blueprint.md`, `.yaml`, or `.yml`, or a `.md` or `.mdx` file under `docs/` outside `docs/internal/`; a PR with none is refused (queue it with `pr`). The notes take the blueprint's shape plus a required `file` naming the document each anchors into, and a choice may not carry `text` or `edit`. A change note's `anchor` is a string only; a quote object is refused. A PR already waiting in the queue is refused. `--replies` takes the blueprint's shape, and each thread's `anchor.file` must name a document the change carries. An approve prints:

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

## Home-grown parts

Every screen takes its stock DaisyUI class first, with overrides that keep the 2026-10-14 prototype's look. These parts stay home-grown, each for the defect that stock part has here:

- **Frame drawers (the queue rail and the review pane).** The stock `drawer` has one `lg:drawer-open` breakpoint and opens from a checkbox. Here the rail stops being a drawer at 1024px and the pane at 1260px, and `drawers.ts` makes the page behind inert, moves focus in, returns it to the opener on close, and closes on Esc and on a link into the work. The stock drawer does none of that.
- **The queue rail's list.** The stock `menu` styles any non-`ul` child of an item as a menu row, so the contents outline (an `ol`) that opens under the current item would take row padding and hover fills. The rail keeps its own list and takes the stock `btn` classes for the Board row, the close button, and the shortcuts button.
- **The breadcrumb (`FrameHeader.svelte`).** Stock `breadcrumbs` takes only `li` items with its own separators. The crumb row mixes links, plain text, a read time, and status badges, built by each screen's snippet, so it stays a flex row inside a `nav` with the Breadcrumb label.
- **The rail's contents outline and the board's table.** The stock `menu` and `table` do not cover an outline with call marks or a table that becomes a stacked list on a phone.
- **The review pane's rows (`PaneList`).** They take `menu menu-sm`, but the status dot, the second line, and the numbered outline form are home-grown rows inside it, since the stock menu row holds one line of text.
