# Status

The Approval Queue: a local SvelteKit app and a command that put a session's hand-over in front of
Geoff and return his decision as JSON. `README.md` holds the interfaces and the gate.

## Current state

- `main` serves the rebuilt queue (Pass 2a of the `workstation-refinement` initiative, merged as
  PR #14, `1d2cbee`, on 2026-11-11). A packet is a fact file the session writes and a text file a
  writer writes, and the page is one reading column with a notes margin.
- The command has `snapshot`, `packet`, `merge`, `land`, `digest`, `reply`, `withdraw`, `pending`,
  `collect`, `design`, and `triage`. The docs and single-`pr` kinds, Defer, per-part verdicts, and
  the contents rail are gone.
- A tab closed inside the 5-second approve hold now sends the held decision on `pagehide`.
- pavilion runs the new build: the cutover ran on 2026-11-11 with `glw907/workstation#227` and
  Survey 1.6.0.

## Next action

thinkpad-x1 has not taken the cutover. Its first session there runs, before any hand-over:

1. `approval-queue pending` (empty, or collect what it lists with the old build first).
2. `npm ci --prefix ~/Projects/approval-queue/approval-queue`, then `npm run build --prefix
   ~/Projects/approval-queue/approval-queue`, then `pkill -f 'approval-queue/[b]uild'`.
3. `systemctl --user disable --now decision-review.timer`.
4. Check that `approval-queue merge` with no id exits 2.

`workstation-sync` never rebuilds the app, so this step stays here until it is done. Open items are
in `BACKLOG.md`.
