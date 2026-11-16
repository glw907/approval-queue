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

The Approval Queue: a local SvelteKit app and a command that put a session's document in front of
Geoff and return his decision as JSON. `README.md` holds the interfaces and the gate.

## Current state

- `main` serves the new queue. PR #26 (`desk-queue`) added `approval-queue list` and
  `approval-queue answer`, so Geoff's decision can be recorded from his words in the chat session
  named `desk`.
- `answer` reads the session's record under `~/.claude/projects`, confirms through
  `claude agents --json` that the session is named `desk`, and refuses unless the `--words` text sits
  in a message Geoff typed after the document's latest arrival. A chat decision stores `via: "chat"`,
  the whole message, and the session id. The decided page shows the message under "Recorded from chat."
- `list` prints each waiting document, oldest first. `list --wait` exits on the first new one.
- The checks catch a session's mistake. They don't stop a session set on writing a false record.
- `decide-checks.mjs` has an eighth check: a decision recorded from chat shows on the decided page.
- Backlog #74 stays open on all five points. The PR lists two review findings left open: a document
  whose decision file fails to read for one poll can wake `list --wait` falsely, and a store error that
  isn't a `StoreError` prints a stack trace.
- On thinkpad-x1, `~/.dotfiles` and `~/Projects/approval-queue` need a pull and an
  `approval-queue restart` if the switch to the new queue hasn't reached it.

## Next action

The planner `workstation-desk-ws-plan` writes the workstation half of the desk: the desk session's
launch and its use of `list --wait` and `answer`. Its launch prompt is
`~/Projects/initiatives/.claude/worktrees/unattended-rounds/unattended-rounds/plans/desk-ws-planning-prompt.txt`.
Open items are in `BACKLOG.md`.
