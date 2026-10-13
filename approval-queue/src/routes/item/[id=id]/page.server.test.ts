import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

const ID = '20261011T100000-1';
const TRIAGE = {
	headline: 'Three calls.',
	lede: 'One now, one later, one dropped.',
	rows: [
		{ action: 'one', why: 'a', detail: 'tech', proposed: 'now' },
		{ action: 'two', why: 'b', proposed: 'defer' },
		{ action: 'three', why: 'c', proposed: 'drop' }
	]
};

async function seed(id: string, meta: object, files: Record<string, string>) {
	const dir = join(state.root, 'items', id);
	await mkdir(dir, { recursive: true });
	for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
	await writeFile(join(dir, 'item.json'), JSON.stringify({ id, repo: 'o/r', title: 't', created: '2026-10-11T10:00:00Z', ...meta }));
}

const seedPr = () => seed(ID, { kind: 'pr', head: 'abc' }, { 'body.md': 'hello', 'diff.patch': '+a' });
const seedTriage = () => seed(ID, { kind: 'triage' }, { 'triage.json': JSON.stringify(TRIAGE) });

function call(name: keyof typeof actions, fields: [string, string][] = [], id = ID) {
	const body = new URLSearchParams(fields);
	const request = new Request('http://127.0.0.1:7907/', { method: 'POST', body });
	return actions[name]({ request, params: { id } } as never);
}

const decision = async () => JSON.parse(await readFile(join(state.root, 'items', ID, 'decision.json'), 'utf8'));

