#!/usr/bin/env bash
# docs.test.sh: prove the docs form of the approval-queue command, its notes forms, and the commands it removed,
# against this worktree's own copy, with curl, xdg-open, setsid, and gh stubbed on PATH (gh serves one synthetic PR
# out of a temp git repo, which is also the review's worktree). Pins the refusals, the queued item, the printed
# decisions, the log lines, the approve refusal, revisions, amends, and `pending` and `collect`. Never starts the
# app, opens a browser, or touches the live queue state.
set -uo pipefail
cd "$(dirname "$0")/.."
SCRIPT="$(pwd)/bin/.local/bin/approval-queue"
PR=glw907/sample#7
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

stubs="$root/stubs"
mkdir -p "$stubs"
printf '#!/usr/bin/env bash\nexit 0\n' >"$stubs/curl"
printf '#!/usr/bin/env bash\necho "$*" >>"$STUB_DIR/open.record"\n' >"$stubs/xdg-open"
printf '#!/usr/bin/env bash\n[ "$1" = "-f" ] && shift\nexec "$@"\n' >"$stubs/setsid"
# gh serves one PR out of the temp repo: the head, the merge base, and the base branch's tip are read from files,
# so a test can move the head after queueing, and the PR's diff is the repo's own diff between the two commits.
# The pr.state file holds OPEN unless a test says MERGED or CLOSED, and gh.down makes every call fail.
cat >"$stubs/gh" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$STUB_DIR/gh.record"
[ -e "$STUB_DIR/gh.down" ] && exit 1
head=$(cat "$STUB_DIR/head")
base=$(cat "$STUB_DIR/base")
case "$1 $2" in
  "api repos/"*/compare/*) printf '%s\n' "$base" ;;
  "pr view")
    case "$7" in
      headRefOid) jq -nc --arg h "$head" '{headRefOid: $h}' ;;
      baseRefOid) jq -nc --arg b "$(cat "$STUB_DIR/tip")" '{baseRefOid: $b}' ;;
      *) jq -nc --arg h "$head" --argjson n "$3" --arg s "$(cat "$STUB_DIR/pr.state")" \
           '{body: "A docs change.\n", headRefOid: $h, number: $n, url: "https://github.com/glw907/sample/pull/\($n)",
             headRefName: "topic", baseRefName: "main", state: $s,
             statusCheckRollup: [{name: "gate", workflowName: "ci", status: "COMPLETED", conclusion: "SUCCESS"}]}' ;;
    esac ;;
  "pr diff") git -C "$REPO" diff "$base" "$head" ;;
  *) echo "gh stub: unexpected $*" >&2; exit 1 ;;
esac
STUB
chmod +x "$stubs"/*
repo="$root/sample"
export STUB_DIR="$root" REPO="$repo" XDG_STATE_HOME="$root/state" PATH="$stubs:$PATH"
export GIT_CONFIG_GLOBAL=/dev/null GIT_AUTHOR_NAME=Test GIT_AUTHOR_EMAIL=test@example.com \
  GIT_COMMITTER_NAME=Test GIT_COMMITTER_EMAIL=test@example.com
state="$XDG_STATE_HOME/approval-queue"
log="$state/decisions.jsonl"
source tests/collect-check.sh


DESC="$root/description.md"
printf 'The guide pages describe the sample tool.\n\nThis review covers four pages. Approving it lets the session merge the pull request.\n' >"$DESC"
printf 'OPEN\n' >"$root/pr.state"
printf 'tip0000\n' >"$root/tip"

# The synthetic repository: main holds two guide pages, an internal page, a code file, and a text file under
# docs/. The topic branch edits a guide page and the internal page, adds a page, renames a page, and edits the
# code and text files.
mkdir -p "$repo/docs/guide" "$repo/docs/internal" "$repo/src"
git -C "$repo" init -q -b main
git -C "$repo" remote add origin https://github.com/glw907/sample.git
printf '# Get started\n\nInstall the tool, then run the setup step. The setup step reads the config.\n' >"$repo/docs/guide/start.md"
printf '# Deploy\n\nPush the build to the host.\nWait for the host to restart.\nOpen the health route.\nRead the status line.\nCheck the logs for errors.\nRoll back on a red status.\n' >"$repo/docs/guide/deploy.md"
printf '# Register\n\nWrite in the second person.\n' >"$repo/docs/internal/register.md"
printf 'console.log("v1");\n' >"$repo/src/app.js"
printf 'plain notes\n' >"$repo/docs/notes.txt"
git -C "$repo" add .
git -C "$repo" commit -q -m "Add the guide"
C0=$(git -C "$repo" rev-parse HEAD)
git -C "$repo" checkout -q -b topic
printf 'Rotate keys with the rotate page.\n' >>"$repo/docs/guide/start.md"
printf '# Rotate keys\n\nRotate the key every 90 days. Store it in the vault.\n' >"$repo/docs/guide/rotate.md"
git -C "$repo" mv docs/guide/deploy.md docs/guide/ship.md
sed -i 's/^# Deploy/# Ship/; s/^Read the status line\./Read the status line. Check the version./' "$repo/docs/guide/ship.md"
printf 'Name the audience first.\n' >>"$repo/docs/internal/register.md"
printf 'console.log("v2");\n' >"$repo/src/app.js"
printf 'more notes\n' >>"$repo/docs/notes.txt"
git -C "$repo" add .
git -C "$repo" commit -q -m "Rotate keys and ship"
C1=$(git -C "$repo" rev-parse HEAD)
printf '%s\n' "$C0" >"$root/base"
printf '%s\n' "$C1" >"$root/head"

NOTES="$root/notes.json"
cat >"$NOTES" <<'JSON'
[
  {"id": "N1", "file": "docs/guide/start.md", "kind": "info",
   "anchor": {"quote": "reads the config", "prefix": "The setup step ", "suffix": "."},
   "title": "Fact check held", "body": ["Checked three claims; all held."]},
  {"id": "N2", "file": "docs/guide/rotate.md", "kind": "decide", "anchor": {"quote": "every 90 days"},
   "title": "Rotation interval", "body": ["The page says 90 days."], "was": "every 30 days", "now": "every 90 days",
   "sides": [{"who": "Fact check", "text": "The config says 90."}, {"who": "Author", "text": "It is 90."}],
   "choices": [{"label": "Apply the fix", "done": "The session applies the proposed wording."},
               {"label": "Keep the text", "done": "The page stands as written."}]}
]
JSON

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
  basename "$dir" >>"$root/ids"
}

# stop_waiter: takes the waiting command down without a decision (its exit trap retires the item).
stop_waiter() {
  kill -TERM "$bgpid" 2>/dev/null; wait "$bgpid" 2>/dev/null; bgpid=""
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
  assert_eq "$(compgen -G "$state/items/*" | wc -l)" "0" "$label: no item directory"
}

# at <commit>: puts the worktree and the PR's head at that commit.
at() {
  git -C "$repo" reset -q --hard "$1"
  printf '%s\n' "$1" >"$root/head"
}

# commit_edit <file> <line> <message>: appends a line to a page in the worktree, commits it, and prints the commit.
commit_edit() {
  printf '%s\n' "$2" >>"$repo/$1"
  git -C "$repo" commit -q -am "$3"
  git -C "$repo" rev-parse HEAD
}

page_reason="The pull request moved after it was queued, so the approval wasn't recorded. The session will queue it again."
args=("$repo" "$PR" "Review the sample docs" --description "$DESC")

# ---- refusals, in the contract's order ----
refuse "no arguments" "usage:" docs
refuse "two arguments" "usage:" docs "$repo" "$PR"
refuse "four arguments" "usage:" docs "$repo" "$PR" T extra --description "$DESC"
refuse "an unknown flag" "usage:" docs "${args[@]}" --bogus x
refuse "a flag with no value" "usage:" docs "${args[@]}" --notes
refuse "a description flag with no value" "usage:" docs "$repo" "$PR" T --description
refuse "a bad ref" "owner/repo#n" docs "$repo" glw907/sample "T" --description "$DESC"
refuse "a ref with no number" "owner/repo#n" docs "$repo" "glw907/sample#" "T" --description "$DESC"
refuse "no description" "needs --description <file>" docs "$repo" "$PR" T
refuse "a description that is not a file" "no description file at $root/none.md" docs "$repo" "$PR" T --description "$root/none.md"
printf 'Only one paragraph.\n' >"$root/one.md"
refuse "a one-paragraph description" "a background paragraph, then one or two summary paragraphs" docs "$repo" "$PR" T --description "$root/one.md"
printf 'One.\n\nTwo.\n\nThree.\n\nFour.\n' >"$root/four.md"
refuse "a four-paragraph description" "the description has 4 paragraphs" docs "$repo" "$PR" T --description "$root/four.md"
refuse "a title ending in a period" "drop its closing punctuation" docs "$repo" "$PR" "A title." --description "$DESC"
refuse "an 81-character title" "the title runs 81 characters; keep it to 80" docs "$repo" "$PR" "$(printf 'x%.0s' $(seq 81))" --description "$DESC"
refuse "a worktree that does not exist" "is not a git worktree" docs "$root/nowhere" "$PR" T --description "$DESC"
refuse "a directory inside a worktree" "is inside a worktree" docs "$repo/docs" "$PR" T --description "$DESC"
refuse "a PR in another repository" "is not in" docs "$repo" glw907/other#7 T --description "$DESC"
git -C "$repo" remote rename origin keep >/dev/null
refuse "a worktree with no origin" "has no origin remote" docs "${args[@]}"
git -C "$repo" remote rename keep origin >/dev/null
printf 'edit\n' >>"$repo/docs/guide/start.md"
refuse "a tracked change" "commit or stash first" docs "${args[@]}"
git -C "$repo" checkout -q -- docs/guide/start.md
printf 'untracked\n' >"$repo/docs/guide/scratch.md"
rm -rf "$state/items"
bash "$SCRIPT" docs "${args[@]}" --notes "$root/none.json" >/dev/null 2>"$root/err"
assert_eq "$?" "2" "an untracked file is not a refusal: the run reaches the notes check"
case "$(cat "$root/err")" in *"no notes file at"*) ;; *) echo "FAIL: an untracked file: stderr '$(cat "$root/err")'"; fail=1 ;; esac
rm -f "$repo/docs/guide/scratch.md"
printf '%s\n' "$C0" >"$root/head"
refuse "a worktree not at the PR's head" "push first, or pull the PR head" docs "${args[@]}"
printf '%s\n' "$C1" >"$root/head"
printf 'MERGED\n' >"$root/pr.state"
refuse "a merged PR" "is MERGED" docs "${args[@]}"
printf 'CLOSED\n' >"$root/pr.state"
refuse "a closed PR" "is CLOSED" docs "${args[@]}"
printf 'OPEN\n' >"$root/pr.state"

# A PR that changes only code and a text file, and one that only deletes a page, have no page to review.
git -C "$repo" worktree add -q -b codeonly "$root/code" "$C0"
printf 'console.log("v3");\n' >"$root/code/src/app.js"
printf 'more notes\n' >>"$root/code/docs/notes.txt"
git -C "$root/code" commit -q -am "Change the code"
printf '%s\n' "$(git -C "$root/code" rev-parse HEAD)" >"$root/head"
refuse "a PR with no page" "queue it with the pr form" docs "$root/code" "$PR" T --description "$DESC"
git -C "$repo" worktree add -q -b deleteonly "$root/gone" "$C0"
git -C "$root/gone" rm -q docs/guide/deploy.md
git -C "$root/gone" commit -q -m "Drop the deploy page"
printf '%s\n' "$(git -C "$root/gone" rev-parse HEAD)" >"$root/head"
refuse "a PR that only deletes a page" "changes no docs/**/*.md page that exists at its head" docs "$root/gone" "$PR" T --description "$DESC"
printf '%s\n' "$C1" >"$root/head"

