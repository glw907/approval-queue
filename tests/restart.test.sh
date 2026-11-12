#!/usr/bin/env bash
# restart.test.sh: prove `approval-queue restart` against a copy of the script and the app inside a temporary tree,
# with a real server on a random port from 7931 to 7999 and a state directory under that tree. It builds the app
# four times (the first build, a restart, a failed restart, and a start that fails). An npm shim on PATH runs the
# real npm and, for a build in the stage, marks it done and can break the staged server. xdg-open is a stub.
# Never touches port 7907, the live state directory, or this worktree's own app.
set -uo pipefail
cd "$(dirname "$0")/.."
SRC="$(pwd)"
FIX="$SRC/approval-queue/src/lib/fixtures"
fail=0
root="$(realpath "$(mktemp -d)")"
pids=()

REAL_NPM="$(command -v npm)"
export STUB_DIR="$root/stub"
mkdir -p "$STUB_DIR/bin" "$root/state" "$root/projects"

# The exit trap ends what the test started, by recorded pid; then the listener on the port, only when its command
# line sits under the temporary root; then the root itself.
cleanup() {
  local p lp
  for p in "${pids[@]:-}"; do
    [ -n "$p" ] && kill "$p" 2>/dev/null
  done
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
assert_ok() {
  local label=$1
  shift
  "$@" || { echo "FAIL: $label"; fail=1; }
}

cat >"$STUB_DIR/bin/xdg-open" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$STUB_DIR/open.record"
STUB
# The npm shim: a `run build` in a .stage directory writes the built marker, and with the break-start flag it makes
# the staged server exit at once.
cat >"$STUB_DIR/bin/npm" <<STUB
#!/usr/bin/env bash
"$REAL_NPM" "\$@" || exit \$?
if [ "\${1:-}" = run ] && [ "\${2:-}" = build ] && [ "\$(basename "\$PWD")" = .stage ]; then
  : >"\$STUB_DIR/built"
  [ ! -e "\$STUB_DIR/break-start" ] || echo 'process.exit(1);' >build/index.js
fi
STUB
chmod +x "$STUB_DIR/bin/"*
export PATH="$STUB_DIR/bin:$PATH"

# A random free port from 7931 to 7999, and a state directory inside the temporary root, set once.
PORT=""
for _ in $(seq 40); do
  cand=$((7931 + RANDOM % 69))
  if [ -z "$(ss -ltnH "sport = :$cand")" ]; then PORT=$cand; break; fi
done
[ -n "$PORT" ] || { echo "FAIL: no free port from 7931 to 7999"; ss -ltn; exit 1; }
export APPROVAL_QUEUE_PORT=$PORT XDG_STATE_HOME="$root/state"
state="$XDG_STATE_HOME/approval-queue"
base="http://127.0.0.1:$PORT"
[ "$PORT" != 7907 ] && case "$state" in "$root"/*) true ;; *) false ;; esac || { echo "FAIL: the test is not isolated"; exit 1; }

# The temporary tree: a copy of the script and of the app's source, with no node_modules, build, or symlink.
tree="$root/tree"
mkdir -p "$tree/bin/.local/bin" "$tree/approval-queue"
cp "$SRC/bin/.local/bin/approval-queue" "$tree/bin/.local/bin/approval-queue"
tar -C "$SRC/approval-queue" --anchored --exclude=./node_modules --exclude=./build --exclude=./.svelte-kit --exclude=./.stage \
  --exclude=./build.prev --exclude=./node_modules.prev -cf - . | tar -C "$tree/approval-queue" -xf -
TSCRIPT="$tree/bin/.local/bin/approval-queue"
app="$tree/approval-queue"

# Fixtures, as tests/packet.test.sh sets them up.
mkdir -p "$root/projects/initiatives/sample" "$root/projects/sample/docs/specs" "$root/w"
printf 'title: Sample release notes\nstatus: active\n' >"$root/projects/initiatives/sample/initiative.yaml"
printf '# A design\n\nOriginal text.\n' >"$root/projects/sample/docs/specs/2026-11-10-sample-design.md"
cp "$FIX/design-facts.json" "$root/w/facts.json"
cp "$FIX/design-text.md" "$root/w/text.md"

# listener: the pid on the port, or nothing. cmdline: a pid's command line, one line.
listener() { ss -ltnpH "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | head -n 1 | cut -d= -f2; }
cmdline() { tr '\0' ' ' <"/proc/$1/cmdline" 2>/dev/null; }
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$1"; }

# queue_packet <out>: queues the design packet in the background and waits for its item; sets qpid and qitem.
qpid="" qitem=""
queue_packet() {
  local before i f
  before=$(ls "$state/items" 2>/dev/null | sort)
  APPROVAL_QUEUE_PROJECTS="$root/projects" timeout 900 bash "$TSCRIPT" packet sample "$root/w/facts.json" "$root/w/text.md" >"$1" 2>"$1.err" &
  qpid=$!
  pids+=("$qpid")
  qitem=""
  for i in $(seq 1200); do
    for f in "$state"/items/*/item.json; do
      [ -e "$f" ] || continue
      grep -qxF "$(basename "$(dirname "$f")")" <<<"$before" || qitem=$(basename "$(dirname "$f")")
    done
    [ -n "$qitem" ] && curl -sf --max-time 2 "$base/item/$qitem" >/dev/null 2>&1 && return 0
    kill -0 "$qpid" 2>/dev/null || break
    sleep 0.1
  done
  echo "FAIL: the packet command did not queue: $(cat "$1.err")"
  fail=1
  return 1
}

