# approval-queue

Approval Queue: a local SvelteKit app and a command that put a packet (one session hand-over of asks and routine parts) or a single item (a PR, a design, a triage list, or a docs review) in front of Geoff and print his decision as JSON. The app serves on `127.0.0.1:7907`; set `APPROVAL_QUEUE_PORT` to use another port, which the command passes to the build, so a build serves only the port it was made with.

## Layout

- `approval-queue/` is the SvelteKit app (Svelte 5, DaisyUI, adapter-node).
- `bin/.local/bin/approval-queue` is the command: `approval-queue <pr|design|triage> <repo> <title> <source>`, `approval-queue packet [--check] <initiative> <file>`, `approval-queue docs <worktree> <owner/repo#n> <title> --description <file> [--notes <notes.json>] [--replies <replies.json>]`, `approval-queue withdraw <id>`, `approval-queue pending`, `approval-queue notes --check <worktree> <notes.json>`, `approval-queue notes <id> <notes.json>`, or `approval-queue collect <id>`. The queuing forms check the item's brief, the packet file, or the docs review's inputs, queue it under `~/.local/state/approval-queue/items/`, starts the app if it isn't up, prints `approval-queue: queued <id> at <url>` on stderr (stdout holds only the decision JSON), opens a tab, and waits for `decision.json`.
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

On the docs kind, Geoff can select text and comment on it. Each comment is saved to the item when he presses Save, and it goes to the author with either decision. The text of a box still open is not saved. Both the approve and the send-back JSON carry two fields:

- `comments`: every comment Geoff left, always present and possibly empty. A comment is `{id, text, anchor}`.
- `threads`: `[{id, reply}]`, one for each of the author's replies that Geoff answered. A reply he resolved without answering, or left alone, is not listed: it resolves at the decision.

An anchor is `{quote, prefix, suffix, from, to, commit, file}`. `quote` is the selected text, `prefix` and `suffix` are up to 32 characters on each side of it, and `from` and `to` are its offsets, end exclusive, into the file with its line endings read as LF. `commit` is the worktree `HEAD` when the comment was saved. `file` names the page. An anchor is never moved at decision time. The author re-places it in the current file by the same steps the screen uses:

1. The offsets, if the text between them is still `quote`.
2. The one place where `prefix + quote + suffix` occurs.
3. The occurrence of `quote` nearest the old `from`.
4. Nowhere: the text is gone.

The author answers every comment, after a send-back or before acting on an approve. A send-back's answers come back when the author queues the item again with `--replies <replies.json>`, a JSON array of threads:

```json
[{"id":"C1","status":"done","text":"<the author's reply>","quote":"<the comment's quote>","anchor":{"quote":"...","prefix":"...","suffix":"...","from":120,"to":168,"commit":"<sha>","file":"docs/guide/x.md"}}]
```

`id`, `quote`, and `anchor` are the comment's own, copied from the decision. `status` is `done` (the author made the change), `kept` (the author left the text as it was, and says why in `text`), or `answered` (the comment was a question, and `text` answers it). Each thread names its page in `anchor.file`, and that page must be one the review carries. The command refuses a file that is not an array of threads in this shape, or that uses an id twice, and accepts an empty array. The screen shows each reply on its comment's card, placed by the steps above, and a thread whose text is gone shows its original quote. Only Geoff resolves a thread. A new comment on the re-queued item takes an id past every thread's, so the ids never collide.

The decision log line of a `docs` review gains `comments`, the number of comments, and `replies`, the number of `threads`.

## After a hand-over: pid, withdraw, defer, collect, and the claim

**The pid.** Every `item.json` the command writes carries `pid` and `pidStart`: the command's process id and its start time in clock ticks since boot (field 22 of `/proc/<pid>/stat`). The id already ends in the same pid. A pid counts as the waiting session only when `/proc/<pid>/stat` exists, its start time equals `pidStart`, and its state is not `Z`, so a pid another process reused never reads as the waiter. An item queued before the pass has no `pid` and reads as unknown: no board mark, and `withdraw` refuses it.

