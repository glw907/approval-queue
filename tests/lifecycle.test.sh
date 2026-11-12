#!/usr/bin/env bash
# lifecycle.test.sh: prove `withdraw`, `collect`, the stop signals, and the retired forms of the approval-queue
# command against this worktree's own copy, with curl, xdg-open, and setsid stubbed on PATH. Never starts the app, opens a browser,
# or touches the live queue state. The per-kind pid fields and collect checks live in each kind's own test.
set -uo pipefail
cd "$(dirname "$0")/.."
SCRIPT="$(pwd)/bin/.local/bin/approval-queue"
fail=0
root="$(mktemp -d)"
bgpid=""
sleeper=""
trap '[ -n "$bgpid" ] && kill "$bgpid" 2>/dev/null; [ -n "$sleeper" ] && kill "$sleeper" 2>/dev/null; rm -rf "$root"' EXIT

assert_eq() {
  [ "$1" = "$2" ] || { echo "FAIL: $3: got '$1', want '$2'"; fail=1; }
}

stubs="$root/stubs"
mkdir -p "$stubs"
printf '#!/usr/bin/env bash\nexit 0\n' >"$stubs/curl"
printf '#!/usr/bin/env bash\nexit 0\n' >"$stubs/xdg-open"
printf '#!/usr/bin/env bash\n[ "$1" = "-f" ] && shift\nexec "$@"\n' >"$stubs/setsid"
chmod +x "$stubs"/*
export XDG_STATE_HOME="$root/state" PATH="$stubs:$PATH"
state="$XDG_STATE_HOME/approval-queue"
log="$state/decisions.jsonl"
cat >"$root/design.md" <<'BRIEF'
# design

## Brief

The queue now refuses an item with no brief.

A session that skips the brief gets a message naming the fix, so every item arrives readable.

### What changes

- The command checks the brief before it queues anything.

### If you approve

1. The PR merges.
BRIEF

wait_for() {
  local i
  for i in $(seq 50); do compgen -G "$1" >/dev/null && return 0; sleep 0.1; done
  echo "FAIL: timed out waiting for $1"; fail=1
  kill "$bgpid" 2>/dev/null; wait "$bgpid" 2>/dev/null; bgpid=""
  return 1
}

# queue_design: starts a design in the background and sets dir and id to its item. It clears tab.seen too: a
# queue that finds a fresh one waits up to 5 seconds for a tab poll that never comes, which is all of finish().
dir="" id=""
queue_design() {
  rm -rf "$state/items" "$state/tab.seen"
  bash "$SCRIPT" design owner/repo T "$root/design.md" >"$root/out" 2>"$root/err" &
  bgpid=$!
  wait_for "$state/items/*/item.json" || return 1
  dir=$(dirname "$(ls "$state"/items/*/item.json | head -1)")
  id=$(basename "$dir")
}

# finish: waits up to 5 seconds for the background command and sets rc to its exit code.
rc=""
finish() {
  local i
  for i in $(seq 50); do kill -0 "$bgpid" 2>/dev/null || break; sleep 0.1; done
  if kill -0 "$bgpid" 2>/dev/null; then
    echo "FAIL: the queuing command did not exit"; fail=1
    kill -KILL "$bgpid"; wait "$bgpid" 2>/dev/null; bgpid=""; rc=hung; return
  fi
  wait "$bgpid"; rc=$?; bgpid=""
}

# fake_item <id> <pid> <pidStart> [extra file]: writes an item.json for a pid the test chose.
fake_item() {
  mkdir -p "$state/items/$1"
  jq -nc --arg id "$1" --argjson pid "$2" --argjson start "$3" \
    '{id: $id, kind: "design", repo: "owner/repo", title: "T", created: "2026-01-01T00:00:00Z", headline: "T", file: "design.md", pid: $pid, pidStart: $start}' \
    >"$state/items/$1/item.json"
}

# start_ticks <pid>: the process's start time as the command records it.
start_ticks() { sed 's/.*) //' "/proc/$1/stat" | cut -d' ' -f20; }

