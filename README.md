# approval-queue

Approval Queue is a local SvelteKit app and a command. A session sends Geoff one packet for a pass's design, one at its close, or one when the pass stops for a call only he can make. The app shows the packet in a browser, and the command prints his decision as JSON. The app serves on `127.0.0.1:7907`. Set `APPROVAL_QUEUE_PORT` to use another port. The command passes it to the build, so a build serves only the port it was made with.

A packet that holds no call, no `auth-data` path, and no `## Before merge` step is not sent. The session lands it with `approval-queue land`, and the app lists it on the digest page.

## Layout

- `approval-queue/` is the SvelteKit app (Svelte 5, DaisyUI, adapter-node).
- `bin/.local/bin/approval-queue` is the command.
- `bin/.local/bin/claude-approval-queue-reminder` is the PostToolUse hook script. After `gh pr create` it prints one line saying where the PR goes.
- `tests/` holds the shell tests. `tests/fixtures/ct/` holds the end-to-end check's `gh` stub, its pull request data, and its Playwright scripts.
- `approval-queue/src/lib/fixtures/` holds a design, a close, and a stop packet (a fact file and a text file each), the patches they cite, and a design and a triage brief.

The command and the app find each other by path, so the command must be a link to this checkout, not a copy.

## Install

```sh
npm ci --prefix approval-queue
bash scripts/install.sh
```

`scripts/install.sh` links both commands into `~/.local/bin`. The command builds the app on first use when `approval-queue/build/index.js` is missing. After an upgrade, run `approval-queue restart`.

The hook's `settings.json` entry lives in the workstation repo and calls `claude-approval-queue-reminder` by name.

## The command

| Form | What it does |
| --- | --- |
| `approval-queue snapshot <facts.json>` | Writes `snapshot/` beside the fact file: one `<owner>-<repo>-<n>.patch` per pull request at its current head, and `heads.json`. |
| `approval-queue packet [--check] [--replies <replies.json>] <initiative> <facts.json> <text.md>` | Checks both files against the snapshot, queues the packet, and waits for the decision. It refuses a pull request whose base is not the repo's default branch. |
| `approval-queue merge [--skip <owner/repo#n>]... [--premerge-done <owner/repo#n>]... <id>` | Merges each approved pull request at its pinned head. It refuses a stop packet, and a pull request not based on the default branch. |
| `approval-queue land <owner/repo#n> <claim>` | Merges a pull request that needs no packet and adds a digest line. It refuses a pull request not based on the default branch. |
| `approval-queue digest <owner/repo#n> <claim>` | Records a merge already done as a digest line. |
| `approval-queue restart` | Builds the app beside the running build, then swaps it in under `start.lock`. It exits 0 with a new server, and exits 1 with the old server answering again. |
| `approval-queue reply <id \| digest> <replies.json>` | Stores the session's answers to Geoff's notes. |
| `approval-queue design <repo> <title> <file>` and `approval-queue triage <repo> <title> <file>` | Queue a design brief or a triage list. |
| `approval-queue withdraw <id>`, `pending`, `collect <id>` | Manage a queued item (see "After a hand-over"). |

A retired form (`approval-queue docs`, `approval-queue notes`, `approval-queue pr`, or a packet file in the old grammar) exits 2 with one line naming its replacement in the `approval-packet` skill. A tool failure exits 1 and prints the `gh` error. A refusal of the input exits 2.

The queuing forms print `approval-queue: queued <id> at <url>` on stderr. Stdout holds only the decision JSON.

## The fact file

The session writes `facts.json`. It states facts and options. It holds no prose for the reader.

| Key | Meaning |
| --- | --- |
| `kind` | `design`, `close`, or `stop`. |
| `title` | The headline's subject, 80 characters or fewer, with no closing punctuation. |
| `reason` | Stop only: `{text, source}`, why the pass paused. |
| `prs` | `owner/repo#n` in merge order. A design packet has none. |
| `design`, `plan` | Design packet: `{repo, path}`. `plan` is optional. |
| `held` | Globs of paths the plan holds for Geoff. |
| `calls` | Each call is `{question, rule, forced, options: [{label, consequence}], recommended, evidence: [{text, source}]}`. |
| `decidedForYou` | Calls the session settled, each with `applied` set to the option's label. |
| `steps` | `{text, who}`, with `who` set to `session` or `you`. |
| `notChecked`, `reviews` | `{text, source}` entries. |

