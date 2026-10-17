import { readFileSync } from 'node:fs';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('$app/env/private', () => ({
	get APPROVAL_QUEUE_STATE() {
		return state.root;
	}
}));

import { seedPacket } from '#lib/fixtures/seed-packet.ts';
import { load as layoutLoad } from './+layout.server.ts';
import { load } from './+page.server.ts';

async function seed(id: string, created: string) {
	const dir = join(state.root, 'items', id);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'item.json'), JSON.stringify({ id, kind: 'design', repo: 'o/r', title: id, created }));
}

beforeEach(async () => {
	state.root = await mkdtemp(join(tmpdir(), 'approval-queue-root-'));
});
afterEach(() => rm(state.root, { recursive: true, force: true }));

const PACKET = readFileSync(new URL('../../../tests/fixtures/e2e-packet.md', import.meta.url), 'utf8');

const board = (sort?: string) =>
	load({ depends() {}, cookies: { get: () => sort } } as never) as Promise<{
		empty: false;
		sort: string;
		rows: Array<{ id: string; group: string; asks: number; rules: string[]; repos: number; single?: string }>;
	}>;

describe('/', () => {
	it('lists a seeded packet under its initiative, with its asks and repos', async () => {
		await seedPacket(state.root, 'p1', PACKET, { initiative: 'drafter-ui', initiativeTitle: 'Drafter UI' });
		const data = await board();
		expect(data.rows).toMatchObject([{ id: 'p1', group: 'Drafter UI', asks: 2, repos: 1 }]);
		expect(data.rows[0].rules).toContain('gate-failed');
	});

	it('shows an item that is not a packet under Single items, with no redirect', async () => {
		await seed('a', '2026-10-11T10:00:00Z');
		expect((await board()).rows).toMatchObject([{ id: 'a', group: 'Single items', asks: 0, single: 'Design' }]);
	});

	it('reads the sort from the cookie, asks first by default', async () => {
		await seed('a', '2026-10-11T10:00:00Z');
		expect((await board()).sort).toBe('asks');
		expect((await board('oldest')).sort).toBe('oldest');
		expect((await board('nonsense')).sort).toBe('asks');
	});

	it('depends on desk:queue, so the poll refreshes the board', async () => {
		const keys: string[] = [];
		await load({ depends: (key: string) => keys.push(key), cookies: { get: () => undefined } } as never);
		expect(keys).toEqual(['desk:queue']);
	});

	it('returns the empty state with nothing waiting', async () => {
		expect(await board()).toEqual({ empty: true });
	});
});

describe('layout', () => {
	it('loads the waiting queue and what was decided since the app started', async () => {
		await seed('a', '2026-10-11T10:00:00Z');
		const data = await layoutLoad({ depends() {}, isDataRequest: false } as never);
		expect(data).toMatchObject({ queue: [{ id: 'a' }], decided: [] });
	});

	it('depends on desk:queue, so the open tab can poll it', async () => {
		const keys: string[] = [];
		await layoutLoad({ depends: (key: string) => keys.push(key), isDataRequest: false } as never);
		expect(keys).toEqual(['desk:queue']);
	});

	it('touches tab.seen on a poll from a running page, never on a server render', async () => {
		const seen = join(state.root, 'tab.seen');
		await layoutLoad({ depends() {}, isDataRequest: false } as never);
		await expect(access(seen)).rejects.toThrow();
		await layoutLoad({ depends() {}, isDataRequest: true } as never);
		await expect(access(seen)).resolves.toBeUndefined();
	});
});
