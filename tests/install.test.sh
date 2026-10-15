#!/usr/bin/env bash
# install.test.sh: prove scripts/install.sh against a temp HOME, never the real one.
set -uo pipefail
cd "$(dirname "$0")/.."
here="$(pwd -P)"
fail=0
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT

assert_eq() {
  [ "$1" = "$2" ] || { echo "FAIL: $3: got '$1', want '$2'"; fail=1; }
}

home="$root/home"
mkdir -p "$home/.local/bin"
# A stale link, as stow leaves it, is replaced.
ln -s "$root/elsewhere" "$home/.local/bin/approval-queue"

HOME="$home" bash scripts/install.sh >/dev/null
assert_eq "$?" "0" "install: exit code"
for name in approval-queue claude-approval-queue-reminder; do
  got="$(realpath "$home/.local/bin/$name")"
  assert_eq "$got" "$here/bin/.local/bin/$name" "$name: realpath"
done

# A second run changes nothing.
HOME="$home" bash scripts/install.sh >/dev/null
assert_eq "$?" "0" "install again: exit code"

# A regular file in the way is refused and left alone.
rm "$home/.local/bin/claude-approval-queue-reminder"
echo keep >"$home/.local/bin/claude-approval-queue-reminder"
HOME="$home" bash scripts/install.sh >/dev/null 2>&1
assert_eq "$?" "1" "regular file: exit code"
assert_eq "$(cat "$home/.local/bin/claude-approval-queue-reminder")" "keep" "regular file: untouched"

[ "$fail" = 0 ] && echo "install: ok"
exit "$fail"
