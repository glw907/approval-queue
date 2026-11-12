#!/usr/bin/env bash
# packet.test.sh: prove the snapshot, packet, reply, and pending forms of the approval-queue command against this
# worktree's own copy, with curl, xdg-open, setsid, and gh stubbed on PATH. The fixtures are the repo's own
# fact files, texts, and patches (they name the nonexistent owner aq-fixture). The poll figures run at one second.
# Never starts the app, opens a browser, calls the real gh, or touches the live queue state.
set -uo pipefail
cd "$(dirname "$0")/.."
SCRIPT="$(pwd)/bin/.local/bin/approval-queue"
FIX="$(pwd)/approval-queue/src/lib/fixtures"
fail=0
root="$(mktemp -d)"
bgpid=""
trap '[ -n "$bgpid" ] && kill "$bgpid" 2>/dev/null; rm -rf "$root"' EXIT

assert_eq() {
  [ "$1" = "$2" ] || { echo "FAIL: $3: got '$1', want '$2'"; fail=1; }
}

# No item id this test queued or logged may appear in the live log: queue() records each id in $root/ids,
# so a write to the live log alone, with nothing in the temp log, still fails by name.
live_log="$HOME/.local/state/approval-queue/decisions.jsonl"
live_leak() {
  local pid
  [ -e "$live_log" ] || return 0
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    if grep -qF "\"packet\":\"$pid\"" "$live_log"; then echo "FAIL: the test wrote packet $pid to the live log"; fail=1; fi
  done < <({ jq -r '.packet' "$log" 2>/dev/null; cat "$root/ids" 2>/dev/null; } | sort -u)
}

stubs="$root/stubs"
mkdir -p "$stubs"
cat >"$stubs/curl" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$STUB_DIR/curl.record"
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
# gh serves PR <n> of <owner>/<repo> from $STUB_DIR/pr-<owner>-<repo>-<n>.json (the `pr view` object) and .patch
# (the diff), and logs every call to gh.log. Flags, as files beside the PR: .escape (the diff is refused until
# --allow-escape-sequences), .toolarge (the diff is refused as past 300 files, and `gh api` answers from
# .apifiles), .moving (every view reports another head), .pend <count> (the next <count> views that ask for
# statusCheckRollup see a check in progress).
cat >"$stubs/gh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "gh $*" >>"$STUB_DIR/gh.log"
sub=$1 verb=${2:-}
repo="" fields="" escape=0 n=""
args=("$@")
for ((i = 2; i < ${#args[@]}; i++)); do
  a=${args[i]}
  case $a in
    -R | --repo) repo=${args[i + 1]}; i=$((i + 1)) ;;
    --json) fields=${args[i + 1]}; i=$((i + 1)) ;;
    --allow-escape-sequences) escape=1 ;;
    -*) ;;
    *) [ -z "$n" ] && n=$a ;;
  esac
done
if [ "$sub" = api ]; then
  for a in "$@"; do
    case $a in repos/*/pulls/*/files*) p=${a#repos/}; r=${p%%/pulls/*}; p=${p#*/pulls/}; cat "$STUB_DIR/pr-${r//\//-}-${p%%/*}.apifiles"; exit 0 ;; esac
  done
  echo "stub: unsupported gh api call" >&2; exit 1
fi
base="$STUB_DIR/pr-${repo//\//-}-$n"
[ -e "$base.json" ] || { echo "no pull requests found for $repo#$n" >&2; exit 1; }
case $verb in
  view)
    json=$(jq -c . "$base.json")
    if [ -e "$base.moving" ]; then
      c=$(($(cat "$base.calls" 2>/dev/null || echo 0) + 1)); echo "$c" >"$base.calls"
      json=$(jq -c --arg h "moved$c" '.headRefOid = $h' <<<"$json")
    fi
    if [ -e "$base.pend" ] && [[ $fields == *statusCheckRollup* ]] && [ "$(cat "$base.pend")" -gt 0 ]; then
      echo $(($(cat "$base.pend") - 1)) >"$base.pend"
      json=$(jq -c '.statusCheckRollup = [{"name":"gate","workflowName":"ci","status":"IN_PROGRESS","conclusion":""}]' <<<"$json")
    fi
    jq -c --arg f "$fields" '. as $o | ($f | split(",")) | map({key: ., value: $o[.]}) | from_entries' <<<"$json" ;;
  diff)
    if [ -e "$base.escape" ] && [ "$escape" = 0 ]; then
      echo "the diff contains terminal escape sequences; pass --allow-escape-sequences to output it anyway" >&2; exit 1
    fi
    if [ -e "$base.toolarge" ]; then
      echo "could not find pull request diff: HTTP 406: Sorry, the diff exceeded the maximum number of files (300)." >&2
      echo "PullRequest.diff too_large" >&2; exit 1
    fi
    cat "$base.patch" ;;
  *) echo "stub: unsupported gh pr verb: $verb" >&2; exit 1 ;;
