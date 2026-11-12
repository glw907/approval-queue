
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('$app/env/private', () => ({
	get APPROVAL_QUEUE_STATE() {
		return state.root;
	}
}));

import { seedFacts } from '#lib/server/seed-facts.ts';
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

/** Marks the first call of a seeded packet irreversible, the one rule that flags a packet. */
async function makeIrreversible(id: string) {
	const file = join(state.root, 'items', id, 'facts.json');
	const facts = JSON.parse(await readFile(file, 'utf8'));
	facts.calls[0].rule = 'irreversible';
	await writeFile(file, JSON.stringify(facts));
}

const board = (sort?: string) =>
	load({ depends() {}, isDataRequest: true, cookies: { get: () => sort } } as never) as Promise<{
		empty: false;
		sort: string;
		rows: Array<{ id: string; headline: string; group: string; asks: number; rules: string[]; repos: number; irreversible: boolean; single?: string; orphaned: boolean }>;
	}>;

describe('/', () => {
	it('lists a seeded packet under its initiative, with its asks and repos', async () => {
		await seedFacts(state.root, 'p1', 'close', { initiative: 'sample-ui', initiativeTitle: 'Sample UI' });
		const data = await board();
		expect(data.rows).toMatchObject([{ id: 'p1', group: 'Sample UI', asks: 2, repos: 1 }]);
		expect(data.rows[0].rules).toContain('public-surface');
	});

	it('carries a packet\'s round and its repo names onto its row, and no round key when it has none', async () => {
		await seedFacts(state.root, 'r1', 'close', { round: 'ur-queue' });
		await seedFacts(state.root, 'r2', 'close', { created: '2026-10-11T11:00:00Z' });
		const { rows } = await board();
		const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
		expect(byId.r1).toMatchObject({ round: 'ur-queue', repoNames: ['sample'] });
		expect('round' in byId.r2).toBe(false);
	});

	it('marks a packet with an irreversible call, and only that packet', async () => {
		await seedFacts(state.root, 'p1', 'close', { initiative: 'sample-ui', initiativeTitle: 'Sample UI' });
		await seedFacts(state.root, 'p2', 'close', { initiative: 'sample-ui', initiativeTitle: 'Sample UI', created: '2026-10-11T11:00:00Z' });
		await makeIrreversible('p2');
		const { rows } = await board();
		expect(Object.fromEntries(rows.map((r) => [r.id, r.irreversible]))).toEqual({ p1: false, p2: true });
	});

	it('shows an item that is not a packet under Single items, with no redirect', async () => {
		await seed('a', '2026-10-11T10:00:00Z');
		expect((await board()).rows).toMatchObject([{ id: 'a', group: 'Single items', asks: 0, single: 'Design' }]);
	});

	it.each([
		['a facts.json that is not JSON', (dir: string) => writeFile(join(dir, 'facts.json'), '{nope')],
		['a facts.json withdrawn mid-load', (dir: string) => rm(join(dir, 'facts.json'))]
	])('names an unreadable packet in Single items instead of failing the board: %s', async (_name, damage) => {
		await seedFacts(state.root, 'p1', 'close', { created: '2026-10-11T10:00:00Z', initiative: 'sample-ui', initiativeTitle: 'Sample UI' });
		await seedFacts(state.root, 'p2', 'close', { created: '2026-10-11T11:00:00Z' });
		await damage(join(state.root, 'items', 'p2'));
		const { rows } = await board();
		expect(rows).toMatchObject([
			{ id: 'p1', group: 'Sample UI' },
			{ id: 'p2', headline: 'p2', group: 'Single items', asks: 0, irreversible: false, single: 'Unreadable' }
		]);
	});

	it('carries whether the session that queued a row is gone', async () => {
		await seed('a', '2026-10-11T10:00:00Z');
		await seed('c', '2026-10-11T12:00:00Z');
		await writeFile(join(state.root, 'items', 'c', 'item.json'), JSON.stringify({ id: 'c', kind: 'design', repo: 'o/r', title: 'c', created: '2026-10-11T12:00:00Z', pid: 2 ** 22 + 1, pidStart: 1 }));
		const { rows } = await board();
		expect(Object.fromEntries(rows.map((r) => [r.id, r.orphaned]))).toEqual({ a: false, c: true });
	});

	it('reads the sort from the cookie, asks first by default', async () => {
		await seed('a', '2026-10-11T10:00:00Z');
		expect((await board()).sort).toBe('asks');
		expect((await board('oldest')).sort).toBe('oldest');
		expect((await board('nonsense')).sort).toBe('asks');
	});

	it('depends on desk:queue, so the poll refreshes the board', async () => {
		const keys: string[] = [];
		await load({ depends: (key: string) => keys.push(key), isDataRequest: true, cookies: { get: () => undefined } } as never);
		expect(keys).toEqual(['desk:queue']);
	});

	it('returns the empty state with nothing waiting', async () => {
		expect(await board()).toEqual({ empty: true });
	});
});

