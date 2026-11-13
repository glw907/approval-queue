# approval-queue

Approval Queue puts a session's work in front of one reader and returns the reader's decision to the session. It's a local SvelteKit app and a command. A session writes one Markdown file, `approval-queue send` stores it and waits, the reader answers on a page at `http://127.0.0.1:7907`, and the command prints the decision as one line of JSON.

This page is for a developer who has never seen the queue. It covers the document, the nine commands, the store, install, `restart`, and the gate.

## Layout

- `approval-queue/` is the SvelteKit app (Svelte 5, DaisyUI, adapter-node) and the command's code in `approval-queue/cli/`.
- `bin/.local/bin/approval-queue` is a short launcher. It resolves its own path and runs `approval-queue/cli/index.js`, so it must be a link to this checkout and not a copy.
- `bin/.local/bin/claude-approval-queue-reminder` is a PostToolUse hook script. After `gh pr create` it prints one line that says where the pull request goes.
- `docs/mockup/` is the pattern for everything a page shows. Change the mockup first, then the app.
- `scripts/` holds the install and gate scripts, and `tests/` holds the shell tests.

## The document

Everything the queue shows is one Markdown file with a header between two `---` lines. A session writes it and the reader sees it as one page with a notes margin.

```markdown
---
kind: merge
prs:
  - glw907/workstation#233 | the packet skill, updated for rounds
approve: I merge the pull request and pull `~/.dotfiles`.
sendback: Nothing merges. I answer each note and send the document back.
---
# Keep an edit to a file Survey owns?

One paragraph that says what the page asks and what you recommend.

:::question The edit to a file Survey owns
- **Keep the edit** and add it to Survey later. {recommended}
- **Send the pull request back** until Survey carries it.
:::
```

The header sets `kind`, one of four:

| Kind | Header keys it needs | Meaning |
| --- | --- | --- |
| `merge` | `prs`, `approve`, `sendback` | One or more pull requests to merge at the head the reader saw. Each `prs` entry is `owner/repo#n`, a bar, and a few plain words. |
| `design` | `approve`, `sendback` | A design to approve before work starts. |
| `decide` | `approve`, `sendback` | A question set, such as a pass that has stopped. |
| `report` | none | A read-only report. It has no decision, and the reader marks it read. |

`approve` and `sendback` are the sentences printed on the two buttons. A line `:::decide` places the buttons. Without one, the buttons go at the end.

After the header come the title, a first paragraph, and the body. A question block opens with `:::question` and a label, holds two to six bullet options, and closes with `:::`. Mark the recommended option with `{recommended}`. A document holds at most 30 questions and 200 KB.

`approval-queue check <file>` refuses these faults and prints each as `path:line: message`:

- No header, a missing `kind`, or a `kind` that isn't one of the four.
- A key the kind needs is missing.
- A `prs` entry that isn't `owner/repo#n | words`.
- No `# ` title as the first line after the header, or no paragraph after it.
- A question block that isn't closed, has no label, has fewer than two or more than six options, or repeats another's label.
- A second `:::decide`, more than 30 questions, or a file over 200 KB.

For a `merge` document, `check` also reads each pull request through `gh` and refuses a pull request that's merged, closed, or a draft, has a failed check, or can't be read. A check that's still running prints a pending line and doesn't fail `check`; `send` refuses until it finishes.

## The commands

`approval-queue` takes a subcommand. A wrong argument count prints the usage line on stderr and exits 2.

| Form | What it does | Exit |
| --- | --- | --- |
| `check <doc.md>` | Prints the document's faults, or nothing but the closing line. | 0 clean, 1 a fault |
| `send <doc.md>` | Checks the document, stores it, opens its page, and waits. Prints the decision as one JSON line that starts with the document's `id`, then the decision record. A `report` prints its id and exits at once. A `merge` document also stores each pull request's head, so `merge` can merge only what the reader saw. | 0 decided, 1 a fault or a check still running |
| `send --returns <id> <doc.md>` | Returns a revised document for a send-back that was handed over, then waits for the next decision. It refuses a changed `kind`, and it empties the stored answers because question ids can move. | 0 decided, 1 refused |
| `collect <id>` | Prints the decision of a document whose `send` is gone, once the decision is handed over. | 0 printed, 1 a report, a withdrawn document, or an unknown id |
| `withdraw <id>` | Takes back a document nobody has decided. | 0 withdrawn or already withdrawn, 1 an unknown id or a store failure, 2 already decided (the decision prints on stdout) |
| `merge <id>` | Merges each pull request of an approved `merge` document at the head the reader saw, in the document's order, and records each one for the front page. A pull request already merged is skipped, so a rerun goes on from there. | 0 done, 1 `gh` or the record failed, 2 a refusal |
| `notes <id>` | Prints the document's note threads as `{"id":…,"threads":[…]}`. | 0, 1 an unknown id |
| `reply <id> [thread] <text.md>` | Adds the session's note. With a thread number, the file is a reply in that thread. Without one, the file opens with a Markdown blockquote of the passage, then the note. Notes run up to 4,000 characters. | 0 stored, 1 a refusal |
| `land <owner/repo#n> <sentence>` | Merges a pull request that needs no decision at the head it read, then records the sentence for the front page. | 0 merged, 1 `gh` failed, 2 a refusal |
| `restart` | Rebuilds the app beside the running one and swaps it in. See "Restart and the archive." | 0 restarted, 1 a refusal or failure |