esac
STUB
chmod +x "$stubs"/*

export STUB_DIR="$root" XDG_STATE_HOME="$root/state" APPROVAL_QUEUE_PROJECTS="$root/projects" PATH="$stubs:$PATH"
export APPROVAL_QUEUE_POLL_S=1 APPROVAL_QUEUE_POLL_MAX_S=3
state="$XDG_STATE_HOME/approval-queue"
log="$state/decisions.jsonl"
source tests/collect-check.sh
mkdir -p "$APPROVAL_QUEUE_PROJECTS/initiatives/sample" "$APPROVAL_QUEUE_PROJECTS/sample/docs/specs"
printf 'title: Sample release notes\nstatus: active\n' >"$APPROVAL_QUEUE_PROJECTS/initiatives/sample/initiative.yaml"
designfile="$APPROVAL_QUEUE_PROJECTS/sample/docs/specs/2026-11-10-sample-design.md"
printf '# A design\n\nOriginal text.\n' >"$designfile"

A=aq-fixture/sample#1 B=aq-fixture/sample#2
HA=aaaa111 HB=bbbb222

# mkpr <n> <head> <state> <checks: pass|fail|pending|none>: writes the gh stub's answer for fixture PR n.
mkpr() {
  local checks='[]'
  case "$4" in
    pass) checks='[{"name":"gate","workflowName":"ci","status":"COMPLETED","conclusion":"SUCCESS"}]' ;;
    fail) checks='[{"name":"lint","workflowName":"ci","status":"COMPLETED","conclusion":"FAILURE"}]' ;;
    pending) checks='[{"name":"gate","workflowName":"ci","status":"IN_PROGRESS","conclusion":""}]' ;;
  esac
  local files='[{"path":"lib/queue.test.ts","additions":3,"deletions":0},{"path":"lib/queue.ts","additions":2,"deletions":1}]'
  [ "$1" != 2 ] || files='[{"path":"docs/queue.md","additions":1,"deletions":0}]'
  jq -n --arg h "$2" --arg s "$3" --argjson n "$1" --argjson c "$checks" --argjson f "$files" \
    '{state: $s, headRefOid: $h, title: "PR \($n)", body: "Body of \($n).", statusCheckRollup: $c, files: $f}' >"$root/pr-aq-fixture-sample-$1.json"
  cp "$FIX/snapshot/aq-fixture-sample-$1.patch" "$root/pr-aq-fixture-sample-$1.patch"
}
mkpr 1 $HA OPEN pass
mkpr 2 $HB OPEN pass

# The working directory holds the close packet's fact file and text; w2 holds the design packet's.
work="$root/work" w2="$root/w2"
mkdir -p "$work" "$w2"
cp "$FIX/close-facts.json" "$work/facts.json"
cp "$FIX/close-text.md" "$work/text.md"
cp "$FIX/design-facts.json" "$w2/facts.json"
cp "$FIX/design-text.md" "$w2/text.md"

# wait_for <glob>: up to 10 seconds; on a timeout, fails the test and kills the background job.
wait_for() {
  local i
  for i in $(seq 100); do compgen -G "$1" >/dev/null && return 0; sleep 0.1; done
  echo "FAIL: timed out waiting for $1"; fail=1
  kill "$bgpid" 2>/dev/null; wait "$bgpid" 2>/dev/null; bgpid=""
  return 1
}

# queue <command args>: starts the command in the background, keeps the items already on disk, and sets dir to the
# waiting item's directory.
dir=""
queue() {
  local i f
  rm -f "$root/open.record"
  bash "$SCRIPT" "$@" >"$root/out" 2>"$root/err" &
  bgpid=$!
  dir=""
  for i in $(seq 100); do
    for f in "$state"/items/*/item.json; do
      [ -e "$f" ] && [ ! -e "$(dirname "$f")/decision.json" ] && dir=$(dirname "$f")
    done
    [ -n "$dir" ] && { basename "$dir" >>"$root/ids"; return 0; }
    kill -0 "$bgpid" 2>/dev/null || break
    sleep 0.1
  done
  echo "FAIL: timed out waiting for a queued item: $(cat "$root/err")"; fail=1
  kill "$bgpid" 2>/dev/null; wait "$bgpid" 2>/dev/null; bgpid=""
  return 1
}

# decide <json>: hands the decision to the queued command and sets rc to its exit code.
rc=""
decide() {
  local i
  printf '%s\n' "$1" >"$dir/decision.json.tmp"
  mv "$dir/decision.json.tmp" "$dir/decision.json"
  for i in $(seq 100); do kill -0 "$bgpid" 2>/dev/null || break; sleep 0.1; done
  if kill -0 "$bgpid" 2>/dev/null; then
    echo "FAIL: did not exit after the decision"; fail=1
    kill "$bgpid"; wait "$bgpid" 2>/dev/null; bgpid=""; rc=hung; return
  fi
  wait "$bgpid"; rc=$?; bgpid=""
}

