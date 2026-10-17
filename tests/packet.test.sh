#!/usr/bin/env bash
# packet.test.sh: prove the packet half of the approval-queue command against this worktree's own
# copy, with curl, firefox, setsid, and gh stubbed on PATH. The decision handling is the merge
# authorization path, so most of this file pins what the command prints and logs for a decision.
# Never starts the app, opens a browser, or touches the live queue state.
set -uo pipefail
cd "$(dirname "$0")/.."
SCRIPT="$(pwd)/bin/.local/bin/approval-queue"
PACKET="$(pwd)/tests/fixtures/e2e-packet.md"
BRIEF="$(pwd)/tests/fixtures/e2e-brief.md"
fail=0
root="$(mktemp -d)"
bgpid=""
trap '[ -n "$bgpid" ] && kill "$bgpid" 2>/dev/null; rm -rf "$root"' EXIT

assert_eq() {
  [ "$1" = "$2" ] || { echo "FAIL: $3: got '$1', want '$2'"; fail=1; }
}

# The live log must come through the run untouched.
live_log="$HOME/.local/state/approval-queue/decisions.jsonl"
live_before=$(stat -c %s "$live_log" 2>/dev/null || echo none)

stubs="$root/stubs"
mkdir -p "$stubs"
cat >"$stubs/curl" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$STUB_DIR/curl.record"
exit 0
STUB
cat >"$stubs/firefox" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$STUB_DIR/firefox.record"
STUB
cat >"$stubs/setsid" <<'STUB'
#!/usr/bin/env bash
[ "$1" = "-f" ] && shift
exec "$@"
STUB
# gh answers by PR number from $STUB_DIR/pr-<n>.json. A pr-<n>.moving file makes every view report
# a head that differs from the last, so the command sees the head move on each fetch.
cat >"$stubs/gh" <<'STUB'
#!/usr/bin/env bash
n=$3
f="$STUB_DIR/pr-$n.json"
[ -e "$f" ] || { echo "no pull request $n" >&2; exit 1; }
echo "gh $*" >>"$STUB_DIR/gh.record"
case "$2" in
  view)
    if [ -e "$STUB_DIR/pr-$n.moving" ]; then
      c=$(($(cat "$STUB_DIR/pr-$n.calls" 2>/dev/null || echo 0) + 1)); echo "$c" >"$STUB_DIR/pr-$n.calls"
      jq -c --arg h "moved$c" '.headRefOid = $h' "$f"
    else jq -c . "$f"; fi ;;
  diff) echo "diff --git a/pr$n b/pr$n" ;;
esac
STUB
chmod +x "$stubs"/*

export STUB_DIR="$root" XDG_STATE_HOME="$root/state" APPROVAL_QUEUE_PROJECTS="$root/projects" PATH="$stubs:$PATH"
state="$XDG_STATE_HOME/approval-queue"
log="$state/decisions.jsonl"
mkdir -p "$APPROVAL_QUEUE_PROJECTS/initiatives/drafter" "$APPROVAL_QUEUE_PROJECTS/drafter/docs/specs"
printf 'title: Drafter release notes\nstatus: active\n' >"$APPROVAL_QUEUE_PROJECTS/initiatives/drafter/initiative.yaml"
design="$APPROVAL_QUEUE_PROJECTS/drafter/docs/specs/x-design.md"
printf '# A design\n\nOriginal text.\n' >"$design"

# mkpr <n> <head> <state> <checks>: writes the gh stub's answer for PR n.
mkpr() {
  local checks='[]'
  case "$4" in
    pass) checks='[{"name":"gate","workflowName":"ci","status":"COMPLETED","conclusion":"SUCCESS"}]' ;;
    fail) checks='[{"name":"lint","workflowName":"ci","status":"COMPLETED","conclusion":"FAILURE"}]' ;;
    pending) checks='[{"name":"gate","workflowName":"ci","status":"IN_PROGRESS","conclusion":""}]' ;;
  esac
  jq -n --rawfile body "$BRIEF" --arg h "$2" --arg s "$3" --argjson n "$1" --argjson c "$checks" \
    '{body: $body, headRefOid: $h, number: $n, url: "https://github.com/glw907/drafter/pull/\($n)",
      headRefName: "feat-\($n)", baseRefName: "main", state: $s, statusCheckRollup: $c}' >"$root/pr-$1.json"
}
mkpr 41 aaa111 OPEN fail
mkpr 42 bbb222 OPEN pass
mkpr 43 ccc333 OPEN pass

# wait_for <glob>: up to 5 seconds; on a timeout, fails the test and kills the background job.
wait_for() {
  local i
  for i in $(seq 50); do compgen -G "$1" >/dev/null && return 0; sleep 0.1; done
  echo "FAIL: timed out waiting for $1"; fail=1
  kill "$bgpid" 2>/dev/null; wait "$bgpid" 2>/dev/null; bgpid=""
  return 1
}

# queue <command args>: starts the command in the background and sets dir to its item directory.
dir=""
queue() {
  rm -rf "$state/items" "$root/firefox.record"
  bash "$SCRIPT" "$@" >"$root/out" 2>"$root/err" &
  bgpid=$!
  dir=""
  wait_for "$state/items/*/item.json" || return 1
  dir=$(dirname "$(ls "$state"/items/*/item.json | head -1)")
}

