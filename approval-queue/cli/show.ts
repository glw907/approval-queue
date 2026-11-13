import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { answers, lock } from './restart.ts';

const START_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const say = (line: string) => process.stderr.write(`approval-queue: ${line}\n`);

/**
 * Starts the page server the way `restart` does, so `restart` knows it as this queue's server.
 * Takes `start.lock` first, so it never starts a server in the middle of a restart's swap.
 * Returns false when this checkout has no build to start, and true at once when a server already answers.
 */
async function startServer(app: string, state: string, port: number): Promise<boolean> {
	const build = path.join(app, 'build');
	fs.mkdirSync(state, { recursive: true });
	const startLock = lock(path.join(state, 'start.lock'), true);
	let logFd: number | undefined;
	try {
		// Checked under the lock: a restart may have swapped the build or started a server meanwhile.
		if (await answers(`http://127.0.0.1:${port}/`)) return true;
		if (!fs.existsSync(path.join(build, 'index.js'))) return false;
		logFd = fs.openSync(path.join(state, 'server.log'), 'a');
		spawn(process.execPath, [build], {
			argv0: 'node',
			detached: true,
			stdio: ['ignore', logFd, logFd],
			env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), APPROVAL_QUEUE_STATE: state }
		}).unref();
	} finally {
		if (logFd !== undefined) fs.closeSync(logFd);
		if (startLock !== null) fs.closeSync(startLock);
	}
	return true;
}

/**
 * Puts document `id` in front of the reader: starts the page server when nothing answers on the
 * port, then opens the document's page with `xdg-open`. Every new document and every return opens
 * its own tab, because a check for an open tab once took an agent's tab for the reader's.
 *
 * @remarks Never fails the command. When the server can't start or `xdg-open` is missing, it says
 * so on stderr and names the page, and the document still waits in the store.
 */
export async function showDocument(id: string): Promise<void> {
	const port = Number(process.env.APPROVAL_QUEUE_PORT ?? 7907);
	const base = `http://127.0.0.1:${port}`;
	const page = `${base}/d/${id}`;
	if (!(await answers(`${base}/`))) {
		const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
		const state =
			process.env.APPROVAL_QUEUE_STATE ||
			path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'approval-queue');
		if (!(await startServer(app, state, port))) {
			say(`the page server isn't running and ${app} has no build; run approval-queue restart, then open ${page}`);
			return;
		}
		const end = Date.now() + START_MS;
		while (Date.now() < end && !(await answers(`${base}/`))) await sleep(100);
		if (!(await answers(`${base}/`))) {
			say(`the page server didn't answer on port ${port}; see server.log, then open ${page}`);
			return;
		}
	}
	const opener = spawn('xdg-open', [page], { detached: true, stdio: 'ignore' });
	// Wait for the spawn or its failure, so the line printed is true before a report exits.
	await new Promise<void>((resolve) => {
		opener.once('spawn', () => {
			say(`opened ${page}`);
			resolve();
		});
		opener.once('error', () => {
			say(`xdg-open isn't available; open ${page}`);
			resolve();
		});
	});
	opener.unref();
}