log_lines() { if [ -e "$log" ]; then wc -l <"$log"; else echo 0; fi; }
item_count() { ls "$state/items" 2>/dev/null | wc -l; }

# run <command args>: runs the command to its end, with a 30 second guard, and sets rc; stdout is $root/out.
run() {
  timeout 30 bash "$SCRIPT" "$@" >"$root/out" 2>"$root/err"
  rc=$?
}

# refused <label> <want> <command args>: the command exits 2 naming the defect, with stdout empty, and queues
# nothing.
refused() {
  local label=$1 want=$2 before
  shift 2
  before=$(item_count)
  run "$@"
  assert_eq "$rc" "2" "$label: exit code"
  grep -qF -- "$want" "$root/err" || { echo "FAIL: $label: message lacks '$want': $(cat "$root/err")"; fail=1; }
  assert_eq "$(wc -c <"$root/out")" "0" "$label: stdout"
  assert_eq "$(item_count)" "$before" "$label: no item directory"
}

NOTES='[{"id":"n1","text":"Why this?","anchor":null},{"id":"n2","text":"And this?","anchor":{"section":"opening","quote":"q","prefix":"","suffix":"","from":0,"to":1}}]'
APPROVE='{"decision":"approve","calls":[{"call":1,"choice":"Skip it","changed":false},{"call":2,"choice":"Merge it with the code","changed":false}],"decidedForYou":[{"call":1,"choice":"lib/queue.test.ts","changed":false}],"notes":'"$NOTES"'}'
REJECT='{"decision":"reject","calls":[],"decidedForYou":[],"notes":'"$NOTES"'}'

# ---- snapshot ----
run snapshot "$work/facts.json"
assert_eq "$rc" "0" "snapshot: exit code"
assert_eq "$(jq -c . "$work/snapshot/heads.json")" "[{\"ref\":\"$A\",\"head\":\"$HA\"},{\"ref\":\"$B\",\"head\":\"$HB\"}]" "snapshot: heads.json"
assert_eq "$(cmp -s "$work/snapshot/aq-fixture-sample-1.patch" "$FIX/snapshot/aq-fixture-sample-1.patch"; echo $?)" "0" "snapshot: patch of #1"
assert_eq "$(ls -A "$work" | paste -sd' ')" "facts.json snapshot text.md" "snapshot: leaves nothing else beside the fact file"

# #61: a diff refused for terminal escape sequences is retried with the flag, and the stored patch holds no byte
# below 0x20 except tab and newline.
{ cat "$FIX/snapshot/aq-fixture-sample-1.patch"; printf '+x\033[31m\a\tend\r\n'; } >"$root/pr-aq-fixture-sample-1.patch"
touch "$root/pr-aq-fixture-sample-1.escape"
: >"$root/gh.log"
run snapshot "$work/facts.json"
assert_eq "$rc" "0" "escape sequences: exit code"
grep -q 'pr diff 1 -R aq-fixture/sample --allow-escape-sequences' "$root/gh.log" || { echo "FAIL: escape sequences: no retry with the flag"; fail=1; }
assert_eq "$(LC_ALL=C tr -d '\011\012\040-\377' <"$work/snapshot/aq-fixture-sample-1.patch" | wc -c)" "0" "escape sequences: the stored patch holds no other control byte"
grep -q "$(printf 'x\\[31m\tend')" "$work/snapshot/aq-fixture-sample-1.patch" || { echo "FAIL: escape sequences: the text around the bytes was lost"; fail=1; }
rm "$root/pr-aq-fixture-sample-1.escape"
cp "$FIX/snapshot/aq-fixture-sample-1.patch" "$root/pr-aq-fixture-sample-1.patch"

# A PR too large for `gh pr diff` gets its diff from the file list.
touch "$root/pr-aq-fixture-sample-2.toolarge"
printf '%s\n' '[{"filename":"docs/new.md","previous_filename":"docs/old.md","status":"renamed"}]' \
  '[{"filename":"b.md","status":"modified","patch":"@@ -1 +1 @@\n-x\n+y"}]' >"$root/pr-aq-fixture-sample-2.apifiles"
run snapshot "$work/facts.json"
assert_eq "$(cat "$work/snapshot/aq-fixture-sample-2.patch")" "$(printf '%s\n' 'diff --git a/docs/old.md b/docs/new.md' \
  'rename from docs/old.md' 'rename to docs/new.md' 'diff --git a/b.md b/b.md' '--- a/b.md' '+++ b/b.md' '@@ -1 +1 @@' '-x' '+y')" "too-large diff: built from the file list"
