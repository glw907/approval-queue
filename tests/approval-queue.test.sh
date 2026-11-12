#!/usr/bin/env bash
# approval-queue.test.sh: prove the approval-queue command against this worktree's own copy, with
# curl, xdg-open, setsid, and gh stubbed on PATH. Never starts the app or opens a browser.
set -uo pipefail
cd "$(dirname "$0")/.."
SCRIPT="$(pwd)/bin/.local/bin/approval-queue"
fail=0
root="$(mktemp -d)"
bgpid=""
trap '[ -n "$bgpid" ] && kill "$bgpid" 2>/dev/null; rm -rf "$root"' EXIT

assert_eq() {
  [ "$1" = "$2" ] || { echo "FAIL: $3: got '$1', want '$2'"; fail=1; }
}

stubs="$root/stubs"
mkdir -p "$stubs"
cat >"$stubs/curl" <<'STUB'
#!/usr/bin/env bash
case "$*" in *"/item/"*) [ -z "${STUB_ITEM_FAILS:-}" ] || exit 22 ;; esac
exit 0
STUB
cat >"$stubs/xdg-open" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$STUB_DIR/open.record"
STUB
cat >"$stubs/setsid" <<'STUB'
#!/usr/bin/env bash
[ "$1" = "-f" ] && shift
exec "$@"
STUB
cat >"$stubs/gh" <<'STUB'
#!/usr/bin/env bash
case "$2" in
  view) jq -n --rawfile body "$STUB_DIR/body.md" '{"body":$body,"headRefOid":"abc123","number":42,"url":"https://github.com/owner/repo/pull/42","headRefName":"feat","baseRefName":"main","statusCheckRollup":[{"name":"make check","workflowName":"tool","status":"COMPLETED","conclusion":"SUCCESS"}]}' ;;
  diff) echo 'diff --git a/x b/x' ;;
