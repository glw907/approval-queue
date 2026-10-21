#!/usr/bin/env bash
# port.test.sh: prove the command's port setting. With APPROVAL_QUEUE_PORT unset it talks to 7907
# as it always did; set, every address it probes and opens names that port. curl, xdg-open, and
# setsid are stubbed on PATH, so it never starts the app, opens a browser, or touches the live queue.
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
chmod +x "$stubs"/*

export STUB_DIR="$root" XDG_STATE_HOME="$root/state" PATH="$stubs:$PATH"
state="$XDG_STATE_HOME/approval-queue"
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

# hand_over <want port>: queues a design, checks the URL the command opens and the URLs it probes,
# then decides the item so the command exits.
hand_over() {
  local want=$1 dir i
  rm -rf "$state/items" "$state/tab.seen" "$root/open.record" "$root/curl.record"
  bash "$SCRIPT" design owner/repo T "$root/design.md" >/dev/null 2>"$root/err" &
  bgpid=$!
  for i in $(seq 50); do [ -e "$root/open.record" ] && break; sleep 0.1; done
  [ -e "$root/open.record" ] || { echo "FAIL: port $want: no tab was opened"; fail=1; cat "$root/err"; }
  dir=$(dirname "$(ls "$state"/items/*/item.json | head -1)")
  assert_eq "$(sed 's|/item/.*|/|' "$root/open.record")" "http://127.0.0.1:$want/" "port $want: xdg-open host"
  assert_eq "$(grep -vc "http://127.0.0.1:$want/" "$root/curl.record")" "0" "port $want: every curl names the port"
  printf '{"decision":"approve"}\n' >"$dir/decision.json"
  wait "$bgpid"; bgpid=""
}

unset APPROVAL_QUEUE_PORT
hand_over 7907
APPROVAL_QUEUE_PORT=7927 hand_over 7927

exit "$fail"
