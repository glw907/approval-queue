#!/usr/bin/env bash
# packet.test.sh: prove the packet half of the approval-queue command against this worktree's own
# copy, with curl, xdg-open, setsid, and gh stubbed on PATH. The decision handling is the merge
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

# No packet id this test logged may appear in the live log. A leak fails by name; other sessions'
# lines in the live log do not matter.
live_log="$HOME/.local/state/approval-queue/decisions.jsonl"
live_leak() {
  local pid
  [ -e "$live_log" ] && [ -e "$log" ] || return 0
  while IFS= read -r pid; do
    if grep -qF "\"packet\":\"$pid\"" "$live_log"; then echo "FAIL: the test wrote packet $pid to the live log"; fail=1; fi
  done < <(jq -r '.packet' "$log" | sort -u)
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
# gh answers by PR number from $STUB_DIR/pr-<n>.json. A pr-<n>.moving file makes every view report
# a head that differs from the last, so the command sees the head move on each fetch.
# A pr-<n>.toolarge file makes `gh pr diff` refuse as GitHub does past 300 files, and `gh api` then
# answers from pr-<n>.files.json.
# A compare call answers from compare-<old>.json (the status; no file answers HTTP 404, as GitHub does for
# an unknown commit) and, for the diff media type, compare-<old>.diff, or HTTP 406 when compare-<old>.toolarge
# exists.
cat >"$stubs/gh" <<'STUB'
#!/usr/bin/env bash
if [ "$1" = api ]; then
  echo "gh $*" >>"$STUB_DIR/gh.record"
  for a in "$@"; do
    case $a in repos/*/compare/*) old=${a#*/compare/}; old=${old%%...*} ;; esac
  done
  if [ -n "${old:-}" ]; then
    case "$*" in
      *vnd.github.diff*)
        if [ -e "$STUB_DIR/compare-$old.toolarge" ]; then echo "gh: Sorry, the diff exceeded the maximum number of files (HTTP 406)" >&2; exit 1; fi
        cat "$STUB_DIR/compare-$old.diff"; exit 0 ;;
    esac
    if [ ! -e "$STUB_DIR/compare-$old.json" ]; then
      echo '{"message":"Not Found","status":"404"}'; echo "gh: Not Found (HTTP 404)" >&2; exit 1
    fi
    jq -r .status "$STUB_DIR/compare-$old.json"; exit 0
  fi
  n=${3#*/pulls/}; n=${n%%/*}
  cat "$STUB_DIR/pr-$n.files.json"; exit 0
fi
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
  diff)
    if [ -e "$STUB_DIR/pr-$n.toolarge" ]; then
      echo "could not find pull request diff: HTTP 406: Sorry, the diff exceeded the maximum number of files (300)." >&2
      echo "PullRequest.diff too_large" >&2; exit 1
    fi
    echo "diff --git a/pr$n b/pr$n" ;;
