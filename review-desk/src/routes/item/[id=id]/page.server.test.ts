import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('$app/env/private', () => ({
	get REVIEW_DESK_STATE() {
		return state.root;
	}
}));

import { actions, load } from './+page.server.ts';

const ID = '20261011T100000-1';
const ROWS = [
	{ item: 'one', disposition: 'now', reason: 'a' },
	{ item: 'two', disposition: 'defer', reason: 'b' },
	{ item: 'three', disposition: 'drop', reason: 'c' }
];

async function seed(id: string, meta: object, files: Record<string, string>) {
	const dir = join(state.root, 'items', id);
	await mkdir(dir, { recursive: true });
	for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
	await writeFile(join(dir, 'item.json'), JSON.stringify({ id, repo: 'o/r', title: 't', created: '2026-10-11T10:00:00Z', ...meta }));
}

const seedPr = () => seed(ID, { kind: 'pr', head: 'abc' }, { 'body.md': 'hello', 'diff.patch': '+a' });
const seedTriage = () => seed(ID, { kind: 'triage' }, { 'triage.json': JSON.stringify(ROWS) });

function call(name: keyof typeof actions, fields: [string, string][] = [], id = ID) {
	const body = new URLSearchParams(fields);
	const request = new Request('http://127.0.0.1:7907/', { method: 'POST', body });
	return actions[name]({ request, params: { id } } as never);
}

const decision = async () => JSON.parse(await readFile(join(state.root, 'items', ID, 'decision.json'), 'utf8'));

beforeEach(async () => {
	state.root = await mkdtemp(join(tmpdir(), 'review-desk-route-'));
});
afterEach(() => rm(state.root, { recursive: true, force: true }));

describe('actions', () => {
	it('approve writes the decision', async () => {
		await seedPr();
		await call('approve');
		expect(await decision()).toEqual({ decision: 'approve' });
	});

	it('reject writes the note', async () => {
		await seedPr();
		await call('reject', [['note', 'no good']]);
		expect(await decision()).toEqual({ decision: 'reject', note: 'no good' });
	});

	it('submit writes every row with the file item text', async () => {
		await seedTriage();
		await call('submit', [
			['item', 'forged'],
			['disposition', 'drop'],
			['reason', 'a'],
			['disposition', 'defer'],
			['reason', 'b'],
			['disposition', 'drop'],
			['reason', 'c']
		]);
		expect(await decision()).toEqual({
			decision: 'submit',
			rows: [{ ...ROWS[0], disposition: 'drop' }, ROWS[1], ROWS[2]]
		});
	});

	it('submit fails with 400 on a short row count', async () => {
		await seedTriage();
		const result = await call('submit', [
			['disposition', 'now'],
			['reason', 'a'],
			['disposition', 'now'],
			['reason', 'b']
		]);
		expect(result).toMatchObject({ status: 400 });
	});

	it('submit fails with 400 on a disposition outside the set', async () => {
		await seedTriage();
		const result = await call('submit', [
			['disposition', 'later'],
			['reason', 'a'],
			['disposition', 'now'],
			['reason', 'b'],
			['disposition', 'now'],
			['reason', 'c']
		]);
		expect(result).toMatchObject({ status: 400 });
	});

	it('fails with 404 on a decided item', async () => {
		await seedPr();
		await call('approve');
		await expect(call('approve')).rejects.toMatchObject({ status: 404 });
	});

	it('fails with 404 on an unknown id', async () => {
		await expect(call('approve')).rejects.toMatchObject({ status: 404 });
	});
});

describe('load', () => {
	it('returns the decided state for a decided item', async () => {
		await seedPr();
		await call('approve');
		expect(await load({ params: { id: ID } } as never)).toMatchObject({ decided: true, kind: 'pr' });
	});

	it('returns a waiting PR rendered and classified', async () => {
		await seedPr();
		expect(await load({ params: { id: ID } } as never)).toMatchObject({
			decided: false,
			bodyHtml: '<p>hello</p>\n',
			beforeMergeHtml: null,
			diff: [{ kind: 'added', text: '+a' }]
		});
	});

	it('renders a Before merge section for a PR that has one', async () => {
		await seed(ID, { kind: 'pr', head: 'abc' }, { 'body.md': 'x\n\n## Before merge\n\nRun `stow -R bin`.', 'diff.patch': '+a' });
		expect(await load({ params: { id: ID } } as never)).toMatchObject({
			beforeMergeHtml: '<p>Run <code>stow -R bin</code>.</p>\n'
		});
	});

	it('throws 404 on an unknown id', async () => {
		await expect(load({ params: { id: ID } } as never)).rejects.toMatchObject({ status: 404 });
	});
});