esac
STUB
chmod +x "$stubs"/*

export STUB_DIR="$root" XDG_STATE_HOME="$root/state" PATH="$stubs:$PATH"
state="$XDG_STATE_HOME/approval-queue"
log="$state/decisions.jsonl"
source tests/collect-check.sh
cat >"$root/body.md" <<'BRIEF'
## Brief

The queue now refuses an item with no brief.

A session that skips the brief gets a message naming the fix, so every item arrives readable.

### What changes

- The command checks the brief before it queues anything.

### If you approve

1. The PR merges.
BRIEF
{ printf '# design\n\n'; cat "$root/body.md"; } >"$root/design.md"
cat >"$root/triage.json" <<'TRIAGE'
{"headline":"One call needs you.","lede":"The session proposes one now.","rows":[{"action":"a","why":"r","proposed":"now"}]}
TRIAGE

# wait_for <glob>: up to 5 seconds; on a timeout, fails the test and kills the background job.
wait_for() {
  local i
  for i in $(seq 50); do compgen -G "$1" >/dev/null && return 0; sleep 0.1; done
  echo "FAIL: timed out waiting for $1"; fail=1
  kill "$bgpid" 2>/dev/null; wait "$bgpid" 2>/dev/null; bgpid=""
  return 1
}

# run_kind <kind> <source> <content files>
run_kind() {
  local kind=$1 source=$2 files=$3 dir id f want i
  rm -rf "$state/items" "$state/tab.seen" "$root/open.record"
  bash "$SCRIPT" "$kind" owner/repo "A title" "$source" >"$root/out" 2>"$root/err" &
  bgpid=$!
  wait_for "$state/items/*/item.json" || return
  dir=$(dirname "$(ls "$state"/items/*/item.json | head -1)")
  id=$(basename "$dir")
  echo "$id" | grep -Eq '^[0-9]{8}T[0-9]{6}-[0-9]+$' || { echo "FAIL: $kind: id '$id'"; fail=1; }
  jq -e '.created | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")' "$dir/item.json" >/dev/null \
    || { echo "FAIL: $kind: created"; fail=1; }
  assert_eq "$(jq -r '.kind + "|" + .repo + "|" + .title' "$dir/item.json")" "$kind|owner/repo|A title" "$kind: item fields"
  want_headline="The queue now refuses an item with no brief."
  [ "$kind" != triage ] || want_headline="One call needs you."
  assert_eq "$(jq -r .headline "$dir/item.json")" "$want_headline" "$kind: headline"
  assert_eq "$(jq -r '[(.pid | type), (.pidStart | type), (.pid as $p | .id | endswith("-\($p)"))] | join(" ")' "$dir/item.json")" "number number true" "$kind: pid and pidStart"
  for f in $files; do [ -e "$dir/$f" ] || { echo "FAIL: $kind: missing $f"; fail=1; }; done
  assert_eq "$(jq 'has("head")' "$dir/item.json")" "false" "$kind: no head"
  [ "$kind" != design ] || assert_eq "$(jq -r .file "$dir/item.json")" "design.md" "design: file"
  wait_for "$root/open.record" || return
  assert_eq "$(cat "$root/open.record")" "http://127.0.0.1:7907/item/$id" "$kind: xdg-open args"
  [ -e "$state/tab.seen" ] || { echo "FAIL: $kind: opening a tab did not stamp tab.seen"; fail=1; }
  printf '{"decision":"approve"}\n' >"$dir/decision.json.tmp"
  mv "$dir/decision.json.tmp" "$dir/decision.json"
  # The command polls once a second, so allow up to five.
  for i in $(seq 50); do kill -0 "$bgpid" 2>/dev/null || break; sleep 0.1; done
  if kill -0 "$bgpid" 2>/dev/null; then
    echo "FAIL: $kind: did not exit after the decision"; fail=1
    kill "$bgpid"; wait "$bgpid" 2>/dev/null; bgpid=""; return
  fi
  wait "$bgpid"; assert_eq "$?" "0" "$kind: exit code"; bgpid=""
  assert_eq "$(cat "$root/out")" '{"decision":"approve"}' "$kind: stdout"
  grep -Fxq "approval-queue: queued $id at http://127.0.0.1:7907/item/$id" "$root/err" \
    || { echo "FAIL: $kind: the queued link is not on stderr: $(cat "$root/err")"; fail=1; }
  # A triage logs nothing, so there is nothing to log once.
  [ "$kind" = triage ] || collect_check "$kind" "$dir"
}

run_kind design "$root/design.md" "doc.md"
run_kind triage "$root/triage.json" "triage.json"

# hand_over <label>: runs a design handover with tab.seen as the caller left it, decides it once
# item.json lands, and prints how many tabs the command opened.
hand_over() {
  rm -rf "$state/items" "$root/open.record"
  bash "$SCRIPT" design owner/repo T "$root/design.md" >/dev/null 2>&1 &
  bgpid=$!
  wait_for "$state/items/*/item.json" || return
  local dir
  dir=$(dirname "$(ls "$state"/items/*/item.json | head -1)")
  # Long enough for the command to act on tab.seen before the decision lets it exit.
  sleep 1
  printf '{"decision":"approve"}\n' >"$dir/decision.json"
  wait "$bgpid"; bgpid=""
  if [ -e "$root/open.record" ]; then wc -l <"$root/open.record"; else echo 0; fi
}

# A live tab, polling every half second here, takes the item: no new tab.
mkdir -p "$state"; touch "$state/tab.seen"
( while :; do touch "$state/tab.seen"; sleep 0.5; done ) &
poller=$!
assert_eq "$(hand_over)" "0" "live tab: tabs opened"
kill "$poller"; wait "$poller" 2>/dev/null

# A tab.seen older than 5 seconds is a closed tab: the command opens one.
touch -d '-1 minute' "$state/tab.seen"
assert_eq "$(hand_over)" "1" "stale tab.seen: tabs opened"