rm "$root/pr-aq-fixture-sample-2.toolarge"
run snapshot "$work/facts.json"

# A head that moves on every fetch exits 1 after three tries and keeps the earlier snapshot; a gh failure exits 1
# with gh's message.
touch "$root/pr-aq-fixture-sample-1.moving"
: >"$root/gh.log"
run snapshot "$work/facts.json"
assert_eq "$rc" "1" "moving head: exit code"
assert_eq "$(grep -c 'pr view' "$root/gh.log")" "6" "moving head: two views per try, three tries"
assert_eq "$(jq -r '.[0].head' "$work/snapshot/heads.json")" "$HA" "moving head: the earlier snapshot stands"
rm -f "$root/pr-aq-fixture-sample-1.moving" "$root/pr-aq-fixture-sample-1.calls"
mv "$root/pr-aq-fixture-sample-2.json" "$root/hold-2.json"
run snapshot "$work/facts.json"
assert_eq "$rc" "1" "gh failure: exit code"
grep -q 'no pull requests found for aq-fixture/sample#2' "$root/err" || { echo "FAIL: gh failure: gh's error not printed: $(cat "$root/err")"; fail=1; }
mv "$root/hold-2.json" "$root/pr-aq-fixture-sample-2.json"
run snapshot "$work/facts.json"
usage_rc() { run "$@"; assert_eq "$rc" "2" "usage: $*"; }
usage_rc snapshot
usage_rc snapshot "$work/text.md"

# ---- a close packet: the item directory, the decision print, and the log line ----
queue packet sample "$work/facts.json" "$work/text.md"
assert_eq "$(jq -c '[.kind, .title, .initiative, (.pid | type), (.pidStart | type), has("revises")]' "$dir/item.json")" \
  '["packet","Skip a decided item in the queue order","sample","number","number",false]' "close: item.json"
assert_eq "$(cmp -s "$work/facts.json" "$dir/facts.json"; echo $?)" "0" "close: facts.json copied"
assert_eq "$(cmp -s "$work/text.md" "$dir/text.md"; echo $?)" "0" "close: text.md copied"
assert_eq "$(cmp -s "$work/snapshot/aq-fixture-sample-2.patch" "$dir/snapshot/aq-fixture-sample-2.patch"; echo $?)" "0" "close: snapshot copied"
assert_eq "$(jq -c . "$dir/heads.json")" "[{\"ref\":\"$A\",\"head\":\"$HA\"},{\"ref\":\"$B\",\"head\":\"$HB\"}]" "close: heads.json"
assert_eq "$(jq -c '[.ref, .title, .body, .checks, (.files | map([.path, .rank]))]' "$dir/prs/0.json")" \
  "[\"$A\",\"PR 1\",\"Body of 1.\",[{\"name\":\"ci / gate\",\"bucket\":\"pass\"}],[[\"lib/queue.ts\",3],[\"lib/queue.test.ts\",4]]]" "close: prs/0.json (a test file sorts after source)"
assert_eq "$(jq -c '.files' "$dir/prs/1.json")" '[{"path":"docs/queue.md","additions":1,"deletions":0,"rank":0}]' "close: prs/1.json (a held path ranks first)"
[ ! -e "$dir/design.md" ] && [ ! -e "$dir/design.json" ] || { echo "FAIL: close: design files written"; fail=1; }
close_id=$(basename "$dir")
decide "$APPROVE"
assert_eq "$rc" "0" "close approve: exit code"
assert_eq "$(jq -c . "$root/out")" "$(jq -c --argjson h "$(cat "$dir/heads.json")" '. + {parts: $h}' <<<"$APPROVE")" "close approve: stdout carries the parts with heads"
assert_eq "$(wc -l <"$root/out")" "1" "close approve: stdout is one line"
assert_eq "$(log_lines)" "1" "close approve: one log line"
assert_eq "$(jq -c '[.packet, .initiative, .kind, .decision, (.calls | length), (.decidedForYou | length), .notes, (.parts | length)]' "$log")" \
  "[\"$close_id\",\"sample\",\"close\",\"approve\",2,1,2,2]" "close approve: log line"
assert_eq "$(jq -r '.time' "$log" | grep -Ec '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$')" "1" "close approve: log time"
grep -q "queued $close_id at http://127.0.0.1:7907/item/$close_id" "$root/err" || { echo "FAIL: close: the queued link is not on stderr"; fail=1; }
collect_check packet "$dir"

# ---- pending: a decided packet whose notes have no reply ----
pending_out() { bash "$SCRIPT" pending 2>/dev/null; }
assert_eq "$(pending_out)" "$(printf '%s\tnotes\t2\t%s' "$close_id" 'Skip a decided item in the queue order')" "pending: a decided packet's unanswered notes"

