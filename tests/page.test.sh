#!/usr/bin/env bash
# page.test.sh: prove the words of a packet page by kind against a served build. It builds a copy of the app in a
# temporary tree, seeds a stop, a close, a design, and an out-of-date stop item with seedFacts, serves them on a
# random port from 7931 to 7999 with a state directory under the tree, and reads each page. A gh stub on PATH
# answers the end-to-end stub checks. Set PAGE_TEST_SHOT to a file to also take a screenshot of the stop page.
# Never touches port 7907, the live state directory, or this worktree's own app.
set -uo pipefail
cd "$(dirname "$0")/.."
SRC="$(pwd)"
fail=0
root="$(realpath "$(mktemp -d)")"
srv=""

# The exit trap ends the one process this test started (timeout, whose child is the server); then the listener on
# the port, only when its command line sits under the temporary root; then the root itself.
cleanup() {
  local lp
  [ -z "$srv" ] || kill "$srv" 2>/dev/null
  if [ -n "${PORT:-}" ]; then
    lp=$(ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | head -n 1 | cut -d= -f2)
    if [ -n "$lp" ] && tr '\0' ' ' <"/proc/$lp/cmdline" 2>/dev/null | grep -qF "$root/"; then kill "$lp" 2>/dev/null; fi
  fi
  rm -rf "$root"
}
trap cleanup EXIT

assert_eq() {
  [ "$1" = "$2" ] || { echo "FAIL: $3: got '$1', want '$2'"; fail=1; }
}
# has <label> <file> <text>: the page holds the text. lacks: it does not.
has() { grep -qF -- "$3" "$2" || { echo "FAIL: $1: lacks '$3'"; fail=1; }; }
lacks() { ! grep -qF -- "$3" "$2" || { echo "FAIL: $1: holds '$3'"; fail=1; }; }
# primary <page>: the text of the btn-primary button, whitespace squeezed. The tag may carry other attributes, a
# disabled one included; the word "Approve" also sits in the shortcut sheet, so the whole page proves nothing.
primary() { tr '\n\t' '  ' <"$1" | grep -o '<button[^>]*btn btn-primary[^>]*>[^<]*' | sed 's/^[^>]*>//; s/[[:space:]]\+/ /g; s/^ //; s/ $//'; }

# A random free port from 7931 to 7999, and a state directory inside the temporary root.
PORT=""
for _ in $(seq 40); do
  cand=$((7931 + RANDOM % 69))
  if [ -z "$(ss -ltnH "sport = :$cand")" ]; then PORT=$cand; break; fi
