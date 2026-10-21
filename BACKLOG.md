# BACKLOG

> Project issue tracker. Managed by `/log-issue`.

## Medium

- [ ] **#2** A damaged `packet.json` makes that packet's page and actions answer 500 `#improvement` `#approval-queue` `#initiative:approval-packets` *(2026-10-17)*
  `readPacket` in `approval-queue/src/lib/server/items.ts` throws on a file that does not parse, so the item's page, approve, and reject return 500. The board and the listings now skip it. Answer 404 or the withdrawn message instead, and name the item on the board (the design's "skips an unreadable item and names it"). The same page's `reject` for a non-packet item and its `submit` action also read `request.formData()` with no catch, so a post that is not a form answers 500 instead of 400.

- [ ] **#13** Give a send-back structured instructions the session can act on `#feature` `#approval-queue` *(2026-10-21)*
  A reject returns only `{"decision":"reject","note"}`, so the session has to work out from free text what to change. LangChain's Agent Inbox has a "respond" outcome that sends the agent a reply it continues from. Add the same here: a send-back carrying the calls Geoff made, each with its anchor (part, file and line, or ask) and his instruction, in the decision JSON. The session then revises and queues the item again. PR #4 already records a send-back's calls, but only for display.

- [ ] **#1** The packet fingerprint omits each part's lane and each ask's bound part and rule `#improvement` `#approval-queue` `#initiative:approval-packets` *(2026-10-17)*
  `packetFingerprint` in `approval-queue/src/lib/server/packet-decision.ts` hashes refs, kinds, verdicts, heads, hashes, and each ask's title, labels, and tags. Rebinding an ask to another ask-bound part with the same question and labels keeps the fingerprint. The command's `jq` check closes this for authorization today, since lane and binding come from the stored `packet.json`. Add `a.part?.ref`, `a.rule`, and `p.lane`.

## Low

- [ ] **#8** The packet and board polish the prototype has and the design did not list `#improvement` `#approval-queue` `#initiative:approval-packets` *(2026-10-17)*
  From the T8 visual grade (cosmetic only): the selected sort segment is blue where the prototype uses near-black; the sidebar group has no bordered box, a very faint mono repo label, and no "Board [b]" row; sidebar entries read "Packet" where the prototype shows the ask count and an irreversible flag (the layout's data holds only item metadata); no hamburger icon on the phone top bar; the breadcrumb shows "Board / N asks" where the prototype shows initiative, repos, and waiting; the person step's text is link-blue; the 1/2/3 number-key chips on ask options are missing, and so is the single-key pick; the dark-mode lifted bar (colour ledger row 7); "Reject with note" wraps on a 390px bar because the R key chip stays.

- [ ] **#7** Part detail shows less than the PR and design screens `#improvement` `#approval-queue` `#initiative:approval-packets` *(2026-10-17)*
  A packet part's detail shows checks, review, file groups with a GitHub link, or the raw design markdown. It has no full diff browser and no rendered design, because the server sends the design as raw Markdown. The PR and design screens still set prose at 65ch to 70ch (`BriefBlock`, `DecideCards`), where the packet screen uses 56ch.

- [ ] **#6** Board rows are not in the j/k navigation, and the hold pauses on pointer only `#improvement` `#approval-queue` `#initiative:approval-packets` *(2026-10-17)*
  The sidebar's `data-q` navigation covers sidebar links only, so a board row has one tab stop and no j/k. The 5-second hold pauses while the pointer is over the bar and never on keyboard focus. The reduced hint copy says "Point at the bar to pause" even when a click already put the pointer there.

- [ ] **#5** DaisyUI-first pass on the packet components `#improvement` `#approval-queue` `#initiative:approval-packets` *(2026-10-17)*
  The a11y review's non-blocking notes: use stock `breadcrumbs` for the breadcrumb; use `collapse` (or record the defect that forced raw `<details>` with a home-grown chevron) in `PacketAsks` and `PacketRoutine`; the "Not checked" `.alert` is stripped until little of the component is left, so use a plain `div` with a start border or record why; `aria-hidden` on the timeline `<hr>`s; `aria-describedby` on the confirm dialog and `autofocus` on Cancel; focus-visible z-index on the join segments; `--btn-color` and `--btn-fg` for the checked override; a focusable scroll region on the routine table; board link context (`aria-describedby` to the meta line, `<time>` for the age, sr-only text for the en dash, a table caption).

- [ ] **#4** The board reparses every `packet.json` on each 2-second poll `#improvement` `#approval-queue` `#initiative:approval-packets` *(2026-10-17)*
  Fine at today's scale. Cache by mtime, or store the ask count, rules, repo count, and irreversible flag in `item.json` when the command writes it.

- [ ] **#3** Add `src/app.d.ts` `#improvement` `#approval-queue` `#initiative:approval-packets` *(2026-10-17)*
  No `locals`, `platform`, or `PageData` augmentation is used, so nothing is broken. Add the standard stub so `App.*` types have a home when the next server concern lands. Also: turning "Close when empty" back on does not restart its count, and the empty state flashes "closes in 30 s" for one frame before `onMount` reads `localStorage`.
