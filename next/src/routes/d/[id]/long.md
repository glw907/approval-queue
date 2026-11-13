---
kind: design
approve: I plan the rewrite and bring you nothing more until a pass stops or the work is done.
sendback: Nothing is planned. I answer each note and send the design back to you.
---
# Rebuild the Approval Queue so every item is one document its session wrote

Initiative: unattended-rounds

## Brief

Rebuild the Approval Queue so that everything a session sends you is one Markdown document, shown on one kind of page. Approving builds the queue you saw in the mockup as a round of six passes, beside the queue you use now.

The queue you use today builds each page from a fact file, a second writer's text, and a form with fixed headings. You called the result sloppy, and the first document you found useful to read was one a session wrote straight through. This design makes that the only way: the session that did the work writes the document, marks its questions, and the queue shows it. The same rebuild fixes the approve you lost on 2026-11-12, because your click is recorded on the server the moment you make it.

### What changes

- Every item is one document with a title, an opening paragraph that is the whole page made small, the questions asked where they come up, and the detail below.
- The front page has three sections: Outstanding decisions, Reports, and Recently merged PRs.
- An approve, a send-back, an answer, and an Undo are each recorded at once, and a click that can't be recorded says so on the page and stays there until it can.
- Notes are threads beside the passage they are about, and a session can answer in the thread or start one.
- A document that comes back after a send-back shows what changed, marked as Word or Google Docs would mark it.
- A document is written in GitHub Flavored Markdown, and the page draws all of it: tables, task lists, struck text, code blocks, quotations, and the rest.
- The command a session uses shrinks to nine verbs, and one library checks a document for both the command and the page.
- The old queue's code, its fact files, and its decided items go. The decided items are kept in one archive file and no page shows them.

### If you approve