`rule` is one of the seven ask rules: `irreversible`, `public-surface`, `cross-repo`, `owner-call`, `low-confidence`, `gate-failed`, and `contradicts-ruling`. A call is `forced` when a rule forces it: a failing check, a `fix` or `escalate` verdict, or a `## Before merge` section. A packet carries at most three unforced calls, and any number of forced ones. Every `source` is a path with a line (`lib/queue.ts:10`), a URL, or `owner/repo#n`. The grammar lives in `approval-queue/src/lib/facts.ts`.

## The text file

A fresh writer writes `text.md` from the fact file, the initiative record, and the snapshot. It holds a `# ` headline, the opening paragraphs, and then these sections in order:

1. `## Deep dive`. Its first line is the sentence the closed fold shows.
2. `## Your calls`, when the fact file has calls. An optional paragraph, then one `### ` block per call in fact-file order, each with `Context:`, `Risk:`, and `Recommendation:` paragraphs.
3. `## Decided for you`, when the fact file has entries. One `### ` block each, with `Context:` and `Why:`.
4. `## Not checked`.
5. `## What changed`, which a design packet omits. A lead paragraph, then one bullet per claim. Each bullet ends with a citation, `[owner/repo#n path:a-b]`, where `a-b` are new-side line numbers in the snapshot.

The command takes the status line, options, steps, files, and checks from the fact file and from GitHub, never from the text. `packet --check` refuses a claim whose line range is not in the snapshot, refuses a pull request with a failing check, and refuses a pull request whose base is not the repo's default branch (a read of the default branch that fails exits 1). It reports pending checks and does not wait. `packet` and `land` wait for pending checks: they poll every 30 seconds for up to 15 minutes, then refuse. `APPROVAL_QUEUE_POLL_S` and `APPROVAL_QUEUE_POLL_MAX_S` override the two figures, for tests only.

When `gh pr diff` refuses a diff that contains terminal escape sequences, the command retries with `--allow-escape-sequences` and stores the patch with the C0 control bytes (other than tab and newline) removed.

## The item directory

The command writes `items/<id>/` under the state directory (`~/.local/state/approval-queue/` by default), and writes `item.json` last.

| File | Writer | Contents |
| --- | --- | --- |
| `item.json` | command | `{id, kind: "packet", title, initiative, created, pid, pidStart, revises?}` |
| `facts.json`, `text.md` | command | Copies of the checked files. |
| `snapshot/`, `heads.json` | command | The checked snapshot, and `[{ref, head}]`, the pinned heads that `merge` reads. |
| `prs/<k>.json` | command | `{ref, title, body, checks, files}` for the k-th pull request, with each file's `rank` ordering held paths, workflows, and configuration first and tests and generated files last. |
| `design.md`, `design.json` | command | A design packet: the copied design and its `{sha256, path}`, where `path` is the design file's full path. |
| `notes.json` | app | Geoff's notes, saved as he types. |
| `decision.json` | app | The decision. |
| `stale.json` | command | `{ref, queued, now}`, written when a head moved. |
| `replies.json` | command | The session's replies to the notes. |
| `merged.json` | command | `[{ref, head, at}]`, appended by `merge`. |

A design or triage item keeps its own layout. An item stored in an older shape opens read-only on the history page.

## The decision

The page has two buttons. Approve means "merge what was read," and Send back means "merge nothing." Each carries the notes Geoff wrote. A send-back with no note is refused. Approve holds for 5 seconds with an Undo toast before it posts, and Ctrl+Enter approves. On a stop packet the primary button reads "Answer and resume" and the page says "Pass parked until you answer." The decision is stored as `approve`, and answering merges nothing.

`decision.json` is `{decision, calls: [{call, choice, changed}], decidedForYou: [{call, choice, changed}], notes}`, where `call` counts from 1 in fact-file order. The command prints it with `parts` added: `[{ref, head}]` for pull requests, or `[{ref, sha256}]` for a design. It appends one line to `decisions.jsonl` for each decision, which holds `time`, `packet`, `initiative`, `kind`, `decision`, `calls`, `decidedForYou`, the number of notes, and `parts`.

The server refuses an approve whose pinned heads moved (409), or when `gh` cannot read a head (503), and a design whose file hash changed (409, "Out of date: the design changed since this packet was queued"). A design is read at the `path` its `design.json` records, whatever tree the server runs under; an unreadable or non-absolute path is a 503, "Could not read the design at <path>; nothing was recorded". A `design.json` with no `path` (queued before this change) is read under `APPROVAL_QUEUE_PROJECTS`. The waiting command also polls the heads every 60 seconds and writes `stale.json`, which the page shows as "Out of date." `merge` checks heads again, and `--match-head-commit` makes GitHub refuse a moved head in any case.

