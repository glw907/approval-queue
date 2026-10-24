#!/usr/bin/env bash
# page-change.test.sh: prove the page and change forms of the approval-queue command, and `approved --kind`,
# against this worktree's own copy, with curl, xdg-open, setsid, and gh stubbed on PATH (gh serves the cairn
# change fixture) and a temp git repo as the page's worktree. Pins the refusals, the queued item, the printed
# decisions, the log lines, and what `approved` answers per kind. Never starts the app, opens a browser, or
# touches the live queue state.
set -uo pipefail
cd "$(dirname "$0")/.."
SCRIPT="$(pwd)/bin/.local/bin/approval-queue"
FX="$(pwd)/approval-queue/src/lib/fixtures"
PAGE="$FX/sample.page.md"
PAGE_NOTES="$FX/sample-page-notes.json"
CHANGE="$FX/change"
FILE=docs/extend/slow-build.md
PR=glw907/sample#7
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
# gh serves one PR from the fixture: the head, the merge base, and the base branch's tip are read from files,
# so a test can move the head after queueing; a file at any commit but the head and the merge base is a 404.
cat >"$stubs/gh" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$STUB_DIR/gh.record"
head=$(cat "$STUB_DIR/head")
base=$(cat "$STUB_DIR/base")
case "$1 $2" in
  "api repos/"*/compare/*) printf '%s\n' "$base" ;;
  "pr view")
    case "$7" in
      headRefOid) [ -e "$STUB_DIR/gh.down" ] && exit 1; jq -nc --arg h "$head" '{headRefOid: $h}' ;;
      baseRefOid) jq -nc --arg b "$(cat "$STUB_DIR/tip")" '{baseRefOid: $b}' ;;
      *) jq -nc --arg h "$head" --argjson n "$3" \
           '{body: "A change.\n", headRefOid: $h, number: $n, url: "https://github.com/glw907/cairn-cms/pull/\($n)",
             headRefName: "retarget", baseRefName: "main", state: "OPEN",
             statusCheckRollup: [{name: "gate", workflowName: "ci", status: "COMPLETED", conclusion: "SUCCESS"}]}' ;;
    esac ;;
  "pr diff") cat "$CHANGE/diff.patch" ;;
  "api -H")
    path=${4#repos/*/*/contents/}
    sha=${path##*?ref=}
    path=${path%%\?*}
    if [ "$sha" = "$head" ]; then dir=head; elif [ "$sha" = "$base" ]; then dir=base; else echo "gh: Not Found (HTTP 404)" >&2; exit 1; fi
    [ -f "$CHANGE/$dir/$path" ] || { echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
    cat "$CHANGE/$dir/$path" ;;
  *) echo "gh stub: unexpected $*" >&2; exit 1 ;;
esac
STUB
chmod +x "$stubs"/*
export STUB_DIR="$root" CHANGE XDG_STATE_HOME="$root/state" PATH="$stubs:$PATH"
export GIT_CONFIG_GLOBAL=/dev/null GIT_AUTHOR_NAME=Test GIT_AUTHOR_EMAIL=test@example.com \
  GIT_COMMITTER_NAME=Test GIT_COMMITTER_EMAIL=test@example.com
state="$XDG_STATE_HOME/approval-queue"
# Every blueprint and page takes a description of a background paragraph and one summary paragraph.
DESC="$root/description.md"
printf 'The page explains the slow build.\n\nThis page documents the cache step. Approving it lets the session merge the pull request.\n' >"$DESC"
log="$state/decisions.jsonl"
printf 'head0000\n' >"$root/head"
printf 'base0000\n' >"$root/base"
printf 'tip0000\n' >"$root/tip"

repo="$root/sample"
mkdir -p "$repo/docs/extend"
git -C "$repo" init -q -b main
git -C "$repo" remote add origin https://github.com/glw907/sample.git
cp "$PAGE" "$repo/$FILE"
git -C "$repo" add "$FILE"
git -C "$repo" commit -q -m "Add the page"

wait_for() {
  local i
  for i in $(seq 50); do compgen -G "$1" >/dev/null && return 0; sleep 0.1; done
  echo "FAIL: timed out waiting for $1"; fail=1
  [ -s "$root/err" ] && sed 's/^/  stderr: /' "$root/err"
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
  for i in $(seq 150); do kill -0 "$bgpid" 2>/dev/null || break; sleep 0.1; done
  if kill -0 "$bgpid" 2>/dev/null; then
    echo "FAIL: did not exit after the decision"; fail=1
    [ -s "$root/err" ] && sed 's/^/  stderr: /' "$root/err"
    ps -o pid,ppid,stat,args --ppid "$bgpid" >&2
    kill "$bgpid"; wait "$bgpid" 2>/dev/null; bgpid=""; rc=hung; return
  fi
  wait "$bgpid"; rc=$?; bgpid=""
}

# refuse <label> <want stderr substring> <args>: the command exits 2 before queuing anything.
refuse() {
  local label=$1 want=$2 out
  shift 2
  rm -rf "$state/items"
  out=$(bash "$SCRIPT" "$@" 2>&1 >/dev/null); local code=$?
  assert_eq "$code" "2" "$label: exit code"
  case "$out" in *"$want"*) ;; *) echo "FAIL: $label: stderr '$out' lacks '$want'"; fail=1 ;; esac
  assert_eq "$(compgen -G "$state/items/*/item.json" | wc -l)" "0" "$label: nothing queued"
  assert_eq "$(compgen -G "$state/items/*" | wc -l)" "0" "$label: no item directory"
}

# ---- page ----
refuse "page without --pr" "usage:" page "$repo" T "$FILE" --description "$DESC"
refuse "page with a bad ref" "owner/repo#n" page "$repo" T "$FILE" --pr glw907/sample --description "$DESC"
refuse "page not a worktree" "is not a git worktree" page "$root/nowhere" T "$FILE" --pr "$PR" --description "$DESC"
refuse "page uncommitted" "is not committed" page "$repo" T docs/extend/new.md --pr "$PR" --description "$DESC"
refuse "page absolute path" "give the file as a path inside" page "$repo" T "/etc/hostname" --pr "$PR" --description "$DESC"
refuse "page dotted path" "give the file as a path inside" page "$repo" T "docs/../$FILE" --pr "$PR" --description "$DESC"
printf 'edit\n' >>"$repo/$FILE"
refuse "page uncommitted change" "has uncommitted changes" page "$repo" T "$FILE" --pr "$PR" --description "$DESC"
git -C "$repo" checkout -q -- "$FILE"
printf '{"id":"A"}' >"$root/obj.json"
refuse "page notes not an array" "a JSON array of notes" page "$repo" T "$FILE" --pr "$PR" --notes "$root/obj.json" --description "$DESC"
jq '.[0].file = "x.md"' "$PAGE_NOTES" >"$root/file-field.json"
refuse "page notes with a file field" "has an unknown field file" page "$repo" T "$FILE" --pr "$PR" \
  --notes "$root/file-field.json" --description "$DESC"
refuse "page without a description" "needs --description <file>" page "$repo" T "$FILE" --pr "$PR"
refuse "page description file missing" "no description file at $root/none.md" page "$repo" T "$FILE" --pr "$PR" --description "$root/none.md"
printf 'Only one paragraph.\n' >"$root/one.md"
refuse "page with a one-paragraph description" "a background paragraph, then one or two summary paragraphs" page "$repo" T "$FILE" --pr "$PR" --description "$root/one.md"
printf 'One.\n\nTwo.\n\nThree.\n\nFour.\n' >"$root/four.md"
refuse "page with a four-paragraph description" "the description has 4 paragraphs" page "$repo" T "$FILE" --pr "$PR" --description "$root/four.md"
refuse "page with a title ending in a period" "drop its closing punctuation" page "$repo" "A title." "$FILE" --pr "$PR" --description "$DESC"
refuse "page with an 81-character title" "the title runs 81 characters; keep it to 80" page "$repo" "$(printf 'x%.0s' $(seq 81))" "$FILE" --pr "$PR" --description "$DESC"
refuse "change takes no description" "usage:" change glw907/cairn-cms#77 T --description "$DESC"
refuse "blueprint refuses --pr" "usage:" blueprint "$repo" T "$FILE" --pr "$PR" --description "$DESC"
refuse "page --pr in another repository" "is not in" page "$repo" T "$FILE" --pr glw907/other#7 --description "$DESC"
git -C "$repo" remote rename origin keep
refuse "page in a worktree with no origin" "has no origin remote" page "$repo" T "$FILE" --pr "$PR" --description "$DESC"
git -C "$repo" remote rename keep origin

queued_blob=$(git -C "$repo" rev-parse "HEAD:$FILE")
printf 'head1111\n' >"$root/head"
queue page "$repo" "Approve the page Fix a slow build" "./$FILE" --pr "$PR" --notes "$PAGE_NOTES" --description "$DESC"
assert_eq "$(jq -c '[.kind,.repo,.file,.blob,.pr,.prHead,.headline]' "$dir/item.json")" \
  "[\"page\",\"sample\",\"$FILE\",\"$queued_blob\",\"$PR\",\"head1111\",\"Approve the page Fix a slow build\"]" "page queue: item.json"
cmp -s "$dir/doc.md" "$PAGE" || { echo "FAIL: page queue: doc.md is not the committed file"; fail=1; }
assert_eq "$(jq -c '[.[].id]' "$dir/notes.json")" '["R1","D1","Q1"]' "page queue: notes.json"
assert_eq "$(grep -c 'headRefOid' "$root/gh.record")" "1" "page queue: one head read"
cmp -s "$dir/description.md" "$DESC" || { echo "FAIL: page queue: description.md is not the description file"; fail=1; }
assert_eq "$(jq -c 'has("revises")' "$dir/item.json")" "false" "page queue: a first page is no revision"

# The page approve names the head the item was queued at and the screen showed. A PR that moved while the
# item waited is refused: the approval would cover commits nobody saw.
printf 'Edited in review.\n' >>"$repo/$FILE"
git -C "$repo" commit -q -am "Edit $FILE in review"
approved_commit=$(git -C "$repo" rev-parse HEAD)
approved_blob=$(git -C "$repo" rev-parse "HEAD:$FILE")
page_approve="{\"decision\":\"approve\",\"calls\":[{\"id\":\"D1\",\"choice\":\"Keep the author's wording\"},{\"id\":\"Q1\",\"choice\":\"Keep it\"}],\"waived\":[{\"id\":\"D1\",\"choice\":\"Keep the author's wording\",\"reason\":\"Kept the author's wording\"}],\"commit\":\"$approved_commit\",\"blob\":\"$approved_blob\"}"
printf 'head2222\n' >"$root/head"
decide "$page_approve"
assert_eq "$rc" "1" "page approve after the PR moved: exit code"
case "$(cat "$root/err")" in *"moved from head1111 to head2222"*) ;; *) echo "FAIL: page approve after the PR moved: stderr '$(cat "$root/err")'"; fail=1 ;; esac
assert_eq "$(cat "$root/out")" "" "page approve after the PR moved: no decision printed"
[ ! -e "$log" ] || { echo "FAIL: page approve after the PR moved: something was logged"; fail=1; }

printf 'head1111\n' >"$root/head"
queue page "$repo" "Approve the page Fix a slow build" "$FILE" --pr "$PR" --notes "$PAGE_NOTES" --description "$DESC"
assert_eq "$(jq -r '.prHead' "$dir/item.json")" "head1111" "page requeue: item.json"
decide "$page_approve"
assert_eq "$rc" "0" "page approve: exit code"
assert_eq "$(cat "$root/out")" \
  "$(jq -cn --arg c "$approved_commit" --arg b "$approved_blob" --arg f "$FILE" --arg pr "$PR" \
    '{decision: "approve", file: $f, commit: $c, blob: $b, pr: $pr, head: "head1111", calls: [{id: "D1", choice: "Keep the author'"'"'s wording"}, {id: "Q1", choice: "Keep it"}],
      comments: [], threads: []}')" "page approve: stdout"
assert_eq "$(wc -l <"$log")" "1" "page approve: one log line"
assert_eq "$(jq -c '[.kind,.ref,.lane,.verdict,.blob,.commit,.pr,.head,.waived[0].id,.initiative]' "$log")" \
  "[\"page\",\"sample:$FILE\",\"single\",\"approve\",\"$approved_blob\",\"$approved_commit\",\"$PR\",\"head1111\",\"D1\",null]" "page approve: log line"
page_id=$(basename "$dir")
grep -Fxq "approval-queue: queued $page_id at http://127.0.0.1:7907/item/$page_id" "$root/err" \
  || { echo "FAIL: page: the queued link is not on stderr: $(cat "$root/err")"; fail=1; }
assert_eq "$(jq -e . "$root/out" >/dev/null; echo $?)" "0" "page: stdout holds only the decision JSON"

# approved matches the kind: a page line answers --kind page only, and a blueprint line the default only.
bash "$SCRIPT" approved --kind page "$FILE" "$approved_blob"; assert_eq "$?" "0" "approved --kind page: the approved blob"
bash "$SCRIPT" approved --kind page "./$FILE" "$approved_blob"; assert_eq "$?" "0" "approved --kind page: a ./ path"
bash "$SCRIPT" approved "$FILE" "$approved_blob"; assert_eq "$?" "1" "approved: a page line never answers the blueprint form"
bash "$SCRIPT" approved --kind blueprint "$FILE" "$approved_blob"; assert_eq "$?" "1" "approved --kind blueprint: a page line"
bash "$SCRIPT" approved --kind page "$FILE" "$queued_blob"; assert_eq "$?" "1" "approved --kind page: the previous blob"
bash "$SCRIPT" approved --kind change "$FILE" "$approved_blob" 2>/dev/null; assert_eq "$?" "2" "approved --kind: an unknown kind"
bash "$SCRIPT" approved --kind page "$FILE" 2>/dev/null; assert_eq "$?" "2" "approved --kind page: usage"
jq -nc --arg r "sample:blueprints/b.md" '{kind: "blueprint", ref: $r, verdict: "approve", blob: "bb"}' >>"$log"
bash "$SCRIPT" approved blueprints/b.md bb; assert_eq "$?" "0" "approved: a blueprint line"
bash "$SCRIPT" approved --kind page blueprints/b.md bb; assert_eq "$?" "1" "approved --kind page: a blueprint line"

git -C "$repo" commit -q --allow-empty -m "A later commit"
printf 'Later.\n' >>"$repo/$FILE"
git -C "$repo" commit -q -am "A later edit"
# A page send-back prints the note and logs a reject with the PR, which never counts as approved.
queue page "$repo" T "$FILE" --pr "$PR" --description "$DESC"
assert_eq "$(cat "$dir/notes.json")" "[]" "page no notes: empty notes.json"
assert_eq "$(jq -c 'has("revises")' "$dir/item.json")" "false" "page: an approved page is no revision"
page_round1=$(basename "$dir")
decide '{"decision":"reject","note":"Say what the table measures."}'
assert_eq "$rc" "0" "page reject: exit code"
assert_eq "$(cat "$root/out")" '{"decision":"reject","note":"Say what the table measures.","calls":[],"comments":[],"threads":[]}' "page reject: stdout"
head_blob=$(git -C "$repo" rev-parse "HEAD:$FILE")
assert_eq "$(tail -n 1 "$log" | jq -c '[.kind,.verdict,.blob,.pr,.head]')" "[\"page\",\"reject\",\"$head_blob\",\"$PR\",null]" "page reject: log line"
bash "$SCRIPT" approved --kind page "$FILE" "$head_blob"; assert_eq "$?" "1" "approved --kind page: a rejected blob"

# A head that gh cannot read at approval is a failure that logs nothing.
lines=$(wc -l <"$log")
queue page "$repo" T "$FILE" --pr "$PR" --description "$DESC"
assert_eq "$(jq -c '.revises' "$dir/item.json")" "{\"item\":\"$page_round1\",\"revision\":2}" "page: a resent page is a revision"
touch "$root/gh.down"
decide "{\"decision\":\"approve\",\"calls\":[],\"commit\":\"$(git -C "$repo" rev-parse HEAD)\"}"
assert_eq "$rc" "1" "page approve with gh down: exit code"
assert_eq "$(wc -l <"$log")" "$lines" "page approve with gh down: nothing logged"
rm -f "$root/gh.down"

# ---- change ----
printf 'head3333\n' >"$root/head"
printf 'base3333\n' >"$root/base"
# The base branch moved on after the branch was cut; the documents' originals are read at the merge base.
printf 'tip3333\n' >"$root/tip"
CPR=glw907/cairn-cms#77
refuse "change usage" "usage:" change "$CPR"
refuse "change bad ref" "owner/repo#n" change cairn-cms T
jq '.[0].file = "docs/other.md"' "$CHANGE/notes.json" >"$root/other-file.json"
jq 'del(.[0].file)' "$CHANGE/notes.json" >"$root/no-file.json"
jq '.[1].choices[0].edit = true' "$CHANGE/notes.json" >"$root/edit-choice.json"
refuse "change notes naming a file the PR does not change" "names files that" change "$CPR" T --notes "$root/other-file.json"
refuse "change notes without a file" "needs a file string" change "$CPR" T --notes "$root/no-file.json"
refuse "change notes with an editing choice" "takes no edits" change "$CPR" T --notes "$root/edit-choice.json"

queue change "$CPR" "Retarget two links" --notes "$CHANGE/notes.json"
assert_eq "$(jq -c '[.kind,.repo,.number,.title,.headline,.head]' "$dir/item.json")" \
  '["change","glw907/cairn-cms",77,"Retarget two links","Retarget two links","head3333"]' "change queue: item.json"
assert_eq "$(jq -c '[.[] | [.kind, .path]]' "$dir/docs.json")" \
  '[["blueprint","blueprints/docs/extend/restrict-admin-access.blueprint.yaml"],["page","docs/extend/run-cairn-audit-on-your-site.md"],["page","docs/extend/share-a-draft-preview.md"]]' "change queue: docs.json"
cmp -s "$dir/docs/2/new.md" "$CHANGE/head/docs/extend/share-a-draft-preview.md" || { echo "FAIL: change queue: new.md is not the head copy"; fail=1; }
cmp -s "$dir/docs/2/old.md" "$CHANGE/base/docs/extend/share-a-draft-preview.md" || { echo "FAIL: change queue: old.md is not the base copy"; fail=1; }
cmp -s "$dir/diff.patch" "$CHANGE/diff.patch" || { echo "FAIL: change queue: diff.patch is not the PR diff"; fail=1; }
assert_eq "$(jq -c '[.[].id]' "$dir/notes.json")" '["L1","Q1"]' "change queue: notes.json"
assert_eq "$(jq -c '[.ref,.head]' "$dir/pr.json")" '["glw907/cairn-cms#77","head3333"]' "change queue: pr.json"

# A second command for the same PR waits on neither; it is refused while this one is waiting.
out=$(bash "$SCRIPT" change "$CPR" Again 2>&1 >/dev/null); assert_eq "$?" "2" "change queued twice: exit code"
case "$out" in *"already in the waiting item"*) ;; *) echo "FAIL: change queued twice: stderr '$out'"; fail=1 ;; esac

# The change approve names the head its documents were read at; a PR that moved while it waited is refused.
lines=$(wc -l <"$log")
printf 'head4444\n' >"$root/head"
decide '{"decision":"approve","calls":[{"id":"Q1","choice":"Keep it"}]}'
assert_eq "$rc" "1" "change approve after the PR moved: exit code"
case "$(cat "$root/err")" in *"moved from head3333 to head4444"*) ;; *) echo "FAIL: change approve after the PR moved: stderr '$(cat "$root/err")'"; fail=1 ;; esac
assert_eq "$(cat "$root/out")" "" "change approve after the PR moved: no decision printed"
assert_eq "$(wc -l <"$log")" "$lines" "change approve after the PR moved: nothing logged"

printf 'head3333\n' >"$root/head"
queue change "$CPR" "Retarget two links" --notes "$CHANGE/notes.json"
decide '{"decision":"approve","calls":[{"id":"Q1","choice":"Keep it"}]}'
assert_eq "$rc" "0" "change approve: exit code"
assert_eq "$(cat "$root/out")" '{"decision":"approve","pr":"glw907/cairn-cms#77","head":"head3333","calls":[{"id":"Q1","choice":"Keep it"}],"comments":[],"threads":[]}' "change approve: stdout"
assert_eq "$(tail -n 1 "$log" | jq -c '[.kind,.ref,.lane,.verdict,.head,.calls,.initiative,.comments,.replies]')" \
  '["change","glw907/cairn-cms#77","single","approve","head3333",[{"id":"Q1","choice":"Keep it"}],null,0,0]' "change approve: log line"
bash "$SCRIPT" approved --kind page docs/extend/share-a-draft-preview.md head3333; assert_eq "$?" "1" "approved: a change line answers nothing"

# A change's threads name their document, which must be one the change carries; an empty list is a valid one.
share=docs/extend/share-a-draft-preview.md
cthread=$(jq -nc --arg f "$share" '{id: "C1", status: "answered", text: "It is.", quote: "x", anchor: {quote: "x", prefix: "", suffix: "", from: 0, to: 1, commit: "head3333", file: $f}}')
printf '[%s]\n' "$cthread" >"$root/change-replies.json"
jq '.[0].anchor.file = "docs/other.md"' "$root/change-replies.json" >"$root/other-replies.json"
jq 'del(.[0].anchor.file)' "$root/change-replies.json" >"$root/unnamed-replies.json"
refuse "change replies on a file the PR does not change" "has threads on files that" change "$CPR" T --replies "$root/other-replies.json"
refuse "change replies with no file" "needs an anchor file naming a changed document" change "$CPR" T --replies "$root/unnamed-replies.json"
jq '. + .' "$root/change-replies.json" >"$root/dup-replies.json"
refuse "change replies with a duplicate id" 'the id "C1" is used 2 times' change "$CPR" T --replies "$root/dup-replies.json"
refuse "page replies naming a file" "has an anchor file" page "$repo" T "$FILE" --pr "$PR" --replies "$root/change-replies.json" --description "$DESC"

printf 'head5555\n' >"$root/head"
echo '[]' >"$root/no-replies.json"
queue change "$CPR" "Retarget two links" --replies "$root/no-replies.json"
assert_eq "$(cat "$dir/notes.json")" "[]" "change no notes: empty notes.json"
assert_eq "$(cat "$dir/replies.json")" "[]" "change empty replies: replies.json"
comment=$(jq -nc --arg f "$share" '{id: "C2", text: "Why?", anchor: {quote: "x", prefix: "", suffix: "", from: 0, to: 1, commit: "head5555", file: $f}}')
decide "{\"decision\":\"reject\",\"note\":\"Keep the old link.\",\"calls\":[{\"id\":\"Q1\",\"choice\":\"Keep it\"}],\"comments\":[$comment],\"threads\":[{\"id\":\"C1\",\"reply\":\"Thanks.\"}]}"
assert_eq "$rc" "0" "change reject: exit code"
assert_eq "$(cat "$root/out")" \
  "$(jq -cn --argjson c "$comment" '{decision: "reject", note: "Keep the old link.", calls: [{id: "Q1", choice: "Keep it"}], comments: [$c], threads: [{id: "C1", reply: "Thanks."}]}')" \
  "change reject: stdout"
assert_eq "$(tail -n 1 "$log" | jq -c '[.kind,.ref,.verdict,.head,.calls,.comments,.replies]')" '["change","glw907/cairn-cms#77","reject","head5555",null,1,1]' "change reject: log line"
grep -Fxq "approval-queue: queued $(basename "$dir") at http://127.0.0.1:7907/item/$(basename "$dir")" "$root/err" \
  || { echo "FAIL: change: the queued link is not on stderr: $(cat "$root/err")"; fail=1; }
assert_eq "$(jq -e . "$root/out" >/dev/null; echo $?)" "0" "change: stdout holds only the decision JSON"

printf 'head6666\n' >"$root/head"
queue change "$CPR" "Retarget two links" --replies "$root/change-replies.json"
assert_eq "$(jq -c '[.[].anchor.file]' "$dir/replies.json")" "[\"$share\"]" "change replies: replies.json"
decide '{"decision":"reject","note":""}'
assert_eq "$rc" "0" "change reject with replies: exit code"

# A PR with no blueprint or page is a pr-form item, not a change.
cp "$CHANGE/diff.patch" "$root/full.patch"
awk '/^diff --git a\/drafter.toml/{p=1} p' "$root/full.patch" >"$root/code-only.patch"
mkdir -p "$root/codeonly"
cp "$root/code-only.patch" "$root/codeonly/diff.patch"
rm -rf "$state/items"
out=$(CHANGE="$root/codeonly" bash "$SCRIPT" change "$CPR" T 2>&1 >/dev/null); assert_eq "$?" "2" "change with no document: exit code"
case "$out" in *"changes no blueprint or page"*) ;; *) echo "FAIL: change with no document: stderr '$out'"; fail=1 ;; esac
assert_eq "$(compgen -G "$state/items/*/item.json" | wc -l)" "0" "change with no document: nothing queued"

assert_eq "$(stat -c %s "$live_log" 2>/dev/null || echo none)" "$live_before" "the live log is untouched"
[ "$fail" -eq 0 ] && echo "page-change.test.sh: ok"
exit "$fail"
