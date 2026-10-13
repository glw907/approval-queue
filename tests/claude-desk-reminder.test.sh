#!/usr/bin/env bash
# claude-desk-reminder.test.sh: prove the desk-reminder hook against this worktree's own copy of
# the script. Each case feeds PostToolUse hook input JSON on stdin.
set -uo pipefail
cd "$(dirname "$0")/.."
SCRIPT="$(pwd)/bin/.local/bin/claude-desk-reminder"
fail=0

assert_eq() {
  [ "$1" = "$2" ] || { echo "FAIL: $3: got '$1', want '$2'"; fail=1; }
}

# run <command> <stdout>: feeds the hook input, leaves stdout in $out and the exit code in $rc.
run() {
  out=$(jq -nc --arg c "$1" --arg s "$2" \
    '{hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: {command: $c},
      tool_response: {stdout: $s, stderr: "", interrupted: false}}' | "$SCRIPT")
  rc=$?
}

run 'gh pr create --repo glw907/workstation --title "T" --body "B"' \
  $'remote: \nhttps://github.com/glw907/workstation/pull/38'
assert_eq "$rc" "0" "created: exit 0"
assert_eq "$(jq -r .hookSpecificOutput.hookEventName <<<"$out")" "PostToolUse" "created: event name"
ctx=$(jq -r .hookSpecificOutput.additionalContext <<<"$out")
case "$ctx" in
  *'review-desk pr glw907/workstation "<the PR title>" 38'*) ;;
  *) echo "FAIL: created: context lacks the desk command: $ctx"; fail=1 ;;
esac
case "$ctx" in
  *'gh pr merge 38 --repo glw907/workstation --merge --match-head-commit <head>'*) ;;
  *) echo "FAIL: created: context lacks the merge command: $ctx"; fail=1 ;;
esac

run 'git push -u origin x && gh pr create --fill' 'https://github.com/glw907/cairn-cms/pull/7'
assert_eq "$(jq -r .hookSpecificOutput.additionalContext <<<"$out" | grep -c 'glw907/cairn-cms')" "1" \
  "compound command: repo from the URL"

run 'gh pr view 38' 'https://github.com/glw907/workstation/pull/38'
assert_eq "$out" "" "a different gh command: silent"

run 'gh pr create --fill' 'a pull request for branch "x" already exists'
assert_eq "$out" "" "no PR URL: silent"; assert_eq "$rc" "0" "no PR URL: exit 0"

out=$(printf 'not json' | "$SCRIPT"); rc=$?
assert_eq "$out" "" "bad input: silent"; assert_eq "$rc" "0" "bad input: exit 0"

if [ "$fail" -eq 0 ]; then echo "claude-desk-reminder: OK"; else exit 1; fi