# ---- 1. Queue: the first build and server A ----
if ! queue_packet "$root/pk1.out"; then exit 1; fi
item1=$qitem
pidA=$(listener)
assert_eq "$(cmdline "$pidA")" "node $app/build " "step 1: server A's command line"
if [ "$(cmdline "$pidA")" != "node $app/build " ]; then echo "the copy does not resolve its app inside the root; stopping"; exit 1; fi
assert_eq "$(code "$base/item/$item1")" "200" "step 1: A serves the item page"

# ---- 2. Lock: the build is staged while start.lock is held, and A keeps serving ----
mkdir -p "$app/build.prev"
: >"$app/build.prev/stale-marker"
inodeA=$(stat -c %i "$app/build/index.js")
(
  exec 9>"$state/start.lock"
  flock 9
  while [ ! -e "$root/release" ] && [ -d "$root" ]; do sleep 0.2; done
) &
holder=$!
pids+=("$holder")
for _ in $(seq 100); do flock -n "$state/start.lock" true 2>/dev/null || break; sleep 0.1; done
rm -f "$STUB_DIR/built"
env -u APPROVAL_QUEUE_PROJECTS timeout 300 bash "$TSCRIPT" restart >"$root/r1.out" 2>"$root/r1.err" &
r1=$!
pids+=("$r1")
for _ in $(seq 600); do [ -e "$STUB_DIR/built" ] && break; sleep 0.1; done
assert_ok "step 2: the staged build finished" [ -e "$STUB_DIR/built" ]
sleep 3
assert_ok "step 2: restart waits on the lock" kill -0 "$r1"
assert_eq "$(listener)" "$pidA" "step 2: A still listens under its first pid"
assert_eq "$(stat -c %i "$app/build/index.js")" "$inodeA" "step 2: the running build is unchanged"
assert_eq "$(code "$base/history")" "200" "step 2: A serves a page it never loaded"
assert_eq "$(code "$base/item/$item1")" "200" "step 2: A serves the item page"
timeout 60 bash "$TSCRIPT" restart >"$root/r2.out" 2>"$root/r2.err"
assert_eq "$?" "1" "step 2: a second restart exits 1"
assert_ok "step 2: the second restart left .stage alone" [ -d "$app/.stage" ]
assert_eq "$(wc -c <"$root/r2.out")" "0" "step 2: a restart prints nothing on stdout"