# ---- reply: shape refusals, then a good reply ----
printf '%s\n' '[{"note":"n1","outcome":"fixed","text":"Done.","ref":"abc1234"}]' >"$root/r-good.json"
reply_refused() {
  local label=$1 json=$2 id=${3:-$close_id}
  printf '%s\n' "$json" >"$root/r.json"
  run reply "$id" "$root/r.json"
  assert_eq "$rc" "2" "reply $label: exit code"
  [ ! -e "$state/items/$close_id/replies.json" ] || { echo "FAIL: reply $label: stored replies"; fail=1; }
}
reply_refused "not an array" '{"note":"n1"}'
reply_refused "an unknown outcome" '[{"note":"n1","outcome":"done","text":"x"}]'
reply_refused "fixed without a ref" '[{"note":"n1","outcome":"fixed","text":"x"}]'
reply_refused "filed without a ref" '[{"note":"n1","outcome":"filed","text":"x"}]'
reply_refused "a note the item does not have" '[{"note":"n9","outcome":"answered","text":"x"}]'
reply_refused "no text" '[{"note":"n1","outcome":"answered","text":" "}]'
reply_refused "a stray key" '[{"note":"n1","outcome":"answered","text":"x","extra":1}]'
reply_refused "an item that is not decided" '[{"note":"n1","outcome":"answered","text":"x"}]' 20200101T000000-1
run reply notanid "$root/r-good.json"; assert_eq "$rc" "2" "reply: not an item id"
run reply "$close_id"; assert_eq "$rc" "2" "reply: no file"
run reply "$close_id" "$root/r-good.json"
assert_eq "$rc" "0" "reply: good reply exit code"
assert_eq "$(jq -c '[.[].note]' "$state/items/$close_id/replies.json")" '["n1"]' "reply: stored"
assert_eq "$(pending_out)" "$(printf '%s\tnotes\t1\t%s' "$close_id" 'Skip a decided item in the queue order')" "pending: one note left"
printf '%s\n' '[{"note":"n2","outcome":"answered","text":"Because.","ref":"https://example.test/x"}]' >"$root/r2.json"
run reply "$close_id" "$root/r2.json"
assert_eq "$(jq -c '[.[].note]' "$state/items/$close_id/replies.json")" '["n1","n2"]' "reply: a second call adds to the first"
assert_eq "$(pending_out)" "" "pending: every note answered"

# The digest's notes: ids D<n>, answered by `reply digest`.
printf '%s\n' '[{"id":"D1","text":"a"},{"id":"D2","text":"b"}]' >"$state/digest-notes.json"
assert_eq "$(pending_out)" "$(printf 'digest\tdigest-notes\t2\t-')" "pending: digest notes"
printf '%s\n' '[{"note":"D1","outcome":"answered","text":"Yes."}]' >"$root/rd.json"
run reply digest "$root/rd.json"
assert_eq "$rc" "0" "reply digest: exit code"
assert_eq "$(pending_out)" "$(printf 'digest\tdigest-notes\t1\t-')" "pending: one digest note left"
printf '%s\n' '[{"note":"D2","outcome":"filed","text":"Logged.","ref":"backlog 12"}]' >"$root/rd.json"
run reply digest "$root/rd.json"
assert_eq "$(pending_out)" "" "pending: digest answered"
printf '%s\n' '[{"note":"D3","outcome":"answered","text":"x"}]' >"$root/rd.json"
run reply digest "$root/rd.json"
assert_eq "$rc" "2" "reply digest: an unknown note"

