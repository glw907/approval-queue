---
kind: report
---
# The rules for unattended rounds are now in force on this machine

Every session that plans, runs, or conducts a pass now reads the round rules from the `pass-core` skill, and the launch guard refuses a plan that has no `Evidence:` line. That guard change stops 17 older plans from launching. The busy check no longer mistakes a finished session for a running one. Getting here took five pull requests, workstation #230 to #234, all merged on 2026-11-12. One of them stopped for six hours on a mistake in its plan, the plans were wrong 16 times in all, and the week's usage ended at 89 percent. Nothing is waiting for you.

## What behaves differently now

**Some plans that used to launch will be refused.** The launch guard now wants an `Evidence:` line in a plan's pre-flight list, and it reads plans kept in initiative records, which it never saw before. Seventeen plans that launched before today are refused. Nine need the one line added. Eight are October plans whose passes already ran.

**The busy check stops crying wolf.** `claude-worktree-busy` used to call a worktree busy when a finished session, the Claude daemon, or the queue's server was the only thing there. It now counts only a running session, a recent uncommitted file, or another process holding the path. It still reports the session that calls it as busy (backlog #75).

**The round rules live in `pass-core`.** Planners, executors, and conductors read them from two new reference files, where before each launch prompt carried its own copy. An executor now loads about 8,800 of its 9,000-word limit, so there is little room to add more.

**`pass-report` counts planning misses by kind.** The monthly report gains a table of how often a plan was wrong, and in which way.

**A weekly usage ceiling of 85 percent.** At or over it, a conductor lets the running pass finish and starts nothing new. This round ended the week at 89 percent. The ceiling merged in the fourth pull request, so it didn't govern this round.

## What went wrong

One pass stopped and waited six hours for you. It was the one updating the packet skill (#233). Its end-to-end check searched for the initiative's id and counted a backlog tag as a failure. You chose to narrow the search, and the relaunch ran clean. The plan should have known the tag was there.

The plans were wrong 16 times across the five passes. Six times the design left something out. Five times a fact in the plan had gone stale by the time the pass ran. Two got the file list wrong, two misdescribed how something works, and one conflicted with another pass. None of these stopped a pass except the one above.

The packet-skill pull request merged with its end-to-end test showing ten review findings, which you accepted when you approved it. The busy-check pull request (#230) merged with one open review finding.

## What it cost

The five passes were planned at 430 minutes and took about 265, not counting the six hours parked. Weekly usage went from 68 percent to 89 percent, and Fable usage from 15 percent to 54 percent.

## What is left for later

Five follow-ups are in the workstation backlog. None blocks anything.

- #75: make the busy check skip the session that calls it.
- #78: add three run details the round rules leave out.
- #79: carry the two passages the packet-skill pull request added to `approval-brief.md` into Survey before its next release overwrites them.
- #81: reword the four round rules the test reader misread.
- #82: let the launch guard tell a plan from the other files a prompt names.
