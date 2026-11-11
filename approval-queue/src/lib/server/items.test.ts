import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { listDecided, listWaiting, procStat, readItem, writeDecision, writeDecisionOnce } from './items.ts';

let root: string;

async function seed(id: string, meta: object, files: Record<string, string> = {}) {
	const dir = join(root, 'items', id);
	await mkdir(dir, { recursive: true });
	for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
	await writeFile(join(dir, 'item.json'), JSON.stringify({ id, ...meta }));
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'approval-queue-test-'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('listWaiting', () => {
	it('lists oldest first', async () => {
		await seed('20261011T100000-1', { kind: 'design', repo: 'r', title: 'old', created: '2026-10-11T10:00:00Z' });
		await seed('20261011T110000-2', { kind: 'design', repo: 'r', title: 'new', created: '2026-10-11T11:00:00Z' });
		expect((await listWaiting(root)).map((m) => m.title)).toEqual(['old', 'new']);
	});

	it('breaks a tie on created by id', async () => {
		const created = '2026-10-11T10:00:00Z';
		await seed('20261011T100000-2', { kind: 'design', repo: 'r', title: 'second', created });
		await seed('20261011T100000-1', { kind: 'design', repo: 'r', title: 'first', created });
		expect((await listWaiting(root)).map((m) => m.title)).toEqual(['first', 'second']);
	});

	it('skips a decided item and a directory with no item.json', async () => {
		await seed('20261011T100000-1', { kind: 'design', repo: 'r', title: 'done', created: '2026-10-11T10:00:00Z' });
		await writeDecision(root, '20261011T100000-1', { decision: 'approve' });
		await mkdir(join(root, 'items', '20261011T120000-3'), { recursive: true });
		expect(await listWaiting(root)).toEqual([]);
	});
});

describe('listDecided', () => {
	it('lists items decided at or after since, newest first, with the decision word', async () => {
		const meta = { kind: 'design', repo: 'r', title: 't', created: 'c' };
		for (const id of ['a', 'b', 'c']) await seed(id, { ...meta, title: id });
		await writeDecision(root, 'a', { decision: 'approve' });
		await writeDecision(root, 'b', { decision: 'reject', note: 'no' });
		await writeDecision(root, 'c', { decision: 'submit', rows: [] });
		const at = (id: string, ms: number) => utimes(join(root, 'items', id, 'decision.json'), ms / 1000, ms / 1000);
		await at('a', 1_000_000);
		await at('b', 3_000_000);
		await at('c', 2_000_000);
		const decided = await listDecided(root, 2_000_000);
		expect(decided.map((d) => [d.meta.title, d.decision])).toEqual([
			['b', 'reject'],
			['c', 'submit']
		]);
	});

	it('adds the reason from refused.json, and only to the item that has one', async () => {
		const meta = { kind: 'packet', repo: 'r', title: 't', created: 'c' };
		for (const id of ['a', 'b']) await seed(id, { ...meta, title: id });
		await writeDecision(root, 'a', { decision: 'approve' });
		await writeDecision(root, 'b', { decision: 'approve' });
		await writeFile(join(root, 'items', 'b', 'refused.json'), JSON.stringify({ at: '2026-10-25T10:00:00Z', reason: 'The packet changed.' }));
		const decided = await listDecided(root, 0);
		expect(decided.find((d) => d.meta.id === 'a')).not.toHaveProperty('refused');
		expect(decided.find((d) => d.meta.id === 'b')?.refused).toBe('The packet changed.');
	});

	it('returns an empty list when there is no items directory', async () => {
		expect(await listDecided(root, 0)).toEqual([]);
	});
});

describe('readItem', () => {
	it('reads a design', async () => {
		await seed('20261011T100000-1', { kind: 'design', repo: 'r', title: 't', created: 'c' }, { 'doc.md': '# doc' });
		expect((await readItem(root, '20261011T100000-1'))?.content).toEqual({ kind: 'design', doc: '# doc' });
	});

	it('reads a triage list', async () => {
		const triage = { headline: 'H.', lede: 'L.', rows: [{ action: 'x', why: 'why', proposed: 'now' }] };
		await seed(
			'20261011T100000-1',
			{ kind: 'triage', repo: 'r', title: 't', created: 'c' },
			{ 'triage.json': JSON.stringify(triage) }
		);
		expect((await readItem(root, '20261011T100000-1'))?.content).toEqual({ kind: 'triage', ...triage });
	});

	it('returns undefined for an unknown id', async () => {
		expect(await readItem(root, '20261011T100000-9')).toBeUndefined();
	});
});

describe('writeDecision', () => {
	it('writes JSON that reads back, with no temp file left', async () => {
		await seed('20261011T100000-1', { kind: 'design', repo: 'r', title: 't', created: 'c' }, { 'doc.md': 'd' });
		await writeDecision(root, '20261011T100000-1', { decision: 'reject', note: 'no' });
		const dir = join(root, 'items', '20261011T100000-1');
		expect(JSON.parse(await readFile(join(dir, 'decision.json'), 'utf8'))).toEqual({ decision: 'reject', note: 'no' });
		expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
		expect((await readItem(root, '20261011T100000-1'))?.decided).toBe(true);
	});
});

describe('a packet item', () => {
	it('reads a packet stored before the fact file as its packet.md', async () => {
		await seed('p', { kind: 'packet', repo: 'r', title: 't', created: 'c' }, { 'packet.json': '{}', 'packet.md': '# Old\n' });
		expect((await readItem(root, 'p'))?.content).toEqual({ kind: 'legacy', text: '# Old\n' });
	});

	it('returns undefined for a kind it does not know, not an empty triage', async () => {
		await seed('p', { kind: 'mystery', repo: 'r', title: 't', created: 'c' });
		expect(await readItem(root, 'p')).toBeUndefined();
	});
});

describe('a damaged item.json', () => {
	it('is skipped by both listings, so one file never takes down the board', async () => {
		await seed('good', { kind: 'design', repo: 'r', title: 'good', created: '2026-10-11T10:00:00Z' });
		await mkdir(join(root, 'items', 'bad'), { recursive: true });
		await writeFile(join(root, 'items', 'bad', 'item.json'), '{"id": ');
		await seed('done', { kind: 'design', repo: 'r', title: 'done', created: 'c' });
		await writeDecision(root, 'done', { decision: 'approve' });
		await mkdir(join(root, 'items', 'bad2'), { recursive: true });
		await writeFile(join(root, 'items', 'bad2', 'item.json'), '{"id": ');
		await writeFile(join(root, 'items', 'bad2', 'decision.json'), '{"decision": "approve"}');
		expect((await listWaiting(root)).map((m) => m.title)).toEqual(['good']);
		expect((await listDecided(root, 0)).map((d) => d.meta.title)).toEqual(['done']);
	});
});

describe('orphaned', () => {
	const meta = { kind: 'design', repo: 'r', title: 't', created: '2026-10-11T10:00:00Z' };
	const flags = async (id: string) => {
		const found = (await listWaiting(root)).find((m) => m.id === id);
		return found?.orphaned;
	};

	it('reads a live pid with its own start time as a waiter', async () => {
		const mine = await procStat(process.pid);
		await seed('live', { ...meta, pid: process.pid, pidStart: mine?.start }, { 'doc.md': 'd' });
		expect(await flags('live')).toBe(false);
		expect((await readItem(root, 'live'))?.meta).toMatchObject({ orphaned: false });
	});

	it('marks a pid that has exited, and a pid with no process, as orphaned', async () => {
		const done = spawn('true');
		await new Promise((resolve) => done.once('exit', resolve));
		await seed('dead', { ...meta, pid: done.pid, pidStart: 1 }, { 'doc.md': 'd' });
		await seed('none', { ...meta, pid: 2 ** 22 + 1, pidStart: 1 });
		expect(await flags('dead')).toBe(true);
		expect(await flags('none')).toBe(true);
		expect((await readItem(root, 'dead'))?.meta.orphaned).toBe(true);
	});

	it('marks a reused pid as orphaned: the pid runs, but not the process that queued the item', async () => {
		const sleeper = spawn('sleep', ['30']);
		try {
			const real = await procStat(sleeper.pid ?? 0);
			await seed('reused', { ...meta, pid: sleeper.pid, pidStart: (real?.start ?? 0) + 1 });
			await seed('same', { ...meta, pid: sleeper.pid, pidStart: real?.start });
			expect(await flags('reused')).toBe(true);
			expect(await flags('same')).toBe(false);
		} finally {
			sleeper.kill();
		}
	});

	it('marks a zombie as orphaned: a killed command its parent has not reaped keeps its stat', async () => {
		// A parent that forks a child and never waits on it leaves the killed child a zombie.
		const parent = spawn(
			'python3',
			['-I', '-c', "import os, time\np = os.fork()\nif p == 0:\n  os.execvp('sleep', ['sleep', '30'])\nprint(p, flush=True)\ntime.sleep(30)"],
			{ stdio: ['ignore', 'pipe', 'ignore'] }
		);
		try {
			const pid = Number(await new Promise<string>((resolve) => parent.stdout.once('data', (chunk) => resolve(String(chunk)))));
			const real = await procStat(pid);
			expect(real?.state).not.toBe('Z');
			process.kill(pid, 'SIGKILL');
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect((await procStat(pid))?.state).toBe('Z');
			await seed('zombie', { ...meta, pid, pidStart: real?.start });
			expect(await flags('zombie')).toBe(true);
		} finally {
			parent.kill();
		}
	});

	it('reads an item with no pid as unknown: not orphaned', async () => {
		await seed('old', meta);
		expect(await flags('old')).toBe(false);
	});
});

describe('an item of a kind the queue no longer reads', () => {
	it.each(['blueprint', 'page', 'change', 'pr', 'docs'])('stays on disk but is not listed, decided or waiting, nor served (%s)', async (kind) => {
		await seed('old', { kind, repo: 'r', title: 't', created: 'c' }, { 'doc.md': '# doc' });
		await seed('gone', { kind, repo: 'r', title: 't', created: 'c' }, { 'doc.md': '# doc' });
		await writeDecision(root, 'gone', { decision: 'approve' });
		expect(await listWaiting(root)).toEqual([]);
		expect(await listDecided(root, 0)).toEqual([]);
		expect(await readItem(root, 'old')).toBeUndefined();
		expect(await readItem(root, 'gone')).toBeUndefined();
		expect(await readdir(join(root, 'items'))).toContain('gone');
	});
});

describe('writeDecisionOnce', () => {
	it('links the decision into place and refuses a second one without replacing the first', async () => {
		await seed('p', { kind: 'design', repo: 'r', title: 't', created: 'c' });
		expect(await writeDecisionOnce(root, 'p', { decision: 'reject', note: 'first' })).toBe('written');
		expect(await writeDecisionOnce(root, 'p', { decision: 'reject', note: 'second' })).toBe('exists');
		const dir = join(root, 'items', 'p');
		expect(JSON.parse(await readFile(join(dir, 'decision.json'), 'utf8'))).toEqual({ decision: 'reject', note: 'first' });
		expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
	});
});

describe('a decision on a withdrawn item', () => {
	// The command's retire_item removed item.json before the post reached the write.
	it('leaves no decision.json beside a removed item.json and reports it gone', async () => {
		await seed('w', { kind: 'design', repo: 'r', title: 't', created: 'c' });
		await rm(join(root, 'items', 'w', 'item.json'));
		expect(await writeDecision(root, 'w', { decision: 'approve' })).toBe(false);
		expect(await writeDecisionOnce(root, 'w', { decision: 'approve' })).toBe('gone');
		expect(await readdir(join(root, 'items', 'w'))).toEqual([]);
	});
});