# ---- the packet refuses ----
# A claim citing line 40 of a short hunk is refused, naming the claim; nothing is queued.
sed 's|lib/queue.ts:10-14|lib/queue.ts:40-40|' "$work/text.md" >"$root/text-range.md"
refused "claim range" 'claim "The queue order now skips an item that has a decision."' packet sample "$work/facts.json" "$root/text-range.md"
grep -q 'lib/queue.ts:40-40' "$root/err" || { echo "FAIL: claim range: the cited lines are not named"; fail=1; }
# A defect in the text alone is the grammar's refusal, logged to refusals.jsonl.
grep -v '^## Your calls' "$work/text.md" >"$root/text-nocalls.md"
rm -f "$state/refusals.jsonl"
refused "text without calls" 'Your calls' packet sample "$work/facts.json" "$root/text-nocalls.md"
assert_eq "$(jq -r '.initiative' "$state/refusals.jsonl")" "sample" "refusals.jsonl: initiative"
# A head that moved after the snapshot is refused.
mkpr 1 moved999 OPEN pass
refused "moved head" "$A moved" packet sample "$work/facts.json" "$work/text.md"
grep -q 'snapshot' "$root/err" || { echo "FAIL: moved head: the snapshot is not named"; fail=1; }
mkpr 1 $HA OPEN pass
# A merged or closed PR is refused.
mkpr 2 $HB MERGED pass
refused "merged PR" "$B is MERGED" packet sample "$work/facts.json" "$work/text.md"
mkpr 2 $HB OPEN pass
# A failing check refuses at once, and names the forced call that would carry it.
mkpr 1 $HA OPEN fail
: >"$root/gh.log"
refused "failing check" "forced call with the rule gate-failed" packet sample "$work/facts.json" "$work/text.md"
assert_eq "$(grep -c 'pr view 1 ' "$root/gh.log")" "1" "failing check: no waiting"
# A Before merge section needs a forced call; the fixture has one, so only the missing-call case refuses.
mkpr 1 $HA OPEN pass
jq '.body = "Body.\n\n## Before merge\n\nRun the migration.\n"' "$root/pr-aq-fixture-sample-1.json" >"$root/x.json" && mv "$root/x.json" "$root/pr-aq-fixture-sample-1.json"
run packet --check sample "$work/facts.json" "$work/text.md"
assert_eq "$rc" "0" "Before merge with a forced call: accepted"
mkpr 1 $HA OPEN pass
# Pending checks: --check reports them and does not wait.
mkpr 1 $HA OPEN pending
: >"$root/gh.log"
refused "--check with pending checks" "has checks still pending" packet --check sample "$work/facts.json" "$work/text.md"
assert_eq "$(grep -c 'pr view 1 ' "$root/gh.log")" "1" "--check with pending checks: no waiting"
# A check that stays pending refuses at the cap.
refused "pending past the cap" "still has checks pending after 3s" packet sample "$work/facts.json" "$work/text.md"
mkpr 1 $HA OPEN pass
# A resend of a retired one-file packet, and an old-grammar file, exit 2 naming the replacement.
refused "one-file form" "the approval-packet skill" packet sample "$work/text.md"
printf '# Old\n\n## Brief\n\nx\n' >"$root/old-packet.md"
refused "old-grammar packet file" "the approval-packet skill" packet sample "$root/old-packet.md" "$work/text.md"
refused "initiative with a capital" "initiative" packet Sample "$work/facts.json" "$work/text.md"
refused "initiative with no record" "initiative" packet nosuch "$work/facts.json" "$work/text.md"
mkdir -p "$APPROVAL_QUEUE_PROJECTS/initiatives/norecord"
refused "initiative directory with no initiative.yaml" "initiative" packet norecord "$work/facts.json" "$work/text.md"
usage_rc packet sample
usage_rc packet --check sample
usage_rc packet --replies
# A snapshot of other pull requests than the fact file's is refused.
mkdir -p "$root/w3"
cp "$work/facts.json" "$root/w3/facts.json"
cp -r "$work/snapshot" "$root/w3/snapshot"
jq '.[0].ref = "aq-fixture/sample#9"' "$root/w3/snapshot/heads.json" >"$root/x.json" && mv "$root/x.json" "$root/w3/snapshot/heads.json"
refused "snapshot of other pull requests" "snapshot holds other pull requests" packet sample "$root/w3/facts.json" "$work/text.md"
rm -rf "$root/w3/snapshot"
refused "no snapshot beside the fact file" "run approval-queue snapshot" packet sample "$root/w3/facts.json" "$work/text.md"
# gh failing is a tool failure: exit 1 with gh's error.
mv "$root/pr-aq-fixture-sample-2.json" "$root/hold-2.json"
run packet sample "$work/facts.json" "$work/text.md"
assert_eq "$rc" "1" "gh failure: exit code"
grep -q 'no pull requests found' "$root/err" || { echo "FAIL: gh failure: gh's error is not printed"; fail=1; }
mv "$root/hold-2.json" "$root/pr-aq-fixture-sample-2.json"

# --check runs the checks and queues nothing: no item, no tab, no app start.
before=$(item_count)
rm -f "$root/open.record" "$root/curl.record" "$state/tab.seen" "$state/start.lock"
run packet --check sample "$work/facts.json" "$work/text.md"
assert_eq "$rc" "0" "--check: exit code"
assert_eq "$(wc -c <"$root/out")" "0" "--check: stdout"
assert_eq "$(item_count)" "$before" "--check: no item directory"
[ ! -e "$root/open.record" ] && [ ! -e "$state/tab.seen" ] && [ ! -e "$root/curl.record" ] && [ ! -e "$state/start.lock" ] \
  || { echo "FAIL: --check: opened a tab or reached for the app"; fail=1; }