# decide <json>: hands the decision to the queued command and sets rc to its exit code.
rc=""
decide() {
  local i
  printf '%s\n' "$1" >"$dir/decision.json.tmp"
  mv "$dir/decision.json.tmp" "$dir/decision.json"
  for i in $(seq 60); do kill -0 "$bgpid" 2>/dev/null || break; sleep 0.1; done
  if kill -0 "$bgpid" 2>/dev/null; then
    echo "FAIL: did not exit after the decision"; fail=1
    kill "$bgpid"; wait "$bgpid" 2>/dev/null; bgpid=""; rc=hung; return
  fi
  wait "$bgpid"; rc=$?; bgpid=""
}

log_lines() { if [ -e "$log" ]; then wc -l <"$log"; else echo 0; fi; }

# The decision the page would post for the end-to-end packet: #42 held, everything else as tagged.
GOOD='{"decision":"approve","parts":[{"ref":"glw907/drafter#41","verdict":"approve"},{"ref":"glw907/drafter#42","verdict":"hold"},{"ref":"glw907/drafter#43","verdict":"approve"},{"ref":"step:1","verdict":"session"}],"asks":[{"index":1,"choice":"Merge anyway"},{"index":2,"choice":"Beta"}]}'

# End-to-end check 3, command half: each part comes back with its own head.
queue packet drafter "$PACKET" && decide "$GOOD"
assert_eq "$rc" "0" "approve: exit code"
want='{"decision":"approve","parts":[
 {"ref":"glw907/drafter#41","kind":"pr","lane":"ask","verdict":"approve","head":"aaa111"},
 {"ref":"glw907/drafter#42","kind":"pr","lane":"routine","verdict":"hold","head":"bbb222"},
 {"ref":"glw907/drafter#43","kind":"pr","lane":"routine","verdict":"approve","head":"ccc333"},
 {"ref":"step:1","kind":"step","lane":"routine","verdict":"session"}],
 "asks":[
 {"index":1,"part":"glw907/drafter#41","rule":"gate-failed","choice":"Merge anyway","followed":false},
 {"index":2,"part":null,"rule":"owner-call","choice":"Beta","followed":true}]}'
assert_eq "$(jq -cS . "$root/out")" "$(jq -cS . <<<"$want")" "approve: stdout"
assert_eq "$(wc -l <"$root/out")" "1" "approve: stdout is one line"

# End-to-end check 4: one log line per part, plus one for the part-less ask.
assert_eq "$(log_lines)" "5" "approve: log line count"
assert_eq "$(jq -c '[.ref,.lane,.rule,.verdict]' "$log" | paste -sd' ')" \
  '["glw907/drafter#41","ask","gate-failed","approve"] ["glw907/drafter#42","routine",null,"hold"] ["glw907/drafter#43","routine",null,"approve"] ["step:1","routine",null,"session"] ["ask:2","ask","owner-call",null]' \
  "approve: log refs, lanes, rules, verdicts"
