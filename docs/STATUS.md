# Status

<!-- round-report ur-queue -->
Report: ~/Projects/initiatives/.claude/worktrees/unattended-rounds/unattended-rounds/reports/ur-queue-report.md

# Round ur-queue, glw907/approval-queue, written 2026-11-11 21:42
Round state: running
Queue live through: Q3

| Pass | State | PR | Planned min | Actual min | Usage before (week / Fable) | Usage after |
| --- | --- | --- | --- | --- | --- | --- |
| Q1 | merged | #15 | 60 | ~60 | 68% / 15% | 73% / 24% |
| Q2 | merged | #16 | 90 | ~49 | 73% / 24% | 75% / 28% |
| Q3 | merged | #17 | 120 | ~59 | 75% / 28% | 77% / 31% |
| Q4 | planning | none | 120 | | 77% / 31% | |

Stops: 0
Note: Q2's PR first paraphrased its acceptance items; the conductor asked the executor by message to quote them verbatim before landing.
Refusals: 0
Calls sent to Geoff: 0
Planning misses: [file-list] 1, [stale-fact] 1 (Q1); [file-list] 1, [stale-fact] 1 (Q2); [estimate] 1, [file-list] 1 (Q3)
Trials: Fable 5.2 planned 3 passes; 3 sessions ran under /goal; 0 went idle before an end line.
Opus seats under rule 6: none
Waiting for Geoff: nothing
Landed: Q1 (#15), Q2 (#16), Q3 (#17)
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
2. `approval-queue restart`, which also serves the round report page.
3. `systemctl --user disable --now decision-review.timer`.
4. Check that `approval-queue merge` with no id exits 2.

`workstation-sync` never rebuilds the app, so this step stays here until it is done. Open items are
in `BACKLOG.md`.
