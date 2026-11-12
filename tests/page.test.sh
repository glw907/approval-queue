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

# A screenshot of the stop page, when the caller asks for one.
if [ -n "${PAGE_TEST_SHOT:-}" ]; then
  node "$SRC/tests/fixtures/ct/shot.mjs" "$base/item/$stop" "$PAGE_TEST_SHOT" || { echo "FAIL: the screenshot failed"; fail=1; }
fi

[ "$fail" = 0 ] && echo "page: ok"
exit "$fail"
