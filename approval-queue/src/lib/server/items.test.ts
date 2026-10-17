import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { seedPacket } from '#lib/fixtures/seed-packet.ts';
import { listDecided, listWaiting, readItem, writeDecision, writeDecisionOnce } from './items.ts';

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

	it('returns an empty list when there is no items directory', async () => {
		expect(await listDecided(root, 0)).toEqual([]);
	});
});

describe('readItem', () => {
	it('reads a PR', async () => {
		await seed(
			'20261011T100000-1',
			{ kind: 'pr', repo: 'o/r', title: 't', created: '2026-10-11T10:00:00Z', head: 'abc' },
			{ 'body.md': 'body', 'diff.patch': 'diff' }
		);
		const item = await readItem(root, '20261011T100000-1');
		expect(item?.content).toEqual({ kind: 'pr', body: 'body', diff: 'diff' });
		expect(item?.decided).toBe(false);
	});

	it('reads a PR with its pr.json', async () => {
		const pr = { number: 7, url: 'https://x/pull/7', statusCheckRollup: [] };
		await seed(
			'20261011T100000-1',
			{ kind: 'pr', repo: 'o/r', title: 't', created: 'c', number: 7 },
			{ 'body.md': 'body', 'diff.patch': 'diff', 'pr.json': JSON.stringify(pr) }
		);
		const item = await readItem(root, '20261011T100000-1');
		expect(item?.content).toEqual({ kind: 'pr', body: 'body', diff: 'diff', pr });
	});

	it('reads an old-format PR with no pr.json and no number', async () => {
		await seed(
			'20261011T100000-1',
			{ kind: 'pr', repo: 'o/r', title: 't', created: 'c' },
			{ 'body.md': 'body', 'diff.patch': 'diff' }
		);
		const item = await readItem(root, '20261011T100000-1');
		expect(item?.meta.number).toBeUndefined();
		expect(item?.content).toEqual({ kind: 'pr', body: 'body', diff: 'diff' });
	});

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

const PACKET = readFileSync(new URL('../fixtures/packet-baseline.md', import.meta.url), 'utf8');

describe('a packet item', () => {
	it('reads the parse and each part with its head or hash, by its index in packet.parts', async () => {
		await seedPacket(root, 'p', PACKET);
		const item = await readItem(root, 'p');
		if (item?.content.kind !== 'packet') throw new Error('not a packet');
		expect(item.content.packet.headline).toContain('merges two drafter PRs');
		expect(item.content.parts.map((p) => [p.ref, p.kind, p.lane, p.verdict, p.head ?? p.sha256?.length])).toEqual([
			['glw907/drafter#41', 'pr', 'ask', '', 'aaa111'],
			['glw907/drafter#42', 'pr', 'routine', 'approve', 'bbb222'],
			['glw907/drafter:docs/specs/notes-design.md', 'design', 'routine', 'approve', 64],
			['step:1', 'step', 'routine', 'session', undefined]
		]);
	});

	it('hashes the design copy the reader saw', async () => {
		await seedPacket(root, 'p', PACKET);
		const item = await readItem(root, 'p');
		if (item?.content.kind !== 'packet') throw new Error('not a packet');
		const design = item.content.parts.find((p) => p.kind === 'design');
		const doc = await readFile(join(root, 'items', 'p', 'parts', '2', 'doc.md'));
		expect(design?.sha256).toBe(createHash('sha256').update(doc).digest('hex'));
		expect(design?.doc).toBe(doc.toString());
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

describe('writeDecisionOnce', () => {
	it('links the decision into place and refuses a second one without replacing the first', async () => {
		await seed('p', { kind: 'design', repo: 'r', title: 't', created: 'c' });
		expect(await writeDecisionOnce(root, 'p', { decision: 'reject', note: 'first' })).toBe(true);
		expect(await writeDecisionOnce(root, 'p', { decision: 'reject', note: 'second' })).toBe(false);
		const dir = join(root, 'items', 'p');
		expect(JSON.parse(await readFile(join(dir, 'decision.json'), 'utf8'))).toEqual({ decision: 'reject', note: 'first' });
		expect((await readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
	});
});