done
[ -n "$PORT" ] || { echo "FAIL: no free port from 7931 to 7999"; ss -ltn; exit 1; }
state="$root/state"
base="http://127.0.0.1:$PORT"
[ "$PORT" != 7907 ] && case "$state" in "$root"/*) true ;; *) false ;; esac || { echo "FAIL: the test is not isolated"; exit 1; }
mkdir -p "$state/items" "$root/stub"

# The tree: a copy of the app's source with no node_modules, build, or cache directory, built for this port.
tree="$root/tree"
mkdir -p "$tree/approval-queue"
tar -C "$SRC/approval-queue" --anchored --exclude=./node_modules --exclude=./build --exclude=./.svelte-kit --exclude=./.stage \
  --exclude=./build.prev --exclude=./node_modules.prev -cf - . | tar -C "$tree/approval-queue" -xf -
app="$tree/approval-queue"
(cd "$app" && timeout 300 npm ci >"$root/npm-ci.log" 2>&1 && APPROVAL_QUEUE_PORT=$PORT timeout 300 npm run build >"$root/build.log" 2>&1) \
  || { echo "FAIL: the copy did not build"; tail -n 20 "$root/npm-ci.log" "$root/build.log" 2>/dev/null; exit 1; }

# The items: one of each kind, and a second stop item with a stale.json that names two differing heads.
stop=20261111T000001-1 close=20261111T000002-1 design=20261111T000003-1 stale=20261111T000004-1
(cd "$app" && node --input-type=module -e "
import { seedFacts } from './src/lib/server/seed-facts.ts';
const [state, ...ids] = process.argv.slice(1);
for (const [id, kind] of [[ids[0], 'stop'], [ids[1], 'close'], [ids[2], 'design'], [ids[3], 'stop']]) await seedFacts(state, id, kind);
" "$state" "$stop" "$close" "$design" "$stale") || { echo "FAIL: the items did not seed"; exit 1; }
# Three more waiting items in rounds, two decided items for the history page, and five digest lines.
rstop=20261111T000005-1 rclose=20261111T000006-1 wclose=20261111T000007-1 hdesign=20261110T000008-1 hround=20261110T000009-1
(cd "$app" && node --input-type=module -e "
import { seedFacts } from './src/lib/server/seed-facts.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const [state, rstop, rclose, wclose, hdesign, hround] = process.argv.slice(1);
const unattended = { initiative: 'unattended-rounds', created: '2026-11-11T12:00:00Z' };
await seedFacts(state, rstop, 'stop', { ...unattended, round: 'ur-queue', title: 'Queue stop title' });
await seedFacts(state, rclose, 'close', { ...unattended, round: 'ur-queue', title: 'Queue close title' });
await seedFacts(state, wclose, 'close', { ...unattended, round: 'ur-ws', title: 'Ws close title' });
const dir = join(state, 'items', hdesign);
await mkdir(dir, { recursive: true });
await writeFile(join(dir, 'item.json'), JSON.stringify({ id: hdesign, kind: 'design', title: 'Old design title', created: '2026-11-09T10:00:00Z' }));
await writeFile(join(dir, 'decision.json'), JSON.stringify({ decision: 'approve' }));
await seedFacts(state, hround, 'close', { round: 'ur-queue', title: 'Old round title', created: '2026-11-09T11:00:00Z' });
await writeFile(join(state, 'items', hround, 'decision.json'), JSON.stringify({ decision: 'approve' }));
" "$state" "$rstop" "$rclose" "$wclose" "$hdesign" "$hround") || { echo "FAIL: the round items did not seed"; exit 1; }
# Round report items: a waiting design, a waiting triage, a waiting report in round ur-queue (newer than its
# packets), a replaced report (a directory with no item.json), a decided triage, and a read report in round ur-ws.
wdesign=20261111T000010-1 wtriage=20261111T000011-1 wreport=20261111T000012-1 oreport=20261111T000013-1 htriage=20261110T000014-1 hreport=20261110T000015-1
(cd "$app" && node --input-type=module -e "
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const [state, wdesign, wtriage, wreport, oreport, htriage, hreport] = process.argv.slice(1);
const put = async (id, meta, files = {}) => {
  const dir = join(state, 'items', id);
  await mkdir(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
  if (meta) await writeFile(join(dir, 'item.json'), JSON.stringify({ id, repo: 'aq-fixture/sample', ...meta }));
};
const table = '| Pass | State |\n| --- | --- |\n| Q1 | merged |\n| Q2 | merged |\n| Q3 | parked |\n';
await put(wdesign, { kind: 'design', title: 'Waiting design title', created: '2026-11-11T08:00:00Z' }, { 'doc.md': '# d\n' });
await put(wtriage, { kind: 'triage', title: 'Waiting triage title', created: '2026-11-11T08:30:00Z' });
await put(wreport, { kind: 'report', title: 'Queue round report title', initiative: 'unattended-rounds', round: 'ur-queue', created: '2026-11-11T13:00:00Z' },
  { 'report.md': '# Queue round report title\n\nRound state: running\n\n' + table });
await put(oreport, null, { 'report.md': '# Replaced report\n\n' + table });
await put(htriage, { kind: 'triage', title: 'Old triage title', created: '2026-11-09T12:00:00Z' }, { 'decision.json': JSON.stringify({ decision: 'submit', rows: [] }) });
await put(hreport, { kind: 'report', title: 'Read report title', initiative: 'unattended-rounds', round: 'ur-ws', created: '2026-11-09T13:00:00Z' },
  { 'report.md': '# Read report title\n\n' + table, 'decision.json': '{\"decision\":\"read\"}' });
" "$state" "$wdesign" "$wtriage" "$wreport" "$oreport" "$htriage" "$hreport") || { echo "FAIL: the report items did not seed"; exit 1; }
dline() { jq -nc --arg r "$1" --arg c "$2" --arg t "$3" --arg round "${4:-}" \
  '{time: $t, ref: $r, head: "abc", claim: $c, lane: "land"} + (if $round == "" then {} else {round: $round} end)'; }
{
  dline aq-fixture/sample#11 "Claim plain one" 2026-11-10T10:00:00Z
  dline aq-fixture/sample#12 "Claim plain two" 2026-11-10T11:00:00Z
  dline aq-fixture/other#13 "Claim other repo" 2026-11-10T12:00:00Z
  dline aq-fixture/sample#14 "Claim round one" 2026-11-11T10:00:00Z ur-queue
  dline aq-fixture/sample#15 "Claim round two" 2026-11-11T11:00:00Z ur-queue
} >"$state/digest.jsonl"
sref=$(jq -r '.prs[0]' "$state/items/$stale/facts.json")
jq -n --arg r "$sref" '{ref: $r, queued: "aaaaaaaaa111", now: "bbbbbbbbb222"}' >"$state/items/$stale/stale.json"

# The stub directory holds copies of the pull request files, so the stub's gh.log never lands in this worktree.
export CT_STUB_DIR="$root/stub"
cp "$SRC"/tests/fixtures/ct/pr-*.json "$CT_STUB_DIR/"

# The server: no subshell and no cd, so $! is timeout's pid and ending it ends node.
HOST=127.0.0.1 PORT=$PORT APPROVAL_QUEUE_STATE="$state" PATH="$SRC/tests/fixtures/ct:$PATH" timeout 300 node "$app/build" >"$root/server.log" 2>&1 &
srv=$!
up=""
for _ in $(seq 100); do
  curl -sf --max-time 2 "$base/item/$stop" >"$root/stop.html" 2>/dev/null && { up=1; break; }
  sleep 0.1
done
[ -n "$up" ] || { echo "FAIL: the server did not answer"; cat "$root/server.log"; exit 1; }

# The listener must be this test's server: its command line holds the temporary root.
lp=$(ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | head -n 1 | cut -d= -f2)
tr '\0' ' ' <"/proc/${lp:-0}/cmdline" 2>/dev/null | grep -qF "$root/" || { echo "FAIL: the process on port $PORT is not this test's server"; exit 1; }

page() { curl -sf --max-time 5 "$base/item/$1" >"$root/$2.html" 2>/dev/null || { echo "FAIL: $2 page did not answer 200"; fail=1; : >"$root/$2.html"; }; }
page "$stop" stop
page "$close" close
page "$design" design
page "$stale" stale

# The stop page.
has "stop page" "$root/stop.html" "Pass parked until you answer."
has "stop page" "$root/stop.html" "Answering merges nothing. The session runs the steps below, then relaunches the pass."
lacks "stop page" "$root/stop.html" "Pass paused until you decide."
assert_eq "$(primary "$root/stop.html")" "Answer and resume" "stop page: the primary buttons"

# The close and design pages keep "Approve".
for k in close design; do
  case "$(primary "$root/$k.html")" in "Approve"*) ;; *) echo "FAIL: $k page: primary button reads '$(primary "$root/$k.html")'"; fail=1 ;; esac
  lacks "$k page" "$root/$k.html" "Answer and resume"
  lacks "$k page" "$root/$k.html" "Answering merges nothing"
done

# The out-of-date stop page: the alert names the button's label, and the button is disabled.
has "stale page" "$root/stale.html" "Out of date."
has "stale page" "$root/stale.html" "Answer and resume is off."
lacks "stale page" "$root/stale.html" "Approve is off."
case "$(primary "$root/stale.html")" in "Answer and resume"*) ;; *) echo "FAIL: stale page: primary button reads '$(primary "$root/stale.html")'"; fail=1 ;; esac
tr '\n\t' '  ' <"$root/stale.html" | grep -q '<button[^>]*btn btn-primary[^>]*disabled=""' || { echo "FAIL: stale page: the primary button is not disabled"; fail=1; }

# The end-to-end stub answers the two reads the commands make.
stubout=$(PATH="$SRC/tests/fixtures/ct:$PATH" gh repo view aq-fixture/sample --json defaultBranchRef 2>&1)
assert_eq "$stubout" '{"defaultBranchRef":{"name":"main"}}' "stub: repo view"
stubout=$(PATH="$SRC/tests/fixtures/ct:$PATH" gh pr view 1 --repo aq-fixture/sample --json baseRefName 2>&1)
assert_eq "$stubout" '{"baseRefName":"main"}' "stub: pr view base"

# pos <file> <text>: the offset of the text in the file's one-line form, 0 when it is absent.
pos() { tr '\n\t' '  ' <"$1" | awk -v t="$2" '{print index($0, t)}'; }
# The rail renders on every page, so each check below reads one part of the page.
tr '\n\t' '  ' <"$root/stop.html" | grep -o '<nav id="rail".*</nav>' >"$root/rail.html"
assert_eq "$(grep -o 'Round ur-queue' "$root/rail.html" | wc -l)" 1 "rail: Round ur-queue once"
assert_eq "$(grep -o 'Round ur-ws' "$root/rail.html" | wc -l)" 1 "rail: Round ur-ws once"
assert_eq "$(grep -o 'data-q' "$root/rail.html" | wc -l)" 10 "rail: ten entries"
first=$(pos "$root/rail.html" "Round ur-queue")
for id in "$stop" "$close" "$design" "$stale"; do
  at=$(pos "$root/rail.html" "/item/$id")
  { [ "$at" -gt 0 ] && [ "$at" -lt "$first" ]; } || { echo "FAIL: rail: $id is not before the first round heading"; fail=1; }
done
for t in "Queue stop title" "Queue close title" "Ws close title"; do
  [ "$(pos "$root/rail.html" "$t")" -gt "$first" ] || { echo "FAIL: rail: '$t' is not after the first round heading"; fail=1; }
done

# The status line: one <p class="kicker"> line.
page "$rstop" rstop
tr '\n\t' '  ' <"$root/rstop.html" | grep -o '<p class="kicker">[^/]*/b>[^<]*</p>' >"$root/rstop.kicker"
has "status line" "$root/rstop.kicker" "Round ur-queue of unattended-rounds"
tr '\n\t' '  ' <"$root/stop.html" | grep -o '<p class="kicker">[^/]*/b>[^<]*</p>' >"$root/stop.kicker"
has "status line, no round" "$root/stop.kicker" "Pass parked"
lacks "status line, no round" "$root/stop.kicker" "Round "