# withdraw on a waiting item stops the command, which exits 143 and, finding the withdrawn marker, removes item.json.
queue_design
bash "$SCRIPT" withdraw "$id" >"$root/w.out" 2>"$root/w.err"
assert_eq "$?" "0" "withdraw a waiting item: exit code"
assert_eq "$(cat "$root/w.out")" "withdrew $id" "withdraw a waiting item: stdout"
assert_eq "$(wc -c <"$root/w.err")" "0" "withdraw a waiting item: stderr"
finish
assert_eq "$rc" "143" "withdraw a waiting item: the queuing command's exit code"
[ ! -e "$dir/item.json" ] || { echo "FAIL: withdraw a waiting item: item.json is still there"; fail=1; }

# A recorded pid of a process that has exited: withdraw removes item.json itself.
sleep 0.01 &
dead=$!
wait "$dead"
fake_item 20260101T000001-$dead "$dead" 1
bash "$SCRIPT" withdraw "20260101T000001-$dead" >"$root/w.out" 2>"$root/w.err"
assert_eq "$?" "0" "withdraw a dead pid: exit code"
assert_eq "$(cat "$root/w.out")" "withdrew 20260101T000001-$dead" "withdraw a dead pid: stdout"
assert_eq "$(wc -c <"$root/w.err")" "0" "withdraw a dead pid: stderr"
[ ! -e "$state/items/20260101T000001-$dead/item.json" ] || { echo "FAIL: withdraw a dead pid: item.json is still there"; fail=1; }

# A reused pid: the pid runs, but its start time is not the one recorded. Nothing is sent to it.
sleep 60 &
sleeper=$!
fake_item "20260101T000002-$sleeper" "$sleeper" 1
bash "$SCRIPT" withdraw "20260101T000002-$sleeper" >/dev/null 2>&1
assert_eq "$?" "0" "withdraw a reused pid: exit code"
[ ! -e "$state/items/20260101T000002-$sleeper/item.json" ] || { echo "FAIL: withdraw a reused pid: item.json is still there"; fail=1; }
kill -0 "$sleeper" 2>/dev/null || { echo "FAIL: withdraw a reused pid: the other process was stopped"; fail=1; }

kill "$sleeper"; wait "$sleeper" 2>/dev/null; sleeper=""

# Each refusal exits 2.
refuse_cmd() {
  local label=$1
  shift
  bash "$SCRIPT" "$@" >/dev/null 2>"$root/err"
  assert_eq "$?" "2" "$label: exit code"
}
refuse_cmd "withdraw with a bad id" withdraw ../etc
refuse_cmd "withdraw with no id" withdraw
refuse_cmd "withdraw an unknown id" withdraw 20260101T000009-1
fake_item 20260101T000004-4 4 1
echo '{"decision":"approve"}' >"$state/items/20260101T000004-4/decision.json"
refuse_cmd "withdraw a decided item" withdraw 20260101T000004-4
grep -q 'collect it instead' "$root/err" || { echo "FAIL: withdraw a decided item: message '$(cat "$root/err")'"; fail=1; }
mkdir -p "$state/items/20260101T000005-5"
jq -nc '{id: "20260101T000005-5", kind: "design", repo: "r", title: "T", created: "2026-01-01T00:00:00Z"}' >"$state/items/20260101T000005-5/item.json"
refuse_cmd "withdraw an item with no pid" withdraw 20260101T000005-5
grep -q 'stop its command' "$root/err" || { echo "FAIL: withdraw an item with no pid: message '$(cat "$root/err")'"; fail=1; }
[ -e "$state/items/20260101T000005-5/item.json" ] || { echo "FAIL: withdraw an item with no pid: item.json was removed"; fail=1; }
refuse_cmd "collect with a bad id" collect nope
refuse_cmd "collect an unknown id" collect 20260101T000009-1
refuse_cmd "collect with no id" collect

