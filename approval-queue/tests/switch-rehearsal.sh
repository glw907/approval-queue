#!/usr/bin/env bash
# switch-rehearsal.sh <scratch> <repo> <old> <new>: runs the switch and its undo once each against
# a copy of the state directory, printed as key=value lines. It stands outside the gate because it
# needs a copy of a real state directory at <scratch>/state/approval-queue. `npm run rehearse`
# starts it under `unshare -rnpf --mount-proc --kill-child`, so port 7907 and every process the
# run leaves behind belong to the namespace and end with it. A merge commit and a `git revert` in
# a clone of <repo> stand in for the GitHub merge, the pull, and the pushed revert.
set -uo pipefail
scratch=${1:?scratch} repo=${2:?repo} old=${3:?old commit} new=${4:?new commit}
[ "$$" = 1 ] || { echo "refused: run this under unshare -rnpf --mount-proc --kill-child, as npm run rehearse does"; exit 1; }
scratch=$(realpath "$scratch")
[ -d "$scratch/state/approval-queue" ] || { echo "refused: $scratch/state/approval-queue is not there; copy the state directory first"; exit 1; }
# A fresh namespace's loopback is down, so neither server could bind until this runs. The namespace
# has no network, and both restarts run npm ci, so npm reads its cache.
ip link set lo up
export npm_config_prefer_offline=true npm_config_audit=false npm_config_fund=false
unset APPROVAL_QUEUE_STATE APPROVAL_QUEUE_PORT

# A stray write to the real state directory fails, if the mount works.
real="$HOME/.local/state/approval-queue"
if [ -d "$real" ] && mount --bind "$real" "$real" 2>/dev/null && mount -o remount,bind,ro "$real" 2>/dev/null; then
	echo "realro=yes"
else
	echo "realro=no"
fi

export XDG_STATE_HOME="$scratch/state"
state="$scratch/state/approval-queue"
tree="$scratch/tree"
launcher="$tree/bin/.local/bin/approval-queue"

up() { curl -s --max-time 3 "http://127.0.0.1:7907/"; }
listener() { ss -ltnpH "sport = :7907" | grep -o 'pid=[0-9]*' | head -n 1 | cut -d= -f2; }
# Hashes every file under the old entries, so the undo can show it put each back as it was.
manifest() {
	local out=$1 name
	: >"$out"
	for name in items findings decisions.jsonl digest.jsonl digest-notes.json digest-replies.json refusals.jsonl claim.token tab.seen queue.lock; do
		[ -e "$state/$name" ] && find "$state/$name" -type f -print0 | sort -z | xargs -0 -r sha256sum >>"$out"
	done
	for name in "$state"/fetch-* "$state"/check-*.md "$state"/check-*.err; do
		[ -e "$name" ] && find "$name" -type f -print0 | sort -z | xargs -0 -r sha256sum >>"$out"
	done
	return 0
}

# Step 1: the old queue, built and running.
git clone -q "$repo" "$tree" || { echo "setup=clone failed"; exit 1; }
git -C "$tree" checkout -q -B main "$old" || { echo "setup=checkout failed"; exit 1; }
(cd "$tree/approval-queue" && npm ci && npm run build) >"$scratch/old-build.log" 2>&1 || { echo "setup=old build failed, see old-build.log"; exit 1; }
HOST=127.0.0.1 PORT=7907 APPROVAL_QUEUE_STATE="$state" setsid -f node "$tree/approval-queue/build" >>"$scratch/old-server.log" 2>&1
for _ in $(seq 100); do up >/dev/null && break; sleep 0.2; done
up >/dev/null || { echo "setup=old server did not answer"; exit 1; }
manifest "$scratch/manifest-before"
echo "before.old_board=$(up | grep -cE 'class="benchmark[ "]')"
echo "before.entries=$(ls -A "$state" | tr '\n' ' ')"

# Step 2: the switch.
git -C "$tree" merge --no-ff -q -m "Merge the switch" "$new" || { echo "setup=merge failed"; exit 1; }
"$launcher" restart 2>"$scratch/switch.err"
echo "switch.exit=$?"
echo "switch.stderr=$(tr '\n' ' ' <"$scratch/switch.err")"
page=$(up)
echo "switch.new_page=$(grep -c 'Outstanding decisions' <<<"$page")"
echo "switch.old_board=$(grep -cE 'class="benchmark[ "]' <<<"$page")"
pid=$(listener)
echo "switch.listener=$(tr '\0' ' ' <"/proc/${pid:-0}/cmdline" 2>/dev/null)"
echo "switch.archive=$([ -e "$state/archive-2026-11.tar.gz" ] && echo yes || echo no)"
echo "switch.archive_entries=$(tar -tzf "$state/archive-2026-11.tar.gz" 2>/dev/null | wc -l)"
echo "switch.old_entries_left=$(for n in items findings decisions.jsonl digest.jsonl digest-notes.json digest-replies.json refusals.jsonl claim.token tab.seen queue.lock; do [ -e "$state/$n" ] && printf '%s ' "$n"; done)"
echo "switch.store=$([ -d "$state/store" ] && echo yes || echo no)"

# Step 3: the undo, as the pull request body gives it.
git -C "$tree" revert -m 1 --no-edit HEAD >/dev/null || { echo "setup=revert failed"; exit 1; }
tar -xzf "$state/archive-2026-11.tar.gz" -C "$state"
mv "$state/archive-2026-11.tar.gz" "$state/archive-2026-11.undone.tar.gz"
"$launcher" restart 2>"$scratch/undo.err"
echo "undo.exit=$?"
echo "undo.stderr=$(tr '\n' ' ' <"$scratch/undo.err")"
page=$(up)
echo "undo.old_board=$(grep -cE 'class="benchmark[ "]' <<<"$page")"
echo "undo.new_page=$(grep -c 'Outstanding decisions' <<<"$page")"
manifest "$scratch/manifest-after"
echo "undo.manifest_matches=$(cmp -s "$scratch/manifest-before" "$scratch/manifest-after" && echo yes || echo no)"
echo "undo.manifest_files=$(wc -l <"$scratch/manifest-after")"
echo "undo.store=$([ -d "$state/store" ] && echo yes || echo no)"
