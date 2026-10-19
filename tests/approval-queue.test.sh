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
  for f in $files; do [ -e "$dir/$f" ] || { echo "FAIL: $kind: missing $f"; fail=1; }; done
  if [ "$kind" = pr ]; then
    assert_eq "$(jq -r .head "$dir/item.json")" "abc123" "pr: head"
    assert_eq "$(cat "$dir/body.md")" "$(cat "$root/body.md")" "pr: body"
    assert_eq "$(jq -r .number "$dir/item.json")" "42" "pr: number"
    assert_eq "$(jq -c 'keys' "$dir/pr.json")" '["baseRefName","headRefName","number","statusCheckRollup","url"]' "pr: pr.json keys"
    assert_eq "$(jq -r .url "$dir/pr.json")" "https://github.com/owner/repo/pull/42" "pr: pr.json url"
    assert_eq "$(jq -r '.statusCheckRollup[0].conclusion' "$dir/pr.json")" "SUCCESS" "pr: pr.json checks"
  else
    assert_eq "$(jq 'has("head")' "$dir/item.json")" "false" "$kind: no head"
    [ "$kind" != design ] || assert_eq "$(jq -r .file "$dir/item.json")" "design.md" "design: file"
  fi
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
  want='{"decision":"approve"}'
  [ "$kind" = pr ] && want='{"decision":"approve","head":"abc123"}'
  assert_eq "$(cat "$root/out")" "$want" "$kind: stdout"
}

run_kind pr 42 "body.md diff.patch pr.json"
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
  compgen -G "$state/items/*/item.json" >/dev/null && { echo "FAIL: TERM: item.json left"; fail=1; }
fi

# The app answers / but does not serve the item: exit 1.
rm -rf "$state/items"
STUB_ITEM_FAILS=1 bash "$SCRIPT" design owner/repo T "$root/design.md" >/dev/null 2>"$root/err"
assert_eq "$?" "1" "item not served: exit code"
grep -q 'does not serve this state root' "$root/err" || { echo "FAIL: item not served: message"; fail=1; }

# A brief defect refuses before queuing: exit 2, the message, the register path, no item directory.
refuse() {
  local label=$1 want=$2
  shift 2
  rm -rf "$state/items"
  "$@" >/dev/null 2>"$root/err"
  assert_eq "$?" "2" "$label: exit code"
  grep -q -- "$want" "$root/err" || { echo "FAIL: $label: message lacks '$want': $(cat "$root/err")"; fail=1; }
  grep -q 'approval-brief.md' "$root/err" || { echo "FAIL: $label: no register path"; fail=1; }
  ! compgen -G "$state/items/*" >/dev/null || { echo "FAIL: $label: left an item directory"; fail=1; }
}
cp "$root/body.md" "$root/body-good.md"
printf 'no brief here\n' >"$root/body.md"
refuse "pr without a brief" '## Brief' bash "$SCRIPT" pr owner/repo T 42
cp "$root/body-good.md" "$root/body.md"
grep -v -e '^### If you approve' -e '^1\. The PR merges' "$root/design.md" >"$root/design-bad.md"
refuse "design missing If you approve" 'If you approve' bash "$SCRIPT" design owner/repo T "$root/design-bad.md"
printf '[{"item":"a","disposition":"now","reason":"r"}]\n' >"$root/triage-old.json"
refuse "old triage shape" 'old triage shape' bash "$SCRIPT" triage owner/repo T "$root/triage-old.json"

# Every exemplar in the register passes the check, run with no approval-queue/node_modules in play.
register="${REGISTER:-$HOME/.claude/docs/voice/approval-brief.md}"
[ -r "$register" ] || { echo "FAIL: brief register not readable at $register (set REGISTER)"; exit 1; }
n=0
packets=0
# A fence closes at a line of its opening width, so a packet's inner three-backtick Evidence fence stays inside it.
while IFS=$'\t' read -r fence file; do
  n=$((n + 1))
  kind=design
  [ "$fence" != brief-triage ] || kind=triage
  [ "$fence" != packet ] || { kind=packet; packets=$((packets + 1)); }
  node approval-queue/src/check-brief.ts "$kind" "$file" >"$root/out$n" 2>"$root/err" \
    || { echo "FAIL: register exemplar $n ($fence) fails the check: $(cat "$root/err")"; fail=1; }
  [ "$kind" != packet ] || cp "$root/out$n" "$root/packet$packets.json"
done < <(awk -v dir="$root" '
  !inblock && /^`+(brief|brief-triage|packet)$/ {
    match($0, /^`+/); width = RLENGTH; fence = substr($0, width + 1)
    n++; out = dir "/ex" n; inblock = 1; next }
  inblock && /^`+$/ && length($0) == width { inblock = 0; close(out); print fence "\t" out; next }
  inblock { print > out }' "$register")
[ "$n" -ge 6 ] || { echo "FAIL: found only $n register exemplars"; fail=1; }
# The three packet shapes, asserted from the parse: two asks, routine only, and a gate-failed ask.
[ "$packets" = 3 ] || { echo "FAIL: found $packets packet exemplars, want 3"; fail=1; }
shapes=$(for f in "$root"/packet*.json; do
  node -e 'const p = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const s = [];
    if (p.asks.length === 2) s.push("two-asks");
    if (p.asks.length === 0 && p.routine.length > 0) s.push("routine-only");
    if (p.asks.some((a) => a.rule === "gate-failed")) s.push("gate-failed");
    console.log(s.join("\n"))' "$f"
done | sort | tr '\n' ' ')
assert_eq "$shapes" "gate-failed routine-only two-asks " "register packet shapes"

bash "$SCRIPT" bogus owner/repo T "$root/design.md" >/dev/null 2>&1
assert_eq "$?" "2" "bad kind: exit code"
bash "$SCRIPT" design owner/repo T >/dev/null 2>&1
assert_eq "$?" "2" "missing argument: exit code"

[ "$fail" = 0 ] && echo "approval-queue: ok"
exit "$fail"