# ---- 3. Swap: the lock is released and the new server takes over ----
: >"$root/release"
wait "$r1"
assert_eq "$?" "0" "step 3: restart exits 0"
pidB=$(listener)
[ -n "$pidB" ] && [ "$pidB" != "$pidA" ] || { echo "FAIL: step 3: pid $pidB is not new"; fail=1; }
assert_eq "$(cmdline "$pidB")" "node $app/build " "step 3: B's command line"
assert_eq "$(code "$base/item/$item1")" "200" "step 3: B serves the item page"
page=$(curl -s --max-time 5 "$base/item/$item1")
grep -q 'Original text' <<<"$page" || { echo "FAIL: step 3: the item page lacks the design's text"; fail=1; }
for d in .stage build.prev node_modules.prev; do
  [ ! -e "$app/$d" ] || { echo "FAIL: step 3: $d is left"; fail=1; }
done
grep -q 'restarted, pid' "$root/r1.err" || { echo "FAIL: step 3: no restarted line: $(cat "$root/r1.err")"; fail=1; }
flock -w 5 "$state/start.lock" true || { echo "FAIL: step 3: a server holds start.lock"; fail=1; }
flock -n "$state/restart.lock" true || { echo "FAIL: step 3: a server holds restart.lock"; fail=1; }

# ---- 4. Approve: the waiting packet command prints its decision after the restart ----
resp=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST -H "Origin: $base" -H 'accept: application/json' \
  --data-urlencode 'calls=[{"call":1,"choice":"Drop it","changed":false}]' --data-urlencode 'notes=[]' "$base/item/$item1?/approve")
assert_eq "$resp" "200" "step 4: B approves a design queued under another tree"
for _ in $(seq 100); do kill -0 "$qpid" 2>/dev/null || break; sleep 0.1; done
if kill -0 "$qpid" 2>/dev/null; then
  echo "FAIL: step 4: the waiting packet command did not exit"
  fail=1
else
  wait "$qpid"
  assert_eq "$?" "0" "step 4: the packet command exits 0"
  assert_eq "$(jq -r '.decision' "$root/pk1.out" 2>/dev/null)" "approve" "step 4: the printed decision"
fi

# ---- 5. Build failure: exit 1, B still serves ----
if ! queue_packet "$root/pk2.out"; then exit 1; fi
item2=$qitem
inodeB=$(stat -c %i "$app/build/index.js")
cp "$app/src/hooks.server.ts" "$root/hooks.server.ts.orig"
printf '\nexport const broken = ;\n' >>"$app/src/hooks.server.ts"
timeout 300 bash "$TSCRIPT" restart >"$root/r3.out" 2>"$root/r3.err"
assert_eq "$?" "1" "step 5: a failed build exits 1"
assert_eq "$(listener)" "$pidB" "step 5: B is still the listener"
assert_eq "$(code "$base/item/$item2")" "200" "step 5: B serves the second item"
assert_eq "$(stat -c %i "$app/build/index.js")" "$inodeB" "step 5: the running build is unchanged"
assert_ok "step 5: no .stage is left" [ ! -e "$app/.stage" ]
cp "$root/hooks.server.ts.orig" "$app/src/hooks.server.ts"

# ---- 6. Start failure: the old build comes back ----
: >"$STUB_DIR/break-start"
timeout 300 bash "$TSCRIPT" restart >"$root/r4.out" 2>"$root/r4.err"
assert_eq "$?" "1" "step 6: a failed start exits 1"
rm -f "$STUB_DIR/break-start"
assert_eq "$(code "$base/item/$item2")" "200" "step 6: a server answers the second item again"
if grep -q 'process.exit(1)' "$app/build/index.js"; then echo "FAIL: step 6: the broken build is in place"; fail=1; fi
for d in .stage build.prev node_modules.prev; do
  [ ! -e "$app/$d" ] || { echo "FAIL: step 6: $d is left"; fail=1; }
done
grep -q 'old build answers again' "$root/r4.err" || { echo "FAIL: step 6: no rollback line: $(cat "$root/r4.err")"; fail=1; }
flock -w 5 "$state/start.lock" true || { echo "FAIL: step 6: a server holds start.lock"; fail=1; }
flock -n "$state/restart.lock" true || { echo "FAIL: step 6: a server holds restart.lock"; fail=1; }

# ---- 7. Usage ----
timeout 30 bash "$TSCRIPT" restart extra >/dev/null 2>&1
assert_eq "$?" "2" "step 7: restart with an argument exits 2"

[ "$fail" = 0 ] && echo "restart: ok"
exit "$fail"