1. A conductor starts the round after the weekly usage reset on 2026-11-13, 11pm Anchorage time. Its first pass waits for a small workstation fix to the busy check (workstation backlog #75), which the workstation round lands first. If you send the workstation design back, this round can't start until that fix is approved some other way.
2. Five passes build the new queue in a directory beside the old one and land without a packet, because nothing you use changes until the switch.
3. The sixth pass prepares the switch and stops with its pull request open.
4. You get one close packet, in the old queue, that carries the switch and the workstation's skill changes together. The workstation round's conductor sends it, and this round's conductor sends none. Approving it merges both and starts the new queue.
5. The first thing you read in the new queue is the report on the rounds that built it.

### Decide: How long a merged pull request stays on the front page

The mockup listed merges "since yesterday". A fixed window is simpler to reason about than one that depends on when you last looked.

- Seven days, then the line drops off the page (recommended)
- Until you mark the section as read
- Since the previous day only, as in the mockup

### Worth knowing

The new queue is built from the mockup you called solid, and the mockup's source is the visual target each page is graded against. The two rounds switch together, so this design and the workstation design need each other: if you approve only this one, nothing starts until the busy-check fix that the workstation design carries is approved some other way.

### The document

A document is a GitHub Flavored Markdown file with a short header. This is all a session has to learn.

```markdown
---
kind: merge
prs:
  - glw907/workstation#233 | the packet skill, updated for rounds
  - glw907/workstation#234 | the launch guard, made stricter
approve: I merge the packet-skill pull request, then the launch-guard one, and pull ~/.dotfiles.
sendback: Nothing merges.
---

# Keep an edit to a file Survey owns, and accept a test with ten findings?

Two workstation pull requests are ready to merge. ...

**1. The packet-skill pull request edited a file that Survey owns. Keep the edit?** Our copy
gained two passages that Survey doesn't have yet.

:::question The edit to a file Survey owns
- **Keep the edit** and add the same two passages to Survey. {recommended}
- **Send the pull request back** until a Survey release carries them.
:::

:::decide
```

| Part | Rule |
| --- | --- |
| `kind` | `merge` (pull requests to merge), `design` (a design to approve), `decide` (questions only), or `report` (nothing to decide; ends with "Mark as read") |
| `prs` | Required for `merge`. Pull requests are listed in merge order as `owner/repo#n`, so one document can carry several repos. Each has a few plain words that the page uses in place of the number alone |
| `approve`, `sendback` | One sentence each, saying what the session does next. The page prints them on the two buttons |
| `# Title` | Required. Names what changed or what is asked |
| First paragraph | Required. The front page shows it under the title |
| `:::question <label>` | The buttons for a question asked in the paragraph above it. The label is a few plain words, and the page uses it to name a question you haven't answered. Two to six options. One option at most ends `{recommended}`. The page draws the options as buttons where the block sits |
| `:::decide` | Where the approve and send-back buttons go. Left out, they go at the end |
| Everything else | GitHub Flavored Markdown, all of it. See "Markdown" below |

For a design, the design file is the document. There is no separate packet text and no fact file.

### Markdown

You ruled on 2026-11-12 that a document is always written in GitHub Flavored Markdown and that the queue supports all of it. "All of it" means the published specification, version 0.29-gfm at github.github.com/gfm: CommonMark plus tables, task lists, struck text, bare addresses as links, and the filter on raw HTML. The page draws every form the specification defines.

The mockup has one specimen document, `specimen/markdown.md`, that uses each form once. It has an address, `/d/markdown`, and appears in no list. Its styles are the specification for how each form looks.

| Form | How the page treats it |
| --- | --- |
| Headings | The first `# ` line is the title. Levels two and three are set in Spectral, four to six in the sans face |
| Tables | The sans face, a rule under the head and at the foot, numbers aligned right. A table too wide for the column scrolls inside its frame |
| Task lists | A checkbox in place of the bullet. The box can't be clicked, because the document belongs to the session |
| Struck text | Drawn as `<s>`. A passage the session removed between versions is drawn as `<del>`, so the two never look alike |
| Code blocks | Monospace on a tinted ground, and a long line scrolls inside the block. No syntax coloring |
| A question block or decide mark inside a code fence | Shown as text. It draws no buttons |
| Raw HTML | Kept, after the specification's filter turns its nine tags into text. The content security policy allows no inline script, so an event attribute does nothing |
| Images | Loaded only from the queue or from a `data:` address in the document |

Four features of GitHub's website are outside the specification and outside this design: footnotes, alerts, mathematics, and diagrams. A document that uses one shows it as the plain text that was typed.

### What the queue refuses

The queue refuses a document only for a fault that would break the page or a merge. What a document says, and how well, is the business of the workstation's skill, so that the writing can be improved there without touching the queue.

| Fault | What the session sees from `check` and `send` |
| --- | --- |
| No title, or no first paragraph | The line where one was expected |
| A header key missing for its kind, or a `kind` not in the list | The key and the four kinds |
| A question block left open, with fewer than two options or more than six, or with two recommended | The block's name and line |
| Two questions with one label | Both lines |
| More than 30 questions, or a file over 200 KB | The count or size and the limit |
| A pull request that is closed, merged, or a draft | The pull request and its state |
| A pull request whose checks are failing or still running | The pull request and the check. `send` refuses. `check` exits 1 for a failing check, and exits 0 with a pending line for one still running |

### The command

One TypeScript file replaces the 1,124-line bash command. It imports the same document library the pages use, which is why it is TypeScript: the tool-language rule puts glue in Bash and standalone tools in Go, and this command has to share code with a SvelteKit app.

| Command | What it does |
| --- | --- |
| `check <doc.md>` | Reports every fault and exits. Changes nothing |
| `send <doc.md>` | Stores the document and waits for your decision, which it prints as JSON. A report is stored and the command exits at once. `--returns <id>` sends a new version of a document you sent back |
| `collect <id>` | Prints a decision whose `send` is gone, for instance after a reboot |
| `withdraw <id>` | Takes back a document you haven't decided |
| `notes <id>` | Prints the note threads as JSON |
| `reply <id> <thread> <text.md>` | Adds the session's answer to a thread. With no thread, it starts one on a quoted passage |
| `merge <id>` | Merges each pull request of an approved document, in order, at the commit you read |
| `land <owner/repo#n> <sentence>` | Merges a pull request that needs no decision and records the sentence for the front page |
| `restart` | Builds and starts the server, and keeps the old one if the new one fails. After the first successful start of the new queue it archives the old queue's state |

### The pages

The mockup is the specification for both pages, and where it and the example above differ on a mark, the mockup's parser is right: `mockup/queue-mock/` in this record, 3,003 lines, with the five real documents it was shown with and the Markdown specimen. Layout, type, spacing, and every string come from it.

- **One layout.** A left rail lists the three sections. The main column holds the front page or a document. A notes margin sits to the right of every document, at every width down to 390 px, where it becomes a sheet.
- **Reading text** is Spectral at 1.125rem. Everything else follows Survey.
- **No bottom bar** in the main area and no strip at the foot of the rail.
- **Every string** a page shows lives in one file, copied from the mockup. A changed or added string goes through the writing process before it merges.
- **No made-up ids.** A page never shows an item id, a round id, or a pull request number without its plain words.

### Decisions, and the approve that was lost

On 2026-11-12 the queue held your approve in the browser for five seconds to allow an Undo, hid the item at once, and then failed to post it. Nothing told you (backlog #71). The new rules:

- A click is posted when it is made. The page changes only after the server answers that it wrote the decision to disk.
- Undo is a second recorded action, a button on the decided document. The queue hands a decision to the waiting session 20 seconds after recording it, and Undo works until that hand-off. The page says which side of it you are on. The decision is on disk the whole time, so the wait can't lose it.
- When the server can't be reached or refuses, the document stays open and a message replaces the buttons: what was not recorded, why, and a "Try again" button. It does not fade.
- An approve records the commit of each pull request, or the hash of the design, as you read it. `merge` checks every head before it merges anything. If one has moved, it merges nothing and says which.
- Approve reads "Approve with the answers selected above" when the document has questions. It is disabled, with the unanswered questions named beside it, until each has an answer.

### Notes and returned documents

A note is a thread on a quoted passage, with entries from you and from the session, each signed and timed. A thread you or the session resolves folds shut and stays on the page. A note a session starts without being asked is labeled as the session's.

When a document comes back with `send --returns`, the queue compares it with the version you read and marks the difference: removed words struck through, added words underlined, with a switch to hide the marks. The session writes no change marks. A thread whose passage changed keeps the original words above the new ones.

### The round

Round `aq-rewrite`, in `glw907/approval-queue`. Every pass is class `runner`.

| Pass | Outcome | Minutes | Waits for |
| --- | --- | --- | --- |
| A1 | The document library, the store, and `check` | 120 | |
| A2 | The command: `send`, `collect`, `withdraw`, `land`, `restart` | 120 | A1 |
| A3 | The layout, the front page, and the document page, read-only | 120 | A1 |
| A4 | Decisions and `merge` | 120 | A2, A3 |
| A5 | Notes threads and returned documents | 100 | A4 |
| A6 | The switch | 75 | A5 |

A2 and A3 run at the same time and share no file. The longest chain is A1, A3, A4, A5, A6 at 535 minutes. Passes A1 to A5 land with `approval-queue land`, the old command. A6 stops with its pull request open.

New code is built in `next/` at the repo's root. The old app in `approval-queue/` and the old command keep running until the switch. Only A6 edits `BACKLOG.md`, `README.md`, and `docs/STATUS.md`, so no two passes meet in a shared file.

**Pass A1. The document library, the store, and `check`.** 120 minutes.

This pass carries the least-proven assumption: that the five real documents parse as written and that the queue can mark changes without the session's help. It runs first.

- The mockup, its five documents, and the Markdown specimen are copied into the repo as `docs/mockup/`, with their hand-written change marks and mockup-only header keys removed. Later passes read them there.
- The library parses the header, title, first paragraph, question blocks, and decide mark, and returns every fault in the refusal table with its line.
- For each of the five documents a test states the expected title, first paragraph, question labels, option count per question, and recommended option, and compares the parse with them.
- The library renders GitHub Flavored Markdown. For each form in the specimen a test states the element it must produce: a table, a disabled checkbox, `<s>`, a link from a bare address, a `<pre>`, a `<blockquote>`, a heading at each of six levels. A `<script>` tag in the specimen comes out as text.
- A question block inside a code fence yields no question, and a change mark inside code stays as typed.
- Each fault in the refusal table has a test, and the closing reviewer removes each check in turn and confirms its test fails.
- A comparison of two versions of one document returns the changed passages. Fed the sent and returned versions of the second close packet, it marks the same words the mockup's hand-written marks do, no more and no fewer, in every passage.
- `scripts/gate.sh` type-checks and tests `next/` as well as the old app.
- The store is plain files under `~/.local/state/approval-queue/store/`, one directory per document, every write a write-then-rename. A decision file that fails to parse is reported by name and never read as "no decision" (backlog #49).
- `check` runs from the command line against a file and exits 0, or 1 with the faults.

Files: `next/src/lib/doc/`, `next/src/lib/store/`, `next/cli/`, `next/package.json`, `docs/mockup/`, `scripts/gate.sh`.

**Pass A2. The command.** 120 minutes. Waits for A1.

- `send` stores a document and exits with the decision once the queue hands it over. Killed and rerun as `collect`, it prints the same decision. The test's decision is written by the store module the server will use, never by hand. The command reads the store's files and never asks the server, so a server that is down or backing off cannot hide a decision (backlog #41).
- `send` on a `report` exits at once with the id.
- `withdraw` on a decided document refuses and prints the decision (backlog #49).
- `land` merges, records the sentence where the front page reads it, and refuses a pull request with a failing check. Tests run against `gh` stubs, as the old command's do.
- `restart` starts the new build on a spare port, waits up to 20 seconds for it to answer, then swaps, and the test finds the new build answering on port 7907 and nothing on the spare port. If it doesn't answer, the old server keeps running and the command exits 1 saying so (backlog #63).

Files: `next/cli/`, `next/tests/`.

**Pass A3. The layout, the front page, and the document page.** 120 minutes. Waits for A1.

- The front page shows Outstanding decisions, Reports, and Recently merged PRs, the last grouped under each tool's name with one sentence per pull request. The test's merged lines are written by A2's `land` code path, or by the store module if A2 has not landed.
- A document page renders each of the five real documents, with option buttons and the two decision buttons drawn and inert, and the Markdown specimen at `/d/markdown`.
- Every page is served with a content security policy whose `img-src` is `'self' data:`. A test document with a remote image shows no image and makes no outside request. The policy allows no inline script, and a test document with an `onclick` attribute on a link runs nothing when the link is clicked.
- Straight quotes in a document's prose render as curly quotes. Quotes inside code are unchanged.
- A fresh `standards:visual-verifier` grades screenshots of each page beside screenshots of the mockup at 1440 px and 390 px, light and dark, and returns no structural difference and no difference in typeface, type size, or spacing of the reading text. The returned close packet is graded without its change marks, which A5 draws.
- At 390 px the specimen's wide table and its long code line each scroll inside its frame.
- No page scrolls sideways at 390 px, and a Playwright check finds no element wider than the viewport, so clipped content fails too.
- The repo gains a rules file for its pages, loaded only when a session edits a file under `next/` or `approval-queue/`: one layout, one notes margin, strings in one file, the mockup as the pattern to follow (backlog #70).

Files: `next/src/routes/`, `next/src/lib/components/`, `next/src/lib/strings.ts`, `next/src/lib/survey/`, `.claude/rules/`.

**Pass A4. Decisions and `merge`.** 120 minutes. Waits for A2 and A3.

- A Playwright test holds the server's answer back, clicks approve, and finds the buttons still showing. It releases the answer, and the page changes only then, with the decision already in the store.
- With the server stopped, the same click leaves the document open, shows the not-recorded message, and "Try again" records it once the server is back. The same holds when the server stops after the click and before its answer.
- Undo on a decided document writes a second record and the document returns to Outstanding decisions. After the hand-off to the session, Undo is gone and the page says why.
- `merge` on a document with two pull requests, the second of whose heads moved after the approve, exits 2 and merges neither.
- A report's "Mark as read" moves it out of Reports.
- A Playwright test answers, approves, and undoes with the keyboard alone, and `standards:daisyui-a11y-reviewer` returns no finding on the document page (backlog #38).

Files: `next/src/routes/`, `next/src/lib/components/`, `next/cli/`, `next/tests/`.

**Pass A5. Notes threads and returned documents.** 100 minutes. Waits for A4.

- Selecting a passage and writing a note stores a thread, and the note sits beside its passage after a reload. A note on the second of two identical phrases stays on the second.
- `reply` adds a session's entry to a thread, and with no thread starts a labeled one.
- A returned document shows the three changed passages of the second close packet marked, and the switch hides the marks.
- A thread whose passage changed shows the original words.
- A send-back with no note and no answer that differs from the recommended one is refused on the page, because the session would have nothing to act on.

Files: `next/src/lib/components/`, `next/src/routes/`, `next/cli/`, `next/tests/`.

**Pass A6. The switch.** 75 minutes. Waits for A5.

- The old app, the bash command, and their tests are deleted, and `next/` moves to `approval-queue/`, so the install path and the server's process name stay as they are.
- `restart` moves the old state into `~/.local/state/approval-queue/archive-2026-11.tar.gz` only after the new server has answered on port 7907. It refuses to switch while an old item is undecided, and names the item. A failed start leaves the old state where it was.
- Every subcommand of the old command that the new one lacks prints one line naming the `approval-packet` skill and exit 1.
- `README.md` describes the document, the nine commands, and the store, for a developer who has never seen the old queue.
- `BACKLOG.md` closes the thirteen items in the sweep below.
- The gate passes on the branch. The pull request's description gives the commands that undo the switch, and the executor runs them and the switch once each against a copy of the state directory.

Files: everything under `approval-queue/` and `bin/`, `README.md`, `BACKLOG.md`, `docs/STATUS.md`, `scripts/`.

### What the passes share

| Assumption | Proof |
| --- | --- |
| The stack is the mockup's: SvelteKit 3 with adapter-node, Svelte 5.57, Tailwind 4.3, daisyUI 5.7, `marked` 18, Node 26 | `mockup/queue-mock/package.json`; `node --version` printed v26.13.1 |
| The gate is `bash scripts/gate.sh` after `npm ci --prefix approval-queue`, and after A1 also `npm ci --prefix next`. The repo has no CI | Queue repo at `7955b0f` |
| The old queue keeps working while `next/` is built | A1's first task runs the gate with an empty `next/` and the old server up |
| `approval-queue land` in the old command merges a pass with no call | `pass-core` "Close" (Geoff, 2026-11-10) |
| A1 reads the mockup at its path in this record and copies it into the repo | The record is a local branch on this machine, as the earlier rounds' prompts were |

### Standing answers

The twelve standing answers in `round-run.md` hold. Two are added for this round.

| Stop | Answer |
| --- | --- |
| A pass finds the mockup and this design disagree | The mockup wins for anything seen on a page, this design for anything else. The pass records the difference in `## Decisions` |
| Weekly usage reaches 85 percent | The pass in flight finishes and nothing new starts, as `unattended-work-guards.md` says |

### Pre-flight

- Permissions checked: the round uses `gh`, `npm`, `node`, and `approval-queue`, each already allowed in `settings.json`. No new rule.
- Reviewed: one `standards:plan-reviewer` read per plan, as class `runner` requires.
- [you: nothing] No sign-in, secret, or dialog is needed.

### Backlog sweep

| Item | Verdict |
| --- | --- |
| #71 lost approve | Done by A4 |
| #70 one shell, one notes margin, written rules | Done by A3 |
| #69 report page | Done by A3 and A4; a report is a document |
| #68, #67, #66 round flags on reports and digest lines | Moot; the pages that carried them go |
| #65 next item order | Done by A3; the front page lists oldest first |
| #64 stop wording | Moot; a stop is a `decide` document the session words |
| #62 a design approved unchecked | Done by A4; the approve records the design's hash |
| #38 Undo toasts and keys | Done by A4 |
| #63 `restart` rollback | Folded into A2 |
| #49 `withdraw` on a decided item, malformed decision | Folded into A1 and A2 |
| workstation #11 queue leftovers | Remote images: done by A3. Pruning: moot, the restart archives old state. The untested 10-second exit: moot, that command goes |
| workstation #14 brief leftovers | Curly quotes: done by A3. `listItems` in `brief.ts`: moot, the file goes |
| #41 `collect` racing the app | Folded into A2 |

### Out of scope

- Anything on the workstation: the skill, `pass-core`, hooks, and settings are the other design.
- A page for old decided items.
- Phone layouts beyond not breaking at 390 px. You read at a desk.
- Search, filters, and keyboard shortcuts beyond ordinary tab order.

<details>
<summary><h2>Technical notes</h2></summary>

### Prompts

Each pass has a planner prompt in `plans/aq-a<n>-planning-prompt.txt` and the round has `plans/aq-rewrite-conductor-prompt.txt`, committed with this design.

### Models

| Role | Model and effort |
| --- | --- |
| Planner | `claude-opus-5-5` at `high` |
| Executor, A2 and A6 | `sonnet` at `medium` |
| Executor, A1, A3, A4, A5 | `claude-opus-5-5` at `medium`; each has a judgment at its center (the parse, the look, the decision's order of events, the comparison) |
| Conductor | `sonnet` at `medium` |
| Reviewers | From agent frontmatter |

### How each mechanism fails

| Mechanism | Failure | What happens |
| --- | --- | --- |
| Store write | Disk full or permission denied | The server answers with the error; the page shows not-recorded |
| Decision post | Server down, or slower than 10 seconds | Not-recorded message with "Try again" |
| `send` | Server down | The document is stored anyway and appears when the server starts |
| `merge` | A head moved or a check failed | Exit 2, the pull request named, nothing merged |
| `merge` | GitHub refuses one part-way through | Exit 2, that pull request named, the earlier ones merged and the later ones untouched |
| Comparison | A returned document shares nothing with the one read | The page says the whole document changed and shows no marks |
| Note | Longer than 4,000 characters | Refused in the box with the count |
| `restart` at the switch | An old item undecided | The command stops and names it; the old server keeps running |

### Claude's calls

These are mine. None is something you said. One fresh Opus reader checked this design and the workstation's against the queue's code and the workstation's skills, and returned fifteen findings. Each is folded into the text above as my call. The edits made after that check had no second reader, and Vale's house config doesn't cover this folder, so `tellgrader` is the only linter that read it.

- The four kinds and the names of the marks.
- Reading "all of GitHub Flavored Markdown" as the published specification, which leaves out footnotes, alerts, mathematics, and diagrams. Say so in a note if you want any of the four.
- How each Markdown form looks, and no syntax coloring in code blocks.
- TypeScript for the command.
- Files as the only store, with the command reading them directly.
- Building beside the old queue in `next/` and landing the first five passes without you.
- The queue computing change marks.
- The 20 seconds between recording a decision and handing it to the session, which is what gives Undo something to undo.
- Refusing a send-back with no note and no changed answer.
- The limits: 30 questions, 200 KB, 4,000 characters, 10 and 20 seconds.
- Keeping the word "packet" and the command name `approval-queue`.
- The old subcommands answering with one line for a release, so a stale skill in another repo fails with directions.

### Left to the builder

- How the test suite checks that no component holds a sentence outside the strings file.
- Where each tool's display name for "Recently merged PRs" comes from, with the repo's name as the fallback.
- The store's file names.

### Sources

| Change | Anthropic page |
| --- | --- |
| The mockup as the visual target, and screenshots graded beside it | Best practices, code.claude.com/docs/en/best-practices |
| A fresh grader with a browser, apart from the builder | "Harness design for long-running application development", anthropic.com/engineering, 2026-03-24 |
| Decisions and state in files | "Effective harnesses for long-running agents", anthropic.com/engineering, 2025-11-26 |
| Playwright tests that click as you would | Prompting best practices, platform.claude.com |
| A rules file loaded by path | Skills, code.claude.com/docs/en/skills |

No source measures whether a rules file changes what a session builds, and none offers a check that catches a new page built outside the shared layout. A3's visual grade covers the pages that exist; a later page is caught only by review.

</details>