# The board's data: the second node holds all seven waiting items and both rounds.
curl -sf --max-time 5 "$base/__data.json" >"$root/board.json" || { echo "FAIL: /__data.json did not answer 200"; fail=1; : >"$root/board.json"; }
jq -c '.nodes[1]' "$root/board.json" >"$root/board-node.json" 2>/dev/null
for id in "$stop" "$close" "$design" "$stale" "$rstop" "$rclose" "$wclose"; do has "board data" "$root/board-node.json" "$id"; done
has "board data" "$root/board-node.json" 'ur-queue'
has "board data" "$root/board-node.json" 'ur-ws'

# The digest page: its main element holds the five claims and one heading each for the round and no round.
curl -sf --max-time 5 "$base/digest" >"$root/digest.html" || { echo "FAIL: /digest did not answer 200"; fail=1; : >"$root/digest.html"; }
tr '\n\t' '  ' <"$root/digest.html" | grep -o '<main id="main".*</main>' >"$root/digest.main"
for c in "Claim plain one" "Claim plain two" "Claim other repo" "Claim round one" "Claim round two"; do has "digest" "$root/digest.main" "$c"; done
assert_eq "$(grep -o 'Round ur-queue' "$root/digest.main" | wc -l)" 1 "digest: Round ur-queue once"
assert_eq "$(grep -o 'No round' "$root/digest.main" | wc -l)" 1 "digest: No round once"

