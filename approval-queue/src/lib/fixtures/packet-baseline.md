# Sample release notes, first stage

The sample initiative replaces hand-written release notes with generated ones. This packet carries the last pass of the first stage. The earlier packet landed the template engine.

The pass is ready to land as two sample PRs and one design. One PR failed a lint check, and one question is yours to settle first.

Approving merges each approved PR in order and publishes the sample release. You refresh your registry login before the publish.

## If you approve
1. [session] Merge each approved PR in the order listed.
2. [irreversible] Publish the sample release to the package registry.
3. [you: refresh your registry login] Run the publish login before step 2.

## Not checked
The release notes were not read on the registry's preview page.

## Ask: Merge the sample PR whose lint check failed?
Rule: gate-failed
Part: glw907/sample#41
Recommended: 2
Reason: The failing check is a style rule the repo already waives for generated files.
Summary: PR 41 changes the note template and fails one lint check. The failure is in a generated file.

Background: A lint check scans every file for style rules. Generated files are exempt by policy, but the check config predates that policy.

Facts: The only failure is in a generated file.
- The lint check reports one error, in `notes.generated.ts` (`glw907/sample#41`)
- The waiver policy lists generated files (`docs/policy.md`)

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
| glw907/sample:docs/specs/notes-design.md | approve | The design matches the approved plan. | It records the template contract. |
| step:1 | session | The merge order is fixed by the plan. | The session can revert a merge. |
