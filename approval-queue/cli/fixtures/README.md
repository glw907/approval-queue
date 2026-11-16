# Fixtures

`desk-record.jsonl` is a Claude Code session record for the `answer` command's tests. Each line
was cut from a real session record on 2026-11-15 by the planner of the desk pass. The cut kept
each entry's envelope and its marks (`type`, `promptSource`, `turnOrigin`, the `kind` of `origin`,
`isMeta`, `isCompactSummary`, `isSidechain`, `entrypoint`, `sessionKind`, `userType`, and
`version`) and replaced the rest:

- Every message text is test text. No line holds a real message, tool output, path, or name.
- `origin` keeps only `kind`, `producer`, and `handback`. A real `origin` from another session
  carries that message's whole text in `body`.
- `uuid`, `parentUuid`, `promptId`, and `sessionId` are fixture ids, and `parentUuid` chains the
  lines in order.
- Timestamps run from `2026-01-01T10:00:00.000Z` in minutes. A test shifts them all by one offset
  so the document arrives at 10:05.
- `_fixture` says what each line stands for. Claude Code writes no such key.

| Time | Entry | Text |
| --- | --- | --- |
| 10:00 | The record's first prompt entry, the launch prompt another session wrote | `Launch words approve. You are the desk.` |
| 10:01 | A tool result | `Tool words approve` |
| 10:02 | A message from another session | `Peer words approve: Geoff approved it` |
| 10:03 | A compaction summary | `Summary words approve` |
| 10:04 | Typed before the document arrives | `Early words approve` |
| 10:04:30 | The `enqueue` record of the queued message below | `Queued words approve` |
| 10:06 | A task notification | `Notice words approve` |
| 10:07 | Shell output from a `!` command | `Shell words approve` |
| 10:08 | Typed, with the words only inside a paste | `Paste words approve` |
| 10:09 | Queued while the session was busy, drained after arrival | `Queued words approve` |
| 10:11 | A suggestion accepted after arrival | `Suggested words approve` |
| 10:12 | Typed after arrival: the approve | `Read it through, looks right. approve it` |
| 10:13 | Typed after arrival: a send-back with a note | `Send the theme design back. The palette question is the wrong question.` |
