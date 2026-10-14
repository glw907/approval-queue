# Send every session-opened PR to approval

## Brief

Every PR a session opens will now come to you for approval, and approving one will merge it. Small fixes were skipping your approval, and Claude Code was blocking merges you had already approved. This fixes both.

### What changes

- Every PR a session opens comes here. Before, only full planned passes sent theirs.
- A merge you approved goes through. Before, Claude Code blocked it, as with PR #38.

### If you approve

1. The PR merges.
2. This machine’s settings rebuild.
3. Sessions follow it on their next command.

### Worth knowing

The merge permission checks the command, not your approval; the merge guard keeps a merge from skipping your approval.

### The reminder

Fires whenever a session opens a PR. A new hook, `claude-approval-queue-reminder`, runs after each shell command. When the command opened a PR, it tells the session to send it here for your approval and wait. It stays quiet for an executor whose conductor hands the PR over, and for a small pass that merges itself.

### The merge permission

Only the exact commit you approved can merge. A permission rule allows `gh pr merge * --match-head-commit *`. GitHub refuses the merge if the branch moved after your approval.

### Testing

A new test covers the reminder; the full check passed. Five cases: a PR opened, one opened inside a longer command, a different `gh` command, a failed open, and unreadable input.

## What landed

The technical notes start here and are not part of the brief.
