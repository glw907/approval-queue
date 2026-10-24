#!/usr/bin/env bash
# lifecycle.test.sh: prove `withdraw`, `collect`, and the defer line of the approval-queue command against this
# worktree's own copy, with curl, xdg-open, and setsid stubbed on PATH. Never starts the app, opens a browser,
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

# queue_design: starts a design in the background and sets dir and id to its item.
dir="" id=""
queue_design() {
  rm -rf "$state/items"
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

# withdraw on a waiting item stops the command, which exits 143 and removes item.json.
queue_design
bash "$SCRIPT" withdraw "$id" >"$root/w.out" 2>"$root/w.err"
assert_eq "$?" "0" "withdraw a waiting item: exit code"
assert_eq "$(wc -c <"$root/w.out")" "0" "withdraw a waiting item: stdout"
finish
assert_eq "$rc" "143" "withdraw a waiting item: the queuing command's exit code"
[ ! -e "$dir/item.json" ] || { echo "FAIL: withdraw a waiting item: item.json is still there"; fail=1; }

# A recorded pid of a process that has exited: withdraw removes item.json itself.
sleep 0.01 &
dead=$!
wait "$dead"
fake_item 20260101T000001-$dead "$dead" 1
bash "$SCRIPT" withdraw "20260101T000001-$dead" 2>/dev/null
assert_eq "$?" "0" "withdraw a dead pid: exit code"
[ ! -e "$state/items/20260101T000001-$dead/item.json" ] || { echo "FAIL: withdraw a dead pid: item.json is still there"; fail=1; }

# A reused pid: the pid runs, but its start time is not the one recorded. Nothing is sent to it.
sleep 60 &
sleeper=$!
fake_item "20260101T000002-$sleeper" "$sleeper" 1
bash "$SCRIPT" withdraw "20260101T000002-$sleeper" 2>/dev/null
assert_eq "$?" "0" "withdraw a reused pid: exit code"
[ ! -e "$state/items/20260101T000002-$sleeper/item.json" ] || { echo "FAIL: withdraw a reused pid: item.json is still there"; fail=1; }
kill -0 "$sleeper" 2>/dev/null || { echo "FAIL: withdraw a reused pid: the other process was stopped"; fail=1; }

# A deferred item whose waiter is still alive: item.json goes without a TERM to the waiter.
fake_item "20260101T000003-$sleeper" "$sleeper" "$(start_ticks "$sleeper")"
echo '{"at":"2026-01-01T00:00:00Z"}' >"$state/items/20260101T000003-$sleeper/deferred.json"
bash "$SCRIPT" withdraw "20260101T000003-$sleeper" 2>/dev/null
assert_eq "$?" "0" "withdraw a deferred item: exit code"
[ ! -e "$state/items/20260101T000003-$sleeper/item.json" ] || { echo "FAIL: withdraw a deferred item: item.json is still there"; fail=1; }
kill -0 "$sleeper" 2>/dev/null || { echo "FAIL: withdraw a deferred item: the waiter was stopped"; fail=1; }
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

# Defer: the command prints the defer line, exits 0, and leaves item.json; nothing is logged. A later
# decision is read by collect.
rm -rf "$state/items"
queue_design
echo '{"at":"2026-01-01T00:00:00Z"}' >"$dir/deferred.json"
finish
assert_eq "$rc" "0" "defer: exit code"
assert_eq "$(cat "$root/out")" "{\"decision\":\"defer\",\"id\":\"$id\"}" "defer: stdout"
[ -e "$dir/item.json" ] || { echo "FAIL: defer: item.json was removed"; fail=1; }
[ ! -e "$log" ] || { echo "FAIL: defer: something was logged"; fail=1; }

# A collect of a deferred item waits for the decision, and a TERM to it leaves item.json in place.
bash "$SCRIPT" collect "$id" >"$root/c.out" 2>/dev/null &
cpid=$!
sleep 1.5
kill -0 "$cpid" 2>/dev/null || { echo "FAIL: collect: ended on a deferral"; fail=1; }
kill -TERM "$cpid"
wait "$cpid" 2>/dev/null
assert_eq "$?" "143" "interrupted collect: exit code"
[ -e "$dir/item.json" ] || { echo "FAIL: interrupted collect: item.json was removed"; fail=1; }

# The decision lands after the deferral: collect prints and logs it, once.
printf '{"decision":"approve"}\n' >"$dir/decision.json"
assert_eq "$(bash "$SCRIPT" collect "$id" 2>/dev/null)" '{"decision":"approve"}' "collect after a defer: stdout"
assert_eq "$(wc -l <"$log")" "1" "collect after a defer: one log line, in a root with no log before"
assert_eq "$(jq -r '[.packet, .verdict, .kind] | join(" ")' "$log")" "$id approve design" "collect after a defer: the log line"
bash "$SCRIPT" collect "$id" >/dev/null 2>&1
assert_eq "$(wc -l <"$log")" "1" "a second collect: nothing more logged"

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

[ "$fail" = 0 ] && echo "lifecycle: ok"
exit "$fail"
