import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('$app/env/private', () => ({
	get APPROVAL_QUEUE_STATE() {
		return state.root;
	}
}));

import { load } from './+page.server.ts';

/** Writes a decided item whose decision was made at `at` (epoch seconds), plus any extra sidecar files. */
async function decided(id: string, title: string, at: number, extra: Record<string, string> = {}, kind = 'packet') {
	const dir = join(state.root, 'items', id);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'item.json'), JSON.stringify({ id, kind, title, created: '2026-11-09T10:00:00Z' }));
	await writeFile(join(dir, 'decision.json'), JSON.stringify({ decision: 'approve' }));
	await utimes(join(dir, 'decision.json'), at, at);
	for (const [name, text] of Object.entries(extra)) await writeFile(join(dir, name), text);
}

const history = (q?: string) =>
	load({ url: new URL(`http://x/history${q === undefined ? '' : `?q=${encodeURIComponent(q)}`}`) } as never) as Promise<{
		q: string;
		rows: Array<{ id: string; title: string; notes: number; replies: number }>;
	}>;

beforeEach(async () => {
	state.root = await mkdtemp(join(tmpdir(), 'approval-queue-history-'));
});
afterEach(() => rm(state.root, { recursive: true, force: true }));

describe('/history', () => {
	it('lists decided items newest first, with their notes and replies', async () => {
		await decided('old', 'Old packet', 1_000_000_000);
		await decided('new', 'New packet', 1_800_000_000, {
			'notes.json': JSON.stringify([{ id: 'n1', text: 'x', anchor: null }]),
			'replies.json': JSON.stringify([{ note: 'n1', outcome: 'answered', text: 'done' }])
		});
		const { rows } = await history();
		expect(rows).toMatchObject([
			{ id: 'new', notes: 1, replies: 1 },
			{ id: 'old', notes: 0, replies: 0 }
		]);
	});

	it('searches titles and echoes the query', async () => {
		await decided('a', 'Setup tooling run', 1_000_000_000);
		await decided('b', 'Release notes', 1_000_000_001);
		const found = await history('TOOLING');
		expect(found.q).toBe('TOOLING');
		expect(found.rows.map((r) => r.id)).toEqual(['a']);
	});

	it('still lists a row whose replies.json is malformed', async () => {
		await decided('p', 'Damaged sidecars', 1_000_000_000, { 'replies.json': '{nope', 'notes.json': '[also bad' });
		expect((await history()).rows).toMatchObject([{ id: 'p', title: 'Damaged sidecars', notes: 0, replies: 0 }]);
	});

	it('lists an item of a retired kind', async () => {
		await decided('d', 'An old docs item', 1_000_000_000, {}, 'docs');
		expect((await history()).rows.map((r) => r.id)).toEqual(['d']);
	});
});