# A TERM or HUP to a waiting command (INT is ignored by a background job of a script, so the test skips it) ends the wait and leaves item.json for collect (#59); nothing is
# logged. A reboot sends the TERM.
for sig in TERM HUP; do
  rm -rf "$state/items"
  rm -f "$log"
  queue_design
  kill -"$sig" "$bgpid"
  finish
  assert_eq "$rc" "143" "$sig to a waiting command: exit code"
  [ -e "$dir/item.json" ] || { echo "FAIL: $sig to a waiting command: item.json was removed"; fail=1; }
  [ ! -e "$log" ] || { echo "FAIL: $sig to a waiting command: something was logged"; fail=1; }
done

# The decision lands after the stop: collect prints and logs it, once.
printf '{"decision":"approve"}\n' >"$dir/decision.json"
assert_eq "$(bash "$SCRIPT" collect "$id" 2>/dev/null)" '{"decision":"approve"}' "collect after a stop: stdout"
assert_eq "$(wc -l <"$log")" "1" "collect after a stop: one log line, in a root with no log before"
assert_eq "$(jq -r '[.packet, .verdict, .kind] | join(" ")' "$log")" "$id approve design" "collect after a stop: the log line"
bash "$SCRIPT" collect "$id" >/dev/null 2>&1
assert_eq "$(wc -l <"$log")" "1" "a second collect: nothing more logged"

# A withdraw of an item a stop left waiting retires it, since its waiter is gone.
rm -rf "$state/items"
queue_design
kill -TERM "$bgpid"
finish
bash "$SCRIPT" withdraw "$id" >"$root/w.out" 2>&1
assert_eq "$?" "0" "withdraw after a stop: exit code"
[ ! -e "$dir/item.json" ] || { echo "FAIL: withdraw after a stop: item.json is still there"; fail=1; }

# A collect and a withdraw racing on a decided item: the withdraw refuses, and the decision and the item stay (#41).
rm -rf "$state/items"
rm -f "$log"
queue_design
printf '{"decision":"approve"}\n' >"$dir/decision.json"
kill -TERM "$bgpid"
finish
bash "$SCRIPT" collect "$id" >"$root/c.out" 2>/dev/null &
cpid=$!
bash "$SCRIPT" withdraw "$id" >/dev/null 2>"$root/w.err"
assert_eq "$?" "2" "withdraw racing a collect on a decided item: exit code"
wait "$cpid"
assert_eq "$?" "0" "collect racing a withdraw: exit code"
assert_eq "$(cat "$root/c.out")" '{"decision":"approve"}' "collect racing a withdraw: stdout"
[ -e "$dir/item.json" ] && [ -e "$dir/decision.json" ] || { echo "FAIL: collect racing a withdraw: the item or its decision is gone"; fail=1; }

# The retired forms exit 2 with one line naming the replacement.
for form in "docs a b c" "notes --check a b" "pr owner/repo T 42"; do
  bash "$SCRIPT" $form >/dev/null 2>"$root/err"
  assert_eq "$?" "2" "retired form $form: exit code"
  grep -q 'retired' "$root/err" || { echo "FAIL: retired form $form: message '$(cat "$root/err")'"; fail=1; }
done
grep -q 'approval-packet skill' "$root/err" || { echo "FAIL: the pr form's message does not name the skill"; fail=1; }

# A collect of an undecided item waits for the decision, and a TERM to it leaves item.json in place.
rm -rf "$state/items"
queue_design
bash "$SCRIPT" collect "$id" >"$root/c.out" 2>/dev/null &
cpid=$!
sleep 1.5
kill -0 "$cpid" 2>/dev/null || { echo "FAIL: collect: ended on a deferral"; fail=1; }
kill -TERM "$cpid"
wait "$cpid" 2>/dev/null
assert_eq "$?" "143" "interrupted collect: exit code"
[ -e "$dir/item.json" ] || { echo "FAIL: interrupted collect: item.json was removed"; fail=1; }