assert_eq "$(sed -n 1p "$log" | jq -c '[.head,.recommended,.chosen,.overridden]')" '["aaa111","Hold","Merge anyway",true]' "approve: ask-bound line"
assert_eq "$(sed -n 2p "$log" | jq -c '[.head,.recommended,.chosen,.overridden]')" '["bbb222","approve","hold",true]' "approve: overridden routine line"
assert_eq "$(sed -n 3p "$log" | jq -c '[.head,.recommended,.chosen,.overridden]')" '["ccc333","approve","approve",false]' "approve: followed routine line"
assert_eq "$(sed -n 5p "$log" | jq -c '[.recommended,.chosen,.overridden]')" '["Beta","Beta",false]' "approve: part-less ask line"
assert_eq "$(jq -r '.initiative' "$log" | sort -u)" "drafter" "approve: log initiative"
assert_eq "$(jq -r '.packet' "$log" | sort -u)" "$(basename "$dir")" "approve: log packet id"
assert_eq "$(jq -r '.time' "$log" | grep -Ec '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$')" "5" "approve: log times"

# A reject prints the note, no parts, and logs each part as rejected.
before=$(log_lines)
queue packet drafter "$PACKET" && decide '{"decision":"reject","note":"Split this packet."}'
assert_eq "$rc" "0" "reject: exit code"
assert_eq "$(jq -cS . "$root/out")" '{"decision":"reject","note":"Split this packet."}' "reject: stdout"
assert_eq "$(($(log_lines) - before))" "4" "reject: log line count"
assert_eq "$(tail -n 4 "$log" | jq -r .verdict | sort -u)" "reject" "reject: every line rejected"

# A design part whose file changed since queueing comes back hold, changed, with the sha256 read.
{ cat "$PACKET"; echo '| glw907/drafter:docs/specs/x-design.md | approve | The design is unchanged. | Nothing in it needs a call. |'; } >"$root/with-design.md"
GOOD_DESIGN=$(jq -c '.parts += [{"ref":"glw907/drafter:docs/specs/x-design.md","verdict":"approve"}]' <<<"$GOOD")
read_sha=$(sha256sum "$design" | cut -d' ' -f1)
queue packet drafter "$root/with-design.md" && decide "$GOOD_DESIGN"
assert_eq "$rc" "0" "design unchanged: exit code"
assert_eq "$(jq -c '.parts[4]' "$root/out")" \
  "{\"ref\":\"glw907/drafter:docs/specs/x-design.md\",\"kind\":\"design\",\"lane\":\"routine\",\"verdict\":\"approve\",\"sha256\":\"$read_sha\"}" "design unchanged: part"
queue packet drafter "$root/with-design.md"
printf 'Edited after queueing.\n' >>"$design"
decide "$GOOD_DESIGN"
assert_eq "$rc" "0" "design changed: exit code"
assert_eq "$(jq -c '.parts[4]' "$root/out")" \
  "{\"ref\":\"glw907/drafter:docs/specs/x-design.md\",\"kind\":\"design\",\"lane\":\"routine\",\"verdict\":\"hold\",\"sha256\":\"$read_sha\",\"changed\":true}" "design changed: part"
assert_eq "$(grep -F 'x-design.md' "$log" | tail -n 1 | jq -c '[.verdict,.sha256]')" "[\"hold\",\"$read_sha\"]" "design changed: log line"

