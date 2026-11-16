import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDocument, writeDecision } from '#lib/store/store.ts';

const CLI = fileURLToPath(new URL('./index.js', import.meta.url));

let dir: string;
let state: string;
let root: string;

const now = () => new Date().toISOString();
const add = (title: string, kind = 'decide'): string => createDocument(root, `# ${title}\n`, { kind, title }).id;
/** Moves a document's creation time, so two made in one second still sort as the test says. */
function createdAt(id: string, created: string): void {
	const file = join(root, id, 'meta.json');
	writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), created }));
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function run(args: string[]) {
	const r = spawnSync(process.execPath, [CLI, 'list', ...args], {
		encoding: 'utf8',
		env: { ...process.env, APPROVAL_QUEUE_STATE: state },
		timeout: 10000
	});
	return { code: r.status, out: r.stdout, err: r.stderr };
}

/** Starts `list --wait` and reports whether it has exited, with its output. */
function watch() {
	const child = spawn(process.execPath, [CLI, 'list', '--wait'], { env: { ...process.env, APPROVAL_QUEUE_STATE: state } });
	let out = '';
	let code: number | null = null;
	child.stdout.on('data', (d) => (out += d));
	child.on('exit', (c) => (code = c));
	const killer = setTimeout(() => child.kill('SIGTERM'), 10000);
	child.on('exit', () => clearTimeout(killer));
	return {
		exited: () => code !== null,
		code: () => code,
		out: () => out,
		/** Resolves once the command has exited, or after `ms`. */
		until: async (ms: number) => {
			for (let t = 0; t < ms && code === null; t += 100) await sleep(100);
		},
		stop: () => child.kill('SIGTERM')
	};
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'aq-list-'));
	state = join(dir, 'state');
	root = join(state, 'store');
	mkdirSync(state);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('list', () => {
	it('prints the one waiting document, with its id, kind, and title', () => {
		const waiting = add('Which way?');
		const decided = add('Decided one');
		writeDecision(root, decided, { action: 'approve', at: now() });
		const withdrawn = add('Withdrawn one');
		writeDecision(root, withdrawn, { action: 'withdraw', at: now() });
		expect(run([])).toEqual({ code: 0, out: `${waiting}\tdecide\tWhich way?\n`, err: '' });
	});

	it('prints nothing for an empty or missing store', () => {
		expect(run([])).toEqual({ code: 0, out: '', err: '' });
	});

	it('prints an unread report with the kind report, oldest first', () => {
		const first = add('Round report', 'report');
		const second = add('Next question');
		createdAt(first, '2026-01-01T10:00:00.000Z');
		createdAt(second, '2026-01-01T10:01:00.000Z');
		expect(run([]).out).toBe(`${first}\treport\tRound report\n${second}\tdecide\tNext question\n`);
	});

	it('names a document with a broken decision file once on stderr and lists the rest', () => {
		const good = add('Good');
		const bad = add('Bad');
		writeFileSync(join(root, bad, 'decision-1.json'), 'not json');
		const r = run([]);
		expect(r.code).toBe(0);
		expect(r.out).toBe(`${good}\tdecide\tGood\n`);
		expect(r.err.split('\n').filter(Boolean)).toHaveLength(1);
		expect(r.err).toMatch(new RegExp(`^approval-queue: ${bad}: `));
	});

	it('refuses an unknown argument with exit 2', () => {
		expect(run(['--now']).code).toBe(2);
	});
});

describe('list --wait', () => {
	it('stays running, then exits 0 when a new document arrives', { timeout: 20000 }, async () => {
		add('Already waiting');
		const w = watch();
		await sleep(2000);
		expect(w.exited()).toBe(false);
		const id = add('Newcomer');
		await w.until(3000);
		expect(w.code()).toBe(0);
		expect(w.out()).toBe(`${id}\tdecide\tNewcomer\n`);
	});

	it('exits when the new document is a report', { timeout: 20000 }, async () => {
		const w = watch();
		await sleep(1500);
		const id = add('Round report', 'report');
		await w.until(3000);
		expect(w.code()).toBe(0);
		expect(w.out()).toBe(`${id}\treport\tRound report\n`);
	});

	it('wakes on a send-back that was handed, held, and returned', { timeout: 20000 }, async () => {
		const id = add('Revised');
		writeDecision(root, id, { action: 'sendback', at: now() });
		writeDecision(root, id, { action: 'handed', at: now(), decision: 1 });
		const w = watch();
		await sleep(1500);
		expect(w.exited()).toBe(false);
		writeDecision(root, id, { action: 'returned', at: now(), version: 2 });
		await w.until(3000);
		expect(w.code()).toBe(0);
		expect(w.out()).toBe(`${id}\tdecide\tRevised\n`);
	});

	it('wakes when a document that was waiting at the start is sent back, handed, and returned', { timeout: 20000 }, async () => {
		const id = add('Cycle');
		const w = watch();
		await sleep(1500);
		writeDecision(root, id, { action: 'sendback', at: now() });
		writeDecision(root, id, { action: 'handed', at: now(), decision: 1 });
		await sleep(1500);
		expect(w.exited()).toBe(false);
		writeDecision(root, id, { action: 'returned', at: now(), version: 2 });
		await w.until(3000);
		expect(w.code()).toBe(0);
		expect(w.out()).toBe(`${id}\tdecide\tCycle\n`);
	});
});
