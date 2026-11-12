#!/usr/bin/env bash
# merge.test.sh: prove `merge`, `land`, and `digest` of the approval-queue command against this worktree's own
# copy, with a gh stub on PATH and hand-written item directories. Never calls the real gh or reads live state.
set -uo pipefail
cd "$(dirname "$0")/.."
SCRIPT="$(pwd)/bin/.local/bin/approval-queue"
fail=0
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT

assert_eq() {
  [ "$1" = "$2" ] || { echo "FAIL: $3: got '$1', want '$2'"; fail=1; }
}

stubs="$root/stubs"
mkdir -p "$stubs" "$root/gh/pr"
# The stub logs argv, answers `pr view` from $STUB_DIR/pr/<n>.json (a <n>.then file replaces it after one view),
# answers `pr merge` by failing when $STUB_DIR/fail-<n> exists, else marking the PR MERGED, and answers `repo view`
# with the default branch named in $STUB_DIR/default (main when absent), or fails when $STUB_DIR/repofail exists.
cat >"$stubs/gh" <<'STUB'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$STUB_DIR/log"
sub="$1 $2" n=$3
case "$sub" in
  "pr view")
    cat "$STUB_DIR/pr/$n.json"
    [ ! -e "$STUB_DIR/pr/$n.then" ] || mv "$STUB_DIR/pr/$n.then" "$STUB_DIR/pr/$n.json"
    ;;
  "repo view")
    if [ -e "$STUB_DIR/repofail" ]; then echo "gh: could not resolve repository $n" >&2; exit 1; fi
    jq -nc --arg b "$(cat "$STUB_DIR/default" 2>/dev/null || echo main)" '{defaultBranchRef: {name: $b}}'
    ;;
  "pr merge")
    if [ -e "$STUB_DIR/fail-$n" ]; then echo "gh: merge of $n refused" >&2; exit 1; fi
    jq '.state = "MERGED"' "$STUB_DIR/pr/$n.json" >"$STUB_DIR/pr/$n.tmp"
    mv "$STUB_DIR/pr/$n.tmp" "$STUB_DIR/pr/$n.json"
    ;;
  *) echo "stub: unexpected $*" >&2; exit 1 ;;
esac
STUB
chmod +x "$stubs/gh"
export STUB_DIR="$root/gh" XDG_STATE_HOME="$root/state" PATH="$stubs:$PATH"
state="$XDG_STATE_HOME/approval-queue"
glog="$STUB_DIR/log"
err="$root/err"
mkdir -p "$state/items"

A=aq-fixture/app#1 B=aq-fixture/app#2
HA=aaaa111 HB=bbbb222

# pr <n> <state> <head> [body] [rollup json] [base]: writes the stub's answer for PR n.
pr() {
  jq -n --arg s "$2" --arg h "$3" --arg b "${4:-All good.}" --argjson r "${5:-[]}" --arg base "${6:-main}" \
    '{state: $s, headRefOid: $h, body: $b, statusCheckRollup: $r, baseRefName: $base}' >"$STUB_DIR/pr/$1.json"
}

# item <id> <kind> [packet kind]: writes a decided packet item. kind: approve | reject | undecided | stale | design.
# A packet kind (close or stop) also writes a facts.json that holds it.
item() {
  local d="$state/items/$1"
  rm -rf "$d"
  mkdir -p "$d"
  jq -n --arg id "$1" '{id: $id, kind: "packet", title: "T", initiative: "none", created: "2026-11-10T00:00:00Z", pid: 1, pidStart: 1}' >"$d/item.json"
  if [ "$2" = design ]; then
    echo '# d' >"$d/design.md"
    echo '{}' >"$d/design.json"
  else
    jq -n --arg a "$A" --arg b "$B" --arg ha "$HA" --arg hb "$HB" '[{ref: $a, head: $ha}, {ref: $b, head: $hb}]' >"$d/heads.json"
  fi
  [ -z "${3:-}" ] || jq -n --arg k "$3" '{kind: $k}' >"$d/facts.json"
  case "$2" in
    approve | stale | design) echo '{"decision":"approve","calls":[],"decidedForYou":[],"notes":[]}' >"$d/decision.json" ;;
    reject) echo '{"decision":"reject","calls":[],"decidedForYou":[],"notes":[]}' >"$d/decision.json" ;;
  esac
  [ "$2" != stale ] || echo '{"ref":"'"$A"'","queued":"x","now":"y"}' >"$d/stale.json"
}

# run <args>: runs the command, sets out, rc, and the stderr file.
out="" rc=""
run() {
  out=$(bash "$SCRIPT" "$@" 2>"$err")
  rc=$?
}

