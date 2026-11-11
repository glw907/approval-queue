# Setup tooling overnight run

You are asked to approve four pull requests, one change to a GitHub setting, and the rules for a night of unattended setup tests. If you approve, the session merges the four pull requests, publishes the first test build of cairn to npm, and starts the setup tests. The tests then run through the night without you. If you do not approve, nothing merges and no setup test runs tonight.

The setup tests are the work that must pass before the next cairn release. In each test, a Claude Code agent that knows nothing about this workstation tries to set up a new cairn site on the test accounts. It reads only the public GitHub repository and installs the published npm packages. It runs in an isolated environment under the cleanroom Unix user, so it cannot read your credentials. A supervising session answers as the site owner, grades the result, and fixes each problem the agent met. Then the next test starts. The tests continue until one test gets a site live and signed in without obvious trouble.

Each test needs the code under test to be on npm, because the new site's first deploy installs cairn from public npm. On 2026-11-09 you ruled that a test must never publish a release candidate. Release candidates are only for versions that can become a release. The session therefore built a way to publish a test build. A test build has the engine version 0.99.0-dev.N and the tool version 2.0.0-dev.N. It is published only under gate, which is an npm dist-tag that a normal install does not use. A test build creates no GitHub release, no git tag, and no changelog heading. The npm latest tag does not move.

Pull request glw907/cairn-cms#214 contains the test-build publishing. The other three pull requests write your ruling into the instructions that agents follow. They are glw907/cairn-cms#215, glw907/workstation#216, and glw907/standards#16.

The setting is the npm-publish environment of the glw907/cairn-cms repository. This environment holds the secrets that publish to npm. Today it accepts only jobs that run from v* and tool/v* tags. A test build is published from the main branch, so the session must add main to the list. This is the only change in this packet that opens a new route to the npm publish secrets.

You have three calls to make. The first is whether the session may change that setting. The second and third decide how long the tests can continue without you. Approving also accepts six prepared answers that the supervising session applies when an expected problem stops a test overnight. The deep dive lists them.

## Deep dive

How the polish loop works, why a test build is needed and how it is published, what changes at the npm-publish environment, the held paths, the budget stop, and the night's standing answers.

### How the polish loop works

Three legs prove setup, in a fixed order: the naive run, then a script that drives the interactive cairn new screens the way an owner would, then your install on the same test accounts.

A run lasts 60 minutes at most and may spend at most $20; a run that hits the cap counts as failed. Each round is the sweep, the naive run, its grading, and two lists of friction. Every item is fixed in the round's pull requests or filed, the conductor merges, and a new candidate is cut when an engine or tool path changed.

### Why a test build, and how it is published

Every leg runs what an owner installs, so each round's candidate must be on npm. The clean home's npm config names gate as its default tag, so a bare install gets the round's candidate and latest never moves.

### The night's standing answers

Auto mode refuses a step a grant line was written for: retry once after 15 minutes, then park the run, write STATUS, and start no further round.

A canary or secret leak, a /proc/*/environ finding, or a record on the bare address or www still stops for you.

## Your calls

The three calls set what happens tonight without you. The first call decides whether any test can start. The other two decide whether the tests can continue until morning or stop early and wait for you. The recommended option on each call lets the tests continue.

### Should the session add main to the npm-publish environment and then merge #214?

Context: The test build is published by a workflow that a person or session starts by hand on the main branch, with an input named snapshot. The workflow writes the test version into the package manifests on the GitHub runner only, and publishes both packages under gate. The npm-publish environment currently refuses a job from main, so the workflow cannot publish until the setting changes. The session will add a branch rule for main only, through the GitHub API. It will not use a wildcard and will not allow all branches. It will then check that the list is exactly v*, tool/v*, and main.

Risk: After the change, any workflow job that runs on main and names the npm-publish environment can use the npm publish secrets. Before the change, only a tag push could. Two reviews traced every route through the workflows. They found no route that publishes to latest, no route that runs from a ref other than main, and no route that publishes a version that differs from the version line in the manifests. One API call removes the rule.

Recommendation: Let the session add the rule and merge #214. Test builds cannot publish without it.

### May the conductor merge a held-path round PR overnight?

Context: The plan sends a round pull request that touches the release skill, the proving skill, .github/, or the clean-room template to you in a small packet. Overnight, that stops the loop at that round.

Risk: A held-path fix is likely in the first rounds, and holding it parks the whole loop until you wake.

Recommendation: Merge after a fresh review accepts. The loop runs on, and the morning packet lists each one.

### How far should the budget stop go tonight?

Context: The approved budget stop is five naive runs or $100, whichever comes first. At five runs the loop stops and waits for you.

Risk: A naive run takes most of an hour, so five runs may end before midnight and leave the night unused.

Recommendation: Ten naive runs or $100. The dollar line is unlikely to bind on a subscription token.

## Not checked

No naive run has tested the test-build path end to end. The environment change lets any workflow job on main that names the environment reach the npm-publish secrets, not only a tag push.

## What changed

Four pull requests change 8 files, adding 200 lines and removing 28. Nearly all of it is #214, which adds the test-build route to two release workflows. The other three each add a few lines of rule text.

- A dispatch on main with a snapshot version now publishes a test build to gate. [glw907/cairn-cms#214 .github/workflows/publish.yml:34-43]
- The tool's workflow gets the same route for the launcher and its platform packages. [glw907/cairn-cms#214 .github/workflows/tool.yml:10-19]
- The release skill says an rc is cut only for an actual candidate, and a test build otherwise. [glw907/cairn-cms#215 .claude/skills/cairn-releasing/SKILL.md:40-46]
- The pass-core "Gates" section carries the same rule. [glw907/workstation#216 claude/.claude/skills/pass-core/SKILL.md:120-126]
- The plan reviewer's checklist carries the same rule. [glw907/standards#16 agents/plan-reviewer.md:30-32]
