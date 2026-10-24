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

import { load } from './+page.server.ts';

beforeEach(async () => {
	state.root = await mkdtemp(join(tmpdir(), 'approval-queue-claim-'));
});
afterEach(() => rm(state.root, { recursive: true, force: true }));

/** Runs the load and returns the cookie it set. */
async function visit() {
	const sets: Array<{ name: string; value: string; options: object }> = [];
	await load({ cookies: { set: (name: string, value: string, options: object) => sets.push({ name, value, options }) } } as never);
	return sets;
}

describe('/claim', () => {
	it('makes the token on the first visit and sets the cookie to it, with the options a 127.0.0.1 page needs', async () => {
		const [set] = await visit();
		const token = await readFile(join(state.root, 'claim.token'), 'utf8');
		expect(token).toMatch(/^[0-9a-f]{64}$/);
		expect(set).toEqual({
			name: 'desk-claim',
			value: token,
			options: { path: '/', httpOnly: true, sameSite: 'lax', secure: false, maxAge: 34_560_000 }
		});
		expect((await stat(join(state.root, 'claim.token'))).mode & 0o777).toBe(0o600);
	});

	it('reuses the token on a later visit', async () => {
		const [first] = await visit();
		const [second] = await visit();
		expect(second.value).toBe(first.value);
	});

	it('agrees on one token when two first visits race', async () => {
		const sets = (await Promise.all([visit(), visit(), visit()])).flat();
		expect(new Set(sets.map((s) => s.value)).size).toBe(1);
		expect(sets[0].value).toBe(await readFile(join(state.root, 'claim.token'), 'utf8'));
	});
});