# The history page: both decided items, one of them in a round and one a design.
curl -sf --max-time 5 "$base/history" >"$root/history.html" || { echo "FAIL: /history did not answer 200"; fail=1; : >"$root/history.html"; }
has "history" "$root/history.html" "Old design title"
has "history" "$root/history.html" "Old round title"
has "history" "$root/history.html" "Old triage title"
has "history" "$root/history.html" "Read report title"
tr '\n\t' '  ' <"$root/history.html" | grep -o '<main id="main".*</main>' >"$root/history.main"
has "history" "$root/history.main" "Round report"
has "history" "$root/history.main" "Read"
lacks "history" "$root/history.main" "Queue round report title"

# Round reports. The board holds one report row, and the rail leads its round with the report and its words.
ridx=$(jq '.nodes[1].data | index("Round report")' "$root/board.json")
assert_eq "$(jq --argjson i "$ridx" '[.nodes[1].data[] | select(type == "object" and .single == $i)] | length' "$root/board.json")" 1 "board data: one Round report row"
has "board data" "$root/board-node.json" "$wreport"
has "board data" "$root/board-node.json" "2 of 3 passes merged, 1 parked"
lacks "board data" "$root/board-node.json" "$oreport"
lacks "board data" "$root/board-node.json" "$hreport"
has "rail" "$root/rail.html" "2 of 3 passes merged, 1 parked"
has "rail" "$root/rail.html" "Round report, "
{ [ "$(pos "$root/rail.html" "/item/$wreport")" -gt "$first" ] && [ "$(pos "$root/rail.html" "/item/$wreport")" -lt "$(pos "$root/rail.html" "/item/$rstop")" ]; } \
  || { echo "FAIL: rail: the report does not lead its round"; fail=1; }

