# Status

The Approval Queue: a local SvelteKit app and a command that put a session's hand-over in front of
Geoff and return his decision as JSON. `README.md` holds the interfaces and the gate.

## Current state

- `main` still serves the old packet, design, triage, docs, and single-`pr` kinds. Pass 2a is open
  as draft PR glw907/approval-queue#14 on the branch `worktree-pass-2a`.
- Pass 2a of the `workstation-refinement` initiative rebuilds this repo. Its plan is local, on the
  unpushed branch `workstation-refinement` in
  `/var/home/glw907/Projects/initiatives/.claude/worktrees/workstation-refinement`.
  - The command gains `snapshot`, `merge`, `land`, `digest`, and `reply`, and `packet` reads a fact
    file and a text file.
  - The app shows a one-column packet page with anchored notes, a digest page, and a history page.
  - The docs kind, the single-`pr` kind, Defer, per-part verdicts, and the contents rail are gone.
- Pass 2a is PR-ready: tasks T0 to T11 are committed, the end-to-end check ran (steps 1 to 7 and 9
  pass; step 8, Orca, heard no focus events and fell back to the accessibility tree), and the
  whole-branch review's three blocking findings are folded. The PR body holds the results.
- Pass 2b changes the merge guard, the allow rule, the `approval-packet` skill, and the register in
  `glw907/workstation`, and in `glw907/survey` under Geoff's ruling.
- `conductor-approval-queue` owns both passes and sends one close packet for their PRs.

## Next action

The conductor hands the close packet over, then runs the cutover with pass 2b once Geoff approves.
The executor `approval-queue-pass-2a` has ended.

## Cutover

The new build refuses the old packet format, so it goes live only with an empty queue, in the same
attended sitting as the workstation PR. The PR body's `## Before merge` section gives the order.
Pass 2b's plan, "Cutover" and "Hosts", gives the step thinkpad-x1's first session runs afterward.
