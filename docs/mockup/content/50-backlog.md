---
kind: decide
approve: I record each answer in the queue's `BACKLOG.md`. An item you choose to close stays open there until the rewrite merges.
sendback: Nothing is recorded. I answer each note and send the list back to you.
---
# Close the backlog items the queue rewrite makes moot, and write the rest into its design?

The Approval Queue has 13 open backlog items. Ten describe a fault in something the rewrite removes, so I recommend closing each when the rewrite merges. Three describe a fault the rewrite could repeat, and I recommend writing each into the design as a requirement.

## Faults the rewrite removes

**An approve can be lost with no sign (#71).** The rewrite records a click at once and shows a click that didn't arrive.

:::question The lost approve (#71)
- **Close it** when the rewrite merges. {recommended}
- **Keep it open.**
:::

**Every page needs one layout and one notes margin (#70).** The rewrite gives every page both.

:::question One layout and one notes margin (#70)
- **Close it** when the rewrite merges. {recommended}
- **Keep it open.**
:::

**A round report reads as a wall of raw fields (#69).** A report becomes a document that the session writes for you.

:::question The report page (#69)
- **Close it** when the rewrite merges. {recommended}
- **Keep it open.**
:::

**A report's list of landed pull requests misses some (#68).** The queue stops building that list. The session names the pull requests in the report.

:::question The report's landed list (#68)
- **Close it** when the rewrite merges. {recommended}
- **Keep it open.**
:::

**`reply` on a report gives the wrong reason (#67).** Every document takes notes and replies, a report included.

:::question The reply message on a report (#67)
- **Close it** when the rewrite merges. {recommended}
- **Keep it open.**
:::

**The `digest` command can't record which round a merge belongs to (#66).** After the rewrite no page groups by round.

:::question The round on a recorded merge (#66)
- **Close it** when the rewrite merges. {recommended}
- **Keep it open.**
:::

**The next item after a decision follows a different order from the list (#65).** The rewrite has one order, oldest first.

:::question The order of the next item (#65)
- **Close it** when the rewrite merges. {recommended}
- **Keep it open.**
:::

**A stop packet's page still says "approve" (#64).** A stopped pass sends a document with a question, and its buttons carry the session's words.

:::question The wording on a stopped pass (#64)
- **Close it** when the rewrite merges. {recommended}
- **Keep it open.**
:::

**A design with a missing file approves with no check (#62).** One check covers every document.

:::question The unchecked design approve (#62)
- **Close it** when the rewrite merges. {recommended}
- **Keep it open.**
:::

**The Undo toasts can't be reached from the keyboard with single-key shortcuts off, and nothing sets how long they stay (#38).** Undo becomes a button that stays on the page, with no timer.

:::question The Undo toasts (#38)
- **Close it** when the rewrite merges. {recommended}
- **Keep it open.**
:::

## Faults the rewrite could repeat

**`restart` can leave a slow new server running after a rollback (#63).** The rewrite still has to start and replace a server.

:::question The restart rollback (#63)
- **Write it into the design** as a requirement. {recommended}
- **Leave it in the backlog** for later.
:::

**`withdraw` refuses a decided item, and a malformed decision never clears (#49).** The rewrite still has a withdraw command.

:::question Withdrawing a decided item (#49)
- **Write it into the design** as a requirement. {recommended}
- **Leave it in the backlog** for later.
:::

**A session can read a decision that the queue is about to take back (#41).** The rewrite makes this more likely, because you can take a decision back at any time before the session acts. The design has to say what a session does when that happens.

:::question Reading a decision that is taken back (#41)
- **Write it into the design** as a requirement. {recommended}
- **Leave it in the backlog** for later.
:::

:::decide