describe('/ on a first load', () => {
	const open = (isDataRequest: boolean) => load({ depends() {}, isDataRequest, cookies: { get: () => undefined } } as never);
	/** The redirect `load` throws, as SvelteKit's `redirect` makes it. */
	const redirected = async (isDataRequest: boolean) => {
		try {
			await open(isDataRequest);
		} catch (thrown) {
			return thrown as { status: number; location: string };
		}
	};

	it('redirects to the oldest waiting packet', async () => {
		await seedFacts(state.root, 'late', 'close', { created: '2026-10-11T11:00:00Z' });
		await seedFacts(state.root, 'early', 'stop', { created: '2026-10-11T10:00:00Z' });
		await seed('d', '2026-10-11T09:00:00Z');
		expect(await redirected(false)).toMatchObject({ status: 302, location: '/item/early' });
	});

	it('shows the board when only a design or an unreadable packet waits', async () => {
		await seed('d', '2026-10-11T09:00:00Z');
		await seedFacts(state.root, 'bad', 'close', { created: '2026-10-11T10:00:00Z' });
		await writeFile(join(state.root, 'items', 'bad', 'facts.json'), '{nope');
		expect(await redirected(false)).toBeUndefined();
	});

	it('never redirects a navigation inside the app, so the board key and a decision that empties the queue land on the board', async () => {
		await seedFacts(state.root, 'p1', 'close', { created: '2026-10-11T10:00:00Z' });
		expect(await redirected(true)).toBeUndefined();
	});
});

describe('layout', () => {
	it('loads the waiting queue and the digest line, with no digest yet', async () => {
		await seed('a', '2026-10-11T10:00:00Z');
		const data = await layoutLoad({ depends() {}, isDataRequest: false } as never);
		expect(data).toMatchObject({ queue: [{ id: 'a' }], digest: null });
	});

	it('gives each packet its call count and kind, and every other kind none', async () => {
		await seed('a', '2026-10-11T10:00:00Z');
		await seedFacts(state.root, 'p1', 'close', { created: '2026-10-11T11:00:00Z' });
		await seedFacts(state.root, 'p2', 'stop', { created: '2026-10-11T12:00:00Z' });
		const { queue } = (await layoutLoad({ depends() {}, isDataRequest: false } as never)) as unknown as {
			queue: Array<{ id: string; asks: number; packetKind?: string }>;
		};
		expect(Object.fromEntries(queue.map((q) => [q.id, [q.asks, q.packetKind]]))).toMatchObject({ a: [0, undefined], p1: [2, 'close'], p2: [expect.any(Number), 'stop'] });
	});

	it('summarizes the newest day of the digest', async () => {
		const line = (time: string, n: number) => JSON.stringify({ time, ref: `o/r#${n}`, head: 'h', claim: `c${n}`, lane: 'land' });
		await writeFile(join(state.root, 'digest.jsonl'), [line('2026-11-09T12:00:00Z', 1), line('2026-11-10T12:00:00Z', 2), line('2026-11-10T12:10:00Z', 3)].join('\n') + '\n');
		const data = await layoutLoad({ depends() {}, isDataRequest: false } as never);
		expect(data).toMatchObject({ digest: { count: 2, day: '10 November' } });
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

describe('a round report', () => {
	const REPORT = '# Round ur-queue\n\n| Pass | State |\n| --- | --- |\n| Q1 | merged |\n| Q2 | parked |\n';

	async function seedReport(id: string, files: Record<string, string> = { 'report.md': REPORT }) {
		const dir = join(state.root, 'items', id);
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, 'item.json'),
			JSON.stringify({ id, kind: 'report', title: 'Round ur-queue', initiative: 'ur', initiativeTitle: 'Unattended rounds', round: 'ur-queue', created: '2026-11-12T06:00:00Z' })
		);
		for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
	}

	it('rows as a single "Round report" in its round, headed by the pass count', async () => {
		await seedReport('rep');
		const { rows } = await board();
		expect(rows).toMatchObject([{ id: 'rep', group: 'Unattended rounds', round: 'ur-queue', single: 'Round report', headline: '1 of 2 passes merged, 1 parked', asks: 0 }]);
	});

	it('shows its title when the report holds no pass table', async () => {
		await seedReport('rep', { 'report.md': '# Round ur-queue\n\nStops: 0\n' });
		expect((await board()).rows[0].headline).toBe('Round ur-queue');
	});

	it('carries the computed headline into the rail queue', async () => {
		await seedReport('rep');
		const { queue } = (await layoutLoad({ depends() {}, isDataRequest: false } as never)) as unknown as { queue: Array<{ id: string; headline?: string }> };
		expect(queue).toMatchObject([{ id: 'rep', headline: '1 of 2 passes merged, 1 parked' }]);
	});
});
