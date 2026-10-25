#!/usr/bin/env bash
# blueprint.test.sh: prove the blueprint and approved forms of the approval-queue command against this
# worktree's own copy, with curl, xdg-open, and setsid stubbed on PATH and a temp git repo as the
# worktree. Pins the refusals, the printed decision, the log line, and what `approved` answers.
# Never starts the app, opens a browser, or touches the live queue state.
set -uo pipefail
cd "$(dirname "$0")/.."
SCRIPT="$(pwd)/bin/.local/bin/approval-queue"
DOC="$(pwd)/approval-queue/src/lib/fixtures/sample.blueprint.md"
NOTES="$(pwd)/approval-queue/src/lib/fixtures/sample-notes.json"
FILE=blueprints/slow-build.blueprint.md
fail=0
root="$(mktemp -d)"
bgpid=""
trap '[ -n "$bgpid" ] && kill "$bgpid" 2>/dev/null; rm -rf "$root"' EXIT

assert_eq() {
  [ "$1" = "$2" ] || { echo "FAIL: $3: got '$1', want '$2'"; fail=1; }
}

# No item id this test queued or logged may appear in the live log: queue() records each id in $root/ids,
# so a write to the live log alone, with nothing in the temp log, still fails by name. Other sessions' lines
# in the live log do not matter.
live_log="$HOME/.local/state/approval-queue/decisions.jsonl"
live_leak() {
  local pid
  [ -e "$live_log" ] || return 0
  while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    if grep -qF "\"packet\":\"$pid\"" "$live_log"; then echo "FAIL: the test wrote packet $pid to the live log"; fail=1; fi
  done < <({ jq -r '.packet' "$log" 2>/dev/null; cat "$root/ids" 2>/dev/null; } | sort -u)
}

# Every blueprint and page takes a description of a background paragraph and one summary paragraph.
DESC="$root/description.md"
printf 'The slow build blocks every release.\n\nThis plan caches the dependency step. Approving it lets the session start.\n' >"$DESC"

stubs="$root/stubs"
mkdir -p "$stubs"
printf '#!/usr/bin/env bash\nexit 0\n' >"$stubs/curl"
printf '#!/usr/bin/env bash\necho "$*" >>"$STUB_DIR/open.record"\n' >"$stubs/xdg-open"
printf '#!/usr/bin/env bash\n[ "$1" = "-f" ] && shift\nexec "$@"\n' >"$stubs/setsid"
chmod +x "$stubs"/*
export STUB_DIR="$root" XDG_STATE_HOME="$root/state" PATH="$stubs:$PATH"
export GIT_CONFIG_GLOBAL=/dev/null GIT_AUTHOR_NAME=Test GIT_AUTHOR_EMAIL=test@example.com \
  GIT_COMMITTER_NAME=Test GIT_COMMITTER_EMAIL=test@example.com
state="$XDG_STATE_HOME/approval-queue"
log="$state/decisions.jsonl"
source tests/collect-check.sh

repo="$root/sample"
mkdir -p "$repo/blueprints"
git -C "$repo" init -q -b main
cp "$DOC" "$repo/$FILE"
git -C "$repo" add "$FILE"
git -C "$repo" commit -q -m "Add the blueprint"

wait_for() {
  local i
  for i in $(seq 50); do compgen -G "$1" >/dev/null && return 0; sleep 0.1; done
  echo "FAIL: timed out waiting for $1"; fail=1
  kill "$bgpid" 2>/dev/null; wait "$bgpid" 2>/dev/null; bgpid=""
  return 1
}

dir=""
queue() {
  rm -rf "$state/items"
  bash "$SCRIPT" "$@" >"$root/out" 2>"$root/err" &
  bgpid=$!
  dir=""
  wait_for "$state/items/*/item.json" || return 1
  dir=$(dirname "$(ls "$state"/items/*/item.json | head -1)")
  basename "$dir" >>"$root/ids"
}