`merge` refuses with exit 2, naming the pull request, a head other than the one the reader approved, a base other than the default branch, or a check that failed or that's still running. It doesn't read or run a `## Before merge` section in a pull request body (backlog #73). `land` refuses a pull request that sits in a waiting document, is closed, is a draft, is off the default branch, has a failing check, or has a `## Before merge` section. A check that's still running is polled every 30 seconds for up to 15 minutes (`APPROVAL_QUEUE_POLL_S` and `APPROVAL_QUEUE_POLL_MAX_S`).

`send` and `send --returns` open the document's page at `/d/<id>` with `xdg-open`, one tab for each document. When nothing answers on the port, they first start this checkout's build the way `restart` does. If there's no build or `xdg-open`, they print the page's address and the document still waits. Then `send` waits on files. It reads the store once a second and never asks the server. A decision is handed over 20 seconds after the reader records it, so the reader can still undo it.

### Retired subcommands

The previous queue's `approval-queue design`, `approval-queue triage`, `approval-queue snapshot`, `approval-queue packet`, `approval-queue report`, `approval-queue pending`, and `approval-queue digest` are gone. Each prints `approval-queue: <name> is gone from the new queue; the approval-packet skill says what to run now` on stderr and exits 1. The `approval-packet` skill says which document to write instead.

## The store

The store is `store/` under the state directory. The state directory is `$APPROVAL_QUEUE_STATE`, else `${XDG_STATE_HOME:-~/.local/state}/approval-queue`. Every write goes to a temporary file that's renamed or linked into place, so a reader sees the old file or the new one and never a part.

```text
store/
  <id>/                  id is YYYYMMDD-HHMMSS-xxxxxx
    meta.json            id, kind, title, created, versions
    v1.md, v2.md, …      the document, one file per version; a return adds a version
    decision-1.json …    one record per decision, undo, withdraw, hand-over, and return
    note-1.json …        one record per note or reply
    heads.json           a merge document: each pull request's head as it was checked
    answers.json         the reader's answer to each question, by question id
  merged/
    <time>-<hex>.json    one line per merged pull request: repo, number, sentence, at
```

A decision record holds an `action` and an `at`. The actions are `approve`, `sendback`, `undo`, `withdraw`, `handed`, and `returned`. A document is waiting, decided, handed, or withdrawn, and the state is the fold of its records in number order. An `undo` takes a decided document back to waiting. A `returned` record, which `send --returns` writes with the new version, opens a handed send-back as waiting again.

## Install

```sh
npm ci --prefix approval-queue
bash scripts/install.sh
```

`scripts/install.sh` links `approval-queue` and `claude-approval-queue-reminder` into `~/.local/bin`. It refuses to replace a regular file. The launcher builds nothing; the first `restart` builds the app, and so does `npm run build --prefix approval-queue`.

The hook's `settings.json` entry lives in the workstation repo and calls `claude-approval-queue-reminder` by name.

## Restart and the archive

`approval-queue restart` replaces the running server with a fresh build of this checkout's `approval-queue/`:

1. It takes `restart.lock`, and refuses if another restart holds it.
2. It builds in `approval-queue/.stage` and starts that build on a spare port.
3. Only when the new build answers within 20 seconds does it stop the old server, swap `build/` and `node_modules/` in, and start the new server on port 7907 (`APPROVAL_QUEUE_PORT` overrides it).
4. If the new server doesn't answer, it puts back what the swap moved and starts the old build again.

It refuses before staging when another process holds the port or the port's listener isn't this queue's server.

The first restart on a state directory that still holds the previous queue's files also archives them. It refuses first if an old item is undecided (`restart` names each one, and the old server keeps running), or if `archive-2026-11.tar.gz` exists while the old files are still there. After the new server answers, it writes the old files into `archive-2026-11.tar.gz` in the state directory, checks the archive with `tar -tzf`, and removes the originals. The entries sit at the archive's root as they sat in the state directory: `items/<id>/decision.json`, `decisions.jsonl`, `digest.jsonl`, the `fetch-*.json` files, and the rest. A file the queue doesn't know stays in place, and `restart` names it. If the archive step fails before the archive is made, the new server keeps running, the old files stay, `restart` says why and exits 1, and running it again retries. If removing the originals fails after that, the archive is complete, `restart` says so, and you remove the rest by hand, because a second `restart` refuses while the archive and old files both exist.

To undo the switch, revert the merge, pull, unpack the archive into the state directory, move the archive aside, and run `restart` again with the old code. The pull request that made the switch carries these steps in full.

`npm run rehearse --prefix approval-queue -- <scratch> <repo> <old> <new>` runs the switch and its undo against a copy of a state directory in `<scratch>/state/approval-queue`, inside `unshare -rnpf --mount-proc --kill-child`, so no process outlives it and the live server on port 7907 isn't touched. It prints `key=value` lines.

## Gate

```sh
bash scripts/gate.sh
```

The gate runs the app's `check` (`svelte-kit sync` and `svelte-check`) and `test` (vitest), then every `tests/*.test.sh`. The shell tests include `install.test.sh`, which uses a temporary `HOME`, and the reminder hook's test. The restart scenarios run inside vitest, through `restart.test.ts` and its scenario script. `bash scripts/gate.sh` ends with `gate: ok` when everything passes.

`approval-queue/scripts/check-mutations.sh` removes one fault check at a time and shows that the tests for it fail. `approval-queue/scripts/page-checks.mjs` and `approval-queue/tests/*-checks.mjs` drive a built copy of the app in a browser.

## Pages

Every page renders inside one layout, `approval-queue/src/routes/+layout.svelte`, and every document inside one notes margin, `approval-queue/src/lib/components/Annotated.svelte`. Every string a page shows lives in `approval-queue/src/lib/strings.ts`. `.claude/rules/pages.md` holds the rules for changing a page.

## History

The code arrived from `glw907/workstation` with its history, including the `review-desk` era names.
