import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

async function write(id: string, item: object, decision?: object, files: Record<string, string> = {}) {
	const dir = join(state.root, 'items', id);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'item.json'), JSON.stringify({ id, created: '2026-11-01T10:00:00Z', ...item }));
	if (decision) await writeFile(join(dir, 'decision.json'), JSON.stringify(decision));
	for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
}

const open = (id: string) => load({ params: { id } } as never) as Promise<Record<string, unknown>>;

beforeEach(async () => {
	state.root = await mkdtemp(join(tmpdir(), 'approval-queue-retired-'));
});
afterEach(() => rm(state.root, { recursive: true, force: true }));

describe('a decided item of a kind the queue no longer serves', () => {
	it.each(['docs', 'pr'])('opens read-only as its title, kind, decision, and date: %s', async (kind) => {
		await write('old', { kind, title: 'An old item' }, { decision: 'approve' });
		expect(await open('old')).toMatchObject({ kind: 'retired', title: 'An old item', itemKind: kind, decision: 'approve' });
		expect(typeof (await open('old')).date).toBe('string');
	});

	it('is still a 404 while it has no decision, and for an id that never existed', async () => {
		await write('waiting', { kind: 'docs', title: 'Waiting' });
		await expect(open('waiting')).rejects.toMatchObject({ status: 404 });
		await expect(open('nothing')).rejects.toMatchObject({ status: 404 });
	});

	it('opens a packet whose fact file no longer checks as its stored record, not a 404', async () => {
		await write('damaged', { kind: 'packet', title: 'Damaged' }, { decision: 'reject' }, { 'facts.json': '{nope', 'text.md': '# x' });
		expect(await open('damaged')).toMatchObject({ kind: 'retired', title: 'Damaged', itemKind: 'packet', decision: 'reject' });
	});
});

describe('a decided packet stored before the fact file', () => {
	it('carries its date beside its stored text', async () => {
		await write('legacy', { kind: 'packet', title: 'Legacy' }, { decision: 'approve' }, { 'packet.md': 'stored text' });
		const data = await open('legacy');
		expect(data).toMatchObject({ kind: 'legacy', text: 'stored text' });
		expect(typeof data.date).toBe('string');
	});
});