rc=""
decide() {
  local i
  printf '%s\n' "$1" >"$dir/decision.json.tmp"
  mv "$dir/decision.json.tmp" "$dir/decision.json"
  for i in $(seq 60); do kill -0 "$bgpid" 2>/dev/null || break; sleep 0.1; done
  if kill -0 "$bgpid" 2>/dev/null; then
    echo "FAIL: did not exit after the decision"; fail=1
    kill "$bgpid"; wait "$bgpid" 2>/dev/null; bgpid=""; rc=hung; return
  fi
  wait "$bgpid"; rc=$?; bgpid=""
}

# refuse <label> <want stderr substring> <args>: the command exits 2 before queuing anything.
refuse() {
  local label=$1 want=$2 out
  shift 2
  out=$(bash "$SCRIPT" blueprint "$@" 2>&1 >/dev/null); local code=$?
  assert_eq "$code" "2" "$label: exit code"
  case "$out" in *"$want"*) ;; *) echo "FAIL: $label: stderr '$out' lacks '$want'"; fail=1 ;; esac
  assert_eq "$(compgen -G "$state/items/*/item.json" | wc -l)" "0" "$label: nothing queued"
  assert_eq "$(compgen -G "$state/items/*" | wc -l)" "0" "$label: no item directory"
}

refuse "not a worktree" "is not a git worktree" "$root/nowhere" T "$FILE" --description "$DESC"
refuse "inside the worktree" "give the worktree's top" "$repo/blueprints" T slow-build.blueprint.md --description "$DESC"
refuse "uncommitted file" "is not committed" "$repo" T blueprints/new.blueprint.md --description "$DESC"
printf 'draft\n' >"$repo/blueprints/new.blueprint.md"
refuse "untracked file" "is not committed" "$repo" T blueprints/new.blueprint.md --description "$DESC"
rm "$repo/blueprints/new.blueprint.md"
printf 'edit\n' >>"$repo/$FILE"
refuse "uncommitted change" "has uncommitted changes" "$repo" T "$FILE" --description "$DESC"
git -C "$repo" checkout -q -- "$FILE"
mkdir -p "$repo/blueprints/dir"
printf 'x\n' >"$repo/blueprints/dir/a.md"
ln -s slow-build.blueprint.md "$repo/blueprints/link.md"
git -C "$repo" add blueprints
git -C "$repo" commit -q -m "Add a directory and a symlink"
refuse "a tree" "is not a regular file" "$repo" T blueprints/dir --description "$DESC"
refuse "a tree with a slash" "is not a regular file" "$repo" T blueprints/dir/ --description "$DESC"
refuse "a symlink" "is not a regular file" "$repo" T blueprints/link.md --description "$DESC"
assert_eq "$(compgen -G "$state/items/*" | wc -l)" "0" "a tree or a symlink: no item directory"
refuse "notes not JSON" "is not JSON" "$repo" T "$FILE" --notes "$DOC" --description "$DESC"
printf '{"id":"A"}' >"$root/obj.json"
refuse "notes not an array" "a JSON array of notes" "$repo" T "$FILE" --notes "$root/obj.json" --description "$DESC"
jq '.[1].kind = "dispute" | .[0].extra = 1 | .[2].choices = [] | .[3].id = "C1" | del(.[0].now)' "$NOTES" >"$root/bad.json"
out=$(bash "$SCRIPT" blueprint "$repo" T "$FILE" --notes "$root/bad.json" --description "$DESC" 2>&1 >/dev/null)
for want in 'note 2 (D1) has kind "dispute"' 'note 1 (C1) has an unknown field extra' \
  'note 3 (Q1) is a question note with no choices' 'the id "C1" is used 2 times' \
  'note 1 (C1) has one of was and now without the other'; do
  case "$out" in *"$want"*) ;; *) echo "FAIL: bad notes: stderr lacks '$want'"; fail=1 ;; esac
done
refuse "usage" "usage:" "$repo" T --description "$DESC"

# A note's anchor is a string, or an object with a non-empty quote and an optional string prefix and suffix.
for case in 'quote: ""|an anchor quote that is a non-empty string' 'quote: "a", prefix: 3|an anchor prefix that is not a string' \
  'quote: "a", suffix: null|an anchor suffix that is not a string' 'quote: "a", extra: 1|an unknown anchor key extra' 'prefix: "a"|an anchor quote that is a non-empty string'; do
  jq "(.[0].anchor) = {${case%%|*}}" "$NOTES" >"$root/bad-anchor.json"
  refuse "anchor {${case%%|*}}" "${case#*|}" "$repo" T "$FILE" --notes "$root/bad-anchor.json" --description "$DESC"
done
jq '.[0].anchor = ""' "$NOTES" >"$root/bad-anchor.json"
refuse "empty anchor string" "needs an anchor string" "$repo" T "$FILE" --notes "$root/bad-anchor.json" --description "$DESC"
jq '.[0].anchor = 5' "$NOTES" >"$root/bad-anchor.json"
refuse "anchor not a string" "needs an anchor string" "$repo" T "$FILE" --notes "$root/bad-anchor.json" --description "$DESC"
# A quote that matches more than once, with no prefix or suffix to tell the places apart, is refused at queueing.
jq '.[0].anchor = {quote: "the"}' "$NOTES" >"$root/repeat.json"
refuse "repeated quote" 'the quote "the" occurs' "$repo" T "$FILE" --notes "$root/repeat.json" --description "$DESC"
jq '.[0].anchor = {quote: "Sort the steps by time.", prefix: "Step", suffix: ""} | .[1].anchor = "sort-steps.heading"' "$NOTES" >"$root/quote-anchor.json"
queue blueprint "$repo" T "$FILE" --notes "$root/quote-anchor.json" --description "$DESC"
assert_eq "$(jq -c '.[0].anchor' "$dir/notes.json")" '{"quote":"Sort the steps by time.","prefix":"Step","suffix":""}' "quote anchor: queued with the notes"
kill -TERM "$bgpid"; wait "$bgpid" 2>/dev/null; bgpid=""
rm -rf "$state/items"

# The description is required, is a file, and with the title follows the register: a background paragraph and
# one or two summary paragraphs, and a heading title with no closing punctuation, at most 80 characters.
refuse "no description" "needs --description <file>" "$repo" T "$FILE"
refuse "no description names the README section" "The description" "$repo" T "$FILE"
refuse "description file missing" "no description file at $root/none.md" "$repo" T "$FILE" --description "$root/none.md"
printf 'Only one paragraph.\n' >"$root/one.md"
refuse "one paragraph" "a background paragraph, then one or two summary paragraphs" "$repo" T "$FILE" --description "$root/one.md"
printf 'One.\n\nTwo.\n\nThree.\n\nFour.\n' >"$root/four.md"
refuse "four paragraphs" "the description has 4 paragraphs" "$repo" T "$FILE" --description "$root/four.md"
refuse "title with a period" "drop its closing punctuation" "$repo" "Approve the plan." "$FILE" --description "$DESC"
refuse "title of 81 characters" "the title runs 81 characters; keep it to 80" "$repo" "$(printf 'x%.0s' $(seq 81))" "$FILE" --description "$DESC"

# A --replies file is an array of threads with unique ids, and a blueprint's anchors name no file.
thread='{"id":"C1","status":"done","text":"Fixed.","quote":"Sort the steps by time.","anchor":{"quote":"Sort the steps by time.","prefix":"","suffix":"","from":10,"to":33,"commit":"c0"}}'
printf '[%s]\n' "$thread" >"$root/replies.json"
refuse "replies not JSON" "is not JSON" "$repo" T "$FILE" --replies "$DOC" --description "$DESC"
refuse "replies not an array" "a JSON array of threads" "$repo" T "$FILE" --replies "$root/obj.json" --description "$DESC"
refuse "replies file missing" "no replies file" "$repo" T "$FILE" --replies "$root/none.json" --description "$DESC"
jq '. + [.[0]] | .[1].status = "fixed" | .[0].anchor.file = "x.md" | .[1].extra = 1 | .[1].anchor.to = 2' \
  "$root/replies.json" >"$root/bad-replies.json"
out=$(bash "$SCRIPT" blueprint "$repo" T "$FILE" --replies "$root/bad-replies.json" --description "$DESC" 2>&1 >/dev/null)
for want in 'the id "C1" is used 2 times' 'thread 2 (C1) has status "fixed"' 'thread 1 (C1) has an anchor file' \
  'thread 2 (C1) has an unknown field extra' 'thread 2 (C1) needs an anchor whose from and to are whole numbers'; do
  case "$out" in *"$want"*) ;; *) echo "FAIL: bad replies: stderr lacks '$want'"; fail=1 ;; esac
done

# A queued blueprint carries the file as committed, the notes, and the worktree, repo, and blob.
queued_blob=$(git -C "$repo" rev-parse "HEAD:$FILE")
queue blueprint "$repo" "Approve the plan for Fix a slow build" "./$FILE" --notes "$NOTES" --description "$DESC"
assert_eq "$(jq -c '[.kind,.repo,.file,.blob,.worktree,.headline]' "$dir/item.json")" \
  "[\"blueprint\",\"sample\",\"$FILE\",\"$queued_blob\",\"$(cd "$repo" && pwd -P)\",\"Approve the plan for Fix a slow build\"]" "queue: item.json"
cmp -s "$dir/doc.md" "$DOC" || { echo "FAIL: queue: doc.md is not the committed file"; fail=1; }
assert_eq "$(jq -c '[.[].id]' "$dir/notes.json")" '["C1","D1","Q1","X1"]' "queue: notes.json"
[ ! -e "$dir/replies.json" ] || { echo "FAIL: queue: replies.json without --replies"; fail=1; }
cmp -s "$dir/description.md" "$DESC" || { echo "FAIL: queue: description.md is not the description file"; fail=1; }
assert_eq "$(jq -c 'has("revises")' "$dir/item.json")" "false" "queue: a first blueprint is no revision"
first_id=$(basename "$dir")

# Approve: the app records HEAD at approval; the blob is read at that commit even after HEAD moves on.
printf 'Edited in review.\n' >>"$repo/$FILE"
git -C "$repo" commit -q -am "Edit $FILE in review"
approved_commit=$(git -C "$repo" rev-parse HEAD)
approved_blob=$(git -C "$repo" rev-parse "HEAD:$FILE")
printf 'Later.\n' >>"$repo/$FILE"
git -C "$repo" commit -q -am "A later commit"
comment='{"id":"C1","text":"Say which log.","anchor":{"quote":"build log","prefix":"","suffix":"","from":3,"to":12,"commit":"c0"}}'
decide "{\"decision\":\"approve\",\"calls\":[{\"id\":\"D1\",\"choice\":\"Keep the author's wording\"},{\"id\":\"Q1\",\"choice\":\"Keep it\"}],\"waived\":[{\"id\":\"D1\",\"choice\":\"Keep the author's wording\",\"reason\":\"Kept the author's wording\"}],\"commit\":\"$approved_commit\",\"blob\":\"$approved_blob\",\"comments\":[$comment],\"threads\":[]}"
assert_eq "$rc" "0" "approve: exit code"
assert_eq "$(wc -l <"$root/out")" "1" "approve: stdout is one line"
assert_eq "$(grep -c 'queued' "$root/err")" "1" "approve: one queued line on stderr"
grep -Fxq "approval-queue: queued $first_id at http://127.0.0.1:7907/item/$first_id" "$root/err" \
  || { echo "FAIL: approve: the queued link is not on stderr: $(cat "$root/err")"; fail=1; }
assert_eq "$(jq -cS . "$root/out")" \
  "$(jq -cnS --arg c "$approved_commit" --arg b "$approved_blob" --arg f "$FILE" --argjson comment "$comment" \
    '{decision: "approve", file: $f, commit: $c, blob: $b, calls: [{id: "D1", choice: "Keep the author'"'"'s wording"}, {id: "Q1", choice: "Keep it"}],
      comments: [$comment], threads: []}')" "approve: stdout"
assert_eq "$(wc -l <"$log")" "1" "approve: one log line"
assert_eq "$(jq -c '[.kind,.ref,.lane,.verdict,.blob,.commit,.waived[0].id,.waived[0].reason,.initiative]' "$log")" \
  "[\"blueprint\",\"sample:$FILE\",\"single\",\"approve\",\"$approved_blob\",\"$approved_commit\",\"D1\",\"Kept the author's wording\",null]" "approve: log line"
assert_eq "$(jq -c '[.comments,.replies]' "$log")" "[1,0]" "approve: log counts"
assert_eq "$(jq -r '[(.pid | type), (.pidStart | type), (.pid as $p | .id | endswith("-\($p)"))] | join(" ")' "$dir/item.json")" "number number true" "queue: pid and pidStart"
assert_eq "$(jq -c 'has("amends")' "$dir/item.json")" "false" "queue: a first blueprint is no amend"
[ ! -e "$dir/approved.md" ] || { echo "FAIL: queue: approved.md without an earlier approve"; fail=1; }
collect_check blueprint "$dir"

# approved answers 0 for the approved blob only, by the ref's file part.
bash "$SCRIPT" approved "$FILE" "$approved_blob"; assert_eq "$?" "0" "approved: the approved blob"
bash "$SCRIPT" approved "./$FILE" "$approved_blob"; assert_eq "$?" "0" "approved: a ./ path"
bash "$SCRIPT" approved "$FILE" "$queued_blob"; assert_eq "$?" "1" "approved: the previous blob"
bash "$SCRIPT" approved other.md "$approved_blob"; assert_eq "$?" "1" "approved: another file"
bash "$SCRIPT" approved "$FILE" 2>/dev/null; assert_eq "$?" "2" "approved: usage"
printf 'not json\n' >>"$log"
bash "$SCRIPT" approved "$FILE" "$approved_blob"; assert_eq "$?" "0" "approved: a bad line is skipped"
XDG_STATE_HOME="$root/empty" bash "$SCRIPT" approved "$FILE" "$approved_blob"; assert_eq "$?" "1" "approved: no log"

# A send-back prints the note, the calls made, the comments, and the replies, and logs a reject at HEAD, which
# never counts as approved. A re-queue takes the author's replies, and an empty list is a valid one.
echo '[]' >"$root/no-replies.json"
queue blueprint "$repo" T "$FILE" --replies "$root/no-replies.json" --description "$DESC"
assert_eq "$(cat "$dir/notes.json")" "[]" "no notes: empty notes.json"
assert_eq "$(cat "$dir/replies.json")" "[]" "empty replies: replies.json"
# Queued after an approve of the same file, it is an amend review: approved.md holds the approved text and
# item.json names its blob.
assert_eq "$(jq -c '.amends' "$dir/item.json")" "\"$approved_blob\"" "amend: item.json names the approved blob"
assert_eq "$(git -C "$repo" cat-file blob "$approved_blob" | cmp - "$dir/approved.md"; echo $?)" "0" "amend: approved.md is the approved text"
decide "{\"decision\":\"reject\",\"note\":\"Fold the event section in.\",\"calls\":[{\"id\":\"Q1\",\"choice\":\"Fold it in\"}],\"comments\":[$comment],\"threads\":[{\"id\":\"C0\",\"reply\":\"Not yet.\"}]}"
assert_eq "$rc" "0" "reject: exit code"
assert_eq "$(cat "$root/out")" \
  "$(jq -cn --argjson comment "$comment" '{decision: "reject", note: "Fold the event section in.", calls: [{id: "Q1", choice: "Fold it in"}],
    comments: [$comment], threads: [{id: "C0", reply: "Not yet."}], amends: $b}' --arg b "$approved_blob")" "reject: stdout (an amend of the approved blob)"
assert_eq "$(grep -v '^not json' "$log" | tail -n 1 | jq -c '[.comments,.replies]')" "[1,1]" "reject: log counts"

queue blueprint "$repo" T "$FILE" --replies "$root/replies.json" --description "$DESC"
assert_eq "$(jq -c '[.[].id]' "$dir/replies.json")" '["C1"]' "replies: replies.json"
decide '{"decision":"reject","note":""}'
assert_eq "$(cat "$root/out")" "{\"decision\":\"reject\",\"note\":\"\",\"calls\":[],\"comments\":[],\"threads\":[],\"amends\":\"$approved_blob\"}" "reject with nothing: stdout"
head_blob=$(git -C "$repo" rev-parse "HEAD:$FILE")
assert_eq "$(grep -v '^not json' "$log" | tail -n 1 | jq -c '[.verdict,.blob,.waived]')" "[\"reject\",\"$head_blob\",[]]" "reject: log line"
bash "$SCRIPT" approved "$FILE" "$head_blob"; assert_eq "$?" "1" "approved: a rejected blob"

# An approve of another file is no amend, and neither is an approve whose blob the worktree lacks.
OTHER=blueprints/other.blueprint.md
GHOST=blueprints/ghost.blueprint.md
cp "$DOC" "$repo/$OTHER"
cp "$DOC" "$repo/$GHOST"
git -C "$repo" add "$OTHER" "$GHOST"
git -C "$repo" commit -q -m "Add two more blueprints"
queue blueprint "$repo" T "$OTHER" --description "$DESC"
assert_eq "$(jq -c 'has("amends")' "$dir/item.json")" "false" "amend: an approve of another file is no amend"
[ ! -e "$dir/approved.md" ] || { echo "FAIL: amend: approved.md for another file's approve"; fail=1; }
decide '{"decision":"reject","note":"Other."}'
jq -nc --arg r "sample:$GHOST" '{kind: "blueprint", ref: $r, verdict: "approve", blob: "0123456789abcdef0123456789abcdef01234567"}' >>"$log"
queue blueprint "$repo" T "$GHOST" --description "$DESC"
assert_eq "$(jq -c 'has("amends")' "$dir/item.json")" "false" "amend: a blob the worktree lacks queues a full review"
[ ! -e "$dir/approved.md" ] || { echo "FAIL: amend: approved.md for a missing blob"; fail=1; }
decide '{"decision":"reject","note":"Ghost."}'

# A blueprint sent back and queued again is a revision, with no section: item.json names the earlier item and
# the round, a third round reads 3, an approve ends the rounds, and a log with no file reads as none.
rm -f "$log"
queue blueprint "$repo" T "$FILE" --description "$DESC"
assert_eq "$(jq -c 'has("revises")' "$dir/item.json")" "false" "revision: no log, no revises"
round1=$(basename "$dir")
decide '{"decision":"reject","note":"First."}'
queue blueprint "$repo" T "$FILE" --description "$DESC"
assert_eq "$(jq -c '.revises' "$dir/item.json")" "{\"item\":\"$round1\",\"revision\":2}" "revision: second round"
round2=$(basename "$dir")
decide '{"decision":"reject","note":"Second."}'
queue blueprint "$repo" T "$FILE" --description "$DESC"
assert_eq "$(jq -c '.revises' "$dir/item.json")" "{\"item\":\"$round2\",\"revision\":3}" "revision: third round"
decide "{\"decision\":\"approve\",\"commit\":\"$(git -C "$repo" rev-parse HEAD)\"}"
assert_eq "$rc" "0" "revision: approve exit code"
queue blueprint "$repo" T "$FILE" --description "$DESC"
assert_eq "$(jq -c 'has("revises")' "$dir/item.json")" "false" "revision: an approve ends the rounds"
decide '{"decision":"reject","note":"Again."}'
queue blueprint "$repo" T "$FILE" --description "$DESC"
assert_eq "$(jq -c '.revises.revision' "$dir/item.json")" "2" "revision: rounds before an approve do not count"
decide '{"decision":"reject","note":""}'

# An approve of an amend review prints the blob it amends.
prev_blob=$(jq -r 'select(.verdict == "approve") | .blob' "$log" | tail -n 1)
queue blueprint "$repo" T "$FILE" --description "$DESC"
decide "{\"decision\":\"approve\",\"commit\":\"$(git -C "$repo" rev-parse HEAD)\"}"
assert_eq "$(jq -r '.amends' "$root/out")" "$prev_blob" "amend: the printed approve names the amended blob"

# `anchors` prints a file's heading anchors by cairn's slug rule.
printf '## Set a section'"'"'s starting state\n\n- A bullet.\n' >"$root/heading.md"
assert_eq "$(bash "$SCRIPT" anchors "$root/heading.md")" "$(printf 'set-a-sections-starting-state.heading\tSet a section'"'"'s starting state')" "anchors: the apostrophe example"

# `notes --check` runs the queue-time notes checks on one document and queues nothing.
rm -rf "$state/items"
notes_check() { bash "$SCRIPT" notes --check "$@" >"$root/nc.out" 2>"$root/nc.err"; }
notes_check "$repo/$FILE" "$NOTES"; assert_eq "$?" "0" "notes --check: clean notes exit code"
assert_eq "$(cat "$root/nc.out" "$root/nc.err")" "" "notes --check: clean notes print nothing"
notes_check "$repo/$FILE" "$root/bad.json"; assert_eq "$?" "2" "notes --check: a shape defect exits 2"
grep -qF 'has an unknown field extra' "$root/nc.err" || { echo "FAIL: notes --check: shape defect not named: $(cat "$root/nc.err")"; fail=1; }
notes_check "$repo/$FILE" "$root/repeat.json"; assert_eq "$?" "2" "notes --check: a repeated quote exits 2"
grep -qF 'note C1: the quote "the" occurs' "$root/nc.err" || { echo "FAIL: notes --check: repeated quote not named: $(cat "$root/nc.err")"; fail=1; }
notes_check "$repo/$FILE" "$root/none.json"; assert_eq "$?" "2" "notes --check: a missing notes file exits 2"
notes_check "$root/none.md" "$NOTES"; assert_eq "$?" "2" "notes --check: a missing document exits 2"
assert_eq "$(compgen -G "$state/items/*" | wc -l)" "0" "notes --check: queues nothing"

# `notes <id>` replaces a waiting item's notes and changes nothing else; any refusal leaves notes.json alone.
queue blueprint "$repo" T "$FILE" --notes "$NOTES" --description "$DESC"
nid=$(basename "$dir")
cp "$dir/item.json" "$root/item.before"
cp "$dir/notes.json" "$root/notes.before"
jq '.[0].title = "A new title"' "$NOTES" >"$root/new.json"
out=$(bash "$SCRIPT" notes "$nid" "$root/new.json" 2>"$root/nc.err"); assert_eq "$?" "0" "notes <id>: exit code"
assert_eq "$out" "replaced the notes of $nid at http://127.0.0.1:7907/item/$nid" "notes <id>: stdout"
assert_eq "$(jq -c . "$dir/notes.json")" "$(jq -c . "$root/new.json")" "notes <id>: notes.json holds the new notes"
cmp -s "$dir/item.json" "$root/item.before" || { echo "FAIL: notes <id>: item.json changed"; fail=1; }
kill -0 "$bgpid" 2>/dev/null || { echo "FAIL: notes <id>: the waiter is gone"; fail=1; }
cp "$dir/notes.json" "$root/notes.before"
for case in "bad id|nope|$root/new.json|is not an item id" "unknown id|20200101T000000-1|$root/new.json|no item 20200101T000000-1" \
  "bad notes|$nid|$root/bad.json|does not match the notes shape" "repeated quote|$nid|$root/repeat.json|the quote \"the\" occurs"; do
  IFS='|' read -r label tid tfile want <<<"$case"
  out=$(bash "$SCRIPT" notes "$tid" "$tfile" 2>&1 >/dev/null); code=$?
  assert_eq "$code" "2" "notes <id>: $label exit code"
  case "$out" in *"$want"*) ;; *) echo "FAIL: notes <id>: $label: stderr '$out' lacks '$want'"; fail=1 ;; esac
  cmp -s "$dir/notes.json" "$root/notes.before" || { echo "FAIL: notes <id>: $label changed notes.json"; fail=1; }
done
decide '{"decision":"reject","note":"Done."}'
out=$(bash "$SCRIPT" notes "$nid" "$root/new.json" 2>&1 >/dev/null); assert_eq "$?" "2" "notes <id>: a decided item exits 2"
case "$out" in *"is decided"*) ;; *) echo "FAIL: notes <id>: decided: stderr '$out'"; fail=1 ;; esac
cmp -s "$dir/notes.json" "$root/notes.before" || { echo "FAIL: notes <id>: a decided item's notes changed"; fail=1; }

live_leak
[ "$fail" -eq 0 ] && echo "blueprint.test.sh: ok"
exit "$fail"