# Two handovers at once with no tab open: the first opens one, the second hands its item to it.
rm -rf "$state/items" "$state/tab.seen" "$root/open.record"
bash "$SCRIPT" design owner/repo T1 "$root/design.md" >/dev/null 2>&1 &
p1=$!
bash "$SCRIPT" design owner/repo T2 "$root/design.md" >/dev/null 2>&1 &
p2=$!
# The opened tab polls like a real one, so a command that queued its item after the first
# stamp of tab.seen still finds the tab inside its 5-second wait.
wait_for "$root/open.record"
( while :; do touch "$state/tab.seen"; sleep 0.5; done ) &
poller=$!
for _ in $(seq 50); do [ "$(ls "$state"/items/*/item.json 2>/dev/null | wc -l)" = 2 ] && break; sleep 0.1; done
sleep 1
for d in "$state"/items/*/; do printf '{"decision":"approve"}\n' >"$d/decision.json"; done
wait "$p1" "$p2"
kill "$poller"; wait "$poller" 2>/dev/null
assert_eq "$(wc -l <"$root/open.record" 2>/dev/null)" "1" "concurrent: tabs opened"
# TERM to a waiting command: exit 143, and item.json stays for collect (#59).
# TERM to a waiting command: exit 143, no item.json.
rm -rf "$state/items" "$state/tab.seen" "$root/open.record"
bash "$SCRIPT" design owner/repo T "$root/design.md" >/dev/null 2>&1 &
bgpid=$!
if wait_for "$root/open.record"; then
  kill -TERM "$bgpid"
  for _ in $(seq 50); do kill -0 "$bgpid" 2>/dev/null || break; sleep 0.1; done
  if kill -0 "$bgpid" 2>/dev/null; then
    echo "FAIL: TERM: still running"; fail=1; kill -KILL "$bgpid"; wait "$bgpid" 2>/dev/null
  else
    wait "$bgpid"; assert_eq "$?" "143" "TERM: exit code"
  fi
  bgpid=""
  compgen -G "$state/items/*/item.json" >/dev/null || { echo "FAIL: TERM: item.json was removed"; fail=1; }
fi

# The app answers / but does not serve the item: exit 1.
rm -rf "$state/items"
STUB_ITEM_FAILS=1 bash "$SCRIPT" design owner/repo T "$root/design.md" >/dev/null 2>"$root/err"
assert_eq "$?" "1" "item not served: exit code"
grep -q 'does not serve this state root' "$root/err" || { echo "FAIL: item not served: message"; fail=1; }
! grep -q 'queued' "$root/err" || { echo "FAIL: item not served: printed a queued link"; fail=1; }

# A brief defect refuses before queuing: exit 2, the message, no item directory.
refuse() {
  local label=$1 want=$2
  shift 2
  rm -rf "$state/items"
  "$@" >/dev/null 2>"$root/err"
  assert_eq "$?" "2" "$label: exit code"
  grep -q -- "$want" "$root/err" || { echo "FAIL: $label: message lacks '$want': $(cat "$root/err")"; fail=1; }
  ! compgen -G "$state/items/*" >/dev/null || { echo "FAIL: $label: left an item directory"; fail=1; }
}
grep -v -e '^### If you approve' -e '^1\. The PR merges' "$root/design.md" >"$root/design-bad.md"
refuse "design missing If you approve" 'If you approve' bash "$SCRIPT" design owner/repo T "$root/design-bad.md"
printf '[{"item":"a","disposition":"now","reason":"r"}]\n' >"$root/triage-old.json"
refuse "old triage shape" 'old triage shape' bash "$SCRIPT" triage owner/repo T "$root/triage-old.json"

# The fixtures under approval-queue/src/lib/fixtures pass the check, run with no approval-queue/node_modules in
# play: the design and triage briefs, and a design, a close, and a stop pair of fact file and text. The close and
# stop pairs also pass with their snapshot, which checks each claim's line range.
fx=approval-queue/src/lib/fixtures
node "$fx/../../check-brief.ts" design "$fx/pr-40-brief.md" >/dev/null 2>"$root/err" \
  || { echo "FAIL: the design brief fixture fails the check: $(cat "$root/err")"; fail=1; }