**withdraw.**

```sh
approval-queue withdraw <id>
```

Takes a session's queued item off the board. It sends TERM to the waiting command, whose exit trap retires `item.json`, and waits up to 5 seconds for that command to exit. When the pid is gone, or the item is deferred (its waiter may still be printing the defer line), it retires `item.json` itself. Retiring renames `item.json` away and then looks for a `decision.json`: if one landed first, the file is renamed back and the decision stands. The app does the same from its side, so a decision written after the rename is taken back and the page says the session withdrew the item. `withdraw` prints `withdrew <id>` on stdout and exits 0. It exits 2 for an id that is not `YYYYMMDDTHHMMSS-<pid>`, an id with no `item.json`, an item with a `decision.json` ("decided; collect it instead"), and an item with no `pid`. It exits 1 when `item.json` stays, or when a decision landed while it waited (run `collect`).

**Defer.** Geoff can defer any item but a triage. The app writes `deferred.json` (`{"at": "<ISO 8601 UTC>"}`). The waiting command prints `{"decision":"defer","id":"<id>"}` and exits 0; nothing is logged, and `item.json` stays. The board lists a deferred item under "Deferred", after "Single items". A decision never opens it next. The item still counts as waiting, so a packet that resends its PRs is refused as "already in the waiting item" until the item is withdrawn or decided. If Geoff later approves or sends back a deferred item, the app writes `decision.json` as for any other, and the decision waits for `collect`.

**collect.**

```sh
approval-queue collect <id>
```

Prints and logs the decision of an item whose queuing command is gone, exactly as the queuing command would have. It waits for `decision.json` when there is none yet (a deferral does not end its wait), and its exit trap never removes `item.json`. If the item is withdrawn while it waits, it prints `approval-queue: <id> was withdrawn; nothing to collect` on stderr, nothing on stdout, and exits 1. The decision is logged once: before it appends, `collect` and the queuing command both look in `decisions.jsonl` for a line whose `packet` is the item's id, under the queue lock, so a second `collect`, or a `collect` racing the queuing command, prints the decision again and logs nothing more. It exits 2 for an id that does not match the id pattern or has no `item.json`, and 1 where the queuing command would (a PR that moved, a worktree removed since the queue). A `collect` whose check passes and logs an approve removes `refused.json`.

**pending.**

```sh
approval-queue pending
```

Lists the decisions that wait for a `collect`: one line per item that has an `item.json` and a `decision.json`, no live waiter, and no line in `decisions.jsonl` whose `packet` is the item's id. A line is `<id>`, `<kind>`, `<decision>`, and `<title>` separated by tabs, oldest id first. It prints nothing when none waits, and exits 0 either way. It skips an item with a live waiter (the `pid` and `pidStart` rule above), a logged decision, a `refused.json` (the refusal went to the command that wrote it), a triage item (a triage decision is never logged), and an item with no `pid` (queued before pids existed, so a handled item cannot be told from a waiting one). It takes no arguments; any exits 2.

**The refused state.** A `docs` approve the waiting command refuses (see "The approve refusal") writes `refused.json` in the item directory before the command exits 1: `{"at": "<ISO 8601 UTC>", "reason": "<sentence>"}`, through a temp file and `mv`. `decision.json` stays, and the app never writes `refused.json`. The rail's "Decided this session" shows the row as "Refused" with the reason under it, and `pending` skips the item. The reason is "The pull request moved after it was queued, so the approval wasn't recorded. The session will queue it again." A later `collect` that passes the check and logs the approve removes the file.

**The board mark.** An item whose pid is recorded but is not the waiting session, and that is not deferred, shows "No session is waiting for this." on the board: its decision is kept, and `collect` prints it.

