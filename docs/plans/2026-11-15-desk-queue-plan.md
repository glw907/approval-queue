# Desk pass plan: record an answer from chat

Initiative: unattended-rounds
Round: desk (one pass, no conductor)
Pass: desk-queue

Design: `~/Projects/initiatives/.claude/worktrees/unattended-rounds/unattended-rounds/specs/2026-11-15-desk-design.md`, approved by Geoff in the queue on 2026-11-16 at 00:16Z (document `20261116-001550-de8f7c`), with its two amendments of 2026-11-16. It is committed on the initiatives branch `unattended-rounds` at `fe6c4da`. If the worktree file is missing, read it with `git -C ~/Projects/initiatives show unattended-rounds:unattended-rounds/specs/2026-11-15-desk-design.md`. The executor reads it in full: "How your word gets recorded", "The rules that change" (the queue half), "How each pass is checked", "Stops and their answers", and "Amendments".

Worktree: `~/Projects/approval-queue/.claude/worktrees/desk-queue`, branch `desk-queue`, cut from `origin/main` at `4616ae8` (PR #25 merged). Pull request base: `main`. The planner commits this plan, its prompt, the backlog rewording, and the test fixture on `desk-queue` and pushes them before the launch. Class: `runner`, the class every pass of this repo has taken for `decide.server.ts`, the API route, and `cli/` (A4 plan, line 9). Call 15 flags the class for Geoff. Executor: `approval-queue-desk-queue`, `sonnet` at `medium` with the Fable advisor. Every call below is settled, so the work is mechanical.

## Pre-flight

No step needs Geoff before the launch. The design lists none, and this pass needs no new setting, secret, sign-in, hook, or permission rule. The existing rule that lets a session run `approval-queue` covers `list` and `answer` (design, "Stops and their answers").

Permissions checked: read `~/.local/state/claude-denials.jsonl` on 2026-11-15 against every command in the tasks below. It holds 73 rows, dated 2026-11-01 to 2026-11-15: Self-Modification 10, refused by the server-side classifier with no class shown 10, Interfere With Workloads 9, "Classifier unavailable" 9, Destructive or Unwanted Actions 5, Merge Without Review 3, Auto-Mode Bypass 3, two each of Irreversible Local Destruction, Git Destructive, Create Public Surface, Unverifiable Deletion Scope, Sensitive-Source Provenance, Security Weaken, and Undermining Oversight, and one each of Production Deploy, Secret-Store Writes, DNS / Domain / Cert Changes, Bot Check Circumvention, Code from External, Shared Scratch Sweep, Safety Bypass Flag, Out-of-Place Publication, PII Data Handling, and Modify Shared Resources. Five classes touch this pass. PII Data Handling: a broad grep over `~/.claude/projects` (2026-11-12). This pass never reads that directory: the planner cut the fixture and committed it, and every test points `CLAUDE_CONFIG_DIR` at a `mkdtemp` folder (rule 5). Interfere With Workloads, Destructive or Unwanted Actions, and Undermining Oversight: `kill`, `pkill`, and `claude stop` typed into the Bash tool. This pass types none of them; a server is a child of the check script that started it (rule 6). Merge Without Review: a typed `gh pr merge`. This pass merges only through `approval-queue merge` on Geoff's approve (rule 7). Self-Modification: edits to `settings.json`. This pass touches no setting and no file under `.claude/`. The post-merge launch of the workstation planner is a `claude --bg` launch from a committed prompt file, the same form this planner used to launch the executor; no row names one. No row names `npm ci`, `npm run check`, `npm test`, `npm run build`, `node approval-queue/tests/decide-checks.mjs`, `vale`, `tellgrader`, `scripts/gate.sh`, `gh pr create`, `gh pr ready`, `approval-queue check`, `approval-queue send`, `approval-queue merge`, or `approval-queue restart`. "Refused commands" gives the answer for each.
Reviewed: one `standards:plan-reviewer` read (Opus, medium) on `c788e56`: 1 blocker, 15 should-fix, 11 nits. All folded in the commit that adds this line, two of them as calls for Geoff (calls 5 and 15). "Review record" lists each.
Evidence: the mechanism table and the recorded searches below. Every row is a probe this planner ran on 2026-11-15 or a quoted source line.

Run `npm ci --prefix approval-queue` first. The baseline is PR #25's merge: `bash scripts/gate.sh` green on `4616ae8`. Run every gate and test with `TMPDIR=$CLAUDE_JOB_DIR/tmp`.

## What the pass changes

The queue gains two commands. `approval-queue list` prints the waiting documents, and `list --wait` stays running until a new one arrives. `approval-queue answer` records Geoff's decision on a waiting document from his words in the desk session's chat. It refuses unless it runs in the session named `desk`, the words sit in a message Geoff entered there, and he entered it after the document's latest version arrived. The page and the command record through one function. A chat decision stores three more fields, and the decided page shows "Recorded from chat" with Geoff's whole message. Nothing Geoff uses changes until the pull request merges and the queue restarts.

## The interface

The workstation pass builds the desk on this table, so the executor changes none of it without a `## Decisions` line and a matching edit here.

| Form | What it does | Exit |
| --- | --- | --- |
| `list` | Prints one line per waiting document, oldest first: `<id>`, a tab, the kind (`-` for none), a tab, the title. An unread report is waiting and prints with the kind `report`. A document the store can't read, or whose decisions it can't read, prints one stderr line `approval-queue: <id>: <reason>` and is skipped. | 0, 1 a store failure (the store folder can't be listed) |
| `list --wait` | Takes the ids waiting at its start as the baseline, then reads the store once a second. An id that leaves waiting drops out of the baseline, so a returned revision counts as new. Exits once a waiting id is outside the baseline, after printing that document's line. An Undo on the page also brings a document back as new; the desk takes that as a document to raise again. | 0 a new document, 1 a store failure |
| `answer <id> approve --words <text> [--pick <label>=<n>]...` | Records an approve with each pick, after the three checks. | 0 recorded, 1 refused, 2 usage |
| `answer <id> sendback --words <text> --note <text> [--passage <text>]` | Stores the note as Geoff's, then records the send-back, after the three checks. | 0 recorded, 1 refused, 2 usage |
| `answer --new <doc.md> approve --words <text> [--pick <label>=<n>]...` | Checks a `decide` document and every pick, stores it, then records the approve. Runs the first two checks, never the third. Opens no page and waits for nothing. Prints the new id. The stored document waits for an instant before its decision, so a `list --wait` running then may wake on it. | 0 recorded, 1 refused, 2 usage |

- `<label>` is a question's label exactly as its `:::question` line gives it. `<n>` is the option's number, from 1, in the document's order. A `--pick` splits on its last `=`.
- On success `answer` prints one line on stdout: `recorded <action> on <id>`. A refusal prints one line on stderr that starts `approval-queue: ` and names the check that failed. The desk relays that line.
- A chat decision record gains `via: "chat"`, `message` (the whole message text, pastes included), and `session` (the session id). A page decision record is unchanged.
- A chat note record is `{ op: "open", who: "geoff", via: "chat", quote, version, text, at }`.

## Rules that bind every task

1. Files: `approval-queue/src/lib/components/decide.server.ts`, `notes.server.ts`, `types.ts`, `Document.svelte`, and new test files beside them; `approval-queue/src/lib/strings.ts`; `approval-queue/cli/` (new `answer.ts`, `words.ts`, `list.ts`, their tests, `main.ts`, `wait.ts`); `approval-queue/tests/decide-checks.mjs`; `docs/mockup/src/lib/components/Document.svelte` and `docs/mockup/src/lib/types.ts`; `docs/plans/desk-queue-shots/` for the two screenshots; `README.md`; `docs/STATUS.md`; and `BACKLOG.md` for follow-ups only. Never edit an existing test file other than `decide-checks.mjs`, and that one only by adding lines. Never touch the route file `approval-queue/src/routes/api/[id]/+server.ts` (it keeps calling `post()`), the fixture, any file under `.claude/`, or any file outside the repo before the merge.
2. Code comments follow TSDoc (`standards:ts-conventions`, `standards:svelte-conventions`). No em dash in a comment, a commit, or the pull request body.
3. After each task, run `npm run check --prefix approval-queue` and `npm test --prefix approval-queue`. After tasks 5 and 6 and at the close, run `bash scripts/gate.sh`. Every run is bare, with the Bash tool's `timeout: 600000` and `TMPDIR=$CLAUDE_JOB_DIR/tmp`. A red stops the line: fix forward or revert. Commit per task with named files, never `git add -A`.
4. Every store a test or a command run uses is a `mkdtemp` folder, passed as `APPROVAL_QUEUE_STATE`. Before the merge, never run the installed `approval-queue` except the close's `check`, `send`, and `merge` of the pass's own document, and never touch `~/.local/state/approval-queue/` or the server on port 7907.
5. Never read `~/.claude/projects` or `~/.claude/jobs` other than your own job folder. A test that needs a session record copies `approval-queue/cli/fixtures/desk-record.jsonl` into `<mkdtemp>/projects/-fixture/<session id>.jsonl` and sets `CLAUDE_CONFIG_DIR=<mkdtemp>`. A test that needs `claude agents --json` puts a stub `claude` first on `PATH`, as `cli/land.test.ts:54` does for `gh`. Never call the real `claude agents` from a test. Never print an environment variable's value.
6. A server runs only as a child of `approval-queue/tests/decide-checks.mjs`: the app on its port 7955, and in task 5's `mockup <dir>` mode the mockup on 7959. Never type `kill`, `pkill`, or `claude stop`; a background command ends through `TaskStop`.
7. `gh` runs against a real repository only for this pass's pull request: `gh pr create --draft`, `gh pr edit`, `gh pr ready`, and `gh pr view`. The merge is `approval-queue merge <id>` on Geoff's approve.
8. The new page string, the `--words` refusals, and every person-read sentence in the README rows follow `~/.claude/docs/voice/written-for-people.md`: all four steps for a page string or a queue document, steps 1 to 3 for the README, the PR opening, and STATUS. The page string passes `vale` (Microsoft) and `tellgrader --register docs` with no finding (`.claude/rules/pages.md`).
9. Read `~/.claude/docs/bluefin-admin/browsers.md` before the first browser step. The checks drive headless Chromium through `page-checks.mjs`'s exported `chromium()`, never Geoff's profile, with `CHROMIUM=$HOME/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome` and `PLAYWRIGHT_CORE=$HOME/.npm/_npx/9833c18b2d85bc59/node_modules/playwright-core` (mechanism 21). Never download a browser.

## Planner's calls

Calls 1 to 4 depart from the design's text because the probes found marks it didn't know. Each is the nearest reading that still accepts only messages Geoff entered, as the design's stop says, and each goes under `## Calls for Geoff` in the pull request, with calls 5 and 15 and call 14.

1. **The accept rule is a conjunction.** An entry counts as Geoff's only when all of these hold: `type` is `user`; `promptSource` is `typed`, `suggestion_accepted`, or `queued`; `turnOrigin` is the string `human`; `origin.kind` is `human`; `isMeta`, `isCompactSummary`, and `isSidechain` are not `true`; and `message.content` is a string. The design said "has a `promptSource`", but `system` and `sdk` entries have one too, and a compaction summary carries `turnOrigin: human` with none (mechanisms 1 and 2). Any other entry is refused, so a change in Claude Code's marks makes the command refuse everything, as the design says.
2. **The launch prompt never counts.** The first entry in the record that has an allowed `promptSource` is never accepted, found by its place in the file, never by a null `parentUuid` (mechanism 5). A `claude --bg` launch prompt, which another session writes, carries `typed`, `human`, and `origin.kind: human`. The cost: in a desk opened with no prompt, Geoff's first message is refused and he says it again. The workstation pass gets a note: open the desk with a prompt, so the first entry is the launcher's.
3. **A queued message is entered when it is enqueued.** A `queued` entry's `timestamp` is when the session took it up, 0.1 to 86 seconds after Geoff typed it (mechanism 6). Its entered time is the `timestamp` of the latest `queue-operation` record before it with `operation: "enqueue"` and `content` equal to the entry's text. With no such record, the entry is refused; its own timestamp is never used.
4. **Words inside a paste don't count.** The words, and a send-back's note, must sit in the message's text with every `<pasted_content id="X">...</pasted_content id="X">` block removed (mechanism 4). The decision still stores the whole message, pastes included.
5. **The latest version's arrival** is the latest of three times: `meta.created`, the `at` of the newest `returned` record, and the `at` of the newest `undo` record. `send --returns` writes the version, then the `returned` record (mechanism 10), so that time is never earlier than the version. Counting the Undo (mechanism 20) is the reviewer's S15: after Geoff undoes a chat approve on the page, the message that made it no longer counts, and he says it again in chat. This is stricter than the design's text, so it goes under `## Calls for Geoff`.
6. **Matching.** The words are trimmed and must be at least one character. They match as an exact, case-sensitive substring. Among accepted entries entered after the latest version arrived, the newest holding the words wins. With none, the refusal says the words were entered before the latest version when an accepted entry before it holds them, and says no message Geoff entered holds them otherwise. A test tells these cases apart by the sentence.
7. **One recording function.** `decide()` in `decide.server.ts` becomes an exported `record(root, id, action, picks, extra?)` that does every check `decide()` does today, throws the same `Refusal`, and returns `{ wrote, state }`, where `state` is the fold `post()` answers with (`ok(before)` or `ok(after)`). The local `const record: Decision` is renamed so it doesn't shadow the function. `post()` calls it and answers as today. The command refuses when `wrote` is false, which covers the case where the same action is already recorded and `decide()` answers 200 with no write (mechanism 8). Node's type stripping refuses `Refusal`'s parameter properties (mechanism 18), so task 1 rewrites the class with declared fields set in the constructor body and exports it; every other module `decide.server.ts` imports already loads in the CLI.
8. **Picks come from `--pick` only.** The command never reads `answers.json`. A pick for an unknown label or an option number out of range is refused. The shared function refuses an approve with an unanswered question, with the page's sentence.
9. **A send-back from chat.** `--note` is required and must sit in the same message as the words, outside pastes. Before the note is written, the command refuses unless the document folds to waiting and the note is within `NOTE_LIMIT`, the page's checks in `noteOp`. Then the note is written, then the decision, because the shared function refuses a send-back with no note waiting. The note's `quote` is `--passage` when given, which must appear in the newest version's text after `normalize` (`documentText`, exported from `notes.server.ts`); otherwise it is the document's title. `NoteRecord`'s `open` form gains an optional `via`. If the decision is then refused, the note stays, as a note written on the page does.
10. **`--new`** accepts `approve` only. It reads and parses the file, refuses any kind but `decide`, then runs every pick check and the unanswered check, all before anything is stored. It runs `check` with a GitHub view that refuses, never `ghView`, so no `gh` call can run (`check.ts:38` asks for the view only for `merge`). Then it stores with `createDocument` and records. The first two checks run before anything is stored, and the third never runs.
11. **The session.** The id is `CLAUDE_CODE_SESSION_ID`; empty refuses. The name is the `name` of the one `claude agents --json` row whose `sessionId` equals it; no row, a failed command, or a name other than `desk` refuses. The record is the one file matching `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/*/<id>.jsonl`; none or more than one refuses. A line that isn't JSON is skipped. A message entered in the turn that runs the command is already on disk by then (mechanism 19).
12. **The page line.** `view()` copies `via` and `message` when `via` is `chat` and `message` is a string; `DecisionView` gains both as optional. The decided panel shows `DOC.fromChat` ("Recorded from chat") and the message as text, line breaks kept, never as HTML. The mockup's `Document.svelte` and `Decision` type change first. Geoff's approve of the merge document covers the mockup change; the document says so and links the mockup screenshot.
13. **No `read` from chat.** `answer` takes `approve` and `sendback`. Marking a report read stays on the page. This goes in the PR's Later list, with a `--new` document staying decided on the page with its Undo for good.
14. **The backlog rewording.** The design approved "two points are closed, three remain" for #74. The code shows all five points open (Document.svelte:99-103, :98, :225-230, :272-274, :274; decide-checks.mjs:433-500), so the planner's commit `c471bbe` says so. The PR lists this under `## Calls for Geoff`.
15. **The class stays `runner`.** The reviewer asked whether `answer`, a second way to record Geoff's approve, makes this `auth-data`. The launch prompt set `runner`, the design treats its checks as a guard against mistakes and never against a session set on faking a record, and only Geoff raises a class. The close's review applies the `auth-data` bar to `words.ts` and `answer.ts`, and the PR lists the question under `## Calls for Geoff`.

## Tasks

The tasks run in order, in this session. Tasks 2 and 4 have disjoint files, but both need `main.ts` and `wait.ts`, so they don't pair.

### Task 1. One recording function

Outcome: call 7. `record()` and `Refusal` are exported, `post()` calls `record()`, and no page behavior changes.
Files: `decide.server.ts` and a new `decide.record.test.ts`. Class: `runner`.
Acceptance check: `npm test --prefix approval-queue` passes, `git diff --diff-filter=M 4616ae8 -- '*.test.ts'` prints nothing, and `node -e "await import('./src/lib/components/decide.server.ts')"` run from `approval-queue/` exits 0 (it fails today with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`). `grep -n "record(" approval-queue/src/lib/components/decide.server.ts`, which finds nothing today, shows `post()`'s body calling it.
Test: in the new file, `record()` called twice with the same action gives `wrote: true` then `wrote: false`, and an approve with an `extra` of the three chat fields finds them in the decision file.
Estimate: 20 minutes.

### Task 2. Finding Geoff's words

Outcome: calls 1 to 6 and 11 as `cli/words.ts`, which returns the matched entry (its text and entered time) or a refusal sentence.
Files: `cli/words.ts`, `cli/words.test.ts`. Class: `runner`.
Acceptance check: each fixture row's words give the result its row in `cli/fixtures/README.md` implies, with the document arriving at 10:05, and each refusal's sentence is asserted. The launch, tool, peer, summary, notice, shell, and paste words refuse as not entered by Geoff. The early and queued words refuse as entered before the latest version. The suggested words and `approve it` match. With a `returned` record at 10:11:30, the suggested words refuse as before the latest version and `approve it` still matches; the same holds with an `undo` record at 10:11:30. Table-driven cases take an in-test copy of the `approve it` line and break one mark at a time (`turnOrigin`, `origin.kind`, `isMeta: true`, `isCompactSummary: true`, `isSidechain: true`, `promptSource: "prompt"`, array content), and each copy matches nothing. A copy with the enqueue record moved to 10:06 makes the queued words match; a copy with it removed makes them refuse.
Test: the cases above, plus empty words, no session id, a stub `claude` with no matching row, a row named `desk-2`, no record file, and two record files.
Estimate: 35 minutes.

### Task 3. `answer`

Outcome: the three `answer` forms in the interface table, calls 8 to 10, and the dispatch in `main.ts` with `USAGE` in `wait.ts`. `answer` and `list` bypass `main.ts`'s `wanted` count check and parse their own arguments.
Files: `cli/answer.ts`, `cli/answer.test.ts`, `cli/main.ts`, `cli/wait.ts`, `notes.server.ts` (call 9's export and type). Class: `runner`.
Acceptance check: acceptance items 3 and 4, each through `node approval-queue/cli/index.js answer` as a child process with a `mkdtemp` store, the copied fixture, and the stub `claude`. The approve case reads the decision file and finds `via`, the whole message `Read it through, looks right. approve it`, the session id, and each `--pick`. Each refusal case finds no new decision file and no new `note-*.json`. The already-decided case covers both the same action and the other one.
Test: the cases above, plus a send-back whose note record is Geoff's with `via: "chat"` and the title as its quote; a `--note` outside the message refused; a send-back on a decided document refused with no note stored; a `--new` approve that prints the new id and records with the words entered at 10:00 skipped only as the launch prompt; a `--new` document of kind `merge`, and one with a bad pick, each refused with no document stored; and `notes.test.ts:139`'s `USAGE` check still passing.
Estimate: 40 minutes.

### Task 4. `list` and `list --wait`

Outcome: the two `list` forms in the interface table.
Files: `cli/list.ts`, `cli/list.test.ts`, `cli/main.ts`, `cli/wait.ts`. Class: `runner`.
Acceptance check: acceptance items 1 and 2. A store with one waiting, one decided, and one withdrawn document prints one line with the waiting id, its kind, and its title. `list --wait` started on it is still running after 2 seconds, then exits 0 within 3 seconds of a test storing a new document, and again for a new report, which `list` prints with the kind `report`. A document that was waiting at the start, sent back, handed and held handed for 1.5 seconds, then returned, wakes it too. A document with a broken decision file prints one stderr line and leaves the rest listed.
Test: the cases above, each with a vitest timeout of 20000 and a 10-second limit on the child.
Estimate: 15 minutes.

### Task 5. The decided page

Outcome: call 12, mockup first.
Files: `docs/mockup/src/lib/components/Document.svelte` and `docs/mockup/src/lib/types.ts`, then `strings.ts`, `types.ts`, `decide.server.ts`, `Document.svelte`, a new test file, and the `mockup <dir>` mode of `decide-checks.mjs`. Class: `runner`.
Acceptance check: the mockup commit lands before the app commit. The mockup is served as A5's plan served it: `cp -r docs/mockup/.` without `node_modules` into `$CLAUDE_JOB_DIR/tmp/mock`, `npm ci` there, a `.state/state.json` written there holding one document decided with `via: "chat"` and a two-line message, then `node approval-queue/tests/decide-checks.mjs mockup $CLAUDE_JOB_DIR/tmp/mock`, which runs `<dir>/node_modules/.bin/vite dev --host 127.0.0.1 --port 7959 --strictPort` through `serve` and screenshots that document to `.playwright-mcp/desk/mockup-chat.png`. The screenshot shows "Recorded from chat" and the quoted message under the "You approved this" line. A vitest case finds `via` and `message` in `get()`'s answer for a chat decision and neither for a page decision. `strings.test.ts` passes. `vale` and `tellgrader --register docs` print no finding on the new string.
Test: the vitest case above.
Estimate: 30 minutes.

### Task 6. The screenshot

Outcome: acceptance item 6.
Files: `approval-queue/tests/decide-checks.mjs`, added lines only. Class: `runner`.
Acceptance check: a new check 8 seeds a document, runs `answer` as task 3's tests do against the check's store, opens `/d/<id>`, asserts the panel holds "Recorded from chat" and the whole message, and screenshots it to `.playwright-mcp/desk/check-8-chat.png`. For the red, remove the line from `Document.svelte`, run `npm run build --prefix approval-queue`, and run the script with only check 8 selected (an argument or an environment variable the check reads): it prints `FAIL`. Restore the line, rebuild, and run the whole script: every check prints `ok`. The executor reads the screenshot.
Test: the check, with rule 9's browser paths.
Estimate: 20 minutes.

### Close

1. `bash scripts/gate.sh` green on the head commit, then `node approval-queue/tests/decide-checks.mjs` on a fresh build. Copy `check-8-chat.png` and `mockup-chat.png` into `docs/plans/desk-queue-shots/` and commit them, then delete `.playwright-mcp/desk/`.
2. One whole-branch `standards:diff-reviewer` read against the design and this plan, holding `words.ts` and `answer.ts` to the `auth-data` bar (call 15). Then one batched fix chain and the gate again. A second read runs only on a blocker.
3. README: two rows in "The commands" for `list` and `answer`, in the table's form, and one paragraph on the three checks. STATUS: present tense, 60 lines or fewer, naming this pull request, dropping the stale "PR #24 pending" line, and naming the next action after the merge: the workstation planner `workstation-desk-ws-plan` plans the desk.
4. The pull request body opens with a paragraph per rule 8, then what landed, `## Acceptance` with evidence under each item, `## Decisions`, `## Calls for Geoff` (calls 1 to 5, 14, and 15, and any advisor choice), `## Planning misses`, the Later list, and the score. It embeds the two screenshots by their `raw.githubusercontent.com` URL on the branch.
5. Hand it over through `approval-packet` as a `merge` document, whatever the review says. It never lands without one. The document asks Geoff to approve calls 1 to 5 and 15 and the mockup change, linking both screenshots by their GitHub URL. On approve, run `approval-queue merge <id>`, then the post-merge steps. On send-back, follow `approval-packet` step 6.
6. Post-merge, in this order:
   1. Pull the main checkout as `pass-core` "Close" says. If it can't be pulled (a live session or a dirty file in a merged path), report it stale, launch nothing, and end with the parked-after-merge line below.
   2. Run `approval-queue restart` and confirm `approval-queue list` exits 0.
   3. Leave through `ExitWorktree` with removal, then `git -C ~/Projects/approval-queue branch -d desk-queue`.
   4. Run `claude-worktree-busy ~/.dotfiles`. If it reports busy, don't launch; end with the parked-after-merge line.
   5. From `~/.dotfiles`, launch `claude --bg --model claude-opus-5-5 --effort high --advisor fable --name workstation-desk-ws-plan "$(cat ~/Projects/initiatives/.claude/worktrees/unattended-rounds/unattended-rounds/plans/desk-ws-planning-prompt.txt)"`. If that file is missing, write `git -C ~/Projects/initiatives show unattended-rounds:unattended-rounds/plans/desk-ws-planning-prompt.txt` to `$CLAUDE_JOB_DIR/tmp/ws-prompt.txt` and launch from that copy. Read its `~/.claude/jobs/<id>/state.json`: `needs: "send a prompt to start"` is a failed launch.
   6. Send it one message with `SendMessage` to `workstation-desk-ws-plan`, naming calls 1 to 5, the interface table, call 2's note on the launch prompt, and three facts from review nits N6 and N8: an Undo or a `--new` document can wake `list --wait`, a subagent of the desk inherits its session id and can record, and `CLAUDE_CODE_SESSION_ID` after a `/clear` or a resume is unprobed. Mechanism 19 also covers only an incoming message from another session, so the planner probes a typed one.
   The parked-after-merge line is `PASS END: merged #<n>; planner not launched: <reason>; launch with <command>`.

Estimate: 50 minutes, not counting Geoff's read.

## Path

Tasks 1 to 6 and the close run in sequence: 20 + 35 + 40 + 15 + 30 + 20 + 50 = 210 minutes. The amended design estimate is 130, and the park line is 260. The 80 over is task 2's four marks the design didn't know, the `Refusal` rewrite, the mockup render, and the close's merge document, which the first draft priced at 25.

## Acceptance

| Item, verbatim | Task | Evidence |
| --- | --- | --- |
| With one waiting, one decided, and one withdrawn document in a test store, `approval-queue list` prints one line, for the waiting one, with its id, its kind, and its title, and exits 0. | 4 | `list.test.ts` case and its output |
| `approval-queue list --wait` keeps running on that store and exits when a test stores a new document. It also exits when the new document is a report, and `list` prints an unread report with the kind `report`. | 4 | `list.test.ts` cases |
| A test gives the command a session record cut from a real one, never written by hand, in which a message entered after the document arrived holds "approve it". The command records an approve. The decision file holds the whole message, the three new fields, and each answer the command was given. | 3 | `answer.test.ts` approve case on `cli/fixtures/desk-record.jsonl` |
| The command refuses, and writes no decision file, in each of these cases: the session isn't named `desk`; the words are in no entry; the words are only in a message from another session, a tool's output, or a compaction summary; the words were entered before the document's latest version arrived; a question is unanswered; the document is already decided. | 2, 3 | one `answer.test.ts` case per bullet, each checking the decision and note files |
| A decision made on the page writes the same file it writes today, the existing tests pass unchanged, and a search shows the page's route and the command calling the same function to record it. | 1, 3 | `git diff --diff-filter=M 4616ae8 -- '*.test.ts'` printing nothing, `decide-checks.mjs`'s diff holding only added lines, and `grep -rn "record(" approval-queue/src approval-queue/cli` showing `post()`'s body and `answer.ts` calling it (today it finds neither) |
| A screenshot of the running app shows a decision the command wrote, with "Recorded from chat" and the whole message. | 6 | `docs/plans/desk-queue-shots/check-8-chat.png`, embedded in the PR body |
| `bash scripts/gate.sh` passes. | Close | the gate's `gate: ok` on the head commit |

## Mechanisms

| # | Mechanism | Probe or source |
| --- | --- | --- |
| 1 | Prompt marks | A tally of `type: user` entries across 3,318 session records from the last 30 days: `promptSource` takes `typed`, `suggestion_accepted`, and `queued` with `turnOrigin: human`; `system` with `turnOrigin` `peer`, `task_notification`, `scheduled`, or `system`; and `sdk`. |
| 2 | Compaction summaries | 277 entries carry `isCompactSummary: true`, `turnOrigin: human`, and no `promptSource`. |
| 3 | Shell output | 129 entries carry `turnOrigin: human`, no `promptSource`, and string content starting `<bash-stdout>` (record `47ae6313-...`, entry `59fca834-...`). |
| 4 | Pastes | A pasted message is `typed` and `human`, its content holding `<pasted_content id="N">...</pasted_content id="N">`, with the id on both tags (record `e69530ba-...`, entry `ab25311e-...`). |
| 5 | Launch prompts | Every record's first prompt entry is `typed` (335 background, 153 interactive) but one `suggestion_accepted`; none has a null `parentUuid`, and the fixture's first line has a fixture parent to match. This session's own launch prompt, written by the design session, is `typed`, `human`, `origin.kind: human`. |
| 6 | Queued messages | 16,963 `queue-operation` records with `operation: enqueue`. 134 of 151 `queued` entries match an enqueue record by content; the entry's time trails it by 0.1 to 86 seconds, median 4.1. |
| 7 | Session id and name | `CLAUDE_CODE_SESSION_ID` is set in this session's Bash; `claude agents --json` printed 9 rows, one with that `sessionId` and `name: approval-queue-desk-queue-plan`. Row keys: `cwd`, `id`, `kind`, `name`, `pid`, `sessionId`, `startedAt`, `state`, `status`. |
| 8 | Same action twice | `decide.server.ts:183`: `if (before.decision.action === body.action) return ok(before);`, which answers 200 and writes nothing. |
| 9 | The page's view | `decide.server.ts:85-89` `view()` copies only `action`, `at`, and `answers`, and feeds both the page load and the poll, so a new field needs a line there. |
| 10 | Version arrival | `cli/send.ts:144` calls `addVersion`, then `:151` writes `{ action: 'returned', at: new Date().toISOString(), version }`. `Meta` holds `id`, `kind`, `title`, `created`, and `versions` (`store.ts:18-26`). |
| 11 | Notes | `writeNote` appends the record as given (`notes.server.ts:128`); its reader checks `who` against `geoff` and `claude` and keeps other fields (`:136-149`). A chat note counts in `notesWaiting` (`decide.server.ts:219-221`). |
| 12 | Usage | `main.ts:59-62` checks a `wanted` argument count per command; `USAGE` is in `wait.ts:5`; `notes.test.ts:139` checks it starts `usage: approval-queue check|send <doc.md>`. |
| 13 | Stub commands | `land.test.ts:54` runs the command with `PATH: \`${dir}:${process.env.PATH}\``, a stub `gh` first. |
| 14 | Page checks | `decide-checks.mjs` serves on port 7955, reads `PLAYWRIGHT_CORE` and `CHROMIUM`, and screenshots to `.playwright-mcp/a4/`; `.playwright-mcp/` is neither tracked nor ignored. |
| 15 | Mockup first | `.claude/rules/pages.md`: "To change what a page looks like or says, change the mockup first and get Geoff's approval for it." The mockup's decided panel is `docs/mockup/src/lib/components/Document.svelte:188-200`; its `Decision` type (`docs/mockup/src/lib/types.ts:64-68`) has no `via` or `message`, and it reads a decision from `.state/state.json` (`docs/mockup/src/lib/server/store.ts:5-26`). |
| 16 | The fixture | `approval-queue/cli/fixtures/desk-record.jsonl`, 13 lines, cut by the planner. A grep for `glw907`, `/var/home`, `token`, `key`, `secret`, and a real name finds 0 hits; `origin` holds only `kind`, `producer`, and `handback`. |
| 17 | Poll interval | `wait.ts`: `const POLL_MS = 1000;`. |
| 18 | Node loads the CLI by stripping types | `node -e "await import('./src/lib/components/decide.server.ts')"` from `approval-queue/` on 2026-11-15: `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, "TypeScript parameter property is not supported in strip-only mode", from `class Refusal` (`decide.server.ts:60-66`). `cli/state.ts`, `store.ts`, `strings.ts`, and `types.ts` load alone; `parse.ts` and `notes.server.ts` load once `npm ci` installs `marked`, and `cli/check.ts` already imports both. |
| 19 | A message is on disk before the turn's tools run | On 2026-11-15 this planner's own record held a subagent's hand-back message (3 lines matched its first line) in the same turn it arrived, from that turn's first Bash call. That covers a message from another session, never a typed one; a typed message that isn't on disk yet makes `answer` refuse, never record wrongly. |
| 20 | Undo has a time | `decide.server.ts:268`: `writeDecision(root, id, { action: 'undo', at: new Date().toISOString(), of: before.n });`. |
| 21 | Browser paths | `page-checks.mjs:149-150` defaults `CHROMIUM` to `chromium-1254`, which isn't installed; `~/.cache/ms-playwright/` holds `chromium-1248` and `chromium-1255`. The reviewer launched `playwright-core` from `~/.npm/_npx/9833c18b2d85bc59` with the 1255 binary and rendered a page (Chromium 159). |
| 22 | The next planner's prompt | `desk-ws-planning-prompt.txt` and the design are committed on the initiatives branch `unattended-rounds` (`fe6c4da`), with no edits in its worktree, and the branch has no upstream. |

## Recorded searches

1. `grep -rn "decide(" approval-queue/src approval-queue/cli`: 6 hits. `Document.svelte:182, :437, :473, :489` are the page's own `decide()` that posts to the route, dismissed. `decide.server.ts:170` is the function call 7 turns into `record()`, and `:291` is `post()` calling it.
2. `grep -rn "USAGE" approval-queue/cli approval-queue/src`: 9 hits in `main.ts:1, :9`, `land.ts:6, :44`, `notes.test.ts:9, :139, :141`, and `wait.ts:5, :14`. Only `wait.ts:5` changes; the `notes.test.ts` checks keep passing because the new forms go at the end.
3. `grep -rln "DecisionView" approval-queue/src approval-queue/cli`: 2 files, `decide.server.ts` and `types.ts`. Both change in task 5.
4. `grep -rn "CLAUDE_CODE_SESSION_ID\|CLAUDE_CONFIG_DIR\|claude agents" approval-queue/src approval-queue/cli approval-queue/tests approval-queue/scripts README.md`: 0 hits, so nothing reads a session today.
5. `grep -n "case '" approval-queue/cli/main.ts`: 9 hits, one per command. Tasks 3 and 4 add two.
6. `grep -rln "doc/parse\|notes.server" approval-queue/cli`: 9 files, among them `check.ts`, `land.ts`, `merge.ts`, and `notes.ts`, so the CLI already loads both modules `decide.server.ts` needs.

## Refused commands

| Command | Answer |
| --- | --- |
| `npm ci`, `npm run check`, `npm test`, or `npm run build` with `--prefix approval-queue` | Run it once more, alone. A second refusal is a stop. |
| `npm ci` in `$CLAUDE_JOB_DIR/tmp/mock` | The same. |
| `node approval-queue/tests/decide-checks.mjs`, either mode | The same. If the refusal names the server, check that the script binds only 7955 or 7959, reads only its `mkdtemp` store or scratch copy, and ends only what it started; fix that, then once more. |
| `node approval-queue/cli/index.js answer` or `list` as a test's child | The same. |
| A read of `~/.claude/projects` | Never typed. Use the fixture. |
| A `kill`, `pkill`, or `claude stop` | Never typed. A server left running means the script's `finally` failed: fix the script. |
| `gh pr create`, `edit`, `ready`, or `view` on this pass's PR, or `git push` to `desk-queue` | Run it once more. A second refusal is a stop. |
| `approval-queue check`, `send`, `merge`, or `restart` at the close | Run it once more. A second refusal is a stop. |
| The `claude --bg` launch of the workstation planner, or the `SendMessage` to it | Run it once more. A second refusal: end with the parked-after-merge line, naming the command. |
| `vale` or `tellgrader` | Run it once more. A second refusal is a stop. |

## Stops and standing answers

| Stop | Standing answer |
| --- | --- |
| The path passes 260 minutes | Park: commit, push, write the stop in STATUS, send a `decide` document through `approval-packet`, and end. |
| The design file is missing from the initiatives worktree | Read it through `git -C ~/Projects/initiatives show unattended-rounds:...` (header). If that fails too, end with "PASS END: the design is missing". |
| The fixture's marks don't match a mark the code needs | Never read a real record. Take the advisor's nearest reading that accepts only Geoff's entered messages, and list it under `## Calls for Geoff`. |
| A task needs a setting, hook, or permission rule | It doesn't get one. Stop as "What always stops" says. |
| A task needs a file outside rule 1 | The README, STATUS, and backlog edits are listed. Anything else goes through the advisor, and a file in another repo is a stop. |
| `strings.test.ts` fails on the new markup | Move the words into `strings.ts`; the test is right. |
| The npx cache's `playwright-core` or Chromium 1255 is gone | Record a `[mechanism]` line, then find another `playwright-core` on disk (`find ~/.npm/_npx -maxdepth 4 -name playwright-core -type d`) whose `browsers.json` names a Chromium revision in `~/.cache/ms-playwright/`, and pass it through `PLAYWRIGHT_CORE`. None found is a stop; never download a browser. |
| The reviewer asks for a change to the interface table | Make it, edit the table here, and list it under `## Decisions` and in the message to the workstation planner. |
| Geoff sends the merge document back | Follow `approval-packet` step 6: answer each note, fix forward, return with `send --returns`. |
| The main checkout can't be pulled after the merge | Report it stale, launch nothing, and end with the parked-after-merge line. |
| `approval-queue restart` or `list` fails after the merge | Fix forward in a new branch as a direct change if it fits one sentence, else end with the parked-after-merge line and leave the planner unlaunched. The page still takes answers. |
| `~/.dotfiles` is busy, or the planner launch fails twice | End with the parked-after-merge line, naming the launch command. |

## Review record

One `standards:plan-reviewer` read (Opus, medium) on `c788e56`, folded in the next commit:

- B1, Node can't load `decide.server.ts`: call 7, task 1's load check, mechanisms 18 and search 6. The planner probed the rest of the module's imports (mechanism 18).
- S1, existing tests "unchanged": new test files, rule 1, and the `--diff-filter=M` check.
- S2, missing files: `notes.server.ts` and the mockup's `types.ts` in rule 1, call 9. The mockup state is a scratch `.state/state.json`, so no seed file changes.
- S3, the mockup can't be shown: task 5's `mockup <dir>` mode on 7959, rule 6, and the merge document's link.
- S4, browser path: rule 9, mechanism 21, and the stop row from A5.
- S5, goal (1) unreachable: STATUS names the planner by name before the merge, close step 6's order and the parked-after-merge line, and stop rows for the pull and the launch.
- S6, screenshots untracked: committed under `docs/plans/desk-queue-shots/`, `.playwright-mcp/desk/` deleted before removal.
- S7, `--new` stores before checking: call 10.
- S8, a stray note: call 9 and task 3's note-file checks.
- S9, fixture coverage: task 2's mark-flip and enqueue cases, refusal sentences asserted, and the fixture's first line given a fixture parent by the planner.
- S10, timeouts: task 4.
- S11, message on disk: mechanism 19, with its limit passed to the workstation planner.
- S12, task 6's runs: task 6's red with only check 8, and its estimate.
- S13, class: call 15, kept `runner` and flagged. Advisor.md "What always stops" names no class question.
- S14, the initiatives worktree: the `git show` fallback in the header, close step 6, and the stops table; the branch isn't pushed, because another session owns that worktree.
- S15, Undo: call 5 option (a), mechanism 20, flagged.
- N1 path: re-estimated to 210. N2: acceptance item 5's evidence. N3: call 7's return. N4: task 3 and the interface notes. N5: `list`'s stderr line. N6 and N7: the interface table and call 13. N8 to N10: close step 6. N11: mechanisms 10 and 15.
