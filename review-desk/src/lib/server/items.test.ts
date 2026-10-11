import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listWaiting, readItem, writeDecision } from './items.ts';

let root: string;

async function seed(id: string, meta: object, files: Record<string, string> = {}) {
	const dir = join(root, 'items', id);
	await mkdir(dir, { recursive: true });
	for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
	await writeFile(join(dir, 'item.json'), JSON.stringify({ id, ...meta }));
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'review-desk-test-'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('listWaiting', () => {
	it('lists newest first', async () => {
		await seed('20261011T100000-1', { kind: 'design', repo: 'r', title: 'old', created: '2026-10-11T10:00:00Z' });
		await seed('20261011T110000-2', { kind: 'design', repo: 'r', title: 'new', created: '2026-10-11T11:00:00Z' });
		expect((await listWaiting(root)).map((m) => m.title)).toEqual(['new', 'old']);
	});

	it('skips a decided item and a directory with no item.json', async () => {
		await seed('20261011T100000-1', { kind: 'design', repo: 'r', title: 'done', created: '2026-10-11T10:00:00Z' });
		await writeDecision(root, '20261011T100000-1', { decision: 'approve' });
		await mkdir(join(root, 'items', '20261011T120000-3'), { recursive: true });
		expect(await listWaiting(root)).toEqual([]);
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

	it('reads a design', async () => {
		await seed('20261011T100000-1', { kind: 'design', repo: 'r', title: 't', created: 'c' }, { 'doc.md': '# doc' });
		expect((await readItem(root, '20261011T100000-1'))?.content).toEqual({ kind: 'design', doc: '# doc' });
	});

	it('reads a triage list', async () => {
		const rows = [{ item: 'x', disposition: 'now', reason: 'why' }];
		await seed(
			'20261011T100000-1',
			{ kind: 'triage', repo: 'r', title: 't', created: 'c' },
			{ 'triage.json': JSON.stringify(rows) }
		);
		expect((await readItem(root, '20261011T100000-1'))?.content).toEqual({ kind: 'triage', rows });
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
