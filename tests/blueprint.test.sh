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

live_log="$HOME/.local/state/approval-queue/decisions.jsonl"
live_before=$(stat -c %s "$live_log" 2>/dev/null || echo none)

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
decide "{\"decision\":\"reject\",\"note\":\"Fold the event section in.\",\"calls\":[{\"id\":\"Q1\",\"choice\":\"Fold it in\"}],\"comments\":[$comment],\"threads\":[{\"id\":\"C0\",\"reply\":\"Not yet.\"}]}"
assert_eq "$rc" "0" "reject: exit code"
assert_eq "$(cat "$root/out")" \
  "$(jq -cn --argjson comment "$comment" '{decision: "reject", note: "Fold the event section in.", calls: [{id: "Q1", choice: "Fold it in"}],
    comments: [$comment], threads: [{id: "C0", reply: "Not yet."}]}')" "reject: stdout"
assert_eq "$(grep -v '^not json' "$log" | tail -n 1 | jq -c '[.comments,.replies]')" "[1,1]" "reject: log counts"

queue blueprint "$repo" T "$FILE" --replies "$root/replies.json" --description "$DESC"
assert_eq "$(jq -c '[.[].id]' "$dir/replies.json")" '["C1"]' "replies: replies.json"
decide '{"decision":"reject","note":""}'
assert_eq "$(cat "$root/out")" '{"decision":"reject","note":"","calls":[],"comments":[],"threads":[]}' "reject with nothing: stdout"
head_blob=$(git -C "$repo" rev-parse "HEAD:$FILE")
assert_eq "$(grep -v '^not json' "$log" | tail -n 1 | jq -c '[.verdict,.blob,.waived]')" "[\"reject\",\"$head_blob\",[]]" "reject: log line"
bash "$SCRIPT" approved "$FILE" "$head_blob"; assert_eq "$?" "1" "approved: a rejected blob"

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

assert_eq "$(stat -c %s "$live_log" 2>/dev/null || echo none)" "$live_before" "the live log is untouched"
[ "$fail" -eq 0 ] && echo "blueprint.test.sh: ok"
exit "$fail"