# A decision outside the server's shape exits 1, prints nothing, and logs nothing.
reject_shape() {
  local label=$1 json=$2 before
  before=$(log_lines)
  queue packet drafter "$PACKET" && decide "$json"
  assert_eq "$rc" "1" "$label: exit code"
  assert_eq "$(wc -c <"$root/out")" "0" "$label: stdout"
  assert_eq "$(log_lines)" "$before" "$label: log lines"
}
reject_shape "submit" '{"decision":"submit"}'
reject_shape "unknown ref" "$(jq -c '.parts[0].ref = "glw907/drafter#99"' <<<"$GOOD")"
reject_shape "missing part" "$(jq -c 'del(.parts[3])' <<<"$GOOD")"
reject_shape "repeated part" "$(jq -c '.parts += [.parts[0]]' <<<"$GOOD")"
reject_shape "step approved" "$(jq -c '.parts[3].verdict = "approve"' <<<"$GOOD")"
reject_shape "pr given a step verdict" "$(jq -c '.parts[1].verdict = "session"' <<<"$GOOD")"
reject_shape "unknown choice" "$(jq -c '.asks[1].choice = "Gamma"' <<<"$GOOD")"
reject_shape "unanswered ask" "$(jq -c 'del(.asks[1])' <<<"$GOOD")"
reject_shape "verdict against the chosen tag" "$(jq -c '.asks[0].choice = "Hold"' <<<"$GOOD")"
reject_shape "reject without a note" '{"decision":"reject"}'

# The pr and design kinds log one line per decision with lane single.
before=$(log_lines)
queue pr glw907/drafter "A title" 42 && decide '{"decision":"approve"}'
assert_eq "$(jq -c . "$root/out")" '{"decision":"approve","head":"bbb222"}' "pr kind: stdout"
assert_eq "$(tail -n 1 "$log" | jq -c '[.ref,.kind,.lane,.verdict,.head]')" '["glw907/drafter#42","pr","single","approve","bbb222"]' "pr kind: log line"
cp "$BRIEF" "$root/single-design.md"
queue design glw907/drafter "A title" "$root/single-design.md" && decide '{"decision":"hold"}'
assert_eq "$(tail -n 1 "$log" | jq -c '[.ref,.kind,.lane,.verdict,.sha256]')" \
  "[\"glw907/drafter:single-design.md\",\"design\",\"single\",\"hold\",\"$(sha256sum "$root/single-design.md" | cut -d' ' -f1)\"]" "design kind: log line"
assert_eq "$(($(log_lines) - before))" "2" "single kinds: log line count"

# item.json names the packet kind, the initiative and its title, the lead repo, and every ref.
queue packet drafter "$PACKET"
assert_eq "$(jq -c '[.kind,.initiative,.initiativeTitle,.repo,.refs]' "$dir/item.json")" \
  '["packet","drafter","Drafter release notes","glw907/drafter",["glw907/drafter#41","glw907/drafter#42","glw907/drafter#43","step:1"]]' "item.json fields"
assert_eq "$(jq -r .headline "$dir/item.json")" "$(head -1 "$PACKET" | sed 's/^# //')" "item.json headline"
assert_eq "$(jq -r .head "$dir/parts/1/pr.json")" "bbb222" "item: part 1 head"
assert_eq "$(cat "$dir/parts/1/diff.patch")" "diff --git a/pr42 b/pr42" "item: part 1 diff"
[ -s "$dir/parts/1/body.md" ] && cmp -s "$PACKET" "$dir/packet.md" || { echo "FAIL: item: body or packet.md missing"; fail=1; }
assert_eq "$(jq -r .headline "$dir/packet.json")" "$(jq -r .headline "$dir/item.json")" "item: packet.json parse"
decide "$GOOD"

# A packet with initiative none queues with no initiative title.
queue packet none "$PACKET"
assert_eq "$(jq -c '[.initiative,.initiativeTitle]' "$dir/item.json")" '["none",""]' "initiative none"
decide "$GOOD"