# Notes and replies.
refuse "notes that are missing" "no notes file at $root/none.json" docs "${args[@]}" --notes "$root/none.json"
printf 'not json' >"$root/bad.json"
refuse "notes that are not JSON" "is not JSON" docs "${args[@]}" --notes "$root/bad.json"
printf '{"id":"A"}' >"$root/obj.json"
refuse "notes that are not an array" "a JSON array of notes" docs "${args[@]}" --notes "$root/obj.json"
jq 'del(.[0].file)' "$NOTES" >"$root/no-file.json"
refuse "a note with no file" "needs a file string" docs "${args[@]}" --notes "$root/no-file.json"
jq '.[0].anchor = "reads the config"' "$NOTES" >"$root/string-anchor.json"
refuse "a note with a string anchor" "needs an anchor object quoting the text" docs "${args[@]}" --notes "$root/string-anchor.json"
jq '.[0].anchor.name = "x"' "$NOTES" >"$root/anchor-key.json"
refuse "a note anchor with another key" "has an unknown anchor key name" docs "${args[@]}" --notes "$root/anchor-key.json"
jq '.[0].anchor.quote = ""' "$NOTES" >"$root/empty-quote.json"
refuse "a note with an empty quote" "an anchor quote that is a non-empty string" docs "${args[@]}" --notes "$root/empty-quote.json"
jq '.[1].choices[0].text = "x"' "$NOTES" >"$root/choice-text.json"
refuse "a choice with text" "needs choices as an array of {label, done} strings" docs "${args[@]}" --notes "$root/choice-text.json"
jq '.[0].waived = []' "$NOTES" >"$root/waived.json"
refuse "a note with waived" "has an unknown field waived" docs "${args[@]}" --notes "$root/waived.json"
jq 'del(.[1].choices)' "$NOTES" >"$root/no-choices.json"
refuse "a decide note with no choices" "could never be answered" docs "${args[@]}" --notes "$root/no-choices.json"
jq '.[1].id = "N1"' "$NOTES" >"$root/dup-id.json"
refuse "a duplicate note id" 'the id "N1" is used 2 times' docs "${args[@]}" --notes "$root/dup-id.json"
jq '.[0].file = "src/app.js"' "$NOTES" >"$root/unchanged-file.json"
refuse "a note on a file that is no changed page" "names files that are not changed docs pages" docs "${args[@]}" --notes "$root/unchanged-file.json"
jq '.[0].file = "docs/guide/deploy.md"' "$NOTES" >"$root/old-path.json"
refuse "a note on a renamed page's old path" "docs/guide/deploy.md" docs "${args[@]}" --notes "$root/old-path.json"
jq '.[0].anchor = {quote: "setup step"}' "$NOTES" >"$root/ambiguous.json"
refuse "a quote that matches twice" 'note N1 (docs/guide/start.md): the quote "setup step" occurs 2 times' docs "${args[@]}" --notes "$root/ambiguous.json"
jq '.[0].anchor = {quote: "setup step", prefix: "The ", suffix: " reads"}' "$NOTES" >"$root/context.json"
rm -rf "$state/items"
bash "$SCRIPT" notes --check "$repo" "$root/context.json" >/dev/null 2>&1
assert_eq "$?" "0" "a quote made unique by its context is not refused"
jq '.[0].anchor = {quote: "matches nowhere"}' "$NOTES" >"$root/nowhere.json"
bash "$SCRIPT" notes --check "$repo" "$root/nowhere.json" >/dev/null 2>&1
assert_eq "$?" "0" "a quote that matches nowhere is not refused"
REPLY=$(jq -nc '{id: "C1", status: "done", text: "Tightened.", quote: "setup step",
  anchor: {quote: "setup step", prefix: "run the ", suffix: ".", from: 20, to: 30, commit: "abc", file: "docs/guide/start.md"}}')
