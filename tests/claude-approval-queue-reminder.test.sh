#!/usr/bin/env bash
# claude-approval-queue-reminder.test.sh: prove the approval-queue reminder hook against this worktree's own copy of
# the script. Each case feeds PostToolUse hook input JSON on stdin.
set -uo pipefail
cd "$(dirname "$0")/.."
SCRIPT="$(pwd)/bin/.local/bin/claude-approval-queue-reminder"
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
assert_eq "$(printf '%s' "$ctx" | wc -l)" "0" "created: one line"
[ "$(printf '%s' "$ctx" | wc -c)" -lt 200 ] || { echo "FAIL: created: the line runs $(printf '%s' "$ctx" | wc -c) bytes: $ctx"; fail=1; }
case "$ctx" in
  *'#38 in glw907/workstation'*"close packet"*'`approval-queue land`'*'no call'*'auth-data'*'## Before merge'*) ;;
  *) echo "FAIL: created: the line lacks the close packet or the land route: $ctx"; fail=1 ;;
esac

run 'git push -u origin x && gh pr create --fill' 'https://github.com/glw907/cairn-cms/pull/7'
assert_eq "$(jq -r .hookSpecificOutput.additionalContext <<<"$out" | grep -c 'glw907/cairn-cms')" "1" \
  "compound command: repo from the URL"

run 'cd x; GH_TOKEN=t gh pr create --fill' 'https://github.com/glw907/cairn-cms/pull/8'
assert_eq "$(jq -r .hookSpecificOutput.additionalContext <<<"$out" | grep -c '#8 in glw907/cairn-cms')" "1" \
  "an environment assignment before the command: still a stage"

run 'gh pr view 38' 'https://github.com/glw907/workstation/pull/38'
assert_eq "$out" "" "gh pr view: silent"

run 'gh pr merge 38 --repo glw907/workstation --merge' 'https://github.com/glw907/workstation/pull/38'
assert_eq "$out" "" "gh pr merge: silent"

run 'echo "gh pr create --fill"' 'https://github.com/glw907/workstation/pull/38'
assert_eq "$out" "" "a quoted gh pr create inside an echo: silent"

run 'git commit -m "Document gh pr create"' 'https://github.com/glw907/workstation/pull/38'
assert_eq "$out" "" "a commit message that names gh pr create: silent"

run 'gh pr create --fill' 'a pull request for branch "x" already exists'
assert_eq "$out" "" "no PR URL: silent"; assert_eq "$rc" "0" "no PR URL: exit 0"

out=$(printf 'not json' | "$SCRIPT"); rc=$?
assert_eq "$out" "" "bad input: silent"; assert_eq "$rc" "0" "bad input: exit 0"

if [ "$fail" -eq 0 ]; then echo "claude-approval-queue-reminder: OK"; else exit 1; fi