# A collect of an item that is neither decided nor deferred also leaves item.json in place when interrupted;
# only collect's own exit trap keeps it.
fake_item 20260101T000006-$dead "$dead" 1
bash "$SCRIPT" collect "20260101T000006-$dead" >"$root/c.out" 2>/dev/null &
cpid=$!
sleep 1.5
kill -TERM "$cpid"
wait "$cpid" 2>/dev/null
assert_eq "$?" "143" "interrupted collect of an undecided item: exit code"
[ -e "$state/items/20260101T000006-$dead/item.json" ] || { echo "FAIL: interrupted collect of an undecided item: item.json was removed"; fail=1; }

kill -TERM "$bgpid"
finish

# A collect racing the queuing command logs the decision once.
rm -rf "$state/items"
rm -f "$log"
queue_design
bash "$SCRIPT" collect "$id" >"$root/c.out" 2>/dev/null &
cpid=$!
sleep 0.5
printf '{"decision":"approve"}\n' >"$dir/decision.json"
finish
wait "$cpid"
assert_eq "$?" "0" "racing collect: exit code"
assert_eq "$(cat "$root/c.out")" "$(cat "$root/out")" "racing collect: the same line as the queuing command"
assert_eq "$(wc -l <"$log")" "1" "racing collect: one line in the log"

# collect_after_withdraw <label> <id>: a collect started now, then a withdraw, must end with exit 1 and the
# withdrawn message inside 4 seconds, and print nothing on stdout.
collect_after_withdraw() {
  local label=$1 cid=$2 i
  bash "$SCRIPT" collect "$cid" >"$root/c.out" 2>"$root/c.err" &
  cpid=$!
  sleep 0.5
  bash "$SCRIPT" withdraw "$cid" >/dev/null 2>&1
  assert_eq "$?" "0" "$label: withdraw exit code"
  for i in $(seq 40); do kill -0 "$cpid" 2>/dev/null || break; sleep 0.1; done
  if kill -0 "$cpid" 2>/dev/null; then
    echo "FAIL: $label: collect did not exit after the withdraw"; fail=1
    kill -KILL "$cpid"; wait "$cpid" 2>/dev/null
    return
  fi
  wait "$cpid"
  assert_eq "$?" "1" "$label: collect exit code"
  assert_eq "$(wc -c <"$root/c.out")" "0" "$label: collect stdout"
  grep -q "$cid was withdrawn; nothing to collect" "$root/c.err" || { echo "FAIL: $label: message '$(cat "$root/c.err")'"; fail=1; }
}

# A collect on a waiting item ends when the item is withdrawn.
rm -rf "$state/items"
queue_design
collect_after_withdraw "collect on a withdrawn waiting item" "$id"
finish

# So does a collect on an undecided item whose recorded pid is dead.
fake_item 20260101T000007-$dead "$dead" 1
collect_after_withdraw "collect on a withdrawn item with a dead pid" "20260101T000007-$dead"

# Regression guard (not a #31 fix; today's trap already does this): a TERM after decision.json lands leaves
# item.json in place, so the decision can still be collected.
rm -rf "$state/items"
queue_design
printf '{"decision":"approve"}\n' >"$dir/decision.json"
kill -TERM "$bgpid"
finish
[ -e "$dir/item.json" ] || { echo "FAIL: TERM after a decision: item.json was removed"; fail=1; }