printf '[%s]\n' "$REPLY" >"$root/replies.json"
jq '.[0].anchor.file = "src/app.js"' "$root/replies.json" >"$root/reply-unchanged.json"
refuse "a thread on a file that is no changed page" "names files that are not changed docs pages" docs "${args[@]}" --replies "$root/reply-unchanged.json"
jq 'del(.[0].anchor.file)' "$root/replies.json" >"$root/reply-no-file.json"
refuse "a thread with no anchor file" "needs an anchor file naming a changed page" docs "${args[@]}" --replies "$root/reply-no-file.json"
jq '.[0].status = "fixed"' "$root/replies.json" >"$root/reply-status.json"
refuse "a thread with another status" "status is done, kept, or answered" docs "${args[@]}" --replies "$root/reply-status.json"
printf 'not json' >"$root/reply-bad.json"
refuse "replies that are not JSON" "is not JSON" docs "${args[@]}" --replies "$root/reply-bad.json"

# gh cannot read the PR: exit 1 before anything is queued.
touch "$root/gh.down"
rm -rf "$state/items"
bash "$SCRIPT" docs "${args[@]}" >/dev/null 2>&1; assert_eq "$?" "1" "gh down at queue time: exit code"
assert_eq "$(compgen -G "$state/items/*" | wc -l)" "0" "gh down at queue time: no item directory"
rm -f "$root/gh.down"

# A PR already in a waiting item is refused: a docs item, a pr item, or a packet part holds it.
queue docs "${args[@]}"
out=$(bash "$SCRIPT" docs "${args[@]}" 2>&1 >/dev/null); assert_eq "$?" "2" "queued twice: exit code"
case "$out" in *"already in the waiting item $(basename "$dir")"*) ;; *) echo "FAIL: queued twice: stderr '$out'"; fail=1 ;; esac
stop_waiter
mkdir -p "$state/items/held"
jq -nc '{id: "held", kind: "pr", repo: "glw907/sample", number: 7}' >"$state/items/held/item.json"
out=$(bash "$SCRIPT" docs "${args[@]}" 2>&1 >/dev/null); assert_eq "$?" "2" "a waiting pr item: exit code"
case "$out" in *"already in the waiting item held"*) ;; *) echo "FAIL: a waiting pr item: stderr '$out'"; fail=1 ;; esac
jq -nc --arg r "$PR" '{id: "held", kind: "packet", refs: [$r]}' >"$state/items/held/item.json"
out=$(bash "$SCRIPT" docs "${args[@]}" 2>&1 >/dev/null); assert_eq "$?" "2" "a waiting packet part: exit code"
case "$out" in *"already in the waiting item held"*) ;; *) echo "FAIL: a waiting packet part: stderr '$out'"; fail=1 ;; esac
touch "$state/items/held/decision.json"
queue docs "${args[@]}"
stop_waiter

# ---- the queued item ----
rm -f "$log"
queue docs "${args[@]}" --notes "$NOTES"
docs_id=$(basename "$dir")
grep -Fxq "approval-queue: queued $docs_id at http://127.0.0.1:7907/item/$docs_id" "$root/err" \
  || { echo "FAIL: queue: the queued link is not on stderr: $(cat "$root/err")"; fail=1; }
assert_eq "$(jq -c 'keys_unsorted' "$dir/item.json")" \
  '["id","kind","repo","number","title","headline","created","worktree","head","base","pid","pidStart"]' "queue: item.json keys"
assert_eq "$(jq -c '[.kind,.repo,.number,.title,.headline,.head,.base]' "$dir/item.json")" \
  "[\"docs\",\"glw907/sample\",7,\"Review the sample docs\",\"Review the sample docs\",\"$C1\",\"$C0\"]" "queue: item.json"
assert_eq "$(jq -r '.worktree' "$dir/item.json")" "$(cd "$repo" && pwd -P)" "queue: item.json worktree"
assert_eq "$(jq -r '[(.pid | type), (.pidStart | type), (.pid as $p | .id | endswith("-\($p)")), (.created | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$"))] | join(" ")' "$dir/item.json")" \
  "number number true true" "queue: pid, pidStart, and created"
assert_eq "$(jq -c . "$dir/pages.json")" \
  '[{"path":"docs/guide/rotate.md"},{"path":"docs/guide/ship.md","from":"docs/guide/deploy.md"},{"path":"docs/guide/start.md"},{"path":"docs/internal/register.md"}]' "queue: pages.json"
assert_eq "$(wc -c <"$dir/pages/0/base.md" | tr -d ' ')" "0" "queue: a new page has an empty base"
cmp -s "$dir/pages/0/queued.md" <(git -C "$repo" show "$C1:docs/guide/rotate.md") || { echo "FAIL: queue: pages/0/queued.md is not the head text"; fail=1; }
cmp -s "$dir/pages/1/base.md" <(git -C "$repo" show "$C0:docs/guide/deploy.md") || { echo "FAIL: queue: a renamed page's base is not its old text"; fail=1; }
cmp -s "$dir/pages/1/queued.md" <(git -C "$repo" show "$C1:docs/guide/ship.md") || { echo "FAIL: queue: pages/1/queued.md is not the head text"; fail=1; }
cmp -s "$dir/pages/2/base.md" <(git -C "$repo" show "$C0:docs/guide/start.md") || { echo "FAIL: queue: pages/2/base.md is not the merge-base text"; fail=1; }
cmp -s "$dir/pages/3/queued.md" <(git -C "$repo" show "$C1:docs/internal/register.md") || { echo "FAIL: queue: an internal page is not read"; fail=1; }
assert_eq "$(ls "$dir/pages")" "$(printf '0\n1\n2\n3')" "queue: one directory per page"
cmp -s "$dir/diff.patch" <(git -C "$repo" diff "$C0" "$C1") || { echo "FAIL: queue: diff.patch is not the whole PR diff"; fail=1; }
grep -q '^diff --git a/src/app.js' "$dir/diff.patch" || { echo "FAIL: queue: diff.patch lacks the code file"; fail=1; }
assert_eq "$(cat "$dir/body.md")" "A docs change." "queue: body.md"
assert_eq "$(jq -c '[.ref,.head,.state,.headRefName]' "$dir/pr.json")" "[\"$PR\",\"$C1\",\"OPEN\",\"topic\"]" "queue: pr.json"
cmp -s "$dir/description.md" "$DESC" || { echo "FAIL: queue: description.md is not the description file"; fail=1; }
assert_eq "$(jq -c '[.[].id]' "$dir/notes.json")" '["N1","N2"]' "queue: notes.json"
for f in replies.json since.patch since.json approved.patch approved.json refused.json; do
  [ ! -e "$dir/$f" ] || { echo "FAIL: queue: a first review has $f"; fail=1; }
done
assert_eq "$(jq -c '[has("revises"), has("amends")]' "$dir/item.json")" "[false,false]" "queue: a first review is no revision or amend"
[ ! -e "$dir/item.json.tmp" ] || { echo "FAIL: queue: item.json.tmp was left"; fail=1; }

# Withdraw covers a docs review.
out=$(bash "$SCRIPT" withdraw "$docs_id" 2>&1); assert_eq "$?" "0" "withdraw of a docs review: exit code"
assert_eq "$out" "withdrew $docs_id" "withdraw of a docs review: stdout"
wait "$bgpid" 2>/dev/null; bgpid=""

# ---- an approve at an unmoved head, after Geoff's edit commit ----
queue docs "${args[@]}" --notes "$NOTES"
E=$(commit_edit docs/guide/start.md "Edited in review." "Edit docs/guide/start.md in review")
decide "{\"decision\":\"approve\",\"commit\":\"$E\",\"calls\":[{\"id\":\"N2\",\"choice\":\"Apply the fix\"}],\"comments\":[],\"threads\":[]}"
assert_eq "$rc" "0" "approve: exit code"
assert_eq "$(cat "$root/out")" \
  "{\"decision\":\"approve\",\"pr\":\"$PR\",\"head\":\"$C1\",\"commit\":\"$E\",\"calls\":[{\"id\":\"N2\",\"choice\":\"Apply the fix\"}],\"comments\":[],\"threads\":[]}" "approve: stdout"
assert_eq "$(jq -e . "$root/out" >/dev/null; echo $?)" "0" "approve: stdout holds only the decision JSON"
assert_eq "$(wc -l <"$log")" "1" "approve: one log line"
assert_eq "$(jq -c 'keys_unsorted' "$log")" \
  '["time","packet","initiative","ref","kind","lane","verdict","head","commit","calls","comments","replies"]' "approve: log keys"
assert_eq "$(jq -c '[.packet,.initiative,.ref,.kind,.lane,.verdict,.head,.commit,.calls,.comments,.replies,(.time | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$"))]' "$log")" \
  "[\"$(basename "$dir")\",null,\"$PR\",\"docs\",\"single\",\"approve\",\"$C1\",\"$E\",[{\"id\":\"N2\",\"choice\":\"Apply the fix\"}],0,0,true]" "approve: log line"
[ ! -e "$dir/refused.json" ] || { echo "FAIL: approve: refused.json was left"; fail=1; }
collect_check approve "$dir"

# An approve with no edit names the head as its commit, and counts comments and replies.
at "$C1"
queue docs "${args[@]}"
comment=$(jq -nc --arg c "$C1" '{id: "C1", text: "Why?", anchor: {quote: "setup step", prefix: "run the ", suffix: ".", from: 20, to: 30, commit: $c, file: "docs/guide/start.md"}}')
decide "{\"decision\":\"approve\",\"commit\":\"$C1\",\"calls\":[],\"comments\":[$comment],\"threads\":[{\"id\":\"C0\",\"reply\":\"Thanks.\"}]}"
assert_eq "$(jq -c '[.commit == .head, .comments, .threads]' "$root/out")" "[true,[$comment],[{\"id\":\"C0\",\"reply\":\"Thanks.\"}]]" "approve with no edit: commit equals head"
assert_eq "$(tail -n 1 "$log" | jq -c '[.comments,.replies]')" "[1,1]" "approve with comments: log counts"

# ---- a moved head refuses the approve ----
rm -f "$log"
at "$C1"
queue docs "${args[@]}"
refused_dir=$dir
printf 'moved0000\n' >"$root/head"
decide "{\"decision\":\"approve\",\"commit\":\"$C1\",\"calls\":[],\"comments\":[],\"threads\":[]}"
assert_eq "$rc" "1" "approve after the PR moved: exit code"
case "$(cat "$root/err")" in *"$PR moved from $C1 to moved0000"*) ;; *) echo "FAIL: approve after the PR moved: stderr '$(cat "$root/err")'"; fail=1 ;; esac
assert_eq "$(cat "$root/out")" "" "approve after the PR moved: no decision printed"
[ ! -e "$log" ] || { echo "FAIL: approve after the PR moved: something was logged"; fail=1; }
assert_eq "$(jq -r '.reason' "$dir/refused.json")" "$page_reason" "approve after the PR moved: refused.json reason"
assert_eq "$(jq -r '.at | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$")' "$dir/refused.json")" "true" "approve after the PR moved: refused.json time"
[ ! -e "$dir/refused.json.tmp" ] || { echo "FAIL: refusal: refused.json.tmp was left"; fail=1; }
[ -e "$dir/decision.json" ] || { echo "FAIL: refusal: decision.json was removed"; fail=1; }

# collect runs the same check: refused while the head differs, and once it matches again it passes, logs, and
# clears refused.json.
bash "$SCRIPT" collect "$(basename "$refused_dir")" >"$root/c.out" 2>"$root/c.err"
assert_eq "$?" "1" "collect after the PR moved: exit code"
assert_eq "$(wc -c <"$root/c.out" | tr -d ' ')" "0" "collect after the PR moved: no decision printed"
[ ! -e "$log" ] || { echo "FAIL: collect after the PR moved: something was logged"; fail=1; }
[ -e "$refused_dir/refused.json" ] || { echo "FAIL: collect after the PR moved: no refused.json"; fail=1; }
printf '%s\n' "$C1" >"$root/head"
bash "$SCRIPT" collect "$(basename "$refused_dir")" >"$root/c.out" 2>"$root/c.err"
assert_eq "$?" "0" "collect once the head matches: exit code"
assert_eq "$(jq -r '.head' "$root/c.out")" "$C1" "collect once the head matches: the head read"
assert_eq "$(wc -l <"$log")" "1" "collect once the head matches: logged once"
[ ! -e "$refused_dir/refused.json" ] || { echo "FAIL: collect once the head matches: refused.json was left"; fail=1; }
rm -f "$log"

# ---- gh cannot read the head at approval: exit 1, nothing logged, no refused.json ----
at "$C1"
queue docs "${args[@]}"
touch "$root/gh.down"
decide "{\"decision\":\"approve\",\"commit\":\"$C1\",\"calls\":[],\"comments\":[],\"threads\":[]}"
assert_eq "$rc" "1" "approve with gh down: exit code"
case "$(cat "$root/err")" in *"could not read the head of $PR"*) ;; *) echo "FAIL: approve with gh down: stderr '$(cat "$root/err")'"; fail=1 ;; esac
[ ! -e "$log" ] || { echo "FAIL: approve with gh down: something was logged"; fail=1; }
[ ! -e "$dir/refused.json" ] || { echo "FAIL: approve with gh down: refused.json was written"; fail=1; }
rm -f "$root/gh.down"

# ---- a send-back, then a resend: Revision 2 with the fix since ----
rm -f "$log"
at "$C1"
queue docs "${args[@]}"
round1=$(basename "$dir")
E=$(commit_edit docs/guide/start.md "Edited in review." "Edit docs/guide/start.md in review")
comment=$(jq -nc --arg c "$E" '{id: "C1", text: "Tighten this.", anchor: {quote: "setup step", prefix: "run the ", suffix: ".", from: 20, to: 30, commit: $c, file: "docs/guide/start.md"}}')
decide "{\"decision\":\"reject\",\"note\":\"Tighten the setup step.\",\"commit\":\"$E\",\"calls\":[{\"id\":\"N2\",\"choice\":\"Keep the text\"}],\"comments\":[$comment],\"threads\":[]}"
assert_eq "$rc" "0" "send-back: exit code"
assert_eq "$(cat "$root/out")" \
  "$(jq -cn --arg pr "$PR" --arg h "$C1" --arg e "$E" --argjson c "$comment" \
    '{decision: "reject", note: "Tighten the setup step.", pr: $pr, head: $h, commit: $e, calls: [{id: "N2", choice: "Keep the text"}], comments: [$c], threads: []}')" "send-back: stdout"
assert_eq "$(jq -c '[.kind,.ref,.lane,.verdict,.head,.commit,.calls,.comments,.replies]' "$log")" \
  "[\"docs\",\"$PR\",\"single\",\"reject\",\"$C1\",\"$E\",[{\"id\":\"N2\",\"choice\":\"Keep the text\"}],1,0]" "send-back: log line"
collect_check "send-back" "$dir"
# Geoff's edit reaches the PR, then the session fixes forward.
printf '%s\n' "$E" >"$root/head"
F=$(commit_edit docs/guide/start.md "Fixed after the send-back." "Tighten the setup step")
printf '%s\n' "$F" >"$root/head"
printf '[%s]\n' "$(jq -c --arg c "$E" '.anchor.commit = $c' <<<"$REPLY")" >"$root/replies.json"
queue docs "${args[@]}" --replies "$root/replies.json"
assert_eq "$(jq -c '.revises' "$dir/item.json")" "{\"item\":\"$round1\",\"revision\":2,\"commit\":\"$E\"}" "resend: revises"
assert_eq "$(jq -c 'keys_unsorted | last' "$dir/item.json")" '"revises"' "resend: revises follows the contract's keys"
cmp -s "$dir/since.patch" <(git -C "$repo" diff "$E" "$F") || { echo "FAIL: resend: since.patch is not the fix alone"; fail=1; }
grep -q '^+Fixed after the send-back\.' "$dir/since.patch" || { echo "FAIL: resend: since.patch lacks the fix"; fail=1; }
! grep -q '^[-+]Edited in review' "$dir/since.patch" || { echo "FAIL: resend: since.patch holds the edit commit"; fail=1; }
[ ! -e "$dir/since.json" ] || { echo "FAIL: resend: since.json beside since.patch"; fail=1; }
assert_eq "$(jq -c '.[0].id' "$dir/replies.json")" '"C1"' "resend: replies.json"
assert_eq "$(jq -c 'has("amends")' "$dir/item.json")" "false" "resend: a send-back is no amend"
decide "{\"decision\":\"reject\",\"note\":\"Once more.\",\"commit\":\"$F\",\"calls\":[],\"comments\":[],\"threads\":[]}"
assert_eq "$rc" "0" "second send-back: exit code"
round2=$(basename "$dir")

# A rebased branch: the send-back's commit is no ancestor of the new head, so the since diff is gone.
at "$C0"
R=$(commit_edit docs/guide/start.md "Rewritten after a rebase." "Rewrite the start page")
printf '%s\n' "$R" >"$root/head"
queue docs "${args[@]}"
assert_eq "$(jq -c '.revises' "$dir/item.json")" "{\"item\":\"$round2\",\"revision\":3,\"commit\":\"$F\"}" "rebased resend: revises"
assert_eq "$(cat "$dir/since.json")" '{"gone": true}' "rebased resend: since.json"
[ ! -e "$dir/since.patch" ] || { echo "FAIL: rebased resend: since.patch was written"; fail=1; }
stop_waiter

# ---- an amend: a queue after a logged approve ----
rm -f "$log"
at "$C1"
queue docs "${args[@]}"
E=$(commit_edit docs/guide/start.md "Edited in review." "Edit docs/guide/start.md in review")
decide "{\"decision\":\"approve\",\"commit\":\"$E\",\"calls\":[],\"comments\":[],\"threads\":[]}"
assert_eq "$rc" "0" "amend setup approve: exit code"
printf '%s\n' "$E" >"$root/head"
F=$(commit_edit docs/guide/start.md "Fixed after the approve." "Fix the start page after the approve")
printf '%s\n' "$F" >"$root/head"
queue docs "${args[@]}"
assert_eq "$(jq -c '.amends' "$dir/item.json")" "{\"commit\":\"$E\"}" "amend: item.json"
assert_eq "$(jq -c 'has("revises")' "$dir/item.json")" "false" "amend: an amend is no revision"
cmp -s "$dir/approved.patch" <(git -C "$repo" diff "$E" "$F") || { echo "FAIL: amend: approved.patch is not the post-approve fix alone"; fail=1; }
grep -q '^+Fixed after the approve\.' "$dir/approved.patch" || { echo "FAIL: amend: approved.patch lacks the fix"; fail=1; }
! grep -q '^[-+]Edited in review' "$dir/approved.patch" || { echo "FAIL: amend: approved.patch holds the approved edit"; fail=1; }
[ ! -e "$dir/approved.json" ] || { echo "FAIL: amend: approved.json beside approved.patch"; fail=1; }
[ ! -e "$dir/since.patch" ] || { echo "FAIL: amend: since.patch was written"; fail=1; }
stop_waiter

# An amend whose approved commit is no ancestor of the head (a rebase after the approve) has no diff to show.
rm -f "$log"
at "$C1"
queue docs "${args[@]}"
decide "{\"decision\":\"approve\",\"commit\":\"$C1\",\"calls\":[],\"comments\":[],\"threads\":[]}"
at "$C0"
R=$(commit_edit docs/guide/start.md "Rewritten after a rebase." "Rewrite the start page")
printf '%s\n' "$R" >"$root/head"
queue docs "${args[@]}"
assert_eq "$(jq -c '.amends' "$dir/item.json")" "{\"commit\":\"$C1\"}" "rebased amend: item.json"
assert_eq "$(cat "$dir/approved.json")" '{"gone": true}' "rebased amend: approved.json"
[ ! -e "$dir/approved.patch" ] || { echo "FAIL: rebased amend: approved.patch was written"; fail=1; }
stop_waiter

# Another PR's approve is no amend of this one, and neither is an approve of another kind.
rm -f "$log"
jq -nc '{kind: "docs", ref: "glw907/sample#8", verdict: "approve", commit: "abc"}' >>"$log"
jq -nc --arg r "$PR" '{kind: "pr", ref: $r, verdict: "approve", head: "abc"}' >>"$log"
at "$C1"
queue docs "${args[@]}"
assert_eq "$(jq -c '[has("amends"), has("revises")]' "$dir/item.json")" "[false,false]" "an approve of another PR or kind: no amend"
stop_waiter

# ---- notes --check ----
rm -f "$log"
at "$C1"
out=$(bash "$SCRIPT" notes --check "$repo" "$NOTES" 2>&1); assert_eq "$?" "0" "notes --check: a good file, exit code"
assert_eq "$out" "" "notes --check: a good file prints nothing"
out=$(bash "$SCRIPT" notes --check "$repo" "$root/no-file.json" 2>&1); assert_eq "$?" "2" "notes --check: a bad shape, exit code"
case "$out" in *"needs a file string"*) ;; *) echo "FAIL: notes --check: bad shape: '$out'"; fail=1 ;; esac
out=$(bash "$SCRIPT" notes --check "$repo" "$root/ambiguous.json" 2>&1); assert_eq "$?" "2" "notes --check: an ambiguous quote, exit code"
case "$out" in *'the quote "setup step" occurs 2 times'*) ;; *) echo "FAIL: notes --check: ambiguous quote: '$out'"; fail=1 ;; esac
jq '.[0].file = "docs/guide/missing.md"' "$NOTES" >"$root/missing-path.json"
out=$(bash "$SCRIPT" notes --check "$repo" "$root/missing-path.json" 2>&1); assert_eq "$?" "2" "notes --check: a missing path, exit code"
case "$out" in *"docs/guide/missing.md is not in"*) ;; *) echo "FAIL: notes --check: missing path: '$out'"; fail=1 ;; esac
out=$(bash "$SCRIPT" notes --check "$root/nowhere" "$NOTES" 2>&1); assert_eq "$?" "2" "notes --check: not a worktree, exit code"
out=$(bash "$SCRIPT" notes --check "$repo" "$root/none.json" 2>&1); assert_eq "$?" "2" "notes --check: no notes file, exit code"
bash "$SCRIPT" notes --check "$repo" >/dev/null 2>&1; assert_eq "$?" "2" "notes --check: usage"
# The copy read is the worktree's HEAD, not the files on disk.
printf 'The setup step runs twice.\n' >>"$repo/docs/guide/start.md"
bash "$SCRIPT" notes --check "$repo" "$root/ambiguous.json" >/dev/null 2>&1; assert_eq "$?" "2" "notes --check: reads HEAD, not the disk (ambiguous at HEAD)"
git -C "$repo" checkout -q -- docs/guide/start.md

# ---- notes <id> ----
queue docs "${args[@]}"
nid=$(basename "$dir")
cp "$dir/notes.json" "$root/notes.before"
jq '.[0].title = "A new title"' "$NOTES" >"$root/new-notes.json"
out=$(bash "$SCRIPT" notes "$nid" "$root/new-notes.json" 2>/dev/null); assert_eq "$?" "0" "notes <id>: exit code"
assert_eq "$out" "replaced the notes of $nid at http://127.0.0.1:7907/item/$nid" "notes <id>: stdout"
assert_eq "$(jq -c . "$dir/notes.json")" "$(jq -c . "$root/new-notes.json")" "notes <id>: notes.json holds the new notes"
cp "$dir/notes.json" "$root/notes.before"
notes_refused() {
  local label=$1 want=$2 out
  shift 2
  out=$(bash "$SCRIPT" notes "$@" 2>&1 >/dev/null); assert_eq "$?" "2" "notes <id> $label: exit code"
  case "$out" in *"$want"*) ;; *) echo "FAIL: notes <id> $label: stderr '$out' lacks '$want'"; fail=1 ;; esac
  cmp -s "$dir/notes.json" "$root/notes.before" || { echo "FAIL: notes <id> $label: the refusal changed notes.json"; fail=1; }
}
notes_refused "a bad id" "is not an item id" nonsense "$NOTES"
notes_refused "an unknown id" "no item 20200101T000000-1 is queued" 20200101T000000-1 "$NOTES"
notes_refused "a bad shape" "needs a file string" "$nid" "$root/no-file.json"
notes_refused "a file the PR does not change" "names files that are not changed docs pages" "$nid" "$root/unchanged-file.json"
notes_refused "an ambiguous quote" 'the quote "setup step" occurs 2 times' "$nid" "$root/ambiguous.json"
notes_refused "a missing file" "no notes file at" "$nid" "$root/none.json"
bash "$SCRIPT" notes "$nid" >/dev/null 2>&1; assert_eq "$?" "2" "notes <id>: usage"
# The screen shows the worktree's HEAD copy: a quote ambiguous there is refused, though the queued copy is clean.
E=$(commit_edit docs/guide/start.md "The setup step runs twice." "Edit docs/guide/start.md in review")
notes_refused "a quote ambiguous at HEAD" 'the quote "setup step" occurs 3 times' "$nid" "$root/ambiguous.json"
bash "$SCRIPT" notes "$nid" "$root/context.json" >/dev/null 2>&1; assert_eq "$?" "0" "notes <id>: a quote made unique by its context"
cp "$dir/notes.json" "$root/notes.before"
# With the worktree gone, the copy queued is the one read.
jq '.worktree = "/nonexistent/sample"' "$dir/item.json" >"$dir/item.json.edit" && mv "$dir/item.json.edit" "$dir/item.json"
notes_refused "a quote ambiguous in the copy queued" 'the quote "setup step" occurs 2 times' "$nid" "$root/ambiguous.json"
# A kind other than docs takes no notes; a decided item cannot be replaced.
mkdir -p "$state/items/20200101T000000-2" "$state/items/20200101T000000-3"
jq -nc '{id: "20200101T000000-2", kind: "pr", repo: "glw907/sample", number: 9}' >"$state/items/20200101T000000-2/item.json"
out=$(bash "$SCRIPT" notes 20200101T000000-2 "$NOTES" 2>&1 >/dev/null); assert_eq "$?" "2" "notes <id>: a pr item, exit code"
case "$out" in *"is a pr item, which takes no notes"*) ;; *) echo "FAIL: notes <id>: a pr item: '$out'"; fail=1 ;; esac
jq -nc '{id: "20200101T000000-3", kind: "docs", repo: "glw907/sample", number: 9}' >"$state/items/20200101T000000-3/item.json"
touch "$state/items/20200101T000000-3/decision.json"
out=$(bash "$SCRIPT" notes 20200101T000000-3 "$NOTES" 2>&1 >/dev/null); assert_eq "$?" "2" "notes <id>: a decided item, exit code"
case "$out" in *"is decided"*) ;; *) echo "FAIL: notes <id>: a decided item: '$out'"; fail=1 ;; esac
stop_waiter

# ---- pending and collect skip the kinds this queue no longer reads ----
rm -rf "$state/items"
rm -f "$log"
mkdir -p "$state/items/20200101T000001-1" "$state/items/20200101T000002-1" "$state/items/20200101T000003-1"
jq -nc '{id: "20200101T000001-1", kind: "docs", repo: "glw907/sample", number: 7, title: "An orphaned docs review", pid: 999999, pidStart: 1}' >"$state/items/20200101T000001-1/item.json"
jq -nc '{id: "20200101T000002-1", kind: "page", repo: "sample", title: "A decided page", file: "docs/x.md", pid: 999999, pidStart: 1}' >"$state/items/20200101T000002-1/item.json"
jq -nc '{id: "20200101T000003-1", kind: "docs", repo: "glw907/sample", number: 8, title: "A logged docs review", pid: 999999, pidStart: 1}' >"$state/items/20200101T000003-1/item.json"
for i in 20200101T000001-1 20200101T000002-1 20200101T000003-1; do
  jq -nc '{decision: "approve", commit: "abc", calls: [], comments: [], threads: []}' >"$state/items/$i/decision.json"
done
jq -nc '{packet: "20200101T000003-1", kind: "docs", ref: "glw907/sample#8", verdict: "approve"}' >"$log"
out=$(bash "$SCRIPT" pending)
assert_eq "$out" "$(printf '20200101T000001-1\tdocs\tapprove\tAn orphaned docs review')" "pending: lists the orphaned docs decision and skips a decided page item"
out=$(bash "$SCRIPT" collect 20200101T000002-1 2>&1 >/dev/null); assert_eq "$?" "2" "collect of a page item: exit code"
case "$out" in *"is a page item, which this queue no longer reads"*) ;; *) echo "FAIL: collect of a page item: '$out'"; fail=1 ;; esac
rm -rf "$state/items"

# ---- the removed commands ----
for cmd in blueprint page change anchors approved; do
  out=$(bash "$SCRIPT" $cmd x y z 2>&1 >/dev/null); assert_eq "$?" "2" "$cmd: exit code"
  case "$out" in *"usage:"*) ;; *) echo "FAIL: $cmd: no usage in '$out'"; fail=1 ;; esac
done
out=$(bash "$SCRIPT" 2>&1 >/dev/null)
case "$out" in *"docs <worktree> <owner/repo#n>"*) ;; *) echo "FAIL: usage: the docs form is not listed"; fail=1 ;; esac
case "$out" in *blueprint* | *page* | *change* | *anchors* | *approved*) echo "FAIL: usage: names a removed command: '$out'"; fail=1 ;; esac

live_leak
[ "$fail" -eq 0 ] && echo "docs.test.sh: ok"
exit "$fail"
