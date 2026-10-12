import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('$app/env/private', () => ({
	get REVIEW_DESK_STATE() {
		return state.root;
	}
}));

import { load as layoutLoad } from './+layout.server.ts';
import { load } from './+page.server.ts';

async function seed(id: string, created: string) {
	const dir = join(state.root, 'items', id);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, 'item.json'), JSON.stringify({ id, kind: 'design', repo: 'o/r', title: id, created }));
}

beforeEach(async () => {
	state.root = await mkdtemp(join(tmpdir(), 'review-desk-root-'));
});
afterEach(() => rm(state.root, { recursive: true, force: true }));

describe('/', () => {
	it('redirects to the oldest waiting item', async () => {
		await seed('b', '2026-10-11T10:01:00Z');
		await seed('a', '2026-10-11T10:00:00Z');
		await expect(load({} as never)).rejects.toMatchObject({ status: 307, location: '/item/a' });
	});

	it('returns the empty state with nothing waiting', async () => {
		expect(await load({} as never)).toEqual({ empty: true });
	});
});

describe('layout', () => {
	it('loads the waiting queue and what was decided since the app started', async () => {
		await seed('a', '2026-10-11T10:00:00Z');
		const data = await layoutLoad({} as never);
		expect(data).toMatchObject({ queue: [{ id: 'a' }], decided: [] });
	});
});