# pending lists a decided item whose waiter is dead and whose decision no log line holds, one tab-separated
# line each, oldest id first. It skips a live waiter, a logged decision, a triage item, a pidless
# item, and an undecided item. After the collect, nothing is pending.
rm -rf "$state/items"
rm -f "$log"
sleep 60 &
sleeper=$!
decided_item() {
  fake_item "$1" "$2" "$3"
  printf '{"decision":"approve"}\n' >"$state/items/$1/decision.json"
  echo design >"$state/items/$1/doc.md"
}
decided_item 20260102T000002-$dead "$dead" 1
jq '.title = "Second\ttitle"' "$state/items/20260102T000002-$dead/item.json" >"$root/t.json"
mv "$root/t.json" "$state/items/20260102T000002-$dead/item.json"
decided_item 20260102T000001-$dead "$dead" 1
decided_item 20260102T000003-$sleeper "$sleeper" "$(start_ticks "$sleeper")"
decided_item 20260102T000004-$dead "$dead" 1
jq -nc '{packet: "20260102T000004-'"$dead"'", verdict: "approve"}' >"$log"
decided_item 20260102T000006-$dead "$dead" 1
jq '.kind = "triage"' "$state/items/20260102T000006-$dead/item.json" >"$root/t.json"
mv "$root/t.json" "$state/items/20260102T000006-$dead/item.json"
decided_item 20260102T000007-$dead "$dead" 1
jq 'del(.pid, .pidStart)' "$state/items/20260102T000007-$dead/item.json" >"$root/t.json"
mv "$root/t.json" "$state/items/20260102T000007-$dead/item.json"
fake_item 20260102T000008-$dead "$dead" 1
bash "$SCRIPT" pending >"$root/p.out" 2>"$root/p.err"
assert_eq "$?" "0" "pending: exit code"
assert_eq "$(cat "$root/p.out")" "$(printf '20260102T000001-%s\tdesign\tapprove\tT\n20260102T000002-%s\tdesign\tapprove\tSecond title' "$dead" "$dead")" "pending: the lines"
assert_eq "$(wc -c <"$root/p.err")" "0" "pending: stderr"
bash "$SCRIPT" collect "20260102T000001-$dead" >/dev/null 2>&1
bash "$SCRIPT" collect "20260102T000002-$dead" >/dev/null 2>&1
assert_eq "$(bash "$SCRIPT" pending)" "" "pending: nothing after the collects"
rm -rf "$state/items"
assert_eq "$(bash "$SCRIPT" pending; echo "rc $?")" "rc 0" "pending: no items"
bash "$SCRIPT" pending extra >/dev/null 2>&1
assert_eq "$?" "2" "pending: takes no arguments"

# pending with all four kinds: a waiting design, a decided triage list, a decided packet (dead pid, no logged
# decision), a waiting report, and a read report. It prints the packet's line alone and stays quiet.
rm -rf "$state/items"
rm -f "$state/decisions.jsonl"
fake_item 20260103T000001-$dead "$dead" 1
fake_item 20260103T000002-$dead "$dead" 1
jq '.kind = "triage"' "$state/items/20260103T000002-$dead/item.json" >"$root/t.json"
mv "$root/t.json" "$state/items/20260103T000002-$dead/item.json"
printf '{"decision":"submit","rows":[]}\n' >"$state/items/20260103T000002-$dead/decision.json"
fake_item 20260103T000003-$dead "$dead" 1
jq '.kind = "packet" | .title = "Packet"' "$state/items/20260103T000003-$dead/item.json" >"$root/t.json"
mv "$root/t.json" "$state/items/20260103T000003-$dead/item.json"
printf '{"decision":"approve"}\n' >"$state/items/20260103T000003-$dead/decision.json"
for n in 4 5; do
  mkdir -p "$state/items/20260103T00000$n-$n"
  printf 'x\n' >"$state/items/20260103T00000$n-$n/report.md"
  jq -nc --arg id "20260103T00000$n-$n" '{id: $id, kind: "report", title: "Round r", initiative: "none", round: "ur-queue", created: "2026-01-03T00:00:00Z"}' \
    >"$state/items/20260103T00000$n-$n/item.json"
done
printf '{"decision":"read"}\n' >"$state/items/20260103T000005-5/decision.json"
bash "$SCRIPT" pending >"$root/p.out" 2>"$root/p.err"
assert_eq "$?" "0" "pending with four kinds: exit code"
assert_eq "$(cat "$root/p.out")" "$(printf '20260103T000003-%s\tpacket\tapprove\tPacket' "$dead")" "pending with four kinds: the lines"
assert_eq "$(wc -c <"$root/p.err")" "0" "pending with four kinds: stderr"
kill "$sleeper"; wait "$sleeper" 2>/dev/null; sleeper=""

[ "$fail" = 0 ] && echo "lifecycle: ok"
exit "$fail"
