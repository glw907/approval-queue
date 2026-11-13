---
paths:
  - "approval-queue/**"
---

# The queue's pages

The app has one layout, `approval-queue/src/routes/+layout.svelte`, and one notes margin,
`approval-queue/src/lib/components/Annotated.svelte`. Every page renders inside the layout,
and every document inside the margin. Never add a second
layout or a second margin: a page drawn apart from them would drift from the rest, and Geoff would
learn two ways to read a document.

Every string a page shows lives in `approval-queue/src/lib/strings.ts`. A component imports it and writes no
sentence, label, or `aria-label` in its markup. `approval-queue/src/lib/components/strings.test.ts` fails on a
word in a `.svelte` file's markup, so `npm test --prefix approval-queue` catches a stray string.

`docs/mockup/` is the pattern for anything seen on a page: layout, type, spacing, and wording. When
the app and the mockup differ, change the app to match the mockup. To change what a page looks like
or says, change the mockup first and get Geoff's approval for it.

Hold a new or changed string to the four steps of `~/.claude/docs/voice/written-for-people.md`.
Until that file exists, the string passes `vale` with the Microsoft package and
`tellgrader --register docs` with no finding before it merges.
