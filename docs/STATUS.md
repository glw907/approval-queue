# Status

The Approval Queue: a local SvelteKit app and a command that put a session's hand-over in front of
Geoff and return his decision as JSON. `README.md` holds the interfaces and the gate.

## Current state

- `main` serves the packet, design, triage, docs, and single-`pr` kinds, with the 2026-10-24 polish
  pass's screens.
- Pass 2 of the `workstation-refinement` initiative is planned. Its record is local, on the
  unpushed branch `workstation-refinement` in
  `/var/home/glw907/Projects/initiatives/.claude/worktrees/workstation-refinement`.
  - Pass 2a rebuilds this repo: `approval-queue merge`, `land`, and `digest`, the fact-file and
    text packet, the one-column packet page with anchored notes, the digest and history, and the
    removal of the docs kind, Defer, and per-part verdicts.
  - Pass 2b changes the merge guard, the allow rule, the `approval-packet` skill, and the register
    in `glw907/workstation`, and in `glw907/survey` under Geoff's ruling.
- `conductor-approval-queue` owns both passes and sends one close packet for their PRs.

## Next action

The conductor runs from this checkout and launches pass 2a at once:

```sh
claude --bg --model sonnet --effort medium --name conductor-approval-queue "$(cat /var/home/glw907/Projects/initiatives/.claude/worktrees/workstation-refinement/workstation-refinement/plans/2026-11-10-pass-2-conductor-prompt.txt)"
```

Pass 2b launches once the cairn-cms setup-tooling run has ended, Pass 1 of the refinement plan has
merged, pass 2a is at PR-ready, and Geoff has answered the pre-launch packet.

## Open decisions

The pre-launch packet for pass 2b asks three things: whether the register changes through a Survey
1.6.0 release, the exact text of the new auto-mode entry, and an attended cutover.

## Cutover

The new build refuses the old packet format, so it goes live only with an empty queue, in the same
attended sitting as the workstation PR. Pass 2b's plan, "Cutover" and "Hosts", gives the order and
the step thinkpad-x1's first session runs afterward.