### Merge

`merge` refuses (exit 2) an item that is not decided, is not an approve, is marked out of date, is a design packet, or is a stop packet ("a stop packet is answered and never merged"). Before it merges anything, it reads each pull request's base branch against the repo's default branch (`gh repo view`) and refuses with exit 2 at any pull request based elsewhere, naming it, its base, and the default branch; `--skip` exempts a pull request from the check. A failed read exits 1 with no JSON line. For each pull request in `heads.json` order, it reads `gh pr view`. A pull request already merged at its pinned head counts as merged. A body with a `## Before merge` section needs the pull request in `--premerge-done`, or the command stops with exit 2 and prints the section. Otherwise it runs `gh pr merge <n> --repo <r> --merge --match-head-commit <head>`. It stops at the first failure with exit 1 and prints one JSON line listing the pull requests merged, failed, skipped, and not reached. A second run prints each merged pull request as merged and calls no merge.

### Land and digest

`land` refuses a pull request that sits in a waiting item, is closed, is not based on the repo's default branch (exit 2; a failed read of the default branch exits 1), has a `## Before merge` section, or has a failing check. It merges at the head it read, and appends `{time, ref, head, claim, lane: "land"}` to `digest.jsonl` in the state directory. `digest` refuses an open pull request and appends the same line with `lane: "record"`. Neither command judges a pull request's class: the session does.

## Notes and replies

Selecting text anywhere in the reading column, a diff line included, puts a draft card in the margin level with the selection. Pressing `n` or "Add note" starts the note, and Escape removes the draft. A note saves as Geoff types. A note is `{id, text, anchor}`:

- A prose anchor is `{section, quote, prefix, suffix, from, to}`. `from` and `to` index the section's text with LF line endings, end exclusive.
- A diff anchor is `{pr, file, side, line, text}` at the pinned head.
- A note on the whole packet has `anchor: null`.

The app re-places a prose anchor in four steps:

1. The offsets, if the text between them is still `quote`.
2. The one place where `prefix + quote + suffix` occurs.
3. The occurrence of `quote` nearest the old `from`.
4. Nowhere: the text is gone.

A diff anchor re-places by pull request, file, side, and line, then by the line's text.

