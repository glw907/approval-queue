# collect-check.sh: sourced by the shell tests that decide an item, for the `collect` check they share.
# The caller sets SCRIPT, root, log, fail, and assert_eq.

# collect_check <label> <item dir>: called right after the queuing command printed and logged the item's
# decision, with the printed line in $root/out. A collect of the logged decision prints that line and logs
# nothing. With the log removed, a collect logs the decision once (as many lines as the command wrote) and a
# second collect prints it again and logs nothing more. The log is restored after.
collect_check() {
  local label=$1 id want n out
  id=$(basename "$2")
  want=$(cat "$root/out")
  n=$(grep -cF "\"packet\":\"$id\"" "$log")
  cp "$log" "$root/log.keep"
  out=$(bash "$SCRIPT" collect "$id" 2>/dev/null)
  assert_eq "$out" "$want" "$label: collect of a logged decision prints it"
  assert_eq "$(cmp -s "$log" "$root/log.keep"; echo $?)" "0" "$label: collect of a logged decision logs nothing"
  rm -f "$log"
  out=$(bash "$SCRIPT" collect "$id" 2>/dev/null)
  assert_eq "$out" "$want" "$label: collect of an unlogged decision prints it"
  assert_eq "$(wc -l <"$log")" "$n" "$label: collect logs the decision once"
  out=$(bash "$SCRIPT" collect "$id" 2>/dev/null)
  assert_eq "$out" "$want" "$label: a second collect prints it again"
  assert_eq "$(wc -l <"$log")" "$n" "$label: a second collect logs nothing"
  cp "$root/log.keep" "$log"
}
