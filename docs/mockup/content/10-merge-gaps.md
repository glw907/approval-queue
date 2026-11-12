---
kind: merge
prs:
  - glw907/workstation#230 | the busy-check fix
  - glw907/workstation#231 | the planning-miss count in the pass report
  - glw907/workstation#232 | the round rules
approve: I merge the three in order, pull `~/.dotfiles` so the changes take effect on this machine, and bring you the round's last two pull requests.
sendback: Nothing merges. I answer each note and send the document back to you.
---
# Merge the busy-check fix and the round rules with three known gaps?

Three workstation pull requests are ready to merge. The first (#230) stops the busy check from calling a worktree busy when nothing is running in it. The second (#231) makes the monthly pass report count how often a plan was wrong. The third (#232) writes the rules for unattended rounds into the `pass-core` skill. A round is one approved design that a chain of sessions carries out without you. Each of the three questions below is about a gap one of them leaves. I recommend merging now and closing each gap later, and the first option in each question does that.

**1. The busy-check test leaves stray processes behind for up to 30 seconds. Merge anyway?** The test starts small `bash` processes that each run `sleep`, then kills the `bash` process and leaves its `sleep` child to run out. The test still passes. The busy check ignores the leftovers, because their command lines hold no path. The only effect is that a command reading the test's output through a pipe waits up to 30 seconds for them. I recommend merging, because nothing breaks and the leftovers end without help.

:::question Stray test processes
- **Merge as it is** and file the cleanup in the backlog. {recommended}
- **Hold the busy-check pull request** until a follow-up cleans up the processes. The other two branches contain its commits, so they can't merge before it.
:::


**2. The new rules tell a conductor to stop launching when the busy check says busy, and the busy check still counts the conductor itself. Merge anyway?** A conductor is the session that launches a round's passes in order. Before each launch it runs the busy check on the repo's main checkout. The old rule let it look at a hit by hand. The design you approved removed that, on the ground that the busy check is now exact. It isn't quite: a conductor working in the main checkout is itself counted, so its first check would end its launches. The fix is already written up as backlog #75. I recommend merging, because the rule reads as your design asks and the gap is in the script. The cost is that #75 has to land before the next round that has a conductor.

:::question The conductor and the busy check
- **Merge as written** and do backlog #75 before the next round that has a conductor. {recommended}
- **Send the round-rules pull request back** to keep an exception for the conductor until #75 lands. It comes back to you afterwards.
:::


**3. Three details for a conductor didn't fit in the round rules. Add them later?** The design you approved caps `round-run.md` at 1,500 words, and the file is at 1,499. Left out are what the round's clock counts, where the report file lives, and how a relaunched conductor picks up where it stopped. Until they are in, each round's launch prompt has to carry them, and a conductor whose prompt misses one has to guess. They are recorded as backlog #78. I recommend adding them later, because the other choice changes a cap you set.

:::question Three details left out of the round rules
- **Merge and add them later** as backlog #78. {recommended}
- **Send the round-rules pull request back** to raise the cap and add them now.
:::


:::decide


## What the busy-check pull request changes

`claude-worktree-busy <directory>` answers whether anything is using a directory. It looks for a process whose command line holds the path, for a Claude session working there, and for an uncommitted file edited in the last hour. Until now a finished session, the Claude daemon, and the Approval Queue's server each counted as a hit. They no longer do. Everything else still counts: a running session, an interactive session, any other `node` or `claude` process.

On question 1, the known fix is `pkill -P` on each test process before the `kill`. The new round rules bar a session from running `pkill`, so a follow-up pass would need another way to end the children.

## What the pass-report pull request changes

`pass-report` gains one table, "Planning misses". It reads that section of each merged pull request's description and counts the lines by the tag that opens each one. It shows a count and a rate per 100 merged pull requests for each of ten tags, and prints one sentence when there are none. The pass also filed backlog #76: the report reads at most 300 merged pull requests per repo and doesn't say when it hits that limit.

## What the round-rules pull request changes

A round is one approved design covering one to six passes in one repo. Two new reference files in the `pass-core` skill hold its rules. A planner reads `round.md`: what a round design adds to a pass design, four design rules, four planner rules, the ten tags for a planning miss, and how to park a pass before any code is written. A conductor and an executor read `round-run.md`: twelve fixed answers for the cases that stop a round, the steps before each launch, the rules for the queue, how to stop, and what the round's report holds.

Four existing files of the skill change to agree. `SKILL.md` says every design is a round design. `conductor.md` sends you a stop packet when a pass stops and launches the next pass that doesn't depend on it. `planner.md` asks a plan's pre-flight list for three lines, with `Evidence:` the new one. `executor.md` says a pull request's base is the default branch.

The pass also filed backlog #77, a `notify-send` step in `conductor.md` that disagrees with the new rules.

## What was checked

Each pull request got a whole-branch review that ended on accept. The review of the busy check left one finding open, the stray processes of question 1. The review of the round rules left one open, the three details of question 3. The repo runs no CI on a pull request, so each pass's own gate run is the only automated check.