beforeEach(async () => {
	state.root = await mkdtemp(join(tmpdir(), 'approval-queue-route-'));
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

	it('submit writes each row with the file action, the changed disposition, and the note', async () => {
		await seedTriage();
		await call('submit', [
			['action', 'forged'],
			['disposition', 'drop'],
			['note', 'not now, the run is waiting'],
			['disposition', 'defer'],
			['note', ''],
			['disposition', 'drop'],
			['note', '']
		]);
		expect(await decision()).toEqual({
			decision: 'submit',
			rows: [
				{ action: 'one', disposition: 'drop', note: 'not now, the run is waiting' },
				{ action: 'two', disposition: 'defer', note: '' },
				{ action: 'three', disposition: 'drop', note: '' }
			]
		});
	});

	it('submit fails with 400 on a short row count', async () => {
		await seedTriage();
		const result = await call('submit', [
			['disposition', 'now'],
			['note', 'a'],
			['disposition', 'now'],
			['note', 'b']
		]);
		expect(result).toMatchObject({ status: 400 });
	});

	it('submit fails with 400 on a disposition outside the set', async () => {
		await seedTriage();
		const result = await call('submit', [
			['disposition', 'later'],
			['note', 'a'],
			['disposition', 'now'],
			['note', 'b'],
			['disposition', 'now'],
			['note', 'c']
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

describe('next', () => {
	const SECOND = '20261011T100100-2';
	const THIRD = '20261011T100200-3';
	const seedAt = (id: string, created: string) =>
		seed(id, { kind: 'pr', head: 'abc', created }, { 'body.md': 'hello', 'diff.patch': '+a' });

	it('returns the item after the current one in queue order', async () => {
		await seedAt(ID, '2026-10-11T10:00:00Z');
		await seedAt(SECOND, '2026-10-11T10:01:00Z');
		expect(await call('approve')).toEqual({ next: `/item/${SECOND}` });
	});

	it('wraps to the oldest other item when the current one is last', async () => {
		await seedAt(ID, '2026-10-11T10:00:00Z');
		await seedAt(SECOND, '2026-10-11T10:01:00Z');
		expect(await call('approve', [], SECOND)).toEqual({ next: `/item/${ID}` });
	});

	it('is null when nothing else waits', async () => {
		await seedPr();
		expect(await call('approve')).toEqual({ next: null });
	});

	it('skips an item whose item.json was removed', async () => {
		await seedAt(ID, '2026-10-11T10:00:00Z');
		await seedAt(SECOND, '2026-10-11T10:01:00Z');
		await seedAt(THIRD, '2026-10-11T10:02:00Z');
		await rm(join(state.root, 'items', SECOND, 'item.json'));
		expect(await call('approve')).toEqual({ next: `/item/${THIRD}` });
	});

	it('comes back from reject and submit too', async () => {
		await seedPr();
		await seedAt(SECOND, '2026-10-11T10:01:00Z');
		expect(await call('reject', [['note', 'x']])).toEqual({ next: `/item/${SECOND}` });
	});
});

describe('load', () => {
	it('returns the decided state for a decided item', async () => {
		await seedPr();
		await call('approve');
		expect(await load({ params: { id: ID } } as never)).toMatchObject({ decided: true, kind: 'pr' });
	});

	it('returns a waiting PR with its figures, sections, and file groups', async () => {
		const body = [
			'Lead paragraph.',
			'',
			'Risk class `runner`.',
			'',
			'## What landed',
			'',
			'Stuff.',
			'',
			'## Review',
			'',
			'First: `fix`. Second: `accept`.'
		].join('\n');
		const diff = [
			'diff --git a/README.md b/README.md',
			'--- a/README.md',
			'+++ b/README.md',
			'@@ -1,1 +1,2 @@',
			' keep',
			'+added',
			'diff --git a/src/a.ts b/src/a.ts',
			'new file mode 100644',
			'--- /dev/null',
			'+++ b/src/a.ts',
			'@@ -0,0 +1,1 @@',
			'+x'
		].join('\n');
		const pr = {
			number: 7,
			url: 'https://github.com/o/r/pull/7',
			headRefName: 'feature',
			baseRefName: 'main',
			statusCheckRollup: [
				{ __typename: 'CheckRun', name: 'build', workflowName: 'ci', status: 'COMPLETED', conclusion: 'SUCCESS' },
				{ __typename: 'CheckRun', name: 'lint', workflowName: 'ci', status: 'COMPLETED', conclusion: 'FAILURE' }
			]
		};
		await seed(ID, { kind: 'pr', head: 'abc', number: 7 }, { 'body.md': body, 'diff.patch': diff, 'pr.json': JSON.stringify(pr) });
		const data = await load({ params: { id: ID } } as never);
		expect(data).toMatchObject({
			decided: false,
			kind: 'pr',
			risk: 'runner',
			verdict: 'accept',
			beforeMergeHtml: null,
			link: { url: pr.url, branches: 'feature into main' },
			checks: { text: '1 passed, 1 failed', failed: 1 },
			totals: { files: 2, adds: 2, dels: 0 }
		});
		const pr_ = data as unknown as {
			leadHtml: string;
			sections: { title: string; html: string }[];
			reviewHtml: string;
			groups: { name: string; files: { path: string }[] }[];
		};
		expect(pr_.leadHtml).toContain('Lead paragraph.');
		expect(pr_.sections.map((x) => x.title)).toEqual(['What landed']);
		expect(pr_.reviewHtml).toContain('accept');
		expect(pr_.groups.map((g) => [g.name, g.files.map((f) => f.path)])).toEqual([
			['Repository root', ['README.md']],
			['src', ['src/a.ts']]
		]);
	});

	it('returns a PR without pr.json with no link and no checks', async () => {
		await seedPr();
		expect(await load({ params: { id: ID } } as never)).toMatchObject({
			link: null,
			risk: null,
			verdict: null,
			checks: { text: 'No checks' }
		});
	});

	it('returns a design with its read time', async () => {
		await seed(ID, { kind: 'design', file: 'd.md' }, { 'doc.md': 'word '.repeat(460) });
		expect(await load({ params: { id: ID } } as never)).toMatchObject({ kind: 'design', minutes: 2 });
	});

	it('renders a Before merge section for a PR that has one', async () => {
		await seed(ID, { kind: 'pr', head: 'abc' }, { 'body.md': 'x\n\n## Before merge\n\nRun `stow -R bin`.', 'diff.patch': '+a' });
		expect(await load({ params: { id: ID } } as never)).toMatchObject({
			beforeMergeHtml: '<p>Run <code>stow -R bin</code>.</p>\n'
		});
	});

	it('returns a triage with its headline, lede, and rows at their proposals', async () => {
		await seedTriage();
		expect(await load({ params: { id: ID } } as never)).toMatchObject({
			kind: 'triage',
			headline: 'Three calls.',
			lede: 'One now, one later, one dropped.',
			rows: [
				{ action: 'one', why: 'a', detail: 'tech', proposed: 'now', disposition: 'now', note: '' },
				{ action: 'two', proposed: 'defer', disposition: 'defer', note: '' },
				{ action: 'three', proposed: 'drop', disposition: 'drop', note: '' }
			]
		});
	});

	it('throws 404 on an unknown id', async () => {
		await expect(load({ params: { id: ID } } as never)).rejects.toMatchObject({ status: 404 });
	});
});