esac
STUB
chmod +x "$stubs"/*

export STUB_DIR="$root" XDG_STATE_HOME="$root/state" APPROVAL_QUEUE_PROJECTS="$root/projects" PATH="$stubs:$PATH"
state="$XDG_STATE_HOME/approval-queue"
log="$state/decisions.jsonl"
source tests/collect-check.sh
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
  rm -rf "$state/items" "$root/open.record"
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

# assert_queued_link <label>: after a decision, stderr holds the queued link once and stdout only the decision JSON.
assert_queued_link() {
  local id
  id=$(basename "$dir")
  assert_eq "$(grep -c 'queued' "$root/err")" "1" "$1: one queued line on stderr"
  grep -Fxq "approval-queue: queued $id at http://127.0.0.1:7907/item/$id" "$root/err" \
    || { echo "FAIL: $1: the queued link is not on stderr: $(cat "$root/err")"; fail=1; }
  assert_eq "$(jq -e . "$root/out" >/dev/null; echo $?)" "0" "$1: stdout is JSON"
  assert_eq "$(wc -l <"$root/out")" "1" "$1: stdout is one line"
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
assert_eq "$(jq -r '[(.pid | type), (.pidStart | type), (.pid as $p | .id | endswith("-\($p)"))] | join(" ")' "$dir/item.json")" "number number true" "queue: pid and pidStart"
collect_check packet "$dir"

# A reject prints the note, no parts, and logs each part as rejected.
before=$(log_lines)
queue packet drafter "$PACKET" && decide '{"decision":"reject","note":"Split this packet."}'
assert_eq "$rc" "0" "reject: exit code"
assert_eq "$(jq -cS . "$root/out")" '{"calls":[],"decision":"reject","note":"Split this packet."}' "reject: stdout (a stored reject without calls prints none)"
assert_eq "$(($(log_lines) - before))" "4" "reject: log line count"
assert_eq "$(tail -n 4 "$log" | jq -r .verdict | sort -u)" "reject" "reject: every line rejected"

# A reject that carries calls prints them beside the note; the log lines do not change. A rejected packet's
# parts are sent back, so each case below starts from an empty log, or its resend would need a section.
: >"$log"
CALLS='[{"ref":"glw907/drafter#41","verdict":"hold"},{"ref":"glw907/drafter#42","verdict":"send-back"},{"ref":"glw907/drafter#43","verdict":null},{"ref":"step:1","verdict":"session"},{"ask":1,"question":"Merge the drafter PR whose lint check failed?","choice":"Hold"},{"ask":2,"question":"Which name?","choice":null}]'
before=$(log_lines)
queue packet drafter "$PACKET" && decide "{\"decision\":\"reject\",\"note\":\"Split.\",\"calls\":$CALLS}"
assert_eq "$rc" "0" "reject with calls: exit code"
assert_eq "$(jq -cS . "$root/out")" "$(jq -cS --argjson c "$CALLS" -n '{decision: "reject", note: "Split.", calls: $c}')" "reject with calls: stdout"
assert_eq "$(($(log_lines) - before))" "4" "reject with calls: log line count"
assert_eq "$(tail -n 4 "$log" | jq -r '[.verdict, has("calls")] | @csv' | sort -u)" '"reject",false' "reject with calls: lines carry no calls"

# A calls of the wrong shape is refused like any shape error: exit 1, nothing printed, nothing logged.
reject_calls() {
  local label=$1 calls=$2 before
  : >"$log"
  before=$(log_lines)
  queue packet drafter "$PACKET" && decide "{\"decision\":\"reject\",\"note\":\"n\",\"calls\":$calls}"
  assert_eq "$rc" "1" "$label: exit code"
  assert_eq "$(wc -c <"$root/out")" "0" "$label: stdout"
  assert_eq "$(log_lines)" "$before" "$label: log lines"
}
reject_calls "calls not an array" '"hold"'
reject_calls "calls entry not an object" '["hold"]'
reject_calls "calls entry with a stray key" '[{"ref":"glw907/drafter#41","verdict":"hold","extra":1}]'
reject_calls "calls entry with a numeric verdict" '[{"ref":"glw907/drafter#41","verdict":1}]'
reject_calls "calls ask with no question" '[{"ask":1,"choice":"Hold"}]'
reject_calls "calls a document-style entry" '[{"id":"Q1","choice":"Keep it"}]'

# A rejected packet's parts are sent back, so a later packet naming them is a revision. Start the rest of the
# file from a log with no sent-back parts.
: >"$log"

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
reject_shape "empty decision" ''
reject_shape "two decisions" "$GOOD $GOOD"
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
assert_queued_link "pr kind"
assert_eq "$(tail -n 1 "$log" | jq -c '[.ref,.kind,.lane,.verdict,.head]')" '["glw907/drafter#42","pr","single","approve","bbb222"]' "pr kind: log line"
cp "$BRIEF" "$root/single-design.md"
queue design glw907/drafter "A title" "$root/single-design.md" && decide '{"decision":"hold"}'
assert_queued_link "design kind"
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
assert_queued_link "packet"

# A PR too large for `gh pr diff` gets its diff from the file list: a rename with no patch keeps
# its header and rename lines, and a changed file carries its patch.
touch "$root/pr-42.toolarge"
printf '%s\n' '[{"filename":"docs/plans/a.md","previous_filename":"docs/old/a.md","status":"renamed"}]' \
  '[{"filename":"b.md","status":"modified","patch":"@@ -1 +1 @@\n-x\n+y"}]' >"$root/pr-42.files.json"
queue packet drafter "$PACKET"
assert_eq "$(cat "$dir/parts/1/diff.patch")" "$(printf '%s\n' 'diff --git a/docs/old/a.md b/docs/plans/a.md' \
  'rename from docs/old/a.md' 'rename to docs/plans/a.md' 'diff --git a/b.md b/b.md' '--- a/b.md' '+++ b/b.md' \
  '@@ -1 +1 @@' '-x' '+y')" "too-large diff: built from the file list"
decide "$GOOD"
rm "$root/pr-42.toolarge"

# A packet with initiative none queues with no initiative title.
queue packet none "$PACKET"
assert_eq "$(jq -c '[.initiative,.initiativeTitle]' "$dir/item.json")" '["none",""]' "initiative none"
decide "$GOOD"

# refuse <label> <want> <command args>: the command exits 2 naming the defect, queues nothing,
# and logs {time, initiative, defect} to refusals.jsonl.
refuse() {
  local label=$1 want=$2 initiative=$3 got
  shift 3
  rm -rf "$state/items" "$root/open.record" "$state/refusals.jsonl"
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
sed '1s/.*/# A title that ends in a period./' "$PACKET" >"$root/bad-title.md"
refuse "parser refusal" "drop its closing punctuation" drafter drafter "$root/bad-title.md"
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
rm -rf "$state/items" "$state/tab.seen" "$state/start.lock" "$root/open.record" "$root/curl.record"
timeout 20 bash "$SCRIPT" packet --check drafter "$PACKET" >"$root/out" 2>"$root/err"
assert_eq "$?" "0" "--check: exit code"
assert_eq "$(wc -c <"$root/out")" "0" "--check: stdout"
! compgen -G "$state/items/*" >/dev/null || { echo "FAIL: --check: left an item directory"; fail=1; }
[ ! -e "$root/open.record" ] && [ ! -e "$state/tab.seen" ] || { echo "FAIL: --check: opened a tab"; fail=1; }
[ ! -e "$root/curl.record" ] || { echo "FAIL: --check: reached for the app"; fail=1; }
[ ! -e "$state/start.lock" ] || { echo "FAIL: --check: took the app start lock"; fail=1; }
mkpr 43 ccc333 MERGED pass
timeout 20 bash "$SCRIPT" packet --check drafter "$PACKET" >"$root/out" 2>"$root/err"
assert_eq "$?" "2" "--check on a refused packet: exit code"
mkpr 43 ccc333 OPEN pass

