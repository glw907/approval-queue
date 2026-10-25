import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('$app/env/private', () => ({
	get APPROVAL_QUEUE_STATE() {
		return state.root;
	}
}));

import { actions, load } from './+page.server.ts';

beforeEach(async () => {
	state.root = await mkdtemp(join(tmpdir(), 'approval-queue-claim-'));
});
afterEach(() => rm(state.root, { recursive: true, force: true }));

type Cookie = { name: string; value: string; options: object };

/** A cookie jar that holds `held` and records each set. */
function jar(held?: string) {
	const sets: Cookie[] = [];
	const cookies = {
		get: (name: string) => (name === 'desk-claim' ? held : undefined),
		set: (name: string, value: string, options: object) => sets.push({ name, value, options })
	};
	return { cookies, sets };
}

/** Presses the button and returns the cookie it set. */
async function press() {
	const { cookies, sets } = jar();
	await actions.default({ cookies } as never);
	return sets;
}

describe('/claim', () => {
	it('sets no cookie and makes no token on a load', async () => {
		const { cookies, sets } = jar();
		expect(await load({ cookies } as never)).toEqual({ claimed: false });
		expect(sets).toEqual([]);
		await expect(stat(join(state.root, 'claim.token'))).rejects.toThrow();
	});

	it('makes the token on the first press and sets the cookie to it, with the options a 127.0.0.1 page needs', async () => {
		const [set] = await press();
		const token = await readFile(join(state.root, 'claim.token'), 'utf8');
		expect(token).toMatch(/^[0-9a-f]{64}$/);
		expect(set).toEqual({
			name: 'desk-claim',
			value: token,
			options: { path: '/', httpOnly: true, sameSite: 'lax', secure: false, maxAge: 34_560_000 }
		});
		expect((await stat(join(state.root, 'claim.token'))).mode & 0o777).toBe(0o600);
	});

	it('reports claimed on a load that carries the matching cookie, and not a stale one', async () => {
		const [set] = await press();
		expect(await load({ cookies: jar(set.value).cookies } as never)).toEqual({ claimed: true });
		expect(await load({ cookies: jar('stale').cookies } as never)).toEqual({ claimed: false });
	});

	it('reuses the token on a later press', async () => {
		const [first] = await press();
		const [second] = await press();
		expect(second.value).toBe(first.value);
	});

	it('agrees on one token when two first presses race', async () => {
		const sets = (await Promise.all([press(), press(), press()])).flat();
		expect(new Set(sets.map((s) => s.value)).size).toBe(1);
		expect(sets[0].value).toBe(await readFile(join(state.root, 'claim.token'), 'utf8'));
	});
});
