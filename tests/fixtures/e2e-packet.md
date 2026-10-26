# Sample release notes, second stage

The sample initiative replaces hand-written release notes with generated ones. This packet carries the second stage. A gate is the set of checks and the review a PR must pass.

The stage lands as three sample PRs. Approving merges the two that pass cleanly. PR 41 failed a check and one question is yours, so the packet needs your answers before it lands.

## If you approve
1. [session] Merge each approved PR in the order listed.
2. [you: refresh your GitHub login] Confirm the merged notes on the project page.

## Not checked
The generated notes were not read on the live project page.

## Ask: Merge the sample PR whose lint check failed?
Rule: gate-failed
Part: glw907/sample#41
Recommended: 2
Reason: The failing check is a style rule the repo waives for generated files.
Summary: PR 41 changes the note template and fails one lint check. The failure is in a generated file.

Background: A lint check scans every file for style rules. Generated files are exempt by policy, but the check config predates that policy.

Facts: The only failure is in a generated file.
- The lint check reports one error, in `notes.generated.ts` (`glw907/sample#41`)

Choices:
- Merge anyway: merges the PR with the lint check red; a revert PR undoes it [approve]
- Hold: leaves the PR open with nothing done [hold]
- Send back: returns the PR to the session to fix the check and send again [send-back]

Evidence: The lint output names a generated file only.
```text
notes.generated.ts:12:1  error  line too long (max-len)
```

## Ask: Which release channel should the first notes go to?
Rule: owner-call
Part: none
Recommended: 1
Reason: The beta channel limits the audience while the notes are new.
Summary: The first generated notes need a channel. Beta reaches fewer readers.

Background: A release channel is the audience a release reaches. Beta readers opted in to early changes.

Facts: Beta has the smaller audience.
- Beta has forty subscribers (`docs/channels.md`)

Choices:
- Beta: the notes go to the beta channel and can be replaced
- Stable: the notes go to every subscriber

## Routine
| Part | Verdict | Fact | Why |
|---|---|---|---|
| glw907/sample#42 | approve | All checks pass and the review verdict is accept. | Nothing in it needs a call. |
| glw907/sample#43 | approve | All checks pass and the review verdict is accept. | Nothing in it needs a call. |
| step:1 | session | The merge order is fixed by the plan. | The session can revert a merge. |