# ---- Revisions: a packet that resends a part Geoff sent back ----
# requeue <command args>: like queue, but keeps the items already on disk, and sets dir to the waiting one.
requeue() {
  local i f
  rm -f "$root/open.record"
  bash "$SCRIPT" "$@" >"$root/out" 2>"$root/err" &
  bgpid=$!
  dir=""
  for i in $(seq 50); do
    for f in "$state"/items/*/item.json; do
      [ -e "$f" ] && [ ! -e "$(dirname "$f")/decision.json" ] && dir=$(dirname "$f")
    done
    [ -n "$dir" ] && return 0
    sleep 0.1
  done
  echo "FAIL: timed out waiting for a requeued item: $(cat "$root/err")"; fail=1
  kill "$bgpid" 2>/dev/null; wait "$bgpid" 2>/dev/null; bgpid=""
  return 1
}
REVISED="$root/revised.md"
sed 's/^## If you approve/## What changed\n- Split the template change out of PR 41.\n\n## If you approve/' "$PACKET" >"$REVISED"
grep -q '^## What changed' "$REVISED" || { echo "FAIL: revisions: the revised packet lost its section"; fail=1; }
mkpr 41 aaa111 OPEN fail
mkpr 42 bbb222 OPEN pass
mkpr 43 ccc333 OPEN pass
rm -f "$log"
rm -rf "$state/items"

# A state root with no decisions.jsonl reads as no revision, and a packet with the section then is refused.
refuse "section on a first packet" "no part of this packet was sent back" drafter drafter "$REVISED"
queue packet drafter "$PACKET"
assert_eq "$(jq -c 'has("revises")' "$dir/item.json")" "false" "revision: no log, no revises"
first_id=$(basename "$dir")
decide '{"decision":"reject","note":"Split this packet."}'

# A resend without the section exits 2, names the earlier item and the refs, and leaves no item directory.
refuse "resend without the section" "$first_id" drafter drafter "$PACKET"
grep -q 'glw907/drafter#41, glw907/drafter#42, glw907/drafter#43' "$root/err" || { echo "FAIL: resend without the section: refs missing: $(cat "$root/err")"; fail=1; }
grep -q 'What changed' "$root/err" || { echo "FAIL: resend without the section: the section is not named"; fail=1; }

# PR 41's head moved ahead, 42 diverged, 43's old head is gone: the since diff, the gone marker, and the marker.
mkpr 41 aaa222 OPEN fail
mkpr 42 bbb999 OPEN pass
mkpr 43 ccc999 OPEN pass
printf '{"status":"ahead"}\n' >"$root/compare-aaa111.json"
printf 'diff --git a/n.md b/n.md\n+since\n' >"$root/compare-aaa111.diff"
printf '{"status":"diverged"}\n' >"$root/compare-bbb222.json"
requeue packet drafter "$REVISED"
assert_eq "$(jq -c '.revises' "$dir/item.json")" \
  "{\"item\":\"$first_id\",\"revision\":2,\"parts\":[{\"ref\":\"glw907/drafter#41\",\"head\":\"aaa111\"},{\"ref\":\"glw907/drafter#42\",\"head\":\"bbb222\"},{\"ref\":\"glw907/drafter#43\",\"head\":\"ccc333\"}]}" \
  "revision 2: item.json revises"
assert_eq "$(jq -c '.whatChanged' "$dir/packet.json")" '["Split the template change out of PR 41."]' "revision 2: packet.json whatChanged"
assert_eq "$(cat "$dir/parts/0/since.patch")" "$(printf 'diff --git a/n.md b/n.md\n+since')" "since: an ahead head writes since.patch"
[ ! -e "$dir/parts/0/since.json" ] || { echo "FAIL: since: an ahead head wrote since.json"; fail=1; }
assert_eq "$(jq -c . "$dir/parts/1/since.json")" '{"gone":true}' "since: a diverged answer writes since.json"
[ ! -e "$dir/parts/1/since.patch" ] || { echo "FAIL: since: a diverged answer wrote since.patch"; fail=1; }
assert_eq "$(jq -c . "$dir/parts/2/since.json")" '{"gone":true}' "since: a 404 writes since.json"
[ ! -e "$dir/parts/3/since.patch" ] && [ ! -e "$dir/parts/3/since.json" ] || { echo "FAIL: since: a step got a since file"; fail=1; }
second_id=$(basename "$dir")
decide '{"decision":"reject","note":"Still not."}'
assert_eq "$rc" "0" "revision 2: decision exit code"

# A diff too large to serve (406) writes neither file, and an unmoved head gets none; neither refuses the packet.
# --check applies the section rule and fetches no compare.
mkpr 41 aaa333 OPEN fail
printf '{"status":"ahead"}\n' >"$root/compare-aaa222.json"
: >"$root/compare-aaa222.toolarge"
: >"$root/gh.record"
timeout 20 bash "$SCRIPT" packet --check drafter "$PACKET" >"$root/out" 2>"$root/err"
assert_eq "$?" "2" "--check on a revision without the section: exit code"
timeout 20 bash "$SCRIPT" packet --check drafter "$REVISED" >"$root/out" 2>"$root/err"
assert_eq "$?" "0" "--check on a revision with the section: exit code"
grep -q compare "$root/gh.record" && { echo "FAIL: --check fetched a compare"; fail=1; }
requeue packet drafter "$REVISED"
assert_eq "$(jq -c '[.revises.item, .revises.revision]' "$dir/item.json")" "[\"$second_id\",3]" "revision 3: item.json revises"
for k in 0 1 2; do
  [ ! -e "$dir/parts/$k/since.patch" ] && [ ! -e "$dir/parts/$k/since.json" ] || { echo "FAIL: since: part $k got a since file"; fail=1; }
done
decide '{"decision":"reject","note":"Third time."}'
assert_eq "$rc" "0" "revision 3: decision exit code"

# An approve, a hold, or a send-back inside an approve is not sent back, and the rounds before an approve do
# not count toward a later revision number.
requeue packet drafter "$REVISED"
decide "$(jq -c '.parts[2].verdict = "send-back"' <<<"$GOOD")"
assert_eq "$(tail -n 5 "$log" | head -n 4 | jq -r '.verdict' | paste -sd' ')" "approve hold send-back session" "approve round: verdicts logged"
queue packet drafter "$PACKET"
assert_eq "$(jq -c 'has("revises")' "$dir/item.json")" "false" "revision: nothing is sent back after an approve"
decide "$(jq -c '.parts[1].verdict = "approve"' <<<"$GOOD")"
queue packet drafter "$PACKET"
decide '{"decision":"reject","note":"Again."}'
requeue packet drafter "$REVISED"
assert_eq "$(jq -c '.revises.revision' "$dir/item.json")" "2" "revision: earlier rounds do not count after an approve"
decide '{"decision":"reject","note":""}'

# ---- Only the parts Geoff sent back make a resend a revision ----
# SOLO is the packet with PR 42 alone, so it holds a part Geoff marked approve in a rejected packet and no part he sent back.
awk '/^## Ask:/{skip=1} /^## Routine/{skip=0} !skip && !/drafter#43 \|/' "$PACKET" >"$root/solo.md"
sed 's/^## If you approve/## What changed\n- Split the template change out of PR 41.\n\n## If you approve/' "$root/solo.md" >"$root/solo-revised.md"
mkpr 41 aaa111 OPEN fail
mkpr 42 bbb222 OPEN pass
mkpr 43 ccc333 OPEN pass
MIXED='{"decision":"reject","note":"Fix 41.","calls":[{"ref":"glw907/drafter#41","verdict":"send-back"},{"ref":"glw907/drafter#42","verdict":"approve"},{"ref":"glw907/drafter#43","verdict":"approve"},{"ref":"step:1","verdict":"session"}]}'
rm -f "$log"
queue packet drafter "$PACKET"
mixed_id=$(basename "$dir")
decide "$MIXED"
assert_eq "$(jq -c '[.ref,.sentBack]' "$log" | paste -sd' ')" \
  '["glw907/drafter#41",true] ["glw907/drafter#42",false] ["glw907/drafter#43",false] ["step:1",false]' "sentBack: one part sent back, the rest marked approve"

# Both heads move on, so an early return on an unmoved head cannot pass this alone: only the sent-back part is
# a revision part and gets a since diff.
mkpr 41 aaa222 OPEN fail
mkpr 42 bbb888 OPEN pass
printf '{"status":"ahead"}\n' >"$root/compare-aaa111.json"
printf '{"status":"ahead"}\n' >"$root/compare-bbb222.json"
printf 'diff --git a/n.md b/n.md\n+since\n' >"$root/compare-bbb222.diff"
requeue packet drafter "$REVISED"
assert_eq "$(jq -c '.revises' "$dir/item.json")" "{\"item\":\"$mixed_id\",\"revision\":2,\"parts\":[{\"ref\":\"glw907/drafter#41\",\"head\":\"aaa111\"}]}" "sentBack: revises names only the sent-back part"
[ -e "$dir/parts/0/since.patch" ] || { echo "FAIL: sentBack: the sent-back part has no since.patch"; fail=1; }
[ ! -e "$dir/parts/1/since.patch" ] && [ ! -e "$dir/parts/1/since.json" ] || { echo "FAIL: sentBack: the approve-marked part got a since file"; fail=1; }
assert_eq "$(jq -r '.head' "$dir/parts/1/pr.json")" "bbb888" "sentBack: the approve-marked part's head moved"
assert_eq "$(jq -r 'select(.ref == "glw907/drafter#42") | .head' "$log")" "bbb222" "sentBack: the approve-marked part's recorded head differs"
decide '{"decision":"reject","note":""}'

# A resend of only the approve-marked part is a fresh packet: it takes no section and has no revises.
mkpr 42 bbb222 OPEN pass
rm -f "$log"
queue packet drafter "$PACKET"
decide "$MIXED"
refuse "section on a resend of an approve-marked part" "a part you marked approve inside a rejected packet" drafter drafter "$root/solo-revised.md"
requeue packet drafter "$root/solo.md"
assert_eq "$(jq -c 'has("revises")' "$dir/item.json")" "false" "sentBack: a resend of only the approve-marked part is a fresh packet"
decide '{"decision":"reject","note":""}'

# A note-only send-back sets no part to send back, so its resend is a revision naming every part.
rm -f "$log"
queue packet drafter "$PACKET"
decide '{"decision":"reject","note":"All of it."}'
assert_eq "$(jq -sc '[.[].sentBack] | unique' "$log")" "[false]" "sentBack: a note-only send-back flags no part"
requeue packet drafter "$REVISED"
assert_eq "$(jq -c '[.revises.parts[].ref]' "$dir/item.json")" '["glw907/drafter#41","glw907/drafter#42","glw907/drafter#43"]' "sentBack: a note-only send-back's resend names every part"
decide '{"decision":"reject","note":""}'

# The revision number counts the rounds in which the part was sent back, and skips one where it was marked
# approve. A log written before the field reads as today: every reject counts.
printf '%s\n' \
  '{"packet":"aqtest-r1","ref":"glw907/drafter#42","kind":"pr","verdict":"reject","head":"bbb222"}' \
  '{"packet":"aqtest-r2","ref":"glw907/drafter#41","kind":"pr","verdict":"reject","sentBack":true,"head":"aaa111"}' \
  '{"packet":"aqtest-r2","ref":"glw907/drafter#42","kind":"pr","verdict":"reject","sentBack":false,"head":"bbb222"}' \
  '{"packet":"aqtest-r3","ref":"glw907/drafter#42","kind":"pr","verdict":"reject","sentBack":true,"head":"bbb222"}' >"$log"
requeue packet drafter "$root/solo-revised.md"
assert_eq "$(jq -c '[.revises.item, .revises.revision]' "$dir/item.json")" '["aqtest-r3",3]' "sentBack: the revision number skips a round marked approve"
decide '{"decision":"reject","note":""}'
printf '%s\n' '{"packet":"aqtest-r1","ref":"glw907/drafter#42","kind":"pr","verdict":"reject","head":"bbb222"}' >"$log"
requeue packet drafter "$root/solo-revised.md"
assert_eq "$(jq -c '[.revises.item, .revises.revision]' "$dir/item.json")" '["aqtest-r1",2]' "sentBack: a log with no sentBack field counts every reject"
decide '{"decision":"reject","note":""}'

live_leak

[ "$fail" = 0 ] && echo "packet: ok"
exit "$fail"