# refuse <label> <want> <command args>: the command exits 2 naming the defect, queues nothing,
# and logs {time, initiative, defect} to refusals.jsonl.
refuse() {
  local label=$1 want=$2 initiative=$3 got
  shift 3
  rm -rf "$state/items" "$root/firefox.record" "$state/refusals.jsonl"
  timeout 20 bash "$SCRIPT" packet "$@" >"$root/out" 2>"$root/err"
  assert_eq "$?" "2" "$label: exit code"
  grep -qF -- "$want" "$root/err" || { echo "FAIL: $label: message lacks '$want': $(cat "$root/err")"; fail=1; }
  assert_eq "$(wc -c <"$root/out")" "0" "$label: stdout"
  ! compgen -G "$state/items/*" >/dev/null || { echo "FAIL: $label: left an item directory"; fail=1; }
  got=$(tail -n 1 "$state/refusals.jsonl" 2>/dev/null)
  assert_eq "$(jq -r .initiative <<<"$got")" "$initiative" "$label: refusals.jsonl initiative"
  jq -e --arg w "$want" '.defect | contains($w)' <<<"$got" >/dev/null 2>&1 || { echo "FAIL: $label: refusals.jsonl defect lacks '$want': $got"; fail=1; }
  jq -e '.time | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T")' <<<"$got" >/dev/null 2>&1 || { echo "FAIL: $label: refusals.jsonl time"; fail=1; }
}
# usage_refusal <label> <command args>: a malformed command line exits 2 before anything else.
usage_refusal() {
  local label=$1
  shift
  timeout 20 bash "$SCRIPT" "$@" >"$root/out" 2>"$root/err"
  assert_eq "$?" "2" "$label: exit code"
}

# The initiative is none or names a directory holding initiative.yaml.
refuse "initiative with a capital" "initiative" Drafter Drafter "$PACKET"
refuse "initiative with a path" "initiative" ../drafter ../drafter "$PACKET"
refuse "initiative with no record" "initiative" nosuch nosuch "$PACKET"
mkdir -p "$APPROVAL_QUEUE_PROJECTS/initiatives/norecord"
refuse "initiative directory with no initiative.yaml" "initiative" norecord norecord "$PACKET"
usage_refusal "packet without a file" packet drafter
usage_refusal "packet --check without a file" packet --check drafter

# A defect in the file alone is a parser refusal with the register path.
sed '1s/.*/# One sentence. Then another./' "$PACKET" >"$root/bad-headline.md"
refuse "parser refusal" "the headline is one sentence" drafter drafter "$root/bad-headline.md"
grep -q 'approval-brief.md' "$root/err" || { echo "FAIL: parser refusal: no register path"; fail=1; }

# End-to-end check 5: once the stub reports #43 MERGED, handing it over again exits 2 naming the state.
mkpr 43 ccc333 MERGED pass
refuse "merged PR" "glw907/drafter#43 is MERGED" drafter drafter "$PACKET"
mkpr 43 ccc333 CLOSED pass
refuse "closed PR" "glw907/drafter#43 is CLOSED" drafter drafter "$PACKET"
mkpr 43 ccc333 OPEN pass

# The second states table: pending checks, failing gates, Before merge, and no checks at all.
mkpr 42 bbb222 OPEN pending
refuse "pending check" "wait for the checks to finish" drafter drafter "$PACKET"
mkpr 42 bbb222 OPEN fail
refuse "failing check with no ask" "a failing gate is an ask" drafter drafter "$PACKET"
mkpr 42 bbb222 OPEN pass
jq '.body += "\n## Review\n\nThe review verdict is `fix`.\n"' "$root/pr-42.json" >"$root/pr-42.tmp" && mv "$root/pr-42.tmp" "$root/pr-42.json"
refuse "review verdict fix with no ask" "a failing gate is an ask" drafter drafter "$PACKET"
jq '.body = (.body | sub("`fix`"; "`escalate`"))' "$root/pr-42.json" >"$root/pr-42.tmp" && mv "$root/pr-42.tmp" "$root/pr-42.json"
refuse "review verdict escalate with no ask" "a failing gate is an ask" drafter drafter "$PACKET"
mkpr 42 bbb222 OPEN pass
jq '.body += "\n## Before merge\n\n1. Run the migration.\n"' "$root/pr-42.json" >"$root/pr-42.tmp" && mv "$root/pr-42.tmp" "$root/pr-42.json"
refuse "Before merge with no ask" "a Before merge step is an ask" drafter drafter "$PACKET"
mkpr 42 bbb222 OPEN none
queue packet drafter "$PACKET"
assert_eq "$(jq -c '.statusCheckRollup' "$dir/parts/1/pr.json")" "[]" "no checks: accepted"
decide "$GOOD"
mkpr 42 bbb222 OPEN pass

