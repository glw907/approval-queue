---
kind: merge
prs:
  - glw907/workstation#233 | the packet skill, updated for rounds
  - glw907/workstation#234 | the stricter launch guard
approve: I merge the packet-skill pull request, then the launch-guard one, pull `~/.dotfiles`, and write the round's report.
sendback: Nothing merges. I answer each note and send the document back to you.
---
# Two answers needed before workstation #233 and #234 merge

Both pull requests are ready. Both questions are about #233, and I recommend the first option in each.

**1. #233 edited a file that Survey owns. Keep the edit?** Our copy of `approval-brief.md` gained two passages: what approving a stop packet does, and the `round` key. Survey doesn't have them yet, so the next `update-skills survey` run would overwrite them with no warning.

:::question The edit to a file Survey owns
- **Keep the edit** and add the same two passages to Survey before its next release (backlog #79). {recommended}
- **Send #233 back** until a Survey release carries them. #234 waits too, because its branch is cut from #233's.
:::


**2. The end-to-end test of #233 came back with ten review findings. Accept it anyway?** A fresh subagent wrote the outline of a round design from the changed `pass-core` skill alone. It produced all ten parts the test asks for, and the reviewer found ten rule breaks in them. Six are the subagent's misreadings. Four come from unclear wording in `round.md`, a file this pass wasn't allowed to touch.

:::question The test with ten findings
- **Accept the test** and fix the four rules in `round.md` as backlog #81. {recommended}
- **Send #233 back** to fix `round.md` in this pass and run the test again.
:::


One thing changes for you as soon as these merge, whatever you answer above. The launch guard starts requiring an `Evidence:` line in every plan, and 17 plans that launch today will be refused. Nine need that one line added. The other eight are October plans whose passes already ran.

:::decide


## Behind question 1: the Survey file

`approval-brief.md` belongs to the Survey repo. The workstation holds a copy of release v1.7.0, and the `survey` skill says to edit it in the Survey repo only. The design you approved listed the copy among this pass's files, so the pass edited it.

`claude-tooling-sync update-skills survey` writes the pinned release over the copy. `claude-tooling-sync verify` doesn't compare a copied file with its release, so no command reports that the copy differed.

## Behind question 2: the test and its ten findings

The test checks that the changed `pass-core` skill can be followed cold. The executor gave a fresh Sonnet subagent the skill and three backlog items, and no one answered its questions. The plan forbids editing what it wrote, so the file stays as evidence.

Backlog #81 sorts the reviewer's ten findings. These are the four it traces to the wording of `round.md`, which the next designer could repeat:

- The list of what a design adds leaves out the order table. The reader described the table and drew none.
- The rule about passes that share a file doesn't mention `BACKLOG.md` or `docs/STATUS.md`, which nearly every pass edits.
- The rule that a pass waiting on a close packet holds every later landing is only in `round-run.md`, a file `round.md` sends a designer away from.
- The rule on the denial log asks for "each class found", and the reader named 6 of 19.

The reviewer's list of all ten isn't in the diff this packet carries. Backlog #81 is the only record of it here.

## What the guard change refuses

The launch guard is the hook that refuses a `claude --bg` launch when the plan behind it skipped its checks. From the moment `~/.dotfiles` is pulled it asks for a third line in a plan's pre-flight list, `Evidence:`. It also starts reading plans named `<slug>-plan.md`, the name a plan in an initiative record has. Until now it never saw those.

The planner ran the old guard and the new one over all 237 prompt files in `~/Projects` and `~/.dotfiles`. Of those, 182 pass under both and 38 are refused under both. Seventeen pass today and would be refused: nine lack only the `Evidence:` line, and eight are the October plans, which lack all three lines and are left as they are. All 21 prompts of this overhaul pass.

The guard checks that the `Evidence:` label is there. It doesn't read what follows the label.

You asked to see any change to the launch guard or to `CLAUDE.md` before it merges. That is why the launch-guard pull request is in front of you, and approving this packet merges it.

## What else the two pull requests change

**#233.** The `approval-packet` skill lists `round` among a fact file's keys, says an approve on a stop packet merges nothing, and names the `approval-queue report` command. The `cairn-pass` skill states your ruling that a pass with nothing for you to decide lands without a packet. `unattended-work-guards.md` gains a weekly usage ceiling of 85 percent: at or over it, a conductor lets the pass in flight finish and starts nothing new. The pass files backlog #79, #80, and #81.

**#234.** Besides the guard and its ten new tests, the global `CLAUDE.md` now lists your touchpoints as the round design, its pre-flight sitting, a close packet where a call remains, a stop packet for a parked pass, and the round report. The pass closes backlog #72 without building the wider `plans/` match it asked for, because that match would mistake another file for the plan and refuse every launch of this overhaul. Backlog #82 asks for a guard that can tell the two apart.

## What was checked

Each pull request got a whole-branch review that ended on accept. The repo runs no CI on a pull request, so each pass's own gate run is the only automated check.
