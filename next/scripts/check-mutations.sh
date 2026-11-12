#!/usr/bin/env bash
# check-mutations.sh: shows that every fault check has a test that fails without it. Copies next/ to a
# directory of its own, deletes one entry of CHECKS or PR_CHECKS at a time, runs the fault tests in the
# copy, and prints one line per entry. Exits 1 if the tests still pass with any entry removed.
set -euo pipefail

here=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

mkdir "$work/next" "$work/orig"
tar -C "$here" --exclude=./node_modules -cf - . | tar -C "$work/next" -xf -
ln -s "$here/node_modules" "$work/next/node_modules"
# The tests read the mockup documents at ../docs/mockup from next/.
ln -s "$here/../docs" "$work/docs"
cd "$work/next"

status=0
for file in src/lib/doc/faults.ts src/lib/doc/pr.ts; do
  orig="$work/orig/$(basename "$file")"
  cp "$file" "$orig"
  # Entry lines: every non-blank, non-comment line between the list's opening line and its closing "];".
  entries=$(awk '/^export const (PR_)?CHECKS/ { on = 1; next } on && /^\];/ { on = 0 } on && NF && $1 !~ /^\/\// { print NR }' "$orig")
  if [ -z "$entries" ]; then
    echo "found no check list in $file"
    exit 1
  fi
  for n in $entries; do
    entry=$(sed -n "${n}p" "$orig" | sed 's/^[[:space:]]*//; s/,[[:space:]]*$//')
    sed "${n}d" "$orig" >"$file"
    if node_modules/.bin/vitest run src/lib/doc/faults.test.ts src/lib/doc/pr.test.ts cli/check.test.ts >/dev/null 2>&1; then
      echo "removed $entry: TESTS STILL PASS"
      status=1
    else
      echo "removed $entry: tests failed"
    fi
  done
  cp "$orig" "$file"
done
exit "$status"
