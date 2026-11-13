# Status

<!-- round-report ur-queue -->
Report: ~/Projects/initiatives/.claude/worktrees/unattended-rounds/unattended-rounds/reports/ur-queue-report.md

# Round ur-queue, glw907/approval-queue, written 2026-11-11 23:06
Round state: ended
Queue live through: Q4

| Pass | State | PR | Planned min | Actual min | Usage before (week / Fable) | Usage after |
| --- | --- | --- | --- | --- | --- | --- |
| Q1 | merged | #15 | 60 | ~60 | 68% / 15% | 73% / 24% |
| Q2 | merged | #16 | 90 | ~49 | 73% / 24% | 75% / 28% |
| Q3 | merged | #17 | 120 | ~59 | 75% / 28% | 77% / 31% |
| Q4 | merged | #18 | 120 | ~84 | 77% / 31% | 81% / 38% |

Stops: 0
Note: Q2's PR first paraphrased its acceptance items; the conductor asked the executor by message to quote them verbatim before landing.
Refusals: 0
Calls sent to Geoff: 0
Planning misses: [file-list] 1, [stale-fact] 1 (Q1); [file-list] 1, [stale-fact] 1 (Q2); [estimate] 1, [file-list] 1 (Q3); [file-list] 2, [mechanism] 1 (Q4)
Trials: Fable 5.2 planned 4 passes; 8 sessions ran under /goal (4 planners, 4 executors); 0 went idle before an end line.
Opus seats under rule 6: none
Waiting for Geoff: nothing
Landed: Q1 (#15), Q2 (#16), Q3 (#17), Q4 (#18). Every pass merged, pulled, and restarted; the round ended with all four passes landed. Nothing waits for Geoff.
Resume from: /var/home/glw907/Projects/initiatives/.claude/worktrees/unattended-rounds/unattended-rounds/plans/ur-queue-conductor-prompt.txt
<!-- /round-report -->

The Approval Queue: a local SvelteKit app and a command that put a session's hand-over in front of
Geoff and return his decision as JSON. `README.md` holds the interfaces and the gate.

## Current state

- `main` serves the rebuilt queue (Pass 2a of the `workstation-refinement` initiative, merged as
  PR #14, `1d2cbee`, on 2026-11-11). A packet is a fact file the session writes and a text file a
  writer writes, and the page is one reading column with a notes margin.
- The command has `snapshot`, `packet`, `merge`, `land`, `digest`, `reply`, `withdraw`, `pending`,
  `collect`, `design`, `triage`, `report`, and `restart`. The docs and single-`pr` kinds, Defer, per-part verdicts, and
  the contents rail are gone.
- Pass Q2: `merge` refuses a stop packet; `merge`, `land`, and `packet` refuse a pull request not
  based on the default branch; a stop page says "Pass parked until you answer." Backlog #64.
- Pass Q3: a packet, a queued item, and a `land --round <id>` digest line carry a round that the
  board, sidebar, digest page, and status line show. Backlog #65, #66.
- Pass Q4: `report <initiative> <round> <report.md>` stores a round report, a fourth item kind that
  leads its round on the board and sidebar. Its page lists the round's waiting packets and landed
  pull requests, with "Mark read". Backlog #67, #68.
- pavilion runs the new build: the cutover ran on 2026-11-11 with `glw907/workstation#227` and
  Survey 1.6.0.

## Next action

thinkpad-x1 has not taken the cutover. Its first session there runs, before any hand-over:

1. `approval-queue pending` (empty, or collect what it lists with the old build first).
2. `approval-queue restart` rebuilds the app; the build before Q4 cannot show a round report.
3. `systemctl --user disable --now decision-review.timer`.
4. Check that `approval-queue merge` with no id exits 2.

`workstation-sync` never rebuilds the app, so this step stays here until it is done. Open items are
in `BACKLOG.md`.

## Stop

**Pass A4, task 5, on `aq-a4` at eb0cad6 (draft PR #22).** The accessibility reader keeps finding problems in one unit, the page's handling of a refused answer post. Task 5's rule makes that a stop: "A finding that comes back after its fix gets one structural fix of the unit the patches kept missing; one that returns again ... is a stop."

**What happened.** Five `standards:daisyui-a11y-reviewer` reads ran. Every finding from reads one and two was fixed and has stayed fixed. The answer-refusal path then took three rounds:

- Read 3, W1: "An answer refused because the document moved on never redraws the page." Fixed in 1072f71 with a redraw.
- Read 4, B1: "The W1 fold hides the very refusal it redraws for, and the focused radio drops focus to the body." This got the structural fix in eb0cad6. A refusal that moves the document on now goes to the decide section, and focus moves there.
- Read 5, W1: "A retried answer can lose focus when it is refused without a standing ... The focused button is gone and focus drops to `<body>`." W3: "An answer refusal moves focus even when the user has already left the radio." W2: another question's stale failure comes back after an Undo, and its Try again posts a pick the radios no longer show. Read 5 also found suggestions S1 to S6 and no blocker.

The gate, the build, 47 decide checks, and 103 page checks all pass at eb0cad6. Acceptance items 1 to 5 are met. Item 6 is not: it needs a last read with no finding.

**Question.** How should A4 finish its answer-failure handling?

**Choices.**

1. *(Recommended)* Allow one more structural rework of the answer-failure unit, then one more read. Answer failures would be checked against the document's state, as decide failures already are, and focus would move only from where the user's focus actually is (the question's fieldset, or `<body>` after a redraw). If that read still finds an answer-refusal finding, A4 lands without item 6, and the rest goes to A5.
2. Land A4 at eb0cad6 with item 6 unmet. Read 5's three warnings and six suggestions go to A5 as found-not-done. They show up only after a refusal from a running queue, which needs a second tab or a malformed post. A down queue's Try again works and passes checks 2 and 3.
3. Narrow call 11: answer refusals never move focus, and a refusal that moves the document on shows only in the decide section, with a sentence in that section's live line. This changes the design, so it needs Geoff's approval.
