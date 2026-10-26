# BACKLOG

> Project issue tracker. Managed by `/log-issue`.

## High

- [x] **#44** Give a decision whose session ended an owner `#bug` `#approval-queue` `#initiative:docs-system` *(2026-10-24)*
  Two page approvals (Content model, Arrange the admin sidebar, 2026-10-24 16:26) landed in decision files after their queueing session ended; the follow-up (mark glw907/cairn-cms#139 ready, CI, merge) has no owner. `collect` covers a deferred item, but an approve with no live session is a file in a folder.
  Add an `approval-queue pending` listing of decided items with no recorded follow-up, or a decision hook that runs a named command.
  Record: ~/Projects/initiatives/docs-system/research/2026-10-24-extend-blueprints-batch-4-friction.md (approval-queue 1)
  Done: PR #10.

## Medium

- [ ] **#58** A docs review's page controls: F8 order, a new page's diff button, and the added-text underline `#improvement` `#approval-queue` `#initiative:docs-system` *(2026-10-26)*
  F8 ("next call") always starts at the page after the last one used, so with two open calls on page 1 and one on page 2 it goes page 1, page 2, page 1. A new page (`base` empty) still offers "Show all unchanged lines" with nothing to unfold. Added text takes a solid underline like a link, so a whole new paragraph can read as a link. Found in the svelte and accessibility reviews of the docs cutover (PR #12).
- [ ] **#57** A docs review's comment and send-back edges `#improvement` `#approval-queue` `#initiative:docs-system` *(2026-10-26)*
  A new comment takes its range before the flush that precedes the post, so text that moves during the flush leaves it stale. The send-back post names `blob:<path>` fields the reject action never reads. The `p.bg.bg-flat` callouts in `DocsView.svelte` are home-grown beside the stock `alert` the missing-page notice uses. Browser localStorage keys `desk.calls.*` are never cleaned up. Found in the reviews of the docs cutover (PR #12).
- [ ] **#56** `readReplies` duplicates the `replies.json` read in `readDocs` `#improvement` `#approval-queue` `#initiative:docs-system` *(2026-10-26)*
  `readDocs` has only the item directory, so it cannot call `readReplies(root, id)`; merge the two so one reader serves the route and the comment store.
- [ ] **#55** Normalize the docs command's tool-failure exit codes `#improvement` `#approval-queue` `#initiative:docs-system` *(2026-10-26)*
  `fetch_pr` exits with `gh`'s own status (4 for auth, 127 for a missing `gh`) where the contract's refusals table says 1, and the notes and replies checks run after the `gh` fetch, so a malformed notes file exits 1 instead of 2 while `gh` is down. A docs item's `pr.json` also carries `ref`, `head`, and `state`, which the `pr` kind's does not.
- [ ] **#54** Run the docs review's end-to-end check again after the close fixes `#improvement` `#approval-queue` `#initiative:docs-system` *(2026-10-26)*
  The scratch-PR check ran before the close review's fixes (a per-worktree save queue, the queued text as the edit count's base, a locked approve for a missing page). Unit and route tests cover each, and no browser run has seen them. The next real docs review exercises them first.
- [x] **#53** Refuse a `.blueprint.yaml` in `blueprint` and `anchors` `#improvement` `#approval-queue` `#initiative:docs-system` *(2026-10-25)*
  Geoff rejected the Claude Code blueprint at approval for being `.blueprint.yaml`, a retired format, and `approval-queue blueprint` queued it without a word. `approval-queue anchors` prints nothing for one, so its notes anchor only by quote. Refuse a YAML blueprint in both with the `drafter convert markdown` command to run, matching drafter #115. Record: ~/Projects/initiatives/docs-system/research/2026-10-25-claude-code-page/RESUME.md (friction 11, 16)
  Dropped: the docs-as-code cutover (PR #12) removed the kind.
- [x] **#52** Check a change review's notes before queuing `#improvement` `#approval-queue` `#initiative:docs-system` *(2026-10-25)*
  `approval-queue notes --check <file> <notes.json>` validates the page and blueprint shape only, so a change review's notes, which carry a `file` beside an index anchor, fail it with "unknown field file", and `kind: "change"` fails as an unknown kind. The only check left was queuing the change itself (cairn batch 5, glw907/cairn-cms#142). Accept a change notes file in `--check`, or add `notes --check --change <owner/repo#n>`, and document the change note's shape, which the blueprint skill describes only in one sentence.
  Dropped: the docs-as-code cutover (PR #12) removed the kind.
- [ ] **#51** Say when a refusal appears on the rail, and keep a bad `refused.json` from hiding its row `#improvement` `#approval-queue` `#initiative:docs-system` *(2026-10-25)*
  A refusal shows as "Refused" on the 2-second poll after the toast has said the decision went through, and nothing announces it to a screen reader. A `refused.json` that does not parse throws a `SyntaxError` in `listDecided`, which drops the decided row altogether (svelte review of the batch 4 friction pass).

- [ ] **#50** A `collect` of an approve that is already logged can write `refused.json` beside it `#bug` `#approval-queue` `#initiative:docs-system` *(2026-10-25)*
  `collect` runs the page or head check before `append_log` looks for an existing line. If the page changed after the first command logged the approve, the second writes `refused.json` and exits 1, and the rail shows "Refused" for a decision that was recorded. Skip the check, or the file, when the log already holds the item's id (task-scope review of the batch 4 friction pass).

- [ ] **#49** A refusal the command makes as a tool failure leaves the item in `pending`, and `withdraw` refuses a decided item `#improvement` `#approval-queue` `#initiative:docs-system` *(2026-10-25)*
  A page whose worktree was removed, a packet decision that does not match its packet, and a `gh` that cannot answer write no `refused.json`, so each stays in `pending` until a session collects it or the item is cleared by hand. `withdraw` exits 2 on a decided item, so a decided item no session wants has no command to clear it.

- [x] **#48** Keep one PR's page approvals from voiding each other `#bug` `#approval-queue` `#initiative:docs-system` *(2026-10-25)*
  Three `page` items queued on glw907/cairn-cms#140 were all approved around 08:30, and all three were refused with "moved ... while it waited, so the approval does not cover it". The first two moved because the later pages' commits rode the same PR. The third moved because `pr_head` read GitHub about five seconds after a push, before the head updated. An approval cost three re-reviews. For a `page` item, check that the page's blob is unchanged instead of the PR head, or check the head against the local commit given at queue time, and show the refusal on the screen, not only on stderr.
  Record: ~/Projects/initiatives/docs-system/research/2026-10-24-extend-blueprints-batch-4/friction.md (P12)
  Done: PR #10.

- [x] **#47** Add a notes check before queueing `#improvement` `#approval-queue` `#initiative:docs-system` *(2026-10-24)*
  No `approval-queue notes --check <file>` exists; a malformed note, or a quote anchor matching more than once, shows up only at queue time or in the review. One theme note quoted `cairn-audit`, which occurs many times; caught by hand.
  Record: ~/Projects/initiatives/docs-system/research/2026-10-24-extend-blueprints-batch-4-friction.md (approval-queue 5)
  Done: PR #10.

- [x] **#46** Fix the H1 anchor slug in `approval-queue anchors` `#bug` `#approval-queue` `#initiative:docs-system` *(2026-10-24)*
  It prints a blueprint's H1 as `<slug>-1.heading` on all three batch 4 pages, as if a heading with the same text came first. The front matter's `page:` title is the likely cause.
  Record: ~/Projects/initiatives/docs-system/research/2026-10-24-extend-blueprints-batch-4-friction.md (approval-queue 4)
  Done: PR #10.

- [x] **#45** Amend an undecided item's notes in place `#improvement` `#approval-queue` `#initiative:docs-system` *(2026-10-24)*
  A misplaced note anchor took a withdraw and a full requeue, which resets the item's id and URL.
  Record: ~/Projects/initiatives/docs-system/research/2026-10-24-extend-blueprints-batch-4-friction.md (approval-queue 3)
  Done: PR #10.

- [x] **#29** `tests/packet.test.sh` fails when another session logs a decision mid-gate `#bug` `#approval-queue` `#initiative:approval-queue` *(2026-10-24)*
  The test guards the live queue by comparing the size of `~/.local/state/approval-queue/decisions.jsonl` before and after the run, so any real decision logged during the gate reads as a leak. It failed three times this way in the send-back revisions pass. Assert instead that no line the test wrote (its packet ids or refs) appears in the live log.
  Record: `~/Projects/initiatives/approval-queue/plans/2026-10-24-sendback-revisions.md`
  Done in the docs friction pass: the three tests assert that no packet id they wrote appears in the live log.

- [x] **#28** A packet send-back marks every part sent back, so each reads as a revision `#improvement` `#approval-queue` `#initiative:approval-queue` *(2026-10-24)*
  The revision lookup takes the latest reject line per ref, and a packet send-back logs one reject line per part, so a resend of one fixed part and one unchanged part needs `## What changed` for both and gives both a since diff when their heads moved. A send-back verdict on one part inside an approve is not counted at all (the plan's "Later"). Geoff, 2026-10-24: only the parts he set to send back count as revised. Folded into the docs friction plan.
  Done: each log line carries `sentBack`, and a note-only send-back still counts every part.
  Record: `~/Projects/initiatives/approval-queue/plans/2026-10-24-sendback-revisions.md`

- [x] **#27** An Undo-restored send-back note counts as text the reader typed `#bug` `#approval-queue` `#initiative:approval-queue` *(2026-10-24)*
  `drafted` starts empty on every mount, so after Undo reopens a note that was an untouched draft, `noteStart` keeps it and a later answered call stays listed as "Still open". Set `drafted` to the restored text when it equals the draft rebuilt at restore time (svelte-reviewer, warning 3, in `ItemPanel.svelte`).
  Done as `restoredDrafted`; its test fails only against a stub, since no user-visible failing path showed on the old code.
  Record: `~/Projects/initiatives/approval-queue/plans/2026-10-24-sendback-revisions.md`

- [x] **#26** Print a blueprint's anchors and document the slug rule `#improvement` `#approval-queue` `#initiative:docs-system` *(2026-10-24)*
  The README's slug rule turns an apostrophe into a hyphen (`set-a-section-s-starting-state`), easy to get wrong by hand, and no tool prints a blueprint's anchors; the session wrote a script (record 39).
  Record: `~/Projects/initiatives/docs-system/research/2026-10-22-extend-blueprints-batch-2-friction.md`

- [x] **#25** Add `approval-queue withdraw` `#feature` `#approval-queue` `#initiative:docs-system` *(2026-10-24)*
  Withdrawing a queued item means killing the blueprint process and relying on its exit trap (record 38).
  Record: `~/Projects/initiatives/docs-system/research/2026-10-22-extend-blueprints-batch-2-friction.md`

- [x] **#24** Stop prefixing "Still open:" on a send-back note Geoff answered `#bug` `#approval-queue` `#initiative:docs-system` *(2026-10-24)*
  A send-back note auto-prefixes "Still open: <title>" even for a question Geoff answered; the sidebar's figure note carried his call, "Keep the fixture as is", and still came back as open (record 37).
  Record: `~/Projects/initiatives/docs-system/research/2026-10-22-extend-blueprints-batch-2-friction.md`
- [x] **#23** Make note anchors survive edits and address reader-block lines `#improvement` `#approval-queue` `#initiative:docs-system` *(2026-10-22)*
  Anchors are positional (`<slug>.p<n>`), so splitting a bullet renumbers every later note; the grammar has no anchor for a line in `:::reader`. Key anchors on the line's text or fact ids (record 19, 20).
  Record: `~/Projects/initiatives/docs-system/research/2026-10-22-extend-blueprints-pilot-friction.md`
  Batch 2: reader-block lines still have no anchor (record 39).
  Done: a note can anchor on a quote, on any line.
- [x] **#22** Carry a ruling across items, or offer an amend review of an approved document `#feature` `#approval-queue` `#initiative:docs-system` *(2026-10-22)*
  A decide ruling on the architecture blueprint reached the approved Access blueprint; a one-clause deletion sent it back through a full review (record 21).
  Record: `~/Projects/initiatives/docs-system/research/2026-10-22-extend-blueprints-pilot-friction.md`
  Done as an amend review (Geoff chose it over carrying a ruling across items).
- [x] **#18** A decision goes out while the editor's last save failed `#bug` `#approval-queue` `#initiative:docs-system` *(2026-10-21)*
  `decide` in `ItemPanel.svelte` never checks `review.saveFailed`, so an approve can post while the file on disk lacks Geoff's last edit. Refuse with a toast until a save lands, as an open comment box refuses. Found in the comments pass's A2 review; out of that pass's scope.

- [x] **#19** A held decision's Undo can be blocked, and a typed-URL decide on a held item is announced but ignored `#bug` `#approval-queue` `#initiative:docs-system` *(2026-10-21)*
  From the comments pass's reviews. When the next item has a comment box holding text, the Undo's `goto` is cancelled by the open-box guard: the decision is still cancelled and nothing posts, but the reader stays put with only the "Save or cancel" toast, and the restore is left pending. Separately, a decision posted from a typed URL on an item already held is announced as held while `Held.hold` ignores it. Say why the Undo did not move, and refuse the second decision aloud.

- [x] **#10** Read the inline notes with a real screen reader `#improvement` `#approval-queue` `#initiative:docs-system` *(2026-10-21)*
  The notes and their choice buttons sit inside CodeMirror's `role="textbox"` (`approval-queue/src/lib/editor/setup.ts`). Tab reaches the buttons and nothing traps the keyboard, but NVDA and JAWS in focus mode may read the notes as plain text. The reviewed-pages accessibility review asked for a run with a real screen reader (its warning 10).
  Done: Orca 50.3's debug log announces each note choice as "<label> button." in one utterance. The NVDA check is #37.

- [x] **#9** Land "Next call for you" on the call on a long document at phone width `#bug` `#approval-queue` `#initiative:docs-system` *(2026-10-21)*
  On the long blueprint at 500px, a tap often leaves the call out of sight: the cursor moves, but the scroll stops at the editor's height estimate, up to 8,000px short. The prototype does the same, and short pages land correctly. The link is the phone's main way to reach a call, so measure the line before scrolling to it. Found by the reviewed-pages visual regrade.
  Done: the call now lands in view at 500 wide. A jump to a line outside the rendered viewport is instant, since three attempts to keep the smooth scroll there failed.

- [x] **#2** A damaged `packet.json` makes that packet's page and actions answer 500 `#improvement` `#approval-queue` `#initiative:approval-packets` *(2026-10-17)*
  `readPacket` in `approval-queue/src/lib/server/items.ts` throws on a file that does not parse, so the item's page, approve, and reject return 500. The board and the listings now skip it. Answer 404 or the withdrawn message instead, and name the item on the board (the design's "skips an unreadable item and names it"). The same page's `reject` for a non-packet item and its `submit` action also read `request.formData()` with no catch, so a post that is not a form answers 500 instead of 400.

- [x] **#16** A decision on an item whose waiting command died is never logged or collected `#bug` `#approval-queue` *(2026-10-21)*
  The command's exit trap withdraws its item on TERM, HUP, or INT, but a KILL, a crash, or a reboot leaves `item.json` on the board with no waiter. Geoff can still decide it: the app writes `decision.json`, but nothing appends it to `decisions.jsonl` and no session ever reads it, and the command cannot reattach to a waiting item. Reproduced on 2026-10-21 against main's command with stubbed `curl` and `gh` in a temp state root. Mark an item on the board whose waiter is gone (record the waiter's pid in `item.json`), and add `approval-queue collect <id>` so a later session can pick up and log the decision. #15 depends on the same path.

- [x] **#17** Any polling tab counts as Geoff's, so an agent's browser can swallow a new item's tab `#bug` `#approval-queue` `#initiative:docs-system` *(2026-10-21)*
  The command opens a tab only when no tab has polled in the last 5 seconds (`tab.seen` in `bin/.local/bin/approval-queue`). On 2026-10-21 the reviewed-pages executor had a browser on the review queue to check a blueprint's rendered notes, so when conductor-drafter queued the tools packet the command handed it to that tab and opened nothing for Geoff. He saw only the desktop notification and had to ask for the link. Tell Geoff's tab apart from one an agent drives (for example, a per-browser token the agent's browser never holds), or open a tab for each new item regardless. Part of the proposed "decision outcomes" follow-on pass, beside #16.

- [x] **#15** Let Geoff defer an item without rejecting it `#feature` `#approval-queue` *(2026-10-21)*
  Today the only way to say "not now" is a reject, which tells the session the work is wrong, or leaving the item waiting while its session blocks. Add a defer outcome: the session gets `{"decision":"defer"}` and is free to end, and the item stays on the board, marked deferred, until Geoff decides it or the session withdraws it. A decided deferral needs a way back to a session, so it builds on `approval-queue collect` (#16).

- [x] **#14** Lead a resent item with what changed since the send-back `#feature` `#approval-queue` *(2026-10-21)*
  When a session resends an item after a send-back (#13), the app should show the item against the version Geoff sent back. It already records that version's PR head or blob. The change belongs in the top-line narrative and the title. The title marks the item as a revision, and the headline and lede summarize what the revision changed in answer to each call, well enough to approve or send back from the summary alone. The diff since the send-back sits one level down, ahead of the full diff, for Geoff to open only when he wants the detail. The summary is the session's claim, so the brief checks should test it against that diff. Packets and the blueprint and page badge are done (a `## What changed` section, "Revision N", and the since-send-back diff); the single `pr`, `design`, and `triage` kinds are won't do (Geoff, 2026-10-24): no decision has come from them since the log began on 2026-10-17, because every PR and design goes through a packet.

- [x] **#13** Give a send-back structured instructions the session can act on `#feature` `#approval-queue` *(2026-10-21)*
  A reject returns only `{"decision":"reject","note"}`, so the session has to work out from free text what to change. LangChain's Agent Inbox has a "respond" outcome that sends the agent a reply it continues from. Add the same here: a send-back carrying the calls Geoff made, each with its anchor (part, file and line, or ask) and his instruction, in the decision JSON. The session then revises and queues the item again. PR #4 already records a send-back's calls, but only for display. Doc-kind half done in the comments pass; the packet half is done (a packet send-back returns `calls`: each part's verdict and each ask's pick); the single `pr`, `design`, and `triage` kinds are won't do (Geoff, 2026-10-24): no decision has come from them since the log began on 2026-10-17, because every PR and design goes through a packet.

- [x] **#1** The packet fingerprint omits each part's lane and each ask's bound part and rule `#improvement` `#approval-queue` `#initiative:approval-packets` *(2026-10-17)*
  `packetFingerprint` in `approval-queue/src/lib/server/packet-decision.ts` hashes refs, kinds, verdicts, heads, hashes, and each ask's title, labels, and tags. Rebinding an ask to another ask-bound part with the same question and labels keeps the fingerprint. The command's `jq` check closes this for authorization today, since lane and binding come from the stored `packet.json`. Add `a.part?.ref`, `a.rule`, and `p.lane`.

## Low

- [ ] **#43** The approve action's 410 for a withdrawn packet has no test `#improvement` `#approval-queue` `#initiative:approval-queue` *(2026-10-25)*
  The route test covers the reject action only; approve takes the same `form.has('fingerprint')` path (whole-branch review of the polish pass).

- [ ] **#42** Small cues the polish pass found and left `#improvement` `#approval-queue` `#initiative:approval-queue` *(2026-10-25)*
  "Sent back" in "Decided this session" takes the green success ink; the decision bar's Defer is hidden while the send-back note is open; `PacketAsks`' comment does not name the digit keys, and the digit caps show on a decided packet; each rail initiative is a `section` landmark; the `packet-facts` cache only drops a key when its file goes; `.linkbtn`, `.reopen`, and the pane toggle are about 20px tall and unmeasured against 2.5.8.

- [ ] **#41** A `collect` can read a decision that the app is about to back off `#improvement` `#approval-queue` `#initiative:approval-queue` *(2026-10-25)*
  With a `collect` beside a `withdraw` and Geoff's post in the same microsecond window, the collect can print a `decision.json` the app then unlinks, while his page says nothing was recorded. The reverse ordering is covered by `withdraw`'s "run collect". A fix is a design call, for example `collect` checking `item.json` again after reading the decision (task-scope review of the polish pass).

- [x] **#40** `approval-queue withdraw` prints "No such file" from `proc_stat` when the waiter is gone `#bug` `#approval-queue` `#initiative:approval-queue` *(2026-10-25)*
  `read -r s <"/proc/$1/stat" 2>/dev/null` fails its redirect before the `2>/dev/null` applies, so bash prints `line 25: /proc/<pid>/stat: No such file or directory`. The result is right; the line is noise. Group the read in braces with the redirect outside.
  Batch 4: `withdraw` printed `line 25: /proc/511192/stat: No such file or directory` and nothing else, though the item was gone (404); it should print "withdrew <id>". Record: ~/Projects/initiatives/docs-system/research/2026-10-24-extend-blueprints-batch-4-friction.md (approval-queue 2)
  Done: PR #10.

- [ ] **#39** A design's table renders without cell padding or borders, and its headings do not nest in a packet part `#bug` `#approval-queue` `#initiative:approval-queue` *(2026-10-25)*
  The columns of a rendered design table run together on the design screen and in a packet part (`DesignView`'s `.desk-read` has no table rule). An embedded design's `##` headings render as `h2` inside a part's Why, so the outline jumps up, and the prose there inherits the Why body's muted colour.

- [ ] **#38** The Undo toasts have no key and no length setting for someone who turns single-key shortcuts off `#improvement` `#approval-queue` `#initiative:approval-queue` *(2026-10-25)*
  `z` reaches the held decision's Undo only with single-key shortcuts on, and the 10-second flash Undo has no key. A speech-input user must Tab to a toast at the end of the page in time. Options: a chord that ignores single-key mode, "Press Z to undo" in the announcement, or a hold length next to the shortcuts setting (daisyui-a11y review of the polish pass, WCAG 2.2.1).

- [ ] **#37** Read the inline notes with NVDA on a Windows machine `#improvement` `#approval-queue` `#initiative:docs-system` *(2026-10-25)*
  The Orca half of #10 passed on 2026-10-25 (each note choice is announced as a button). NVDA and JAWS in focus mode may still read CodeMirror's `role="textbox"` content as plain text; this needs a Windows machine.

- [x] **#36** An old-spelling note anchor can resolve into the wrong section when two headings share an old slug `#bug` `#approval-queue` `#initiative:approval-queue` *(2026-10-24)*
  The alias in `notes.ts` maps a key the first section lacks (for example `setup.p3`) into the second section's block, where the old rule resolved it to nothing. Only old-spelling notes on documents with repeated headings are affected (docs friction whole-branch review).
  Done: the alias records only for the first section that bears an old slug.

- [x] **#35** `/claim` is a GET load that changes state `#improvement` `#approval-queue` `#initiative:approval-queue` *(2026-10-24)*
  Any browser that loads `/claim`, an agent's included, takes the claim, and a link preload would do the same. A form post behind a "Claim this browser" button would keep it to one deliberate click (svelte-reviewer, docs friction close). Plan call 6 specified the load, so this changes a design call.
  Done: `/claim` is a form post behind a "Claim this browser" button; a load sets no cookie, and a browser already claimed stays claimed.

- [x] **#34** Heading slugs keep HTML entities `#bug` `#approval-queue` `#initiative:approval-queue` *(2026-10-24)*
  `marked`'s inline lexer leaves `&amp;` undecoded, so a heading holding an entity can slug differently from the page's `rehype-slug` (T2 report).
  Done: named entities decode through `decode-named-character-reference` (the decoder cairn's parser runs); code spans stay as written.

- [x] **#33** `tests/lifecycle.test.sh`'s defer case hung past its 5-second finish limit once `#bug` `#approval-queue` `#initiative:approval-queue` *(2026-10-24)*
  Seen three times in the docs friction pass (a diff-reviewer rerun and two fix-chain gate runs, each while other work loaded the machine); it passed on the next run and in three solo runs. A timing-sensitive wait in the defer path or in `finish()`. Not reproduced on demand.
  Done: the cause was the command's 5-second wait for a tab poll newer than `item.json`; `queue_design` now clears `tab.seen`.

- [x] **#32** The live-log leak check only sees ids still in the test's temp log `#improvement` `#approval-queue` `#initiative:approval-queue` *(2026-10-24)*
  `tests/packet.test.sh` removes or overwrites the temp log between sections, so ids from earlier sections are never checked, and a command that wrote only to the live log never puts its id in the temp log. Collect every id a test queued instead (task-scope diff-reviewer, docs friction).
  Done: each of the three tests appends every id it reads, and `live_leak` checks them against the live log.

- [x] **#31** `collect` on an undecided item waits forever once the item is withdrawn `#improvement` `#approval-queue` `#initiative:approval-queue` *(2026-10-24)*
  The wait loop watches only `decision.json`. Leave the loop when `item.json` is gone. Related: `withdraw` removes `item.json` with no lock, so a `decision.json` written in that instant is lost, and a defer in the same instant as a withdraw's TERM reports "still queued". Also `$check_body` and `$check_err` are assigned after the EXIT trap is armed, so a TERM in that window hits an unbound variable.
  Done: `collect` ends with "was withdrawn; nothing to collect" (exit 1) when `item.json` is gone; `retire_item`, `withdraw`'s wait on the waiter, and the app's re-check close the race windows. The narrow case where both sides back off is #41.

- [x] **#30** The item page, rail, and merge view miss small cues for deferred and orphaned items and amend reviews `#improvement` `#approval-queue` `#initiative:approval-queue` *(2026-10-24)*
  The item page says nothing about being deferred or orphaned. The rail does not mark an orphaned item and styles "Deferred" like "Approved". The orphan line sits outside the row link, so a screen reader skips it. The editor's label does not say it shows changes since the approval. The claim page's top padding differs from the board's. Opening a collapsed run by "Next call for you" is covered by a unit test only, and a far jump scrolls instantly where a near one is smooth (a11y and svelte reviews, T2 and T3 reports).
  Done: the item page, rail, board row description, amend label, and claim padding carry the cues; "Next call for you" opens a folded run (browser check); the far jump now scrolls smoothly with a `requestMeasure` correction (a 400-paragraph blueprint lands the line at 140px).

- [x] **#21** Print the queued item's id or URL from `approval-queue blueprint` `#improvement` `#approval-queue` `#initiative:docs-system` *(2026-10-22)*
  A successful queue prints nothing; the author learns it is queued only from `pgrep` (record 22).
  Record: `~/Projects/initiatives/docs-system/research/2026-10-22-extend-blueprints-pilot-friction.md`
  Batch 2: still prints nothing on a successful queue; the session confirmed each queue with `pgrep` (record 36).
- [x] **#20** The comments pass's review suggestions not taken `#improvement` `#approval-queue` `#initiative:docs-system` *(2026-10-21)*
  The delete toast's Undo lasts 6 s, which may be short for a screen-reader user (a11y W9); the highlight fills are a spec colour under 3:1 against the page (a11y W5); the comment chords match `e.code`, so on Dvorak or AZERTY they follow the QWERTY key position; `settled()` is awaited once before a decision's flush, so a comment op started during the flush is not awaited; `review.svelte.test.ts` has no case for `restore`, the gone-text path, `focusAfterRemoving`, or `cancelBox` during an op, which need a CodeMirror view the store tests do not build.
  Done: the Undo lasts 10 s and pauses; the highlight fills keep light tints with a 2px ink underline, since no fill met 3:1 against the page and 4.5:1 for the text over it; chords follow the key's letter; `settled()` loops; five new review cases. Undo reach without single-key shortcuts is #38.

- [x] **#12** The review screens' optional Svelte and accessibility suggestions `#improvement` `#approval-queue` `#initiative:docs-system` *(2026-10-21)*
  From the reviewed-pages close review. Svelte: `$state.raw` for `DocReview.decided`, `starts`, and DocEditor's `view`; announce only save failures; move the headline's long-size threshold into `FrameHeader`; key `PaneList` rows on more than `href`; a note on why the custom enhance never calls `applyAction`; `App.PageData` in `app.d.ts`; rename the `blueprint` derived in `ItemPanel` to `docItem`. Accessibility: `aria-keyshortcuts` with `aria-hidden` key caps in buttons; `<th scope="row">` in the help sheet; a `nav` breadcrumb; `aria-describedby` on the send-back hint; an "opens in a new tab" cue; a heading for each note's header.
  Done: all listed items landed; only a failed save announces.

- [x] **#11** DaisyUI-first pass on the review frame and its panes `#improvement` `#approval-queue` `#initiative:docs-system` *(2026-10-21)*
  No ledger ruling records a DaisyUI defect behind these home-grown parts: the frame drawers (`drawer drawer-end`; the hand-rolled `inert` focus handling is better, so record that if kept), `PaneList` (`menu menu-sm`), `.linkbtn`, `.drawer-x`, `.appbtn`, `.rail-keys`, the note choices, the pane's native checkbox (`toggle toggle-sm`), the send-back `fieldset`, and the crumb (`breadcrumbs`). Each can take the stock class and keep the prototype's look with overrides.
  Done: stock `menu`, `toggle`, `btn`, `fieldset`, and `collapse` classes; the frame drawers, the crumb, the rail list, and the pane rows stay home-grown, each with its defect in the README's "Home-grown parts".

- [x] **#8** The packet and board polish the prototype has and the design did not list `#improvement` `#approval-queue` `#initiative:approval-packets` *(2026-10-17)*
  From the T8 visual grade (cosmetic only): the selected sort segment is blue where the prototype uses near-black; the sidebar group has no bordered box, a very faint mono repo label, and no "Board [b]" row; sidebar entries read "Packet" where the prototype shows the ask count and an irreversible flag (the layout's data holds only item metadata); no hamburger icon on the phone top bar; the breadcrumb shows "Board / N asks" where the prototype shows initiative, repos, and waiting; the person step's text is link-blue; the 1/2/3 number-key chips on ask options are missing, and so is the single-key pick; the dark-mode lifted bar (colour ledger row 7); "Reject with note" wraps on a 390px bar because the R key chip stays.
  Done: every listed difference landed except three that were already true (the phone menu icon, the person step's ink, and the bar's "Send back with note" with no R chip).

- [x] **#7** Part detail shows less than the PR and design screens `#improvement` `#approval-queue` `#initiative:approval-packets` *(2026-10-17)*
  A packet part's detail shows checks, review, file groups with a GitHub link, or the raw design markdown. It has no full diff browser and no rendered design, because the server sends the design as raw Markdown. The PR and design screens still set prose at 65ch to 70ch (`BriefBlock`, `DecideCards`), where the packet screen uses 56ch.
  Done: a packet part opens the full diff (`FilesDiff`) and the rendered design (`DesignView`); the PR and design screens set prose at 56ch.

- [x] **#6** Board rows are not in the j/k navigation, and the hold pauses on pointer only `#improvement` `#approval-queue` `#initiative:approval-packets` *(2026-10-17)*
  The sidebar's `data-q` navigation covers sidebar links only, so a board row has one tab stop and no j/k. The 5-second hold pauses while the pointer is over the bar and never on keyboard focus. The reduced hint copy says "Point at the bar to pause" even when a click already put the pointer there.
  Done: board rows carry `data-q` and join j and k; the hold already paused on focus and pointer since be99989.

- [x] **#5** DaisyUI-first pass on the packet components `#improvement` `#approval-queue` `#initiative:approval-packets` *(2026-10-17)*
  The a11y review's non-blocking notes: use stock `breadcrumbs` for the breadcrumb; use `collapse` (or record the defect that forced raw `<details>` with a home-grown chevron) in `PacketAsks` and `PacketRoutine`; the "Not checked" `.alert` is stripped until little of the component is left, so use a plain `div` with a start border or record why; `aria-hidden` on the timeline `<hr>`s; `aria-describedby` on the confirm dialog and `autofocus` on Cancel; focus-visible z-index on the join segments; `--btn-color` and `--btn-fg` for the checked override; a focusable scroll region on the routine table; board link context (`aria-describedby` to the meta line, `<time>` for the age, sr-only text for the en dash, a table caption).
  Done: stock `collapse`, `menu`, `toggle`, `btn`, and `fieldset` classes plus the accessibility notes; the "Not checked" block, the timeline, and the routine list were already done.

- [x] **#4** The board reparses every `packet.json` on each 2-second poll `#improvement` `#approval-queue` `#initiative:approval-packets` *(2026-10-17)*
  Fine at today's scale. Cache by mtime, or store the ask count, rules, repo count, and irreversible flag in `item.json` when the command writes it.
  Done: `packet-facts.ts` caches each packet's facts by the mtime of `packet.json`, for the board and the rail.

- [x] **#3** Add `src/app.d.ts` `#improvement` `#approval-queue` `#initiative:approval-packets` *(2026-10-17)*
  No `locals`, `platform`, or `PageData` augmentation is used, so nothing is broken. Add the standard stub so `App.*` types have a home when the next server concern lands. Also: turning "Close when empty" back on does not restart its count, and the empty state flashes "closes in 30 s" for one frame before `onMount` reads `localStorage`.
  Done: `App.PageData` is typed from the layout load; turning "Close when empty" back on restarts the count, and the countdown waits for the saved setting.
