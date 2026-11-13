#!/usr/bin/env bash
# restart-scenario.sh <mode> <tree> <state>: one `approval-queue restart` run inside a private network
# namespace, printed as key=value lines. restart.test.ts starts it through `unshare -rnpf --mount-proc
# --kill-child`, so port 7907 and every process the run leaves behind belong to the namespace and end
# with it. It copies approval-queue/ to <tree>, builds the copy with a real npm ci and npm run build, starts that
# build as the old server on 7907, then runs the copy's restart. A shim npm breaks the staged build
# per mode: exits (the staged server exits at once), silent (it never listens), slow (it waits 15
# seconds before listening on 7907 only), foreign (a server this queue didn't start holds 7907), and
# locked (another restart holds restart.lock). Mode ok leaves the build alone.
set -uo pipefail
mode=${1:?mode} tree=${2:?tree} state=${3:?state}
src=$(cd "$(dirname "$0")/.." && pwd)
ip link set lo up
export APPROVAL_QUEUE_STATE="$state" npm_config_audit=false npm_config_fund=false npm_config_prefer_offline=true
unset APPROVAL_QUEUE_PORT
mkdir -p "$tree" "$state"
tree=$(realpath "$tree")
state=$(realpath "$state")
export APPROVAL_QUEUE_STATE="$state"
tar -C "$src" --exclude=./node_modules --exclude=./build --exclude=./.svelte-kit --exclude=./.stage -cf - . | tar -C "$tree" -xf -

up() { curl -s -o /dev/null --max-time 2 "http://127.0.0.1:${1:-7907}/"; }
listener() { ss -ltnpH "sport = :${1:-7907}" | grep -o 'pid=[0-9]*' | head -n 1 | cut -d= -f2; }
wait_up() {
	local i
	for i in $(seq 150); do
		up "$@" && return 0
		sleep 0.2
	done
	return 1
}
# Counts processes whose command line contains the text.
count() {
	local n=0 p
	for p in /proc/[0-9]*; do
		[ "${p#/proc/}" = "$$" ] && continue
		tr '\0' ' ' <"$p/cmdline" 2>/dev/null | grep -qF -- "$1" && n=$((n + 1))
	done
	echo "$n"
}

if [ "$mode" = foreign ]; then
	ln -s "$src/node_modules" "$tree/node_modules"
	node -e "require('node:http').createServer((q, s) => s.end('x')).listen(7907, '127.0.0.1')" &
	wait_up || { echo "setup=foreign server did not answer"; exit 1; }
else
	(cd "$tree" && npm ci && npm run build) >"$state/first-build.log" 2>&1 || { echo "setup=first build failed"; exit 1; }
	HOST=127.0.0.1 PORT=7907 APPROVAL_QUEUE_STATE="$state" setsid -f node "$tree/build" >>"$state/old.log" 2>&1
	wait_up || { echo "setup=old server did not answer"; exit 1; }
	mkdir -p "$tree/static"
	echo new >"$tree/static/aq-build.txt"
fi
oldpid=$(listener)

if [ "$mode" = locked ]; then
	flock "$state/restart.lock" sleep 300 &
	for _ in $(seq 50); do
		flock -n "$state/restart.lock" true && sleep 0.1 || break
	done
fi

shim="$state/shim"
mkdir -p "$shim"
real=$(command -v npm)
cat >"$shim/npm" <<EOF
#!/usr/bin/env bash
"$real" "\$@" || exit \$?
if [ "\${1:-}" = run ] && [ "\${2:-}" = build ] && [ "\$(basename "\$PWD")" = .stage ]; then
	case "$mode" in
		exits) echo 'process.exit(1);' >build/index.js ;;
		silent) echo 'setInterval(() => {}, 1000);' >build/index.js ;;
		slow)
			mv build/index.js build/real.js
			printf '%s\n' "if (process.env.PORT === '7907') await new Promise((r) => setTimeout(r, 15000));" "await import('./real.js');" >build/index.js ;;
	esac
fi
EOF
chmod +x "$shim/npm"
export PATH="$shim:$PATH"

began=$(date +%s)
node "$tree/cli/index.js" restart 2>"$state/restart.err"
code=$?
finished=$(date +%s)
err=$(tr '\n' ' ' <"$state/restart.err")
spare=$(grep -oE '(spare port|answer on port) [0-9]+' <<<"$err" | grep -oE '[0-9]+$' | head -n 1)

report() {
	local label=$1 newpid status
	newpid=$(listener)
	status=$(curl -s -o "$state/body" -w '%{http_code}' --max-time 3 http://127.0.0.1:7907/aq-build.txt)
	echo "$label.pid_on_7907_is_old=$([ "$newpid" = "$oldpid" ] && echo yes || echo no)"
	echo "$label.pid_on_7907_is_ours=$([ "$(tr '\0' ' ' <"/proc/${newpid:-0}/cmdline" 2>/dev/null)" = "node $tree/build " ] && echo yes || echo no)"
	echo "$label.aq_build_status=$status"
	echo "$label.aq_build_body=$(tr -d '\n' <"$state/body" | cut -c1-20)"
	echo "$label.build_processes=$(count "node $tree/build")"
}

echo "mode=$mode"
echo "exit=$code"
echo "seconds=$((finished - began))"
echo "stderr=$err"
echo "spare_port=$spare"
echo "spare_listeners=$([ -n "$spare" ] && ss -ltnH "sport = :$spare" | wc -l || echo none)"
echo "build_prev_exists=$([ -e "$tree/build.prev" ] && echo yes || echo no)"
echo "node_modules_prev_exists=$([ -e "$tree/node_modules.prev" ] && echo yes || echo no)"
echo "stage_exists=$([ -e "$tree/.stage" ] && echo yes || echo no)"
echo "stage_processes=$(count "$tree/.stage")"
report now
if [ "$mode" = slow ]; then
	sleep 20
	report later
fi
