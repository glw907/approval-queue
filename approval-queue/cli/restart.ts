import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TRIAL_MS = 20_000;
const STOP_MS = 10_000;
const SWAP_DIRS = ['build', 'node_modules'] as const;
const NOT_COPIED = new Set(['node_modules', 'build', '.svelte-kit', '.stage', 'build.prev', 'node_modules.prev']);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const say = (line: string) => process.stderr.write(`approval-queue: ${line}\n`);

/** One directory the swap moved: whether the live one went to `.prev`, and whether a staged one took its place. */
type Moved = { dir: (typeof SWAP_DIRS)[number]; hadOld: boolean; installedNew: boolean };

function alive(pid: number): boolean {
	try {
		const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
		return stat.slice(stat.lastIndexOf(')') + 2)[0] !== 'Z';
	} catch {
		return false;
	}
}

async function stop(pid: number): Promise<void> {
	if (!alive(pid)) return;
	for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
		try {
			process.kill(pid, signal);
		} catch {
			return;
		}
		const end = Date.now() + (signal === 'SIGTERM' ? STOP_MS : 2000);
		while (Date.now() < end) {
			if (!alive(pid)) return;
			await sleep(50);
		}
	}
}

/** Takes an exclusive `flock` on `file` and keeps the descriptor open; returns it, or null when `wait` is off and the lock is held. */
function lock(file: string, wait: boolean): number | null {
	const fd = fs.openSync(file, 'w');
	const held = spawnSync('flock', wait ? ['3'] : ['-n', '3'], { stdio: ['ignore', 'ignore', 'ignore', fd] });
	if (held.status === 0) return fd;
	fs.closeSync(fd);
	return null;
}

async function answers(url: string): Promise<boolean> {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
		await res.arrayBuffer();
		return res.status < 500;
	} catch {
		return false;
	}
}

/** The pid listening on `port`, null when none, or undefined when the listener can't be identified. */
function listener(port: number): number | null | undefined {
	const run = spawnSync('ss', ['-ltnpH', `sport = :${port}`], { encoding: 'utf8' });
	const lines = (run.stdout ?? '').split('\n').filter(Boolean);
	if (!lines.length) return null;
	const pids = new Set(lines.flatMap((l) => [...l.matchAll(/pid=(\d+)/g)].map((m) => Number(m[1]))));
	if (pids.size !== 1 || lines.some((l) => !l.includes('pid='))) return undefined;
	return [...pids][0];
}

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address() as net.AddressInfo;
			server.close(() => resolve(port));
		});
	});
}

/**
 * Replaces the running server with a fresh build of this checkout's `approval-queue/`.
 *
 * @remarks Builds in `.stage` beside the running build and starts that build on a spare port. Only
 * when it answers within 20 seconds does the old server stop, the build and `node_modules` swap
 * in, and the new server start on the real port. A new server that doesn't answer is stopped, and
 * the directories the swap moved go back, from the swap's own record, with the old build started
 * again. Returns the exit code: 0 on a restart, 1 on any refusal or failure.
 */