**The claim.** Only a browser that claimed itself counts as Geoff's open tab. Open `/claim` and press "Claim this browser": the button makes `claim.token` in the state directory on its first press (32 random bytes as hex, mode 0600) and sets the `desk-claim` cookie to it. Loading `/claim` sets nothing, so a link preload or an agent's page load never claims a browser. A poll that carries the cookie touches `tab.seen` and sets the cookie again, which pushes its 400-day lifetime out from the last use; a poll without it touches nothing. So a browser an agent drives never takes a new item's tab, and while no browser is claimed the command opens a tab for each new item, as it does when no tab is live. The token belongs to the state directory, so a throwaway instance never matches the live queue's cookie.

## The docs kind

A docs review is one pull request that changes documentation pages, read as a code review plus an editor for each page. The screen shows the PR, its code diff, and then each changed page as an editable diff against its merge-base text, with the author's notes and Geoff's comments beside the lines. Geoff edits the pages in place, comments, answers the author's calls, and approves, sends back, or defers.

```sh
approval-queue docs <worktree> <owner/repo#n> <title> --description <file> [--notes <notes.json>] [--replies <replies.json>]
```

`<worktree>` is the top of a git worktree of the PR's repository, checked out at the PR's head. Flags may sit anywhere after `docs`. The title follows a packet's rule: sentence case, no closing punctuation, at most 80 characters. The command fetches the PR, queues the item, starts the app if it is down, prints `approval-queue: queued <id> at <url>` on stderr, and waits. On a decision it prints one line of JSON on stdout and exits 0.

A changed page is a file the PR's diff adds, modifies, or renames whose path at the head matches `docs/**/*.md`, `docs/internal/` included. A deleted page shows in the code diff only. The diff runs from GitHub's merge base to the head, so commits the base branch gained after the branch was cut never read as the PR's. A rename reads its old text from the old path. Both commits are read from the worktree with git, and one the worktree lacks is fetched from `origin` first.

### Refusals

Each refusal prints one line naming the problem on stderr and exits before anything is queued.

| Condition | Exit |
| --- | --- |
| Wrong argument count, an unknown flag, or a flag with no value (prints the usage) | 2 |
| `<owner/repo#n>` is not that shape | 2 |
| `--description` is missing, not a file, or not a background paragraph followed by one or two summary paragraphs, or the title is bad | 2 |
| `<worktree>` is not a git worktree's top | 2 |
| The worktree's `origin` is not `<owner/repo>` | 2 |
| The worktree has uncommitted changes to tracked files | 2 |
| The worktree's `HEAD` is not the PR's head | 2 |
| The PR is merged or closed | 2 |
| The PR changes no `docs/**/*.md` file that exists at its head (queue it with the `pr` form) | 2 |
| A notes or replies file that is missing, not JSON, or not the shape below; a note or thread whose `file` names no changed page; a quote that matches more than once in its page | 2 |
| The PR is already in a waiting item (a packet part, a `pr` item, or a `docs` item) | 2 |
| `gh` cannot read the PR, its diff, or its merge base | 1 |

A draft PR is accepted, and pending checks are not refused.

### The notes file

A JSON array of notes:

```json
{
  "id": "N1",
  "file": "docs/guide/water-a-houseplant.md",
  "kind": "info",
  "anchor": {"quote": "once a week", "prefix": "Water it ", "suffix": " in summer"},
  "title": "The interval was corrected",
  "body": ["The page said every day. `src/watering.ts:12` waters once a week."],
  "was": "Water it every day in summer",
  "now": "Water it once a week in summer"
}
```

- `id` is a non-empty string, unique in the file. `file` is a changed page's path. `kind` is `info`, `decide`, or `question`.
- `anchor` is an object with a non-empty `quote`, optional string `prefix` and `suffix`, and no other key. The screen places it at the one place `prefix + quote + suffix` occurs, else at the first occurrence of `quote`, else at the top of the page. A quote that matches more than once with its context (a missing `prefix` or `suffix` reads as empty) is refused, naming the note, the quote, and the count. A quote that matches nowhere is not refused.
- `title` is a string, and `body` is an array of paragraph strings.
- A note may add `was` and `now` together, `sides` (`[{who, text}]`), and `choices` (`[{label, done}]`, where `done` says what the session will do on that choice). A `decide` or `question` note must carry choices, and approve stays locked until each has one.