# ---- a stub that answers pending twice, then passing, makes packet queue ----
echo 2 >"$root/pr-aq-fixture-sample-1.pend"
: >"$root/gh.log"
queue packet sample "$work/facts.json" "$work/text.md"
assert_eq "$(cat "$root/pr-aq-fixture-sample-1.pend")" "0" "pending twice: both pending answers were read"
assert_eq "$(grep -c 'pr view 1 .*statusCheckRollup' "$root/gh.log")" "3" "pending twice: three reads of #1"
assert_eq "$(jq -c '.checks' "$dir/prs/0.json")" '[{"name":"ci / gate","bucket":"pass"}]' "pending twice: the stored checks are the passing read"
rm "$root/pr-aq-fixture-sample-1.pend"

# ---- a head that moves while the item waits writes stale.json ----
[ ! -e "$dir/stale.json" ] || { echo "FAIL: stale: stale.json before any move"; fail=1; }
mkpr 1 moved222 OPEN pass
wait_for "$dir/stale.json"
assert_eq "$(jq -c . "$dir/stale.json" 2>/dev/null)" "{\"ref\":\"$A\",\"queued\":\"$HA\",\"now\":\"moved222\"}" "stale: stale.json"
mkpr 1 $HA OPEN pass
# A packet that holds a PR already in a waiting item is refused.
refused "waiting item" "$A is already in the waiting item $(basename "$dir")" packet sample "$work/facts.json" "$work/text.md"
# A decision shape the command does not accept exits 1, prints nothing, and logs nothing.
before=$(log_lines)
decide '{"decision":"submit"}'
assert_eq "$rc" "1" "bad decision: exit code"
assert_eq "$(wc -c <"$root/out")" "0" "bad decision: stdout"
assert_eq "$(log_lines)" "$before" "bad decision: log lines"

# ---- a send-back, and a resend that answers each note ----
queue packet sample "$work/facts.json" "$work/text.md"
first=$(basename "$dir")
decide "$REJECT"
assert_eq "$rc" "0" "send-back: exit code"
assert_eq "$(jq -c '[.decision, (.notes | length), (.parts | map(.head))]' "$root/out")" '["reject",2,["aaaa111","bbbb222"]]' "send-back: stdout"
assert_eq "$(jq -c '[.kind, .notes, .decision]' "$log" | tail -n 1)" '["close",2,"reject"]' "send-back: log line"
before=$(item_count)
refused "resend with no replies" "n1, n2 unanswered" packet sample "$work/facts.json" "$work/text.md"
grep -q "$first" "$root/err" || { echo "FAIL: resend with no replies: the sent-back item is not named"; fail=1; }
printf '%s\n' '[{"note":"n1","outcome":"fixed","text":"Done.","ref":"abc1234"}]' >"$root/replies-one.json"
refused "resend missing a reply" "n2 unanswered" packet --replies "$root/replies-one.json" sample "$work/facts.json" "$work/text.md"
[ ! -e "$state/items/$first/replies.json" ] || { echo "FAIL: resend missing a reply: stored replies"; fail=1; }
printf '%s\n' '[{"note":"n9","outcome":"answered","text":"x"}]' >"$root/replies-bad.json"
refused "resend with a reply to no note" "answers a note this item does not have" packet --replies "$root/replies-bad.json" sample "$work/facts.json" "$work/text.md"
printf '%s\n' '[{"note":"n1","outcome":"fixed","text":"Done.","ref":"abc1234"},{"note":"n2","outcome":"answered","text":"Because."}]' >"$root/replies-both.json"
run packet --check --replies "$root/replies-both.json" sample "$work/facts.json" "$work/text.md"
assert_eq "$rc" "0" "resend --check: exit code"
[ ! -e "$state/items/$first/replies.json" ] || { echo "FAIL: resend --check: stored replies"; fail=1; }
queue packet --replies "$root/replies-both.json" sample "$work/facts.json" "$work/text.md"
second=$(basename "$dir")
assert_eq "$(jq -c '.revises' "$dir/item.json")" "{\"item\":\"$first\",\"revision\":2}" "resend: item.json revises"
assert_eq "$(jq -c '[.[].note]' "$state/items/$first/replies.json")" '["n1","n2"]' "resend: replies stored on the sent-back item"
decide "$REJECT"
# The revision counts on: a third round names the second item.
printf '%s\n' '[{"note":"n1","outcome":"answered","text":"a"},{"note":"n2","outcome":"answered","text":"b"}]' >"$root/replies-3.json"
queue packet --replies "$root/replies-3.json" sample "$work/facts.json" "$work/text.md"
assert_eq "$(jq -c '.revises' "$dir/item.json")" "{\"item\":\"$second\",\"revision\":3}" "third round: item.json revises"
# --replies on a packet that resends nothing is refused.
decide "$APPROVE"
refused "replies with nothing sent back" "no item holding these pull requests was" packet --replies "$root/replies-3.json" sample "$work/facts.json" "$work/text.md"
queue packet sample "$work/facts.json" "$work/text.md"
assert_eq "$(jq -c 'has("revises")' "$dir/item.json")" "false" "after an approve: no revises"
decide "$APPROVE"

