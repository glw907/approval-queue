#!/usr/bin/env bash
# review-desk.test.sh: prove the review-desk command against this worktree's own copy, with
# curl, firefox, setsid, and gh stubbed on PATH. Never starts the app or opens a browser.
set -uo pipefail
cd "$(dirname "$0")/.."
SCRIPT="$(pwd)/bin/.local/bin/review-desk"
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
cat >"$stubs/firefox" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$STUB_DIR/firefox.record"
STUB
cat >"$stubs/setsid" <<'STUB'
#!/usr/bin/env bash
[ "$1" = "-f" ] && shift
exec "$@"
STUB
cat >"$stubs/gh" <<'STUB'
#!/usr/bin/env bash
case "$2" in
  view) echo '{"body":"the body","headRefOid":"abc123","number":42,"url":"https://github.com/owner/repo/pull/42","headRefName":"feat","baseRefName":"main","statusCheckRollup":[{"name":"make check","workflowName":"tool","status":"COMPLETED","conclusion":"SUCCESS"}]}' ;;
  diff) echo 'diff --git a/x b/x' ;;
esac
STUB
chmod +x "$stubs"/*

export STUB_DIR="$root" XDG_STATE_HOME="$root/state" PATH="$stubs:$PATH"
state="$XDG_STATE_HOME/review-desk"
printf '# design\n' >"$root/design.md"
printf '[{"item":"a","disposition":"now","reason":"r"}]\n' >"$root/triage.json"

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
  rm -rf "$state/items" "$root/firefox.record"
  bash "$SCRIPT" "$kind" owner/repo "A title" "$source" >"$root/out" 2>"$root/err" &
  bgpid=$!
  wait_for "$state/items/*/item.json" || return
  dir=$(dirname "$(ls "$state"/items/*/item.json | head -1)")
  id=$(basename "$dir")
  echo "$id" | grep -Eq '^[0-9]{8}T[0-9]{6}-[0-9]+$' || { echo "FAIL: $kind: id '$id'"; fail=1; }
  jq -e '.created | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")' "$dir/item.json" >/dev/null \
    || { echo "FAIL: $kind: created"; fail=1; }
  assert_eq "$(jq -r '.kind + "|" + .repo + "|" + .title' "$dir/item.json")" "$kind|owner/repo|A title" "$kind: item fields"
  for f in $files; do [ -e "$dir/$f" ] || { echo "FAIL: $kind: missing $f"; fail=1; }; done
  if [ "$kind" = pr ]; then
    assert_eq "$(jq -r .head "$dir/item.json")" "abc123" "pr: head"
    assert_eq "$(cat "$dir/body.md")" "the body" "pr: body"
    assert_eq "$(jq -r .number "$dir/item.json")" "42" "pr: number"
    assert_eq "$(jq -c 'keys' "$dir/pr.json")" '["baseRefName","headRefName","number","statusCheckRollup","url"]' "pr: pr.json keys"
    assert_eq "$(jq -r .url "$dir/pr.json")" "https://github.com/owner/repo/pull/42" "pr: pr.json url"
    assert_eq "$(jq -r '.statusCheckRollup[0].conclusion' "$dir/pr.json")" "SUCCESS" "pr: pr.json checks"
  else
    assert_eq "$(jq 'has("head")' "$dir/item.json")" "false" "$kind: no head"
    [ "$kind" != design ] || assert_eq "$(jq -r .file "$dir/item.json")" "design.md" "design: file"
  fi
  wait_for "$root/firefox.record" || return
  assert_eq "$(cat "$root/firefox.record")" "--new-tab http://127.0.0.1:7907/item/$id" "$kind: firefox args"
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

# TERM to a waiting command: exit 143, no item.json.
rm -rf "$state/items" "$root/firefox.record"
bash "$SCRIPT" design owner/repo T "$root/design.md" >/dev/null 2>&1 &
bgpid=$!
if wait_for "$root/firefox.record"; then
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

bash "$SCRIPT" bogus owner/repo T "$root/design.md" >/dev/null 2>&1
assert_eq "$?" "2" "bad kind: exit code"
bash "$SCRIPT" design owner/repo T >/dev/null 2>&1
assert_eq "$?" "2" "missing argument: exit code"

[ "$fail" = 0 ] && echo "review-desk: ok"
exit "$fail"