export async function restart(): Promise<number> {
	const port = Number(process.env.APPROVAL_QUEUE_PORT ?? 7907);
	const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	const state =
		process.env.APPROVAL_QUEUE_STATE ||
		path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'approval-queue');
	const log = path.join(state, 'server.log');
	const stage = path.join(app, '.stage');
	const base = `http://127.0.0.1:${port}`;
	fs.mkdirSync(state, { recursive: true });
	fs.appendFileSync(log, '');

	const restartLock = lock(path.join(state, 'restart.lock'), false);
	if (restartLock === null) {
		say('another restart is running; nothing was touched');
		return 1;
	}
	const logFd = fs.openSync(log, 'a');

	const ours = (pid: number): boolean => {
		try {
			const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ');
			const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
			return cmd === `node ${app}/build ` && env.includes(`APPROVAL_QUEUE_STATE=${state}`);
		} catch {
			return false;
		}
	};
	const servers = (): number[] =>
		fs
			.readdirSync('/proc')
			.filter((name) => /^\d+$/.test(name))
			.map(Number)
			.filter((pid) => pid !== process.pid && ours(pid));
	const start = (script: string, onPort: number): number => {
		const child = spawn(process.execPath, [script], {
			argv0: 'node',
			detached: true,
			stdio: ['ignore', logFd, logFd],
			env: { ...process.env, HOST: '127.0.0.1', PORT: String(onPort), APPROVAL_QUEUE_STATE: state }
		});
		child.unref();
		return child.pid as number;
	};
	/** The pid of this queue's server on the port, null when nothing is there, or the refusal to print. */
	const identify = async (): Promise<number | null | string> => {
		const pid = listener(port);
		if (pid === undefined) return `the process on port ${port} can't be identified; nothing was changed`;
		if (pid === null) {
			if (await answers(`${base}/`)) return `something answers on port ${port} with no listener to identify; nothing was changed`;
			return null;
		}
		if (!ours(pid)) return `port ${port} is held by pid ${pid}, which is not this queue's server; nothing was changed`;
		return pid;
	};
	const waitDown = async (): Promise<boolean> => {
		for (let i = 0; i < 100; i++) {
			if (listener(port) === null && !(await answers(`${base}/`))) return true;
			await sleep(100);
		}
		return false;
	};
	const waitUp = async (onPort: number, ms: number, pid?: number): Promise<boolean> => {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			if (await answers(`http://127.0.0.1:${onPort}/`)) return true;
			if (pid !== undefined && !alive(pid)) return false;
			await sleep(100);
		}
		return false;
	};

	try {
		// Name the listener before staging anything.
		const first = await identify();
		if (typeof first === 'string') {
			say(first);
			return 1;
		}

		fs.rmSync(stage, { recursive: true, force: true });
		try {
			fs.mkdirSync(stage);
			for (const entry of fs.readdirSync(app)) {
				if (!NOT_COPIED.has(entry)) fs.cpSync(path.join(app, entry), path.join(stage, entry), { recursive: true });
			}
		} catch (err) {
			say(`could not copy the app's source into ${stage}: ${(err as Error).message}`);
			return 1;
		}
		for (const args of [['ci'], ['run', 'build']]) {
			const built = spawnSync('npm', args, {
				cwd: stage,
				stdio: ['ignore', logFd, logFd],
				env: { ...process.env, APPROVAL_QUEUE_PORT: String(port) }
			});
			if (built.status !== 0) {
				say(`the staged build failed; nothing was swapped, see ${log}`);
				return 1;
			}
		}

		// The trial: the new build answers on a spare port before the old server is touched.
		const spare = await freePort();
		const trial = start(path.join(stage, 'build'), spare);
		const trialUp = await waitUp(spare, TRIAL_MS, trial);
		await stop(trial);
		if (!trialUp) {
			say(`the new build did not answer on port ${spare} within 20 seconds; the old server keeps running, see ${log}`);
			return 1;
		}
		for (let i = 0; i < 100 && listener(spare) !== null; i++) await sleep(100);

		const startLock = lock(path.join(state, 'start.lock'), true);
		try {
			// Settle a swap an earlier run was killed in the middle of.
			for (const dir of SWAP_DIRS) {
				const prev = path.join(app, `${dir}.prev`);
				if (!fs.existsSync(prev)) continue;
				if (fs.existsSync(path.join(app, dir))) fs.rmSync(prev, { recursive: true, force: true });
				else fs.renameSync(prev, path.join(app, dir));
			}

			const oldPid = await identify();
			if (typeof oldPid === 'string') {
				say(oldPid);
				return 1;
			}

			// From here a stop signal to this command is ignored: a half-swapped app has no server.
			for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT'] as const) process.on(signal, () => {});
			if (oldPid !== null) {
				try {
					process.kill(oldPid, 'SIGTERM');
				} catch {}
				if (!(await waitDown())) {
					const page = (await answers(`${base}/`)) ? 'the page still answers' : 'the page does not answer';
					say(`pid ${oldPid} was sent TERM and still holds port ${port}; ${page}; nothing was swapped`);
					return 1;
				}
			}

			const moved: Moved[] = [];
			let swapped = true;
			try {
				for (const dir of SWAP_DIRS) {
					const live = path.join(app, dir);
					const entry: Moved = { dir, hadOld: false, installedNew: false };
					moved.push(entry);
					if (fs.existsSync(live)) {
						fs.renameSync(live, `${live}.prev`);
						entry.hadOld = true;
					}
					if (fs.existsSync(path.join(stage, dir))) {
						fs.renameSync(path.join(stage, dir), live);
						entry.installedNew = true;
					}
				}
			} catch {
				swapped = false;
			}

			if (swapped) {
				start(path.join(app, 'build'), port);
				if (await waitUp(port, STOP_MS)) {
					const pid = listener(port);
					if (typeof pid === 'number' && pid !== oldPid && ours(pid)) {
						for (const dir of SWAP_DIRS) fs.rmSync(path.join(app, `${dir}.prev`), { recursive: true, force: true });
						say(`the new build answered on spare port ${spare}; restarted, pid ${pid}`);
						return 0;
					}
				}
			}

			// Roll back: stop every server of this build, restore from the swap's record, start the old build.
			for (const pid of servers()) await stop(pid);
			for (const entry of [...moved].reverse()) {
				const live = path.join(app, entry.dir);
				if (entry.installedNew) fs.rmSync(live, { recursive: true, force: true });
				if (entry.hadOld) fs.renameSync(`${live}.prev`, live);
			}
			start(path.join(app, 'build'), port);
			if (await waitUp(port, STOP_MS)) say(`restart failed; the old build answers again, see ${log}`);
			else say(`restart failed; the old build does not answer, see ${log}`);
			return 1;
		} finally {
			if (startLock !== null) fs.closeSync(startLock);
		}
	} finally {
		fs.rmSync(stage, { recursive: true, force: true });
		fs.closeSync(logFd);
		fs.closeSync(restartLock);
	}
}