# The report page: the title, the Markdown table, the waiting packets and landed pull requests of its round, and one button.
page "$wreport" report
tr '\n\t' '  ' <"$root/report.html" | grep -o '<main id="main".*</main>' >"$root/report.main"
has "report page" "$root/report.main" "Queue round report title"
has "report page" "$root/report.main" "Round report, "
has "report page" "$root/report.main" "<table"
has "report page" "$root/report.main" "Waiting in this round"
has "report page" "$root/report.main" "/item/$rstop"
has "report page" "$root/report.main" "/item/$rclose"
lacks "report page" "$root/report.main" "/item/$wclose"
has "report page" "$root/report.main" "Landed in this round"
has "report page" "$root/report.main" "https://github.com/aq-fixture/sample/pull/14"
has "report page" "$root/report.main" "https://github.com/aq-fixture/sample/pull/15"
assert_eq "$(grep -o 'Mark read' "$root/report.main" | wc -l)" 1 "report page: one Mark read button"

# A read report's page says Read and offers no button.
page "$hreport" hreport
tr '\n\t' '  ' <"$root/hreport.html" | grep -o '<main id="main".*</main>' >"$root/hreport.main"
has "read report page" "$root/hreport.main" "Read report title"
has "read report page" "$root/hreport.main" "Read, "
lacks "read report page" "$root/hreport.main" "Mark read"

# Screenshots of the board and the digest page, when the caller asks for them.
if [ -n "${PAGE_TEST_ROUND_SHOTS:-}" ]; then
  node "$SRC/tests/fixtures/ct/round-shot.mjs" "$base" "$stop" "$PAGE_TEST_ROUND_SHOTS" "$wreport" || { echo "FAIL: the round screenshots failed"; fail=1; }
fi

# A screenshot of the stop page, when the caller asks for one.
if [ -n "${PAGE_TEST_SHOT:-}" ]; then
  node "$SRC/tests/fixtures/ct/shot.mjs" "$base/item/$stop" "$PAGE_TEST_SHOT" || { echo "FAIL: the screenshot failed"; fail=1; }
fi