node "$fx/../../check-brief.ts" triage "$fx/sample-triage.json" >/dev/null 2>"$root/err" \
  || { echo "FAIL: the triage brief fixture fails the check: $(cat "$root/err")"; fail=1; }
for pair in design close stop; do
  node "$fx/../../check-brief.ts" facts "$fx/$pair-facts.json" "$fx/$pair-text.md" "$fx/snapshot" >"$root/facts-$pair.json" 2>"$root/err" \
    || { echo "FAIL: the $pair fixture pair fails the check: $(cat "$root/err")"; fail=1; }
done
assert_eq "$(jq -r '[.facts.kind, (.facts.calls | length), (.text.claims | length)] | join(" ")' "$root/facts-stop.json")" "stop 3 5" "stop fixture: parse"
sed 's/ \[aq-fixture\/sample#1 lib\/queue.test.ts:1-4\]//' "$fx/close-text.md" >"$root/close-bad.md"
node "$fx/../../check-brief.ts" facts "$fx/close-facts.json" "$root/close-bad.md" >/dev/null 2>"$root/err"
assert_eq "$?" "2" "a claim with no citation: exit code"
grep -q 'no citation' "$root/err" || { echo "FAIL: a claim with no citation: message '$(cat "$root/err")'"; fail=1; }

bash "$SCRIPT" bogus owner/repo T "$root/design.md" >/dev/null 2>&1
assert_eq "$?" "2" "bad kind: exit code"
bash "$SCRIPT" design owner/repo T >/dev/null 2>&1
assert_eq "$?" "2" "missing argument: exit code"

# report: stores a round's report as an item of kind report, replaces a waiting one, and never waits.
rp="$root/rprojects"
mkdir -p "$rp/initiatives/unattended-rounds" "$rp/initiatives/other"
printf 'title: Unattended rounds\nstatus: active\n' >"$rp/initiatives/unattended-rounds/initiative.yaml"
printf 'title: Other\nstatus: active\n' >"$rp/initiatives/other/initiative.yaml"
cat >"$root/report1.md" <<'REPORT'
# Round ur-queue, aq-fixture/sample, written 2026-11-12 06:14
Round state: running

| Pass | State | PR | Planned min | Actual min |
| --- | --- | --- | --- | --- |
| Q1 | merged | #51 | 60 | 31 |
| Q2 | merged | #52 | 90 | 44 |
| Q3 | merged | #53 | 120 | 70 |
| Q4 | parked | #54 | 120 | 38 |

