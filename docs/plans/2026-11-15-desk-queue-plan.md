# Desk pass plan: record an answer from chat

Initiative: unattended-rounds
Round: desk (one pass, no conductor)
Pass: desk-queue

Design: `~/Projects/initiatives/.claude/worktrees/unattended-rounds/unattended-rounds/specs/2026-11-15-desk-design.md`, approved by Geoff in the queue on 2026-11-16 at 00:16Z (document `20261116-001550-de8f7c`), with its two amendments of 2026-11-16. The executor reads it in full: "How your word gets recorded", "The rules that change" (the queue half), "How each pass is checked", "Stops and their answers", and "Amendments".

Worktree: `~/Projects/approval-queue/.claude/worktrees/desk-queue`, branch `desk-queue`, cut from `origin/main` at `4616ae8` (PR #25 merged). Pull request base: `main`. The planner commits this plan, its prompt, the backlog rewording, and the test fixture on `desk-queue` and pushes them before the launch. Class: `runner`, the class every pass of this repo has taken for `decide.server.ts`, the API route, and `cli/` (A4 plan, line 9). Executor: `approval-queue-desk-queue`, `sonnet` at `medium` with the Fable advisor. Every call below is settled, so the work is mechanical.

## Pre-flight

No step needs Geoff before the launch. The design lists none, and this pass needs no new setting, secret, sign-in, hook, or permission rule. The existing rule that lets a session run `approval-queue` covers `list` and `answer` (design, "Stops and their answers").

Permissions checked: read `~/.local/state/claude-denials.jsonl` on 2026-11-15 against every command in the tasks below. It holds 73 rows, dated 2026-11-01 to 2026-11-15: Self-Modification 10, refused by the server-side classifier with no class shown 10, Interfere With Workloads 9, "Classifier unavailable" 9, Destructive or Unwanted Actions 5, Merge Without Review 3, Auto-Mode Bypass 3, two each of Irreversible Local Destruction, Git Destructive, Create Public Surface, Unverifiable Deletion Scope, Sensitive-Source Provenance, Security Weaken, and Undermining Oversight, and one each of Production Deploy, Secret-Store Writes, DNS / Domain / Cert Changes, Bot Check Circumvention, Code from External, Shared Scratch Sweep, Safety Bypass Flag, Out-of-Place Publication, PII Data Handling, and Modify Shared Resources. Five classes touch this pass. PII Data Handling: a broad grep over `~/.claude/projects` (2026-11-12). This pass never reads that directory: the planner cut the fixture and committed it, and every test points `CLAUDE_CONFIG_DIR` at a `mkdtemp` folder (rule 5). Interfere With Workloads, Destructive or Unwanted Actions, and Undermining Oversight: `kill`, `pkill`, and `claude stop` typed into the Bash tool. This pass types none of them; a server is a child of the check script that started it (rule 6). Merge Without Review: a typed `gh pr merge`. This pass merges only through `approval-queue merge` on Geoff's approve (rule 7). Self-Modification: edits to `settings.json`. This pass touches no setting and no file under `.claude/`. The post-merge launch of the workstation planner is a `claude --bg` launch from a committed prompt file, the same form this planner used to launch the executor; no row names one. No row names `npm ci`, `npm run check`, `npm test`, `npm run build`, `node approval-queue/tests/decide-checks.mjs`, `vale`, `tellgrader`, `scripts/gate.sh`, `gh pr create`, `gh pr ready`, `approval-queue check`, `approval-queue send`, `approval-queue merge`, or `approval-queue restart`. "Refused commands" gives the answer for each.
Reviewed: one `standards:plan-reviewer` read, recorded under "Review record".
Evidence: the mechanism table and the recorded searches below. Every row is a probe this planner ran on 2026-11-15 or a quoted source line.

Run `npm ci --prefix approval-queue` first. The baseline is PR #25's merge: `bash scripts/gate.sh` green on `4616ae8`. Run every gate and test with `TMPDIR=$CLAUDE_JOB_DIR/tmp`.

## What the pass changes

The queue gains two commands. `approval-queue list` prints the waiting documents, and `list --wait` stays running until a new one arrives. `approval-queue answer` records Geoff's decision on a waiting document from his words in the desk session's chat. It refuses unless it runs in the session named `desk`, the words sit in a message Geoff entered there, and he entered it after the document's latest version arrived. The page and the command record through one function. A chat decision stores three more fields, and the decided page shows "Recorded from chat" with Geoff's whole message. Nothing Geoff uses changes until the pull request merges and the queue restarts.

## The interface

The workstation pass builds the desk on this table, so the executor changes none of it without a `## Decisions` line and a matching edit here.

| Form | What it does | Exit |
| --- | --- | --- |
| `list` | Prints one line per waiting document, oldest first: `<id>`, a tab, the kind (`-` for none), a tab, the title. An unread report is waiting and prints with the kind `report`. | 0, 1 a store failure |
| `list --wait` | Takes the ids waiting at its start as the baseline, then reads the store once a second. An id that leaves waiting drops out of the baseline, so a returned revision counts as new. Exits once a waiting id is outside the baseline, after printing that document's line. | 0 a new document, 1 a store failure |
| `answer <id> approve --words <text> [--pick <label>=<n>]...` | Records an approve with each pick, after the three checks. | 0 recorded, 1 refused, 2 usage |
| `answer <id> sendback --words <text> --note <text> [--passage <text>]` | Stores the note as Geoff's, then records the send-back, after the three checks. | 0 recorded, 1 refused, 2 usage |
| `answer --new <doc.md> approve --words <text> [--pick <label>=<n>]...` | Checks and stores a `decide` document, then records the approve. Runs the first two checks, never the third. Opens no page and waits for nothing. Prints the new id. | 0 recorded, 1 refused, 2 usage |

- `<label>` is a question's label exactly as its `:::question` line gives it. `<n>` is the option's number, from 1, in the document's order.
- On success `answer` prints one line on stdout: `recorded <action> on <id>`. A refusal prints one line on stderr that starts `approval-queue: ` and names the check that failed. The desk relays that line.
- A chat decision record gains `via: "chat"`, `message` (the whole message text, pastes included), and `session` (the session id). A page decision record is unchanged.
- A chat note record is `{ op: "open", who: "geoff", via: "chat", quote, version, text, at }`.

## Rules that bind every task

1. Files: `approval-queue/src/lib/components/decide.server.ts`, `types.ts`, `Document.svelte`, and their tests; `approval-queue/src/lib/strings.ts`; `approval-queue/cli/` (new `answer.ts`, `words.ts`, `list.ts`, their tests, `main.ts`, `wait.ts`); `approval-queue/tests/decide-checks.mjs`; `docs/mockup/src/lib/components/Document.svelte`; `README.md`; `docs/STATUS.md`; and `BACKLOG.md` for follow-ups only. Never touch the route file `approval-queue/src/routes/api/[id]/+server.ts` (it keeps calling `post()`), the fixture, any file under `.claude/`, or any file outside the repo before the merge.
2. Code comments follow TSDoc (`standards:ts-conventions`, `standards:svelte-conventions`). No em dash in a comment, a commit, or the pull request body.
3. After each task, run `npm run check --prefix approval-queue` and `npm test --prefix approval-queue`. After tasks 5 and 6 and at the close, run `bash scripts/gate.sh`. Every run is bare, with the Bash tool's `timeout: 600000` and `TMPDIR=$CLAUDE_JOB_DIR/tmp`. A red stops the line: fix forward or revert. Commit per task with named files, never `git add -A`.
4. Every store a test or a command run uses is a `mkdtemp` folder, passed as `APPROVAL_QUEUE_STATE`. Before the merge, never run the installed `approval-queue` except the close's `check`, `send`, and `merge` of the pass's own document, and never touch `~/.local/state/approval-queue/` or the server on port 7907.
5. Never read `~/.claude/projects` or `~/.claude/jobs` other than your own job folder. A test that needs a session record copies `approval-queue/cli/fixtures/desk-record.jsonl` into `<mkdtemp>/projects/-fixture/<session id>.jsonl` and sets `CLAUDE_CONFIG_DIR=<mkdtemp>`. A test that needs `claude agents --json` puts a stub `claude` first on `PATH`, as `cli/land.test.ts:54` does for `gh`. Never call the real `claude agents` from a test.
6. A server runs only as a child of `approval-queue/tests/decide-checks.mjs`, on its port 7955. Never type `kill`, `pkill`, or `claude stop`; a background command ends through `TaskStop`.
7. `gh` runs against a real repository only for this pass's pull request: `gh pr create --draft`, `gh pr edit`, `gh pr ready`, and `gh pr view`. The merge is `approval-queue merge <id>` on Geoff's approve.
8. The new page string, the `--words` refusals, and every person-read sentence in the README rows follow `~/.claude/docs/voice/written-for-people.md`: all four steps for a page string or a queue document, steps 1 to 3 for the README, the PR opening, and STATUS. The page string passes `vale` (Microsoft) and `tellgrader --register docs` with no finding (`.claude/rules/pages.md`).

## Planner's calls

Calls 1 to 4 depart from the design's text because the probes found marks it didn't know. Each is the nearest reading that still accepts only messages Geoff entered, as the design's stop says, and each goes under `## Calls for Geoff` in the pull request.

1. **The accept rule is a conjunction.** An entry counts as Geoff's only when all of these hold: `type` is `user`; `promptSource` is `typed`, `suggestion_accepted`, or `queued`; `turnOrigin` is the string `human`; `origin.kind` is `human`; `isMeta`, `isCompactSummary`, and `isSidechain` are not `true`; and `message.content` is a string. The design said "has a `promptSource`", but `system` and `sdk` entries have one too, and a compaction summary carries `turnOrigin: human` with none (mechanisms 1 and 2). Any other entry is refused, so a change in Claude Code's marks makes the command refuse everything, as the design says.
2. **The launch prompt never counts.** The first entry in the record that has an allowed `promptSource` is never accepted. A `claude --bg` launch prompt, which another session writes, carries `typed`, `human`, and `origin.kind: human` (mechanism 5). The cost: in a desk opened with no prompt, Geoff's first message is refused and he says it again. The workstation pass gets a note: open the desk with a prompt, so the first entry is the launcher's.
3. **A queued message is entered when it is enqueued.** A `queued` entry's `timestamp` is when the session took it up, 0.1 to 86 seconds after Geoff typed it (mechanism 6). Its entered time is the `timestamp` of the latest `queue-operation` record before it with `operation: "enqueue"` and `content` equal to the entry's text. With no such record, the entry is refused.
4. **Words inside a paste don't count.** The words, and a send-back's note, must sit in the message's text with every `<pasted_content id="X">...</pasted_content id="X">` block removed (mechanism 4). The decision still stores the whole message, pastes included.
5. **The latest version's arrival** is the `at` of the newest `returned` record, else `meta.created`. `send --returns` writes the version, then the `returned` record (mechanism 10), so the record's time is never earlier than the version.
6. **Matching.** The words are trimmed and must be at least one character. They match as an exact, case-sensitive substring. Among accepted entries entered after the latest version arrived, the newest holding the words wins. With none, the refusal says the words were entered before the latest version when an accepted entry before it holds them, and says no message Geoff entered holds them otherwise.
7. **One recording function.** `decide()` in `decide.server.ts` becomes an exported `record(root, id, action, picks, extra?)` that does every check `decide()` does today and returns whether it wrote. `post()` calls it and answers as today. The command refuses when it didn't write, which covers the case where the same action is already recorded and `decide()` answers 200 with no write (mechanism 8).
8. **Picks come from `--pick` only.** The command never reads `answers.json`. A pick for an unknown label or an option number out of range is refused. The shared function refuses an approve with an unanswered question, with the page's sentence.
9. **A send-back from chat.** `--note` is required and must sit in the same message as the words, outside pastes. The note is written first, then the decision, because the shared function refuses a send-back with no note waiting. The note's `quote` is `--passage` when given, which must appear in the newest version's text after `normalize`; otherwise it is the document's title. If the decision is then refused, the note stays, as a note written on the page does.
10. **`--new`** accepts a document of kind `decide` only, and only `approve`. It runs `check` on the file (a `decide` document has no pull request, so no `gh` call), stores it with `createDocument`, and records. The first two checks run before anything is stored.
11. **The session.** The id is `CLAUDE_CODE_SESSION_ID`; empty refuses. The name is the `name` of the one `claude agents --json` row whose `sessionId` equals it; no row, a failed command, or a name other than `desk` refuses. The record is the one file matching `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/*/<id>.jsonl`; none or more than one refuses. A line that isn't JSON is skipped.
12. **The page line.** `view()` copies `via` and `message` when `via` is `chat` and `message` is a string; `DecisionView` gains both as optional. The decided panel shows `DOC.fromChat` ("Recorded from chat") and the message as text, line breaks kept, never as HTML. The mockup's `Document.svelte` changes first. Geoff's approve of the merge document covers the mockup change, and the document says so.
13. **No `read` from chat.** `answer` takes `approve` and `sendback`. Marking a report read stays on the page. This goes in the PR's Later list.
14. **The backlog rewording.** The design approved "two points are closed, three remain" for #74. The code shows all five points open (Document.svelte:99-103, :98, :225-230, :272-274, :274; decide-checks.mjs:433-500), so the planner's commit `c471bbe` says so. The PR lists this under `## Calls for Geoff`.

## Tasks

The tasks run in order, in this session. Tasks 2 and 4 have disjoint files, but both need `main.ts` and `wait.ts`, so they don't pair.

### Task 1. One recording function

Outcome: call 7. `record()` is exported and `post()` calls it; no page behavior changes.
Files: `decide.server.ts` and its test. Class: `runner`.
Acceptance check: `npm test --prefix approval-queue` passes with every existing test file unchanged (`git diff --stat 4616ae8 -- '*.test.ts' tests/` shows only new files), and `grep -n "record(" approval-queue/src/lib/components/decide.server.ts` shows `post()` calling it. A new test calls `record()` twice with the same action and gets "wrote" then "didn't write".
Test: the new vitest case above, plus an approve with an `extra` of the three chat fields that finds them in the decision file.
Estimate: 15 minutes.

### Task 2. Finding Geoff's words

Outcome: calls 1 to 6 and 11 as `cli/words.ts`, which returns the matched entry (its text and entered time) or a refusal sentence.
Files: `cli/words.ts`, `cli/words.test.ts`. Class: `runner`.
Acceptance check: each fixture row's words give the result its row in `cli/fixtures/README.md` implies, with the document arriving at 10:05: the launch, tool, peer, summary, notice, shell, and paste words refuse as not entered by Geoff; the early and queued words refuse as entered before the latest version; the suggested words and `approve it` match. With a `returned` record at 10:11:30, the suggested words refuse as before the latest version and `approve it` still matches. A record with the marks renamed (a copy with `promptSource` changed to `prompt`) matches nothing.
Test: the cases above, plus empty words, no session id, a stub `claude` with no matching row, a row named `desk-2`, no record file, and two record files.
Estimate: 30 minutes.

### Task 3. `answer`

Outcome: the three `answer` forms in the interface table, calls 8 to 10, and the dispatch in `main.ts` with `USAGE` in `wait.ts`.
Files: `cli/answer.ts`, `cli/answer.test.ts`, `cli/main.ts`, `cli/wait.ts`. Class: `runner`.
Acceptance check: acceptance items 3 and 4, each through `node approval-queue/cli/index.js answer` as a child process with a `mkdtemp` store, the copied fixture, and the stub `claude`. The approve case reads the decision file and finds `via`, the whole message `Read it through, looks right. approve it`, the session id, and each `--pick`. Each refusal case finds no new decision file. The already-decided case covers both the same action and the other one.
Test: the cases above, plus a send-back whose note record is Geoff's with `via: "chat"` and the title as its quote; a `--note` outside the message refused; a `--new` approve that prints the new id and records with the words entered at 10:00 skipped only as the launch prompt; a `--new` document of kind `merge` refused; and `notes.test.ts:139`'s `USAGE` check still passing.
Estimate: 35 minutes.

### Task 4. `list` and `list --wait`

Outcome: the two `list` forms in the interface table.
Files: `cli/list.ts`, `cli/list.test.ts`, `cli/main.ts`, `cli/wait.ts`. Class: `runner`.
Acceptance check: acceptance items 1 and 2. A store with one waiting, one decided, and one withdrawn document prints one line with the waiting id, its kind, and its title. `list --wait` started on it is still running after 2 seconds, then exits 0 within 3 seconds of a test storing a new document, and again for a new report, which `list` prints with the kind `report`. A document that was waiting at the start, sent back, handed, and returned wakes it too.
Test: the cases above, each with a 10-second limit on the child.
Estimate: 15 minutes.

### Task 5. The decided page

Outcome: call 12, mockup first.
Files: `docs/mockup/src/lib/components/Document.svelte`, then `strings.ts`, `types.ts`, `decide.server.ts`, `Document.svelte`, and their tests. Class: `runner`.
Acceptance check: the mockup commit lands before the app commit, and its decided panel shows "Recorded from chat" and a quoted message under the "You approved this" line. A vitest case finds `via` and `message` in `get()`'s answer for a chat decision and neither for a page decision. `strings.test.ts` passes. `vale` and `tellgrader --register docs` print no finding on the new string.
Test: the vitest case above.
Estimate: 20 minutes.

### Task 6. The screenshot

Outcome: acceptance item 6.
Files: `approval-queue/tests/decide-checks.mjs`. Class: `runner`.
Acceptance check: a new check 8 seeds a document, runs `answer` as task 3's tests do against the check's store, opens `/d/<id>`, asserts the panel holds "Recorded from chat" and the whole message, and screenshots it to `.playwright-mcp/a4/check-8-chat.png`. The check prints `FAIL` when the line is removed from `Document.svelte`, and `ok` with it. The executor reads the screenshot.
Test: the check, run with `npm run build --prefix approval-queue` first and `PLAYWRIGHT_CORE` and `CHROMIUM` set as the file's header says.
Estimate: 10 minutes.

### Close

1. `bash scripts/gate.sh` green on the head commit, then `node approval-queue/tests/decide-checks.mjs` on a fresh build.
2. One whole-branch `standards:diff-reviewer` read against the design and this plan, then one batched fix chain and the gate again. A second read runs only on a blocker.
3. README: two rows in "The commands" for `list` and `answer`, in the table's form, and one paragraph on the three checks. STATUS: present tense, 60 lines or fewer, naming this pull request and dropping the stale "PR #24 pending" line.
4. The pull request body opens with a paragraph per rule 8, then what landed, `## Acceptance` with evidence under each item, `## Decisions`, `## Calls for Geoff` (calls 1 to 4 and 14, and any advisor choice), `## Planning misses`, the Later list, and the score.
5. Hand it over through `approval-packet` as a `merge` document, whatever the review says. It never lands without one. The document asks Geoff to approve calls 1 to 4 and the mockup change. On approve, run `approval-queue merge <id>`, then the post-merge steps. On send-back, follow `approval-packet` step 6.
6. Post-merge: pull the main checkout as `pass-core` "Close" says, run `approval-queue restart`, and confirm `approval-queue list` exits 0. Then launch the workstation planner from `~/.dotfiles` with `claude --bg --model claude-opus-5-5 --effort high --advisor fable --name workstation-desk-ws-plan "$(cat ~/Projects/initiatives/.claude/worktrees/unattended-rounds/unattended-rounds/plans/desk-ws-planning-prompt.txt)"`, and read its `~/.claude/jobs/<id>/state.json`: `needs: "send a prompt to start"` is a failed launch. Send that planner one message naming calls 1 to 4, the interface table, and call 2's note on the launch prompt. Then remove the worktree and branch as `pass-core` "Close" says.

Estimate: 25 minutes, not counting Geoff's read.

## Path

Tasks 1 to 6 and the close run in sequence: 15 + 30 + 35 + 15 + 20 + 10 + 25 = 150 minutes. The amended design estimate is 130, and the park line is 260. The 20 over is task 2's four marks the design didn't know.

## Acceptance

| Item, verbatim | Task | Evidence |
| --- | --- | --- |
| With one waiting, one decided, and one withdrawn document in a test store, `approval-queue list` prints one line, for the waiting one, with its id, its kind, and its title, and exits 0. | 4 | `list.test.ts` case and its output |
| `approval-queue list --wait` keeps running on that store and exits when a test stores a new document. It also exits when the new document is a report, and `list` prints an unread report with the kind `report`. | 4 | `list.test.ts` cases |
| A test gives the command a session record cut from a real one, never written by hand, in which a message entered after the document arrived holds "approve it". The command records an approve. The decision file holds the whole message, the three new fields, and each answer the command was given. | 3 | `answer.test.ts` approve case on `cli/fixtures/desk-record.jsonl` |
| The command refuses, and writes no decision file, in each of these cases: the session isn't named `desk`; the words are in no entry; the words are only in a message from another session, a tool's output, or a compaction summary; the words were entered before the document's latest version arrived; a question is unanswered; the document is already decided. | 2, 3 | one `answer.test.ts` case per bullet, each checking the decision files |
| A decision made on the page writes the same file it writes today, the existing tests pass unchanged, and a search shows the page's route and the command calling the same function to record it. | 1, 3 | the unchanged test files, and `grep -rn "record(\|post(" approval-queue/src approval-queue/cli` showing the route's `post()` and `answer.ts` reaching `record()` |
| A screenshot of the running app shows a decision the command wrote, with "Recorded from chat" and the whole message. | 6 | `check-8-chat.png`, attached to the PR body |
| `bash scripts/gate.sh` passes. | Close | the gate's `gate: ok` on the head commit |

## Mechanisms

| # | Mechanism | Probe or source |
| --- | --- | --- |
| 1 | Prompt marks | A tally of `type: user` entries across 3,318 session records from the last 30 days: `promptSource` takes `typed`, `suggestion_accepted`, and `queued` with `turnOrigin: human`; `system` with `turnOrigin` `peer`, `task_notification`, `scheduled`, or `system`; and `sdk`. |
| 2 | Compaction summaries | 277 entries carry `isCompactSummary: true`, `turnOrigin: human`, and no `promptSource`. |
| 3 | Shell output | 129 entries carry `turnOrigin: human`, no `promptSource`, and string content starting `<bash-stdout>` (record `47ae6313-...`, entry `59fca834-...`). |
| 4 | Pastes | A pasted message is `typed` and `human`, its content holding `<pasted_content id="N">...</pasted_content id="N">`, with the id on both tags (record `e69530ba-...`, entry `ab25311e-...`). |
| 5 | Launch prompts | Every record's first prompt entry is `typed` (335 background, 153 interactive) but one `suggestion_accepted`; none has a null `parentUuid`. This session's own launch prompt, written by the design session, is `typed`, `human`, `origin.kind: human`. |
| 6 | Queued messages | 16,963 `queue-operation` records with `operation: enqueue`. 134 of 151 `queued` entries match an enqueue record by content; the entry's time trails it by 0.1 to 86 seconds, median 4.1. |
| 7 | Session id and name | `CLAUDE_CODE_SESSION_ID` is set in this session's Bash; `claude agents --json` printed 9 rows, one with that `sessionId` and `name: approval-queue-desk-queue-plan`. Row keys: `cwd`, `id`, `kind`, `name`, `pid`, `sessionId`, `startedAt`, `state`, `status`. |
| 8 | Same action twice | `decide.server.ts`: `if (before.decision.action === body.action) return ok(before);`, which answers 200 and writes nothing. |
| 9 | The page's view | `decide.server.ts` `view()` copies only `action`, `at`, and `answers`, so a new field needs a line there. |
| 10 | Version arrival | `cli/send.ts:144` calls `addVersion`, then `:151` writes `{ action: 'returned', at: new Date().toISOString(), version }`. `Meta` holds `id`, `kind`, `title`, `created`, and `versions` (`store.ts:19-25`). |
| 11 | Notes | `writeNote` appends the record as given (`notes.server.ts:128`); its reader checks `who` against `geoff` and `claude` and keeps other fields (`:136-149`). |
| 12 | Usage | `main.ts` checks a `wanted` argument count per command; `USAGE` is in `wait.ts:5`; `notes.test.ts:139` checks it starts `usage: approval-queue check|send <doc.md>`. |
| 13 | Stub commands | `land.test.ts:54` runs the command with `PATH: \`${dir}:${process.env.PATH}\``, a stub `gh` first. |
| 14 | Page checks | `decide-checks.mjs` serves on port 7955, reads `PLAYWRIGHT_CORE` and `CHROMIUM`, and screenshots to `.playwright-mcp/a4/`. |
| 15 | Mockup first | `.claude/rules/pages.md`: "To change what a page looks like or says, change the mockup first and get Geoff's approval for it." The mockup's decided panel is `docs/mockup/src/lib/components/Document.svelte:193-200`. |
| 16 | The fixture | `approval-queue/cli/fixtures/desk-record.jsonl`, 13 lines, 6,860 bytes, cut by the planner. A grep for `glw907`, `/var/home`, `token`, `key`, and a real name finds 0 hits; `origin` holds only `kind`, `producer`, and `handback`. |
| 17 | Poll interval | `wait.ts`: `const POLL_MS = 1000;`. |

## Recorded searches

1. `grep -rn "decide(" approval-queue/src approval-queue/cli`: 6 hits. `Document.svelte:182, :437, :473, :489` are the page's own `decide()` that posts to the route, dismissed. `decide.server.ts:170` is the function call 7 turns into `record()`, and `:291` is `post()` calling it.
2. `grep -rn "USAGE" approval-queue/cli approval-queue/src`: 9 hits in `main.ts:1, :9`, `land.ts:6, :44`, `notes.test.ts:9, :139, :141`, and `wait.ts:5, :14`. Only `wait.ts:5` changes; the `notes.test.ts` checks keep passing because the new forms go at the end.
3. `grep -rln "DecisionView" approval-queue/src approval-queue/cli`: 2 files, `decide.server.ts` and `types.ts`. Both change in task 5.
4. `grep -rn "CLAUDE_CODE_SESSION_ID\|CLAUDE_CONFIG_DIR\|claude agents" approval-queue/src approval-queue/cli approval-queue/tests approval-queue/scripts README.md`: 0 hits, so nothing reads a session today.
5. `grep -n "case '" approval-queue/cli/main.ts`: 9 hits, one per command. Tasks 3 and 4 add two.

## Refused commands

| Command | Answer |
| --- | --- |
| `npm ci`, `npm run check`, `npm test`, or `npm run build` with `--prefix approval-queue` | Run it once more, alone. A second refusal is a stop. |
| `node approval-queue/tests/decide-checks.mjs` | The same. If the refusal names the server, check that the script binds only 7955, reads only its `mkdtemp` store, and ends only what it started; fix that, then once more. |
| `node approval-queue/cli/index.js answer` or `list` as a test's child | The same. |
| A read of `~/.claude/projects` | Never typed. Use the fixture. |
| A `kill`, `pkill`, or `claude stop` | Never typed. A server left running means the script's `finally` failed: fix the script. |
| `gh pr create`, `edit`, `ready`, or `view` on this pass's PR, or `git push` to `desk-queue` | Run it once more. A second refusal is a stop. |
| `approval-queue check`, `send`, `merge`, or `restart` at the close | Run it once more. A second refusal is a stop. |
| The `claude --bg` launch of the workstation planner | Run it once more. A second refusal: write the launch command into STATUS as the next action and report it in the close line. |
| `vale` or `tellgrader` | Run it once more. A second refusal is a stop. |

## Stops and standing answers

| Stop | Standing answer |
| --- | --- |
| The path passes 260 minutes | Park: commit, push, write the stop in STATUS, send a `decide` document through `approval-packet`, and end. |
| The fixture's marks don't match a mark the code needs | Never read a real record. Take the advisor's nearest reading that accepts only Geoff's entered messages, and list it under `## Calls for Geoff`. |
| A task needs a setting, hook, or permission rule | It doesn't get one. Stop as "What always stops" says. |
| A task needs a file outside rule 1 | The README, STATUS, and backlog edits are listed. Anything else goes through the advisor, and a file in another repo is a stop. |
| `strings.test.ts` fails on the new markup | Move the words into `strings.ts`; the test is right. |
| The reviewer asks for a change to the interface table | Make it, edit the table here, and list it under `## Decisions` and in the message to the workstation planner. |
| Geoff sends the merge document back | Follow `approval-packet` step 6: answer each note, fix forward, return with `send --returns`. |
| `approval-queue restart` or `list` fails after the merge | Fix forward in a new branch as a direct change if it fits one sentence, else report it as the close line and leave the planner unlaunched. The page still takes answers. |

## Review record

Pending: one `standards:plan-reviewer` read.
