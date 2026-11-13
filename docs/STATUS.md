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

- `main` still serves the old queue: the old SvelteKit app and the bash command. Passes A1 to A5
  (PRs #19 to #23) put the new app under `next/`, and the switch to it waits on PR #PRNUM.
- Pass A6 is on `aq-a6` as PR #PRNUM. It deletes the old app, the old bash command, and their shell
  tests, and moves `next/` to `approval-queue/`. The command is a launcher with nine commands, and
  seven old subcommands print that they are gone.
- `restart` carries the switch. The first restart on a state directory that holds the old queue's
  files refuses while an old item is undecided, then moves the old files into
  `archive-2026-11.tar.gz` once the new server answers.
- The switch and its undo were rehearsed against a copy of the real state directory under
  `unshare -rnpf --mount-proc --kill-child` (`npm run rehearse --prefix approval-queue`). The
  rehearsal's output is in the PR body.
- The reminder hook says a pull request goes to Geoff in a document sent with `approval-queue send`.
- pavilion and thinkpad-x1 both run the old queue until the switch.

## Next action

The workstation round's conductor sends the close packet that carries PR #PRNUM, and runs the
switch after Geoff's approve (workstation design, "The switch"): merge, pull the checkout, and run
`approval-queue restart` on pavilion. On thinkpad-x1, after the switch: pull `~/.dotfiles` and
`~/Projects/approval-queue`, run `approval-queue restart`, and run
`systemctl --user disable --now decision-review.timer` if it still runs.

The PR body's "Undo the switch" lists the steps back. Open items are in `BACKLOG.md`.