# A PR whose head moves on every fetch exits 1 after three tries, prints nothing, and queues nothing.
touch "$root/pr-42.moving"; rm -f "$root/pr-42.calls"
rm -rf "$state/items"
timeout 20 bash "$SCRIPT" packet drafter "$PACKET" >"$root/out" 2>"$root/err"
assert_eq "$?" "1" "moving head: exit code"
assert_eq "$(wc -c <"$root/out")" "0" "moving head: stdout"
assert_eq "$(cat "$root/pr-42.calls")" "6" "moving head: two views per try, three tries"
! compgen -G "$state/items/*" >/dev/null || { echo "FAIL: moving head: left an item directory"; fail=1; }
rm -f "$root/pr-42.moving"

# A PR already in another waiting item is refused, whichever kind queues it.
queue packet drafter "$PACKET"
first=$(basename "$dir")
firstpid=$bgpid
timeout 20 bash "$SCRIPT" packet drafter "$PACKET" >"$root/out2" 2>"$root/err2"
assert_eq "$?" "2" "waiting item (packet): exit code"
grep -q "glw907/drafter#41.*$first" "$root/err2" || { echo "FAIL: waiting item (packet): message lacks the item: $(cat "$root/err2")"; fail=1; }
timeout 20 bash "$SCRIPT" pr glw907/drafter "A title" 42 >"$root/out2" 2>"$root/err2"
assert_eq "$?" "2" "waiting item (pr kind): exit code"
grep -q "glw907/drafter#42.*$first" "$root/err2" || { echo "FAIL: waiting item (pr kind): message lacks the item: $(cat "$root/err2")"; fail=1; }
assert_eq "$(ls "$state/items" | wc -l)" "1" "waiting item: no second item directory"
decide "$GOOD"
# Once decided, the PRs are free again.
queue packet drafter "$PACKET"
decide "$GOOD"

# A pr-kind item in the queue blocks a packet naming its PR.
queue pr glw907/drafter "A title" 42
refuse_dir=$dir
timeout 20 bash "$SCRIPT" packet drafter "$PACKET" >"$root/out2" 2>"$root/err2"
assert_eq "$?" "2" "waiting pr item: exit code"
grep -q "glw907/drafter#42.*$(basename "$refuse_dir")" "$root/err2" || { echo "FAIL: waiting pr item: message lacks the item: $(cat "$root/err2")"; fail=1; }
decide '{"decision":"approve"}'

# --check runs the checks and queues nothing: no item, no tab, no app start.
rm -rf "$state/items" "$state/tab.seen" "$state/start.lock" "$root/firefox.record" "$root/curl.record"
timeout 20 bash "$SCRIPT" packet --check drafter "$PACKET" >"$root/out" 2>"$root/err"
assert_eq "$?" "0" "--check: exit code"
assert_eq "$(wc -c <"$root/out")" "0" "--check: stdout"
! compgen -G "$state/items/*" >/dev/null || { echo "FAIL: --check: left an item directory"; fail=1; }
[ ! -e "$root/firefox.record" ] && [ ! -e "$state/tab.seen" ] || { echo "FAIL: --check: opened a tab"; fail=1; }
[ ! -e "$root/curl.record" ] || { echo "FAIL: --check: reached for the app"; fail=1; }
[ ! -e "$state/start.lock" ] || { echo "FAIL: --check: took the app start lock"; fail=1; }
mkpr 43 ccc333 MERGED pass
timeout 20 bash "$SCRIPT" packet --check drafter "$PACKET" >"$root/out" 2>"$root/err"
assert_eq "$?" "2" "--check on a refused packet: exit code"
mkpr 43 ccc333 OPEN pass

live_after=$(stat -c %s "$live_log" 2>/dev/null || echo none)
assert_eq "$live_after" "$live_before" "live decisions.jsonl untouched"

[ "$fail" = 0 ] && echo "packet: ok"
exit "$fail"