# ---- a design packet ----
queue packet sample "$w2/facts.json" "$w2/text.md"
dsha=$(sha256sum "$designfile" | cut -d' ' -f1)
assert_eq "$(jq -c '[.kind, .title]' "$dir/item.json")" '["packet","Sample queue redesign"]' "design: item.json"
assert_eq "$(cmp -s "$designfile" "$dir/design.md"; echo $?)" "0" "design: design.md copied"
assert_eq "$(jq -c . "$dir/design.json")" "{\"sha256\":\"$dsha\",\"path\":\"$(realpath "$designfile")\"}" "design: design.json"
[ ! -e "$dir/heads.json" ] && [ ! -d "$dir/prs" ] || { echo "FAIL: design: pull request files written"; fail=1; }
design_id=$(basename "$dir")
dref="sample:docs/specs/2026-11-10-sample-design.md"
# The design's hash moving while the item waits writes stale.json.
printf 'Edited later.\n' >>"$designfile"
wait_for "$dir/stale.json"
assert_eq "$(jq -r '[.ref, .queued] | join(" ")' "$dir/stale.json" 2>/dev/null)" "$dref $dsha" "design: stale.json"
printf '# A design\n\nOriginal text.\n' >"$designfile"
# The poll reads the recorded path: a second copy outside the projects tree, edited, writes stale.json.
rm -f "$dir/stale.json"
elsewhere="$root/elsewhere-design.md"
cp "$designfile" "$elsewhere"
jq -c --arg p "$elsewhere" '.path = $p' "$dir/design.json" >"$dir/design.json.tmp" && mv "$dir/design.json.tmp" "$dir/design.json"
printf 'Edited elsewhere.\n' >>"$elsewhere"
wait_for "$dir/stale.json"
assert_eq "$(jq -r '.now' "$dir/stale.json" 2>/dev/null)" "$(sha256sum "$elsewhere" | cut -d' ' -f1)" "design: stale.json from the recorded path"
# An item with no recorded path reads the projects tree, as before.
rm -f "$dir/stale.json"
jq -c 'del(.path)' "$dir/design.json" >"$dir/design.json.tmp" && mv "$dir/design.json.tmp" "$dir/design.json"
printf 'Edited later.\n' >>"$designfile"
wait_for "$dir/stale.json"
assert_eq "$(jq -r '.ref' "$dir/stale.json" 2>/dev/null)" "$dref" "design: stale.json for an item with no recorded path"
printf '# A design\n\nOriginal text.\n' >"$designfile"
DESIGN_REJECT='{"decision":"reject","calls":[],"decidedForYou":[],"notes":[{"id":"n1","text":"Why?","anchor":null}]}'
decide "$DESIGN_REJECT"
assert_eq "$(jq -c '.parts' "$root/out")" "[{\"ref\":\"$dref\",\"sha256\":\"$dsha\"}]" "design: parts carry the file hash"
assert_eq "$(jq -c '[.kind, .decision, .notes]' "$log" | tail -n 1)" '["design","reject",1]' "design: log line"
# The resend of a sent-back design is found by its repo and path.
refused "design resend with no replies" "n1 unanswered" packet sample "$w2/facts.json" "$w2/text.md"
printf '%s\n' '[{"note":"n1","outcome":"answered","text":"Because."}]' >"$root/replies-d.json"
queue packet --replies "$root/replies-d.json" sample "$w2/facts.json" "$w2/text.md"
assert_eq "$(jq -c '.revises' "$dir/item.json")" "{\"item\":\"$design_id\",\"revision\":2}" "design resend: item.json revises"
decide '{"decision":"approve","calls":[{"call":1,"choice":"Drop it","changed":false}],"decidedForYou":[],"notes":[]}'
assert_eq "$rc" "0" "design approve: exit code"
run merge "$(basename "$dir")"
assert_eq "$rc" "2" "design packet: merge has nothing to merge"

# ---- the design and triage kinds keep their behavior ----
before=$(log_lines)
cat >"$root/single-design.md" <<'BRIEF'
# design

## Brief

The queue now refuses an item with no brief.

A session that skips the brief gets a message naming the fix, so every item arrives readable.

### What changes

- The command checks the brief before it queues anything.

### If you approve

1. The PR merges.
BRIEF
queue design glw907/sample "A title" "$root/single-design.md"
decide '{"decision":"hold"}'
assert_eq "$(tail -n 1 "$log" | jq -c '[.ref,.kind,.lane,.verdict]')" '["glw907/sample:single-design.md","design","single","hold"]' "design kind: log line"
assert_eq "$(($(log_lines) - before))" "1" "design kind: log line count"

live_leak

[ "$fail" = 0 ] && echo "packet: ok"
exit "$fail"
