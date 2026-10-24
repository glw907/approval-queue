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
		rows: Array<{ id: string; group: string; asks: number; rules: string[]; repos: number; irreversible: boolean; single?: string; deferred: boolean; orphaned: boolean }>;
	}>;

describe('/', () => {
	it('lists a seeded packet under its initiative, with its asks and repos', async () => {
		await seedPacket(state.root, 'p1', PACKET, { initiative: 'drafter-ui', initiativeTitle: 'Drafter UI' });
		const data = await board();
		expect(data.rows).toMatchObject([{ id: 'p1', group: 'Drafter UI', asks: 2, repos: 1 }]);
		expect(data.rows[0].rules).toContain('gate-failed');
	});

	it('marks a packet with an irreversible step, and only that packet', async () => {
		await seedPacket(state.root, 'p1', PACKET, { initiative: 'drafter-ui', initiativeTitle: 'Drafter UI' });
		await seedPacket(state.root, 'p2', PACKET.replace(/^1\. \[session\]/m, '1. [irreversible]'), {
			initiative: 'drafter-ui',
			initiativeTitle: 'Drafter UI',
			created: '2026-10-11T11:00:00Z'
		});
		const { rows } = await board();
		expect(Object.fromEntries(rows.map((r) => [r.id, r.irreversible]))).toEqual({ p1: false, p2: true });
	});

	it('shows an item that is not a packet under Single items, with no redirect', async () => {
		await seed('a', '2026-10-11T10:00:00Z');
		expect((await board()).rows).toMatchObject([{ id: 'a', group: 'Single items', asks: 0, single: 'Design' }]);
	});

	it.each([
		['a packet.json that is not JSON', (dir: string) => writeFile(join(dir, 'packet.json'), '{nope')],
		['a packet.json withdrawn mid-load', (dir: string) => rm(join(dir, 'packet.json'))]
	])('names an unreadable packet in Single items instead of failing the board: %s', async (_name, damage) => {
		await seedPacket(state.root, 'p1', PACKET, { initiative: 'drafter-ui', initiativeTitle: 'Drafter UI' });
		await seedPacket(state.root, 'p2', PACKET, { created: '2026-10-11T11:00:00Z' });
		await damage(join(state.root, 'items', 'p2'));
		const { rows } = await board();
		expect(rows).toMatchObject([
			{ id: 'p1', group: 'Drafter UI' },
			{ id: 'p2', headline: 'p2', group: 'Single items', asks: 0, irreversible: false, single: 'Unreadable' }
		]);
	});

	it('carries whether Geoff deferred a row and whether its session is gone', async () => {
		await seed('a', '2026-10-11T10:00:00Z');
		await seed('b', '2026-10-11T11:00:00Z');
		await seed('c', '2026-10-11T12:00:00Z');
		await writeFile(join(state.root, 'items', 'b', 'deferred.json'), '{}');
		await writeFile(join(state.root, 'items', 'c', 'item.json'), JSON.stringify({ id: 'c', kind: 'design', repo: 'o/r', title: 'c', created: '2026-10-11T12:00:00Z', pid: 2 ** 22 + 1, pidStart: 1 }));
		const { rows } = await board();
		expect(Object.fromEntries(rows.map((r) => [r.id, [r.deferred, r.orphaned]]))).toEqual({ a: [false, false], b: [true, false], c: [false, true] });
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

	describe('the claim', () => {
		const TOKEN = 'a'.repeat(64);
		const seen = () => join(state.root, 'tab.seen');

		/** Runs the layout load as a poll (or a server render) carrying `cookie`, and returns the cookie sets. */
		async function poll(cookie: string | undefined, isDataRequest = true) {
			const sets: Array<{ name: string; value: string; options: object }> = [];
			const cookies = { get: () => cookie, set: (name: string, value: string, options: object) => sets.push({ name, value, options }) };
			await layoutLoad({ depends() {}, isDataRequest, cookies } as never);
			return sets;
		}

		it('touches tab.seen and sets the cookie again on a poll that carries the token', async () => {
			await writeFile(join(state.root, 'claim.token'), TOKEN);
			expect(await poll(TOKEN)).toEqual([
				{
					name: 'desk-claim',
					value: TOKEN,
					options: { path: '/', httpOnly: true, sameSite: 'lax', secure: false, maxAge: 34_560_000 }
				}
			]);
			await expect(access(seen())).resolves.toBeUndefined();
		});

		it('touches nothing for a poll with another value, with no cookie, or with no token file', async () => {
			await writeFile(join(state.root, 'claim.token'), TOKEN);
			expect(await poll('b'.repeat(64))).toEqual([]);
			expect(await poll(undefined)).toEqual([]);
			await rm(join(state.root, 'claim.token'));
			expect(await poll(TOKEN)).toEqual([]);
			expect(await poll('')).toEqual([]);
			await expect(access(seen())).rejects.toThrow();
		});

		it('never touches tab.seen on a server render, whatever the cookie', async () => {
			await writeFile(join(state.root, 'claim.token'), TOKEN);
			expect(await poll(TOKEN, false)).toEqual([]);
			await expect(access(seen())).rejects.toThrow();
		});
	});
});