# The command and the app joined: the worktree's report command stores a report into the served state through a
# symlinked state home, and a second report for the same round replaces the first on the board.
mkdir -p "$root/xdg" "$root/projects/initiatives/unattended-rounds"
ln -s "$state" "$root/xdg/approval-queue"
: >"$root/projects/initiatives/unattended-rounds/initiative.yaml"
printf '# Std round report\n\nRound state: running\n\n| Pass | State |\n| --- | --- |\n| Q1 | merged |\n' >"$root/joined1.md"
printf '# Std round report, second\n\nRound state: running\n\n| Pass | State |\n| --- | --- |\n| Q1 | merged |\n| Q2 | merged |\n' >"$root/joined2.md"
jr1=$(XDG_STATE_HOME="$root/xdg" APPROVAL_QUEUE_PROJECTS="$root/projects" APPROVAL_QUEUE_PORT=$PORT timeout 10 "$SRC/bin/.local/bin/approval-queue" report unattended-rounds ur-std "$root/joined1.md")
sleep 1
jr2=$(XDG_STATE_HOME="$root/xdg" APPROVAL_QUEUE_PROJECTS="$root/projects" APPROVAL_QUEUE_PORT=$PORT timeout 10 "$SRC/bin/.local/bin/approval-queue" report unattended-rounds ur-std "$root/joined2.md")
{ [ -n "$jr1" ] && [ -n "$jr2" ] && [ "$jr1" != "$jr2" ]; } || { echo "FAIL: joined: the two report commands printed '$jr1' and '$jr2'"; fail=1; }
curl -sf --max-time 5 "$base/__data.json" >"$root/board3.json" || { echo "FAIL: /__data.json did not answer 200 after report"; fail=1; : >"$root/board3.json"; }
has "joined board" "$root/board3.json" "$jr2"
lacks "joined board" "$root/board3.json" "$jr1"
has "joined board" "$root/board3.json" "$wreport"
page "$jr2" jreport
has "joined report page" "$root/jreport.html" "Std round report, second"
has "joined report page" "$root/jreport.html" "Mark read"
tr '\n\t' '  ' <"$root/jreport.html" | grep -o '<nav id="rail".*</nav>' >"$root/jrail.html"
tr '\n\t' '  ' <"$root/jreport.html" | grep -o '<main id="main".*</main>' >"$root/jreport.main"
has "joined report page" "$root/jreport.main" "Q2"
assert_eq "$(grep -o 'Round ur-std' "$root/jrail.html" | wc -l)" 1 "joined rail: Round ur-std once"
has "joined rail" "$root/jrail.html" "/item/$jr2"
lacks "joined rail" "$root/jrail.html" "/item/$jr1"

# Mark read, last because it changes the state the checks above read. It stores only the read decision, merges
# nothing, and moves the report from the board to the history.
code=$(curl -s -o "$root/read.out" -w '%{http_code}' --max-time 5 -X POST --data '' -H "Origin: $base" "$base/item/$wreport?/read")
{ [ "$code" -ge 200 ] && [ "$code" -lt 400 ]; } || { echo "FAIL: Mark read answered $code"; fail=1; }
assert_eq "$(cat "$state/items/$wreport/decision.json" 2>/dev/null)" '{"decision":"read"}' "Mark read: decision.json"
[ ! -e "$state/decisions.jsonl" ] || { echo "FAIL: Mark read wrote decisions.jsonl"; fail=1; }
! grep -q 'pr merge' "$CT_STUB_DIR/gh.log" 2>/dev/null || { echo "FAIL: Mark read ran gh pr merge"; fail=1; }
curl -sf --max-time 5 "$base/history" >"$root/history2.html" || { echo "FAIL: /history did not answer 200 after Mark read"; fail=1; : >"$root/history2.html"; }
has "history after Mark read" "$root/history2.html" "Queue round report title"
curl -sf --max-time 5 "$base/__data.json" >"$root/board2.json" || { echo "FAIL: /__data.json did not answer 200 after Mark read"; fail=1; : >"$root/board2.json"; }
lacks "board data after Mark read" "$root/board2.json" "$wreport"

[ "$fail" = 0 ] && echo "page: ok"
exit "$fail"
