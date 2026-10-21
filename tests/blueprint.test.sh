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
}

refuse "not a worktree" "is not a git worktree" "$root/nowhere" T "$FILE"
refuse "inside the worktree" "give the worktree's top" "$repo/blueprints" T slow-build.blueprint.md
refuse "uncommitted file" "is not committed" "$repo" T blueprints/new.blueprint.md
printf 'draft\n' >"$repo/blueprints/new.blueprint.md"
refuse "untracked file" "is not committed" "$repo" T blueprints/new.blueprint.md
rm "$repo/blueprints/new.blueprint.md"
printf 'edit\n' >>"$repo/$FILE"
refuse "uncommitted change" "has uncommitted changes" "$repo" T "$FILE"
git -C "$repo" checkout -q -- "$FILE"
mkdir -p "$repo/blueprints/dir"
printf 'x\n' >"$repo/blueprints/dir/a.md"
ln -s slow-build.blueprint.md "$repo/blueprints/link.md"
git -C "$repo" add blueprints
git -C "$repo" commit -q -m "Add a directory and a symlink"
refuse "a tree" "is not a regular file" "$repo" T blueprints/dir
refuse "a tree with a slash" "is not a regular file" "$repo" T blueprints/dir/
refuse "a symlink" "is not a regular file" "$repo" T blueprints/link.md
assert_eq "$(compgen -G "$state/items/*" | wc -l)" "0" "a tree or a symlink: no item directory"
refuse "notes not JSON" "is not JSON" "$repo" T "$FILE" --notes "$DOC"
printf '{"id":"A"}' >"$root/obj.json"
refuse "notes not an array" "a JSON array of notes" "$repo" T "$FILE" --notes "$root/obj.json"
jq '.[1].kind = "dispute" | .[0].extra = 1 | .[2].choices = [] | .[3].id = "C1" | del(.[0].now)' "$NOTES" >"$root/bad.json"
out=$(bash "$SCRIPT" blueprint "$repo" T "$FILE" --notes "$root/bad.json" 2>&1 >/dev/null)
for want in 'note 2 (D1) has kind "dispute"' 'note 1 (C1) has an unknown field extra' \
  'note 3 (Q1) is a question note with no choices' 'the id "C1" is used 2 times' \
  'note 1 (C1) has one of was and now without the other'; do
  case "$out" in *"$want"*) ;; *) echo "FAIL: bad notes: stderr lacks '$want'"; fail=1 ;; esac
done
refuse "usage" "usage:" "$repo" T

# A queued blueprint carries the file as committed, the notes, and the worktree, repo, and blob.
queued_blob=$(git -C "$repo" rev-parse "HEAD:$FILE")
queue blueprint "$repo" "Approve the plan for Fix a slow build" "./$FILE" --notes "$NOTES"
assert_eq "$(jq -c '[.kind,.repo,.file,.blob,.worktree,.headline]' "$dir/item.json")" \
  "[\"blueprint\",\"sample\",\"$FILE\",\"$queued_blob\",\"$(cd "$repo" && pwd -P)\",\"Approve the plan for Fix a slow build\"]" "queue: item.json"
cmp -s "$dir/doc.md" "$DOC" || { echo "FAIL: queue: doc.md is not the committed file"; fail=1; }
assert_eq "$(jq -c '[.[].id]' "$dir/notes.json")" '["C1","D1","Q1","X1"]' "queue: notes.json"

# Approve: the app records HEAD at approval; the blob is read at that commit even after HEAD moves on.
printf 'Edited in review.\n' >>"$repo/$FILE"
git -C "$repo" commit -q -am "Edit $FILE in review"
approved_commit=$(git -C "$repo" rev-parse HEAD)
approved_blob=$(git -C "$repo" rev-parse "HEAD:$FILE")
printf 'Later.\n' >>"$repo/$FILE"
git -C "$repo" commit -q -am "A later commit"
decide "{\"decision\":\"approve\",\"calls\":[{\"id\":\"D1\",\"choice\":\"Keep the author's wording\"},{\"id\":\"Q1\",\"choice\":\"Keep it\"}],\"waived\":[{\"id\":\"D1\",\"choice\":\"Keep the author's wording\",\"reason\":\"Kept the author's wording\"}],\"commit\":\"$approved_commit\",\"blob\":\"$approved_blob\"}"
assert_eq "$rc" "0" "approve: exit code"
assert_eq "$(jq -cS . "$root/out")" \
  "$(jq -cnS --arg c "$approved_commit" --arg b "$approved_blob" --arg f "$FILE" \
    '{decision: "approve", file: $f, commit: $c, blob: $b, calls: [{id: "D1", choice: "Keep the author'"'"'s wording"}, {id: "Q1", choice: "Keep it"}]}')" "approve: stdout"
assert_eq "$(wc -l <"$log")" "1" "approve: one log line"
assert_eq "$(jq -c '[.kind,.ref,.lane,.verdict,.blob,.commit,.waived[0].id,.waived[0].reason,.initiative]' "$log")" \
  "[\"blueprint\",\"sample:$FILE\",\"single\",\"approve\",\"$approved_blob\",\"$approved_commit\",\"D1\",\"Kept the author's wording\",null]" "approve: log line"

# approved answers 0 for the approved blob only, by the ref's file part.
bash "$SCRIPT" approved "$FILE" "$approved_blob"; assert_eq "$?" "0" "approved: the approved blob"
bash "$SCRIPT" approved "./$FILE" "$approved_blob"; assert_eq "$?" "0" "approved: a ./ path"
bash "$SCRIPT" approved "$FILE" "$queued_blob"; assert_eq "$?" "1" "approved: the previous blob"
bash "$SCRIPT" approved other.md "$approved_blob"; assert_eq "$?" "1" "approved: another file"
bash "$SCRIPT" approved "$FILE" 2>/dev/null; assert_eq "$?" "2" "approved: usage"
printf 'not json\n' >>"$log"
bash "$SCRIPT" approved "$FILE" "$approved_blob"; assert_eq "$?" "0" "approved: a bad line is skipped"
XDG_STATE_HOME="$root/empty" bash "$SCRIPT" approved "$FILE" "$approved_blob"; assert_eq "$?" "1" "approved: no log"

# A send-back prints the note and logs a reject at HEAD, which never counts as approved.
queue blueprint "$repo" T "$FILE"
assert_eq "$(cat "$dir/notes.json")" "[]" "no notes: empty notes.json"
decide '{"decision":"reject","note":"Fold the event section in."}'
assert_eq "$rc" "0" "reject: exit code"
assert_eq "$(cat "$root/out")" '{"decision":"reject","note":"Fold the event section in."}' "reject: stdout"
head_blob=$(git -C "$repo" rev-parse "HEAD:$FILE")
assert_eq "$(grep -v '^not json' "$log" | tail -n 1 | jq -c '[.verdict,.blob,.waived]')" "[\"reject\",\"$head_blob\",[]]" "reject: log line"
bash "$SCRIPT" approved "$FILE" "$head_blob"; assert_eq "$?" "1" "approved: a rejected blob"

assert_eq "$(stat -c %s "$live_log" 2>/dev/null || echo none)" "$live_before" "the live log is untouched"
[ "$fail" -eq 0 ] && echo "blueprint.test.sh: ok"
exit "$fail"