Stops: 1
Refusals: 0
Waiting for Geoff: one stop packet
REPORT
sed 's/| 38 |/| 39 |/' "$root/report1.md" >"$root/report2.md"
rep() { APPROVAL_QUEUE_PROJECTS="$rp" timeout 10 bash "$SCRIPT" report "$@"; }
rcount() { find "$state/items" -mindepth 1 -maxdepth 1 -type d | wc -l; }
rwaiting() {
  local d n=0
  for d in "$state"/items/*/; do
    [ -e "$d/item.json" ] && [ ! -e "$d/decision.json" ] && [ "$(jq -r .kind "$d/item.json")" = report ] \
      && [ "$(jq -r .round "$d/item.json")" = "$1" ] && [ "$(jq -r .initiative "$d/item.json")" = unattended-rounds ] && n=$((n + 1))
  done
  echo "$n"
}
rm -rf "$state/items"
mkdir -p "$state"
: >"$root/open.record"
opens=$(wc -l <"$root/open.record")

# 1: the stored item
r1=$(rep unattended-rounds ur-queue "$root/report1.md" 2>"$root/err")
assert_eq "$?" "0" "report: exit code"
[[ $r1 =~ ^[0-9]{8}T[0-9]{6}-[0-9]+$ ]] || { echo "FAIL: report: id '$r1'"; fail=1; }
assert_eq "$(jq -r 'keys | join(" ")' "$state/items/$r1/item.json" 2>/dev/null)" "created id initiative kind round title" "report: item.json keys"
assert_eq "$(jq -r '[.kind, .round, .initiative, .title] | join("|")' "$state/items/$r1/item.json" 2>/dev/null)" "report|ur-queue|unattended-rounds|Round ur-queue, aq-fixture/sample, written 2026-11-12 06:14" "report: item.json values"
cmp -s "$state/items/$r1/report.md" "$root/report1.md" || { echo "FAIL: report: report.md is not a byte copy"; fail=1; }
assert_eq "$(wc -l <"$root/open.record")" "$opens" "report: opens no tab"

# 2: the title when the first line is no heading
printf 'Round state: running\n' >"$root/report-nohead.md"
rn=$(rep unattended-rounds ur-ws "$root/report-nohead.md" 2>"$root/err")
assert_eq "$(jq -r .title "$state/items/$rn/item.json" 2>/dev/null)" "Round ur-ws" "report: title with no heading"

# 3: a second report replaces the waiting one
r2=$(rep unattended-rounds ur-queue "$root/report2.md" 2>"$root/err")
assert_eq "$?" "0" "report: second exit code"
[ -n "$r2" ] && [ "$r2" != "$r1" ] || { echo "FAIL: report: second id '$r2' equals the first '$r1'"; fail=1; }
[ ! -e "$state/items/$r1/item.json" ] || { echo "FAIL: report: the replaced report keeps item.json"; fail=1; }
assert_eq "$(rwaiting ur-queue)" "1" "report: one waiting report for the round"
cmp -s "$state/items/$r2/report.md" "$root/report2.md" || { echo "FAIL: report: the waiting report is not the second file"; fail=1; }

# 4: another round, and another initiative, leave it in place
rep unattended-rounds ur-ws "$root/report1.md" >/dev/null 2>&1
rep other ur-queue "$root/report1.md" >/dev/null 2>&1
[ -e "$state/items/$r2/item.json" ] || { echo "FAIL: report: another round or initiative retired the waiting report"; fail=1; }
assert_eq "$(rwaiting ur-queue)" "1" "report: still one waiting report for the round"

# 5: a read report stays, and a new one queues beside it
printf '{"decision":"read"}\n' >"$state/items/$r2/decision.json"
r3=$(rep unattended-rounds ur-queue "$root/report1.md" 2>"$root/err")
[ -e "$state/items/$r2/item.json" ] && [ -e "$state/items/$r2/decision.json" ] || { echo "FAIL: report: a read report was retired"; fail=1; }
assert_eq "$(rwaiting ur-queue)" "1" "report: a new report queues beside a read one"
[ -e "$state/items/$r3/item.json" ] || { echo "FAIL: report: the new report is not queued"; fail=1; }

# 6: refusals write nothing
before=$(rcount)
for bad in Ur-queue ur-queue-long; do
  rep unattended-rounds "$bad" "$root/report1.md" >/dev/null 2>"$root/err"
  assert_eq "$?" "2" "report: round $bad exit code"
  grep -q 'lowercase letters, digits, and hyphens, starting with a letter, 12 characters at most' "$root/err" || { echo "FAIL: report: round $bad message '$(cat "$root/err")'"; fail=1; }
done
rep nope ur-queue "$root/report1.md" >/dev/null 2>"$root/err"
assert_eq "$?" "2" "report: bad initiative exit code"
grep -q 'initiative.yaml' "$root/err" || { echo "FAIL: report: bad initiative message '$(cat "$root/err")'"; fail=1; }
rep unattended-rounds ur-queue >/dev/null 2>"$root/err"
assert_eq "$?" "2" "report: two arguments exit code"
grep -q 'approval-queue report <initiative> <round> <report.md>' "$root/err" || { echo "FAIL: report: usage line missing on two arguments"; fail=1; }
rep unattended-rounds ur-queue "$root/report1.md" extra >/dev/null 2>"$root/err"
assert_eq "$?" "2" "report: four arguments exit code"
rep unattended-rounds ur-queue "$root/nonexistent.md" >/dev/null 2>"$root/err"
assert_eq "$?" "1" "report: unreadable file exit code"
grep -q 'cannot read' "$root/err" || { echo "FAIL: report: unreadable message '$(cat "$root/err")'"; fail=1; }
: >"$root/report-empty.md"
rep unattended-rounds ur-queue "$root/report-empty.md" >/dev/null 2>"$root/err"
assert_eq "$?" "2" "report: empty file exit code"
printf '\n  \n' >"$root/report-blank.md"
rep unattended-rounds ur-queue "$root/report-blank.md" >/dev/null 2>"$root/err"
assert_eq "$?" "2" "report: blank file exit code"
assert_eq "$(rcount)" "$before" "report: refusals leave the item count alone"
assert_eq "$(rwaiting ur-queue)" "1" "report: refusals leave the waiting report"

# 7, 8: merge, collect, and withdraw refuse a report, waiting or read
for id in "$r3" "$r2"; do
  bash "$SCRIPT" merge "$id" >/dev/null 2>"$root/err"
  assert_eq "$?" "2" "report: merge $id exit code"
  grep -q 'a report is never merged' "$root/err" || { echo "FAIL: report: merge message '$(cat "$root/err")'"; fail=1; }
  bash "$SCRIPT" collect "$id" >/dev/null 2>"$root/err"
  assert_eq "$?" "2" "report: collect $id exit code"
  grep -q 'a report holds no decision to collect' "$root/err" || { echo "FAIL: report: collect message '$(cat "$root/err")'"; fail=1; }
  bash "$SCRIPT" withdraw "$id" >/dev/null 2>"$root/err"
  assert_eq "$?" "2" "report: withdraw $id exit code"
  grep -q 'replaces it' "$root/err" || { echo "FAIL: report: withdraw message '$(cat "$root/err")'"; fail=1; }
  [ -e "$state/items/$id/item.json" ] || { echo "FAIL: report: withdraw removed item.json of $id"; fail=1; }
done

# 9: nothing above wrote a decision line for a report
if [ -e "$log" ]; then
  for id in "$r1" "$r2" "$r3" "$rn"; do
    ! grep -qF -- "$id" "$log" || { echo "FAIL: report: decisions.jsonl names $id"; fail=1; }
  done
fi

# 10: the usage text lists the form
bash "$SCRIPT" bogus >"$root/usage.out" 2>&1
grep -q 'approval-queue report <initiative> <round> <report.md>' "$root/usage.out" || { echo "FAIL: report: usage text lacks the report form"; fail=1; }

# 11: an empty state directory
emptyx="$root/emptyxdg"
mkdir -p "$emptyx"
re=$(XDG_STATE_HOME="$emptyx" rep unattended-rounds ur-queue "$root/report1.md" 2>"$root/err")
assert_eq "$?" "0" "report: empty state exit code"
[ -e "$emptyx/approval-queue/items/$re/item.json" ] || { echo "FAIL: report: empty state wrote no item"; fail=1; }

# 12: two waiting reports for a round collapse to one
for n in 1 2; do
  d="$state/items/20261112T00000$n-1$n"
  mkdir -p "$d"
  printf 'x\n' >"$d/report.md"
  jq -n --arg id "20261112T00000$n-1$n" '{id: $id, kind: "report", title: "t", initiative: "unattended-rounds", round: "ur-std", created: "2026-11-12T00:00:00Z"}' >"$d/item.json"
done
rep unattended-rounds ur-std "$root/report1.md" >/dev/null 2>&1
assert_eq "$(rwaiting ur-std)" "1" "report: two waiting reports collapse to one"
for n in 1 2; do
  [ ! -e "$state/items/20261112T00000$n-1$n/item.json" ] || { echo "FAIL: report: hand-made report $n kept item.json"; fail=1; }
done

[ "$fail" = 0 ] && echo "approval-queue: ok"
exit "$fail"
