# The queue mockup

This directory is a copy of the mockup the queue rewrite is built from. The copy is for reading:
later passes take the page layout, the strings, and the five real documents from here.

## Where it came from

The 35 files are the mockup's tracked files at commit `44af306` of the initiatives record, from
`unattended-rounds/mockup/queue-mock/`. The runnable original stays at that path. The round design
is `unattended-rounds/specs/2026-11-12-approval-queue-rewrite-design.md` in the same record.

## What changed in the copy

The five documents in `content/` and the two in `specimen/` were cleaned so they follow the
document form of the round design:

- The mockup-only header keys `repo`, `sent`, `returned`, and `mock` are gone.
- Each `prs` line names its repository, as in `glw907/workstation#233 | words`, where the mockup
  wrote `233 | words` and kept the repository in `repo`.
- `content/20-survey-edit.md` is the returned version of the second close packet, with the
  hand-written change marks resolved: removed text dropped and added text kept. Its sent version
  is `versions/20-survey-edit.sent.md`, outside `content/`, so a list of `content/*.md` still
  finds five documents. The comparison tests read the two versions and expect the three passages
  the hand marks showed.

Every other byte is the record's.

## The app source

The files under `src/`, `package.json`, and the configuration files are copied unchanged. They
still expect the old header form (`repo`, `sent`, `returned`, and `mock`, and a bare number in
each `prs` line), so this copy doesn't run against the cleaned documents. Run the original at its
record path to see the pages.