merges() { grep -c '^pr merge' "$glog" 2>/dev/null || true; }
reset() { rm -f "$glog" "$STUB_DIR"/fail-* "$STUB_DIR"/pr/* "$STUB_DIR/default" "$STUB_DIR/repofail"; : >"$glog"; }
repoviews() { grep -c "^repo view" "$glog" 2>/dev/null || true; }

id=20261110T120000-1

# Two PRs merge in order at the stored heads.
reset; item $id approve; pr 1 OPEN $HA; pr 2 OPEN $HB
run merge $id
assert_eq "$rc" 0 "merge exit"
assert_eq "$(grep '^pr merge' "$glog")" "pr merge 1 --repo aq-fixture/app --merge --match-head-commit $HA
pr merge 2 --repo aq-fixture/app --merge --match-head-commit $HB" "merge calls"
assert_eq "$out" '{"merged":["'"$A"'","'"$B"'"],"failed":[],"skipped":[],"notReached":[]}' "merge summary"
assert_eq "$(jq -c '[.[].ref]' "$state/items/$id/merged.json")" '["'"$A"'","'"$B"'"]' "merged.json"

# A rerun after success calls no merge.
: >"$glog"
run merge $id
assert_eq "$rc" 0 "rerun exit"
assert_eq "$(merges)" 0 "rerun merge calls"
assert_eq "$(jq -c '[.[].ref]' "$state/items/$id/merged.json")" '["'"$A"'","'"$B"'"]' "rerun merged.json unchanged"

# A failure on the first PR stops with exit 1, prints the gh error, and leaves the second not reached.
reset; item $id approve; pr 1 OPEN $HA; pr 2 OPEN $HB; : >"$STUB_DIR/fail-1"
run merge $id
assert_eq "$rc" 1 "failure exit"
assert_eq "$out" '{"merged":[],"failed":["'"$A"'"],"skipped":[],"notReached":["'"$B"'"]}' "failure summary"
assert_eq "$(merges)" 1 "failure stops after one call"
grep -q 'refused' "$err" || { echo "FAIL: gh error not printed"; fail=1; }

# A PR already MERGED at the pinned head counts as merged with no call.
reset; item $id approve; pr 1 MERGED $HA; pr 2 OPEN $HB
run merge $id
assert_eq "$rc" 0 "already merged exit"
assert_eq "$(grep '^pr merge' "$glog")" "pr merge 2 --repo aq-fixture/app --merge --match-head-commit $HB" "already merged calls"

# A Before merge body needs --premerge-done, else exit 2 and the section prints.
reset; item $id approve; pr 1 OPEN $HA "$(printf 'Body.\n\n## Before merge\n\nRun the migration.\n\n## Other\n\nx')"; pr 2 OPEN $HB
run merge $id
assert_eq "$rc" 2 "before merge exit"
assert_eq "$(merges)" 0 "before merge makes no call"
case "$out" in *"Run the migration."*) ;; *) echo "FAIL: before merge section not printed"; fail=1 ;; esac
run merge --premerge-done $A $id
assert_eq "$rc" 0 "premerge-done exit"
assert_eq "$(merges)" 2 "premerge-done merges both"

# --skip leaves its PR unmerged and listed.
reset; item $id approve; pr 1 OPEN $HA; pr 2 OPEN $HB
run merge --skip $A $id
assert_eq "$rc" 0 "skip exit"
assert_eq "$(grep '^pr merge' "$glog")" "pr merge 2 --repo aq-fixture/app --merge --match-head-commit $HB" "skip calls"
assert_eq "$out" '{"merged":["'"$B"'"],"failed":[],"skipped":["'"$A"'"],"notReached":[]}' "skip summary"

# Refusals exit 2 with no call.
for kind in reject undecided stale design; do
  reset; item $id $kind; pr 1 OPEN $HA; pr 2 OPEN $HB
  run merge $id
  assert_eq "$rc" 2 "$kind exit"
  assert_eq "$(merges)" 0 "$kind makes no call"
  case "$(cat "$err")" in approval-queue:*) ;; *) echo "FAIL: $kind stderr lacks the prefix"; fail=1 ;; esac
done
grep -q 'no pull requests to merge' "$err" || { echo "FAIL: design message"; fail=1; }

# A stop packet is answered and never merged, whatever its decision, and no gh call is made.
for k in approve undecided; do
  reset; item $id $k stop; pr 1 OPEN $HA; pr 2 OPEN $HB
  run merge $id
  assert_eq "$rc" 2 "stop $k exit"
  grep -q 'a stop packet is answered and never merged' "$err" || { echo "FAIL: stop $k message"; fail=1; }
  assert_eq "$(wc -c <"$glog" | tr -d ' ')" 0 "stop $k makes no gh call"
  [ ! -e "$state/items/$id/merged.json" ] || { echo "FAIL: stop $k wrote merged.json"; fail=1; }
done

# A close packet merges as an item with no fact file does.
reset; item $id approve close; pr 1 OPEN $HA; pr 2 OPEN $HB
run merge $id
assert_eq "$rc" 0 "close exit"
assert_eq "$(merges)" 2 "close merges both"

# A PR based on another branch refuses before anything merges, naming the PR, its base, and the default.
reset; item $id approve close; pr 1 OPEN $HA; pr 2 OPEN $HB "" "[]" release
run merge $id
assert_eq "$rc" 2 "off base exit"
assert_eq "$(merges)" 0 "off base merges nothing"
assert_eq "$out" "" "off base stdout"
[ ! -e "$state/items/$id/merged.json" ] || { echo "FAIL: off base wrote merged.json"; fail=1; }
for w in "$B" release main; do grep -q -- "$w" "$err" || { echo "FAIL: off base message lacks $w"; fail=1; }; done
assert_eq "$(repoviews)" 1 "one repo view for one repo"

# --skip leaves an off-base PR out of the check.
reset; item $id approve close; pr 1 OPEN $HA; pr 2 OPEN $HB "" "[]" release
run merge --skip $B $id
assert_eq "$rc" 0 "off base skipped exit"
assert_eq "$(merges)" 1 "off base skipped merges A"

# The default branch is read, never assumed: trunk passes, and a PR on main then refuses.
reset; echo trunk >"$STUB_DIR/default"; item $id approve close; pr 1 OPEN $HA "" "[]" trunk; pr 2 OPEN $HB "" "[]" trunk
run merge $id
assert_eq "$rc" 0 "trunk exit"
assert_eq "$(merges)" 2 "trunk merges both"
reset; echo trunk >"$STUB_DIR/default"; item $id approve close; pr 1 OPEN $HA "" "[]" trunk; pr 2 OPEN $HB
run merge $id
assert_eq "$rc" 2 "trunk off base exit"
grep -q trunk "$err" || { echo "FAIL: trunk not named"; fail=1; }

# A failed default-branch read exits 1 before anything merges.
reset; : >"$STUB_DIR/repofail"; item $id approve close; pr 1 OPEN $HA; pr 2 OPEN $HB
run merge $id
assert_eq "$rc" 1 "repo view failure exit"
assert_eq "$out" "" "repo view failure stdout"
assert_eq "$(merges)" 0 "repo view failure merges nothing"
grep -q 'could not resolve repository' "$err" || { echo "FAIL: repo view error not printed"; fail=1; }
[ ! -e "$state/items/$id/merged.json" ] || { echo "FAIL: repo view failure wrote merged.json"; fail=1; }

# land: a PR in a waiting item refuses.
reset; item $id undecided; pr 1 OPEN $HA
run land $A "small fix"
assert_eq "$rc" 2 "land waiting exit"
assert_eq "$(merges)" 0 "land waiting makes no call"

# land: a clean PR merges at the head it read and appends one digest line.
reset; rm -rf "$state/items/$id" "$state/digest.jsonl"; pr 1 OPEN $HA "Clean." '[{"status":"COMPLETED","conclusion":"SUCCESS"}]'
run land $A "small fix"
assert_eq "$rc" 0 "land exit"
assert_eq "$(grep '^pr merge' "$glog")" "pr merge 1 --repo aq-fixture/app --merge --match-head-commit $HA" "land call"
assert_eq "$(wc -l <"$state/digest.jsonl")" 1 "digest lines"
assert_eq "$(jq -c '[.ref, .head, .claim, .lane]' "$state/digest.jsonl")" '["'"$A"'","'"$HA"'","small fix","land"]' "land digest line"
assert_eq "$(jq -r '.time | type' "$state/digest.jsonl")" string "digest time"
assert_eq "$(jq -c 'has("round")' "$state/digest.jsonl")" false "land digest line has no round key"

# land --round: the digest line holds the round.
reset; rm -f "$state/digest.jsonl"; pr 1 OPEN $HA "Clean." '[{"status":"COMPLETED","conclusion":"SUCCESS"}]'
run land --round ur-queue $A "small fix"
assert_eq "$rc" 0 "land round exit"
assert_eq "$(grep -c '^pr merge' "$glog")" 1 "land round merges once"
assert_eq "$(jq -c '[.ref, .head, .claim, .lane, .round]' "$state/digest.jsonl")" '["'"$A"'","'"$HA"'","small fix","land","ur-queue"]' "land round digest line"

# land --round with a bad id: exit 2 naming the rule, no gh call, no digest line.
reset; rm -f "$state/digest.jsonl"
run land --round UR_Queue-way-too-long $A c
assert_eq "$rc" 2 "land bad round exit"
grep -qF "lowercase letters, digits, and hyphens, starting with a letter, 12 characters at most" "$err" || { echo "FAIL: land bad round: rule not named: $(cat "$err")"; fail=1; }
# An accented letter is not in a to z, whatever the caller's locale: the command and the fact check agree.
run land --round ür-queue $A c
assert_eq "$rc" 2 "land accented round exit"
grep -qF "12 characters at most" "$err" || { echo "FAIL: land accented round: rule not named: $(cat "$err")"; fail=1; }
assert_eq "$(wc -l <"$glog")" 0 "land accented round makes no gh call"
assert_eq "$(wc -c <"$glog")" 0 "land bad round makes no gh call"
[ ! -e "$state/digest.jsonl" ] || { echo "FAIL: a bad round logged a digest line"; fail=1; }
run land --round
assert_eq "$rc" 2 "land --round alone exit"
run land --round ur-queue $A
assert_eq "$rc" 2 "land --round with no claim exit"
assert_eq "$(merges)" 0 "land round usage errors merge nothing"

# land refusals: closed, Before merge, a failing check (each makes no call and logs nothing).
rm -f "$state/digest.jsonl"
reset; pr 1 CLOSED $HA
run land $A c; assert_eq "$rc" 2 "land closed exit"
reset; pr 1 OPEN $HA "## Before merge
step"
run land $A c; assert_eq "$rc" 2 "land before merge exit"
reset; pr 1 OPEN $HA "ok" '[{"status":"COMPLETED","conclusion":"FAILURE"}]'
run land $A c; assert_eq "$rc" 2 "land failing check exit"
reset; pr 1 OPEN $HA "ok" '[{"state":"ERROR"}]'
run land $A c; assert_eq "$rc" 2 "land errored status exit"
reset; pr 1 OPEN $HA "ok" '[{"status":"COMPLETED","conclusion":"STARTUP_FAILURE"}]'
run land $A c; assert_eq "$rc" 2 "land startup failure exit"
reset; pr 1 OPEN $HA "ok" '[{"status":"COMPLETED","conclusion":"STALE"}]'
run land $A c; assert_eq "$rc" 2 "land stale check exit"
assert_eq "$(merges)" 0 "land refusals make no call"
[ ! -e "$state/digest.jsonl" ] || { echo "FAIL: a refusal logged a digest line"; fail=1; }

# land refuses a PR based on another branch, and a failed default-branch read, before any merge or digest line.
rm -f "$state/digest.jsonl"
reset; pr 1 OPEN $HA "ok" "[]" release
run land $A c
assert_eq "$rc" 2 "land off base exit"
assert_eq "$(merges)" 0 "land off base makes no call"
for w in "$A" release main; do grep -q -- "$w" "$err" || { echo "FAIL: land off base message lacks $w"; fail=1; }; done
reset; : >"$STUB_DIR/repofail"; pr 1 OPEN $HA
run land $A c
assert_eq "$rc" 1 "land repo view failure exit"
assert_eq "$(merges)" 0 "land repo view failure makes no call"
[ ! -e "$state/digest.jsonl" ] || { echo "FAIL: a land refusal logged a digest line"; fail=1; }

# land: pending checks poll, then pass; a check that stays pending refuses at the cap.
reset; pr 1 OPEN $HA "ok" '[{"status":"IN_PROGRESS","conclusion":""}]'
pr 1.then OPEN $HA "ok" '[{"status":"COMPLETED","conclusion":"SUCCESS"}]'
mv "$STUB_DIR/pr/1.then.json" "$STUB_DIR/pr/1.then"
APPROVAL_QUEUE_POLL_S=1 APPROVAL_QUEUE_POLL_MAX_S=10 run land $A c
assert_eq "$rc" 0 "pending then passing exit"
assert_eq "$(merges)" 1 "pending then passing merges"
reset; pr 1 OPEN $HA "ok" '[{"state":"PENDING"}]'
APPROVAL_QUEUE_POLL_S=1 APPROVAL_QUEUE_POLL_MAX_S=2 run land $A c
assert_eq "$rc" 2 "stuck pending exit"
assert_eq "$(merges)" 0 "stuck pending makes no call"

# digest: an open PR refuses; a merged one records its head.
reset; rm -f "$state/digest.jsonl"; pr 1 OPEN $HA
run digest $A c
assert_eq "$rc" 2 "digest open exit"
reset; pr 1 MERGED $HA
run digest $A "merged by hand"
assert_eq "$rc" 0 "digest merged exit"
assert_eq "$(jq -c '[.ref, .head, .claim, .lane]' "$state/digest.jsonl")" '["'"$A"'","'"$HA"'","merged by hand","record"]' "digest line"
assert_eq "$(merges)" 0 "digest never merges"

# Usage errors exit 2.
run merge; assert_eq "$rc" 2 "merge no id"
run land $A; assert_eq "$rc" 2 "land no claim"
run digest; assert_eq "$rc" 2 "digest no args"

[ "$fail" = 0 ] && echo "merge: ok"
exit "$fail"