After an approve, the session merges, then answers each note with `approval-queue reply <id> <replies.json>`, an array of `{note, outcome, text, ref}`. `outcome` is `fixed`, `filed`, or `answered`, and `ref` (a commit or a backlog item) is required for `fixed` and `filed`. After a send-back, the session fixes each note and sends the packet again with `--replies`. The command refuses a resend that leaves a note unanswered, finds the sent-back item by its pull request refs (or by the design's `repo` and `path`), and stores `revises: {item, revision}`. The page carries the earlier notes into the margin with their replies, marks each paragraph of the text that changed, and labels a note whose quote no longer occurs "This passage changed."

## The digest and history

The digest page groups `digest.jsonl` lines by repo, one claim each. Each line shows its replies and takes a note. The page shows no badge and no count. Digest notes save in `digest-notes.json` with ids `D1`, `D2`, and so on, and `approval-queue reply digest <replies.json>` answers them. The history page lists decided items newest first and has a search over titles. Each decided item opens with its notes and replies. A damaged sidecar file never hides a row.

The app appends `{time, item, fold}` to `folds.jsonl` each time a fold opens, for the monthly review of what Geoff reads.

## After a hand-over

**The pid.** Every `item.json` carries `pid` and `pidStart`: the command's process id and its start time in clock ticks since boot (field 22 of `/proc/<pid>/stat`). A pid counts as the waiting session only when `/proc/<pid>/stat` exists, its start time equals `pidStart`, and its state is not `Z`.

**Stop signals.** A TERM, HUP, or INT to a waiting command ends the wait and leaves `item.json` in place, so `collect` can recover a decision after a reboot. Only `withdraw` retires a waiting item.

**withdraw.** `approval-queue withdraw <id>` writes a `withdrawn` marker, sends TERM to the waiting command, and waits up to 5 seconds. The command's exit trap retires `item.json` when it finds the marker. When the waiter is already gone, `withdraw` retires the item itself. Retiring renames `item.json` away and then looks for a `decision.json`: if one landed first, the file is renamed back and the decision stands. `withdraw` exits 2 for an id that is not `YYYYMMDDTHHMMSS-<pid>`, an id with no `item.json`, a decided item, and an item with no `pid`.

**collect.** `approval-queue collect <id>` prints and logs the decision of an item whose queuing command is gone. It waits for `decision.json` when there is none yet. If the item is withdrawn while it waits, it prints `approval-queue: <id> was withdrawn; nothing to collect` on stderr and exits 1. The decision is logged once, however many commands print it.

**pending.** `approval-queue pending` lists the decisions that wait for a `collect`: one line per item with a `decision.json`, no live waiter, and no line in `decisions.jsonl`. A line is `<id>`, `<kind>`, `<decision>`, and `<title>` separated by tabs. It also prints `<id>\tnotes\t<count>\t<title>` for a decided packet whose notes have no reply, and `digest\tdigest-notes\t<count>\t-` when a digest note has no reply. A session answers the notes `pending` lists for its repos before it hands over.

**The claim.** Only a browser that claimed itself counts as Geoff's open tab. Open `/claim` and press "Claim this browser." The button makes `claim.token` in the state directory and sets the `desk-claim` cookie. Loading `/claim` sets nothing, so an agent's page load never claims a browser.

## Cutover

The new build refuses the old packet format, so it goes live only with an empty queue: `approval-queue pending` prints nothing, and every `items/*/item.json` has a `decision.json` beside it. After the merge and the pull, run `approval-queue restart`. For about a second during the swap no server answers, and the new server takes the caller's environment. The check is that `approval-queue/build/index.js` is newer than the merge commit, and that `approval-queue merge 00000000T000000-1` exits 2.

## Gate

```sh
bash scripts/gate.sh
```

The gate runs the app's `check` and `test`, then every `tests/*.test.sh`, including the install test (which uses a temp `HOME`) and `tests/page.test.sh`, which builds a copy of the app on a random port and reads the stop, close, design, and out-of-date pages.

## History

The code arrived from `glw907/workstation` with its history, including the `review-desk` era names.

## Home-grown parts

Every screen takes its stock DaisyUI class first, with overrides that keep the 2026-11-10 prototype's look. These parts stay home-grown, each for the defect that stock part has here:

- **The packet page's grid (`PacketPage.svelte`, `packet.css`).** The reading column, the notes margin, and the queue rail are three tracks of one grid whose widths are the prototype's (46rem of text, a margin beside it). No stock component lays out a page, and `drawer` and `hero` are not columns. Below 1180px the margin drops under the column.
- **A claim's closed line (`PacketFold`'s `claim` title).** The fold is a stock `collapse`. Only its title takes the reading face and a second line (`.sub`) that says what is inside, which the stock `collapse-title` has no slot for.
- **The call card (`CallCard.svelte`).** The card is a bordered box holding stock `radio` inputs, `badge`, `btn`, and a `collapse`. A stock `card` is a media layout with a body and actions. Stock `fieldset` and `join` do not make the radio an option row with a consequence under its label and a "Session's pick" badge. The row is a `label`, so the whole row is the target.
- **A note card in the margin (`NotesMargin.svelte`, `NoteCard.svelte`).** The card holds a stock `textarea`, `btn`, and `badge`. The box is home-grown because a stock `card` is a media layout with a body and actions, and `chat` and `toast` are not boxes that sit at a passage's line. `margin-stack.ts` stacks the boxes so none covers another, and each card takes its place from where its passage is now, which no stock component does.
- **The passage highlight (`::highlight(note)`).** A note's passage is painted with the CSS Custom Highlight API. The stock `mark` would need wrapper elements inside text that Svelte renders, and the next render would drop them. A browser without the API shows no highlight, and the card still quotes the passage.
- **The decision bar (`.bar`, `.barwrap`).** Stock `navbar` and `dock` are page chrome. The bar is a sticky strip at the foot of the column that carries the counts and two stock `btn`s.
- **The rail's wordmark and menu rows (`+layout.svelte`, `frame.css`).** The rail is a stock `menu`. Only the Spectral wordmark with its benchmark triangle, the muted second line under each entry, and the active entry's fill are home-grown, because the stock `menu-title` and `menu` row carry no wordmark and hold one line of text. Below 1180px the rail is hidden, as in the prototype, so a small "Keyboard shortcuts" button stays at its foot: `?` is a single key, and with single keys off the sheet that turns them on would otherwise be out of reach.
- **The digest note form (`routes/digest/`).** Each digest line is a stock `collapse` holding a stock `textarea` and `btn` in a small form. Nothing stock holds a note per line of a list.