`approval-queue notes --check <worktree> <notes.json>` runs the queue-time checks without queueing, reading each note's page from the worktree's `HEAD`. It prints nothing and exits 0 when the notes pass, and exits 2 with the queue-time messages when they do not, or when a path is missing.

`approval-queue notes <id> <notes.json>` replaces a waiting `docs` item's notes, keeping its id, URL, `item.json`, and waiter, and prints `replaced the notes of <id> at <url>`. It checks the notes against the pages as the screen shows them: the worktree's `HEAD` copy, else the copy queued. It exits 2, leaving `notes.json` as it was, for an id that is not an item id, an id with no queued item, a decided item, an item of another kind, and notes that fail the checks. The item route reads `notes.json` on each load, so an open tab shows the new notes on its next load.

The quote check is `node approval-queue/src/check-notes.ts <dir> <notes.json>`: each note's `file` resolves under `<dir>`. It exits 0 with no output when every quote is unambiguous, 2 with one line per defect when not, and 1 when a file cannot be read.

### The replies file

`--replies` takes the author's answers to the comments of a send-back, in the shape "Comments and replies" sets. `anchor.file` must name a changed page. An empty array is accepted.

### The screen

The item opens with the title and description, then the PR (number, branch, checks) and its body, then the code diff (the PR's diff without the changed pages), then each changed page. Every pause in typing (or Ctrl+S) writes that page in the worktree and commits it alone with `Edit <path> in review`. A save is refused with 409 when the file's blob at `HEAD` is not the blob the screen holds. Geoff selects text to comment, and each comment saves on Save. Approve stays locked until every call is answered and every page is saved. A page whose worktree or file is gone shows the queued copy read-only.

### The decision

An approve prints, keys in this order:

```json
{"decision":"approve","pr":"<owner/repo#n>","head":"<PR head, unmoved since the queue>","commit":"<worktree HEAD at approval>","calls":[{"id":"N2","choice":"Apply the fix"}],"comments":[],"threads":[]}
```

`commit` equals `head` when Geoff made no edit, and is a descendant of it holding only his `Edit ... in review` commits when he did. A send-back prints `{"decision":"reject","note":"<text>","pr":...,"head":...,"commit":...,"calls":[...],"comments":[...],"threads":[...]}`, where `head` is the PR head as queued, `commit` is the worktree `HEAD` at the send-back, and `calls` holds only the calls Geoff answered; the screen's button reads "Send back with note". A defer prints `{"decision":"defer","id":"<id>"}`.

Every approve and send-back appends one line to `decisions.jsonl`:

```json
{"time":"<ISO 8601 UTC>","packet":"<id>","initiative":null,"ref":"<owner/repo#n>","kind":"docs","lane":"single","verdict":"approve","head":"<sha>","commit":"<sha>","calls":[],"comments":0,"replies":0}
```

A send-back's line has `"verdict":"reject"`.

### The approve refusal

At an approve the command reads the PR's head. If it is not the head the item was queued at, the approve is refused: nothing is logged, `refused.json` is written (see "The refused state"), the rail shows the row as "Refused", and the command exits 1 with a line naming the PR and both heads. The session pulls the new head into the worktree and queues the item again. A head `gh` cannot read exits 1 with nothing logged and no `refused.json`, so the item stays in `pending` for a `collect` to retry. The app writes `decision.json` for an approve only when every page is committed and clean in the worktree, each page's posted blob is its blob at `HEAD`, and every call is answered.

### Revisions

A `docs` item queued after a send-back of the same PR is a revision. The command looks up the PR's latest counting reject line for `{"ref": "<owner/repo#n>", "kind": "docs"}` and writes `revises: {item, revision, commit}` into `item.json`, where `commit` is that line's. It saves what changed since as `since.patch` (`git diff <commit> HEAD`) when that commit is an ancestor of `HEAD`, else `since.json` as `{"gone": true}`. The screen shows "Revision N" and a "Since you sent it back" diff. A `docs` item needs no `## What changed` section: the replies answer each comment, and the description says what changed.

### The amend review

A `docs` item queued when the PR's latest `docs` line in `decisions.jsonl` is an approve (CI went red after the approve, say, and the session fixed forward) is an amend review. The command reads that line's `commit`, writes `amends: {"commit": "<sha>"}` into `item.json`, and saves `approved.patch` (`git diff <commit> HEAD`) when that commit is an ancestor of `HEAD`, else `approved.json` as `{"gone": true}`. The screen shows a "Since you approved" diff above the pages. An amend is never also a revision: the latest line decides.

### The item directory

`item.json` is written last:

```json
{"id":"<id>","kind":"docs","repo":"<owner/repo>","number":150,"title":"<title>","headline":"<title>","created":"<ISO 8601 UTC>","worktree":"/abs/path","head":"<sha>","base":"<merge-base sha>","pid":123,"pidStart":456}
```

The directory also holds `description.md`, `body.md` (the PR body), `pr.json`, `diff.patch` (the whole PR diff at `head`), `pages.json` (`[{"path": "docs/x.md", "from": "docs/old.md"}]`, `from` only on a rename), `pages/<k>/base.md` (the merge-base text, empty for a new page) and `pages/<k>/queued.md` (the text at `head`), `notes.json`, and, as the item calls for them, `replies.json`, `since.patch` or `since.json`, and `approved.patch` or `approved.json`. The app writes `comments.json`, `decision.json`, and `deferred.json`. The command writes `refused.json`.

Decided items of any other kind stay on disk, and the app neither lists nor serves them: `/item/<id>` answers 404, and `pending` and `collect` skip them.

## Gate

```sh
bash scripts/gate.sh
```

The gate runs the app's `check` and `test`, then every `tests/*.test.sh`, including the install test (which uses a temp `HOME`). The brief-register test reads `REGISTER`, defaulting to `~/.claude/docs/voice/approval-brief.md`, and fails when the file is absent.

## History

The code arrived from `glw907/workstation` with its history, including the `review-desk` era names.

## Home-grown parts

Every screen takes its stock DaisyUI class first, with overrides that keep the 2026-10-14 prototype's look. These parts stay home-grown, each for the defect that stock part has here:

- **Frame drawers (the queue rail and the review pane).** The stock `drawer` ships `sm:`, `md:`, `lg:`, and `xl:drawer-open` breakpoints, so the rail's 1024px is exactly `lg`. Three defects remain. The pane stops being a drawer at 1260px, and no stock breakpoint sits there (`xl` is 1280px). Two drawers on one page need nested `.drawer` wrappers. And a checkbox toggle makes nothing inert, moves no focus, and ignores Esc and the return of focus. Here `drawers.ts` makes the page behind inert, moves focus in, returns it to the opener on close, and closes on Esc and on a link into the work.
- **The queue rail's list.** The stock `menu` styles any non-`ul` child of an item as a menu row, so the contents outline (an `ol`) that opens under the current item would take row padding and hover fills. The rail keeps its own list and takes the stock `btn` classes for the Board row, the close button, and the shortcuts button.
- **The breadcrumb (`FrameHeader.svelte`).** Stock `breadcrumbs` sets `white-space: nowrap` with `overflow-x: auto`, so a long path scrolls sideways instead of wrapping on a phone, and it gives every `li > *` a pointer cursor and a hover underline, so a plain-text crumb looks clickable. The header keeps an `ol` of `li` crumbs, with the slashes drawn by CSS and `aria-current="page"` on the last, inside a `nav` with the Breadcrumb label. The wait, the badges, and the links out sit beside it, outside the `nav`.
- **The rail's contents outline and the board's table.** The stock `menu` and `table` do not cover an outline with call marks or a table that becomes a stacked list on a phone.
- **The review pane's rows (`PaneList`).** They take `menu menu-sm`, but the status dot, the second line, and the numbered outline form are home-grown rows inside it, since the stock menu row holds one line of text.
