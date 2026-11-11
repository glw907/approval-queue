import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ root: '', vanish: false }));
vi.mock('$app/env/private', () => ({
	get APPROVAL_QUEUE_STATE() {
		return state.root;
	}
}));
// A test sets `vanish` to have the command's withdraw land between the route's read and its write.
vi.mock('#lib/server/items.ts', async (importOriginal) => {
	const real = await importOriginal<typeof import('#lib/server/items.ts')>();
	const { rm } = await import('node:fs/promises');
	const { join } = await import('node:path');
	const withdraw = async (root: string, id: string) => {
		if (state.vanish) await rm(join(root, 'items', id, 'item.json'));
	};
	return {
		...real,
		writeDecision: async (root: string, id: string, decision: Parameters<typeof real.writeDecision>[2]) => {
			await withdraw(root, id);
			return real.writeDecision(root, id, decision);
		},
		writeDecisionOnce: async (root: string, id: string, decision: Parameters<typeof real.writeDecisionOnce>[2]) => {
			await withdraw(root, id);
			return real.writeDecisionOnce(root, id, decision);
		}
	};
});

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

const fixture = (name: string) => readFileSync(new URL(`../../../lib/fixtures/${name}`, import.meta.url), 'utf8');
/** PR #40's brief as a design doc, with T5's Decide block before its Worth knowing. */
const DESIGN_DECIDE = `# A design\n\n${fixture('pr-40-brief.md')
	.replace('# Send every session-opened PR to approval\n\n', '')
	.replace('### Worth knowing', `${fixture('pr-41-variant.md')}\n### Worth knowing`)}\n## Design\n\nThe plan itself.\n`;
const FP_DESIGN = 'decide:Which branch name to keep';
const seedDesignDoc = () => seed(ID, { kind: 'design', file: 'd.md' }, { 'doc.md': '# d' });
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
	it('approve writes the decision, with no choices for a design that raises no card', async () => {
		await seedDesignDoc();
		await call('approve');
		expect(await decision()).toEqual({ decision: 'approve', choices: [] });
	});

	it('approve on a design with no Decide block writes no choices', async () => {
		await seed(ID, { kind: 'design', file: 'd.md' }, { 'doc.md': '# d' });
		await call('approve', [['cards', '']]);
		expect(await decision()).toEqual({ decision: 'approve', choices: [] });
	});

	describe('a design with a Decide block', () => {
		const seedDesign = () => seed(ID, { kind: 'design', file: 'd.md' }, { 'doc.md': DESIGN_DECIDE });
		const noDecision = () => expect(readFile(join(state.root, 'items', ID, 'decision.json'), 'utf8')).rejects.toThrow();

		it('records the pick as the choice', async () => {
			await seedDesign();
			await call('approve', [['cards', FP_DESIGN], ['c0', '1']]);
			expect(await decision()).toEqual({
				decision: 'approve',
				choices: [{ title: 'Which branch name to keep', choice: 'Rename it' }]
			});
		});

		it('refuses an approve with no pick', async () => {
			await seedDesign();
			expect(await call('approve', [['cards', FP_DESIGN]])).toMatchObject({ status: 400 });
			await noDecision();
		});

		it('refuses an approve made against a different card list', async () => {
			await seedDesign();
			expect(await call('approve', [['cards', ''], ['c0', '1']])).toMatchObject({ status: 400 });
			await noDecision();
		});
	});

	it('reject writes the note', async () => {
		await seedDesignDoc();
		await call('reject', [['note', 'no good']]);
		expect(await decision()).toEqual({ decision: 'reject', note: 'no good' });
	});

	it('submit writes each row with the file action and the changed disposition', async () => {
		await seedTriage();
		await call('submit', [
			['action', 'forged'],
			['disposition', 'drop'],
			['disposition', 'defer'],
			['disposition', 'drop']
		]);
		expect(await decision()).toEqual({
			decision: 'submit',
			rows: [
				{ action: 'one', disposition: 'drop' },
				{ action: 'two', disposition: 'defer' },
				{ action: 'three', disposition: 'drop' }
			]
		});
	});

	it('submit fails with 400 on a short row count', async () => {
		await seedTriage();
		const result = await call('submit', [
			['disposition', 'now'],
			['disposition', 'now']
		]);
		expect(result).toMatchObject({ status: 400 });
	});

	it('submit fails with 400 on a disposition outside the set', async () => {
		await seedTriage();
		const result = await call('submit', [
			['disposition', 'later'],
			['disposition', 'now'],
			['disposition', 'now']
		]);
		expect(result).toMatchObject({ status: 400 });
	});

	it('fails with 404 on a decided item', async () => {
		await seedDesignDoc();
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
		seed(id, { kind: 'design', file: 'd.md', created }, { 'doc.md': '# d' });

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
		await seedDesignDoc();
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
		await seedDesignDoc();
		await seedAt(SECOND, '2026-10-11T10:01:00Z');
		expect(await call('reject', [['note', 'x']])).toEqual({ next: `/item/${SECOND}` });
	});
});

describe('load', () => {
	it('returns the decided state for a decided item', async () => {
		await seedDesignDoc();
		await call('approve');
		expect(await load({ params: { id: ID } } as never)).toMatchObject({ decided: true, kind: 'design' });
	});

	it('returns a design with its read time', async () => {
		await seed(ID, { kind: 'design', file: 'd.md' }, { 'doc.md': 'word '.repeat(460) });
		expect(await load({ params: { id: ID } } as never)).toMatchObject({ kind: 'design', minutes: 2 });
	});

	it('returns a triage with its headline, lede, rendered row text, and rows at their proposals', async () => {
		await seedTriage();
		expect(await load({ params: { id: ID } } as never)).toMatchObject({
			kind: 'triage',
			headlineHtml: 'Three calls.',
			ledeHtml: 'One now, one later, one dropped.',
			rows: [
				{ action: 'one', why: 'a', detail: 'tech', proposed: 'now', disposition: 'now' },
				{ action: 'two', proposed: 'defer', disposition: 'defer' },
				{ action: 'three', proposed: 'drop', disposition: 'drop' }
			],
			html: [
				{ action: 'one', why: 'a', detail: 'tech' },
				{ action: 'two', why: 'b', detail: null },
				{ action: 'three', why: 'c', detail: null }
			]
		});
	});

	it('returns a decided triage with the calls that were submitted, not the proposals', async () => {
		await seedTriage();
		const submitted = {
			decision: 'submit',
			rows: [
				{ action: 'one', disposition: 'drop' },
				{ action: 'two', disposition: 'defer' },
				{ action: 'three', disposition: 'now' }
			]
		};
		await writeFile(join(state.root, 'items', ID, 'decision.json'), JSON.stringify(submitted));
		expect(await load({ params: { id: ID } } as never)).toMatchObject({
			decided: true,
			rows: [
				{ action: 'one', proposed: 'now', disposition: 'drop' },
				{ action: 'two', proposed: 'defer', disposition: 'defer' },
				{ action: 'three', proposed: 'drop', disposition: 'now' }
			]
		});
	});

	it('returns a design with a card for each Decide block', async () => {
		await seed(ID, { kind: 'design', file: 'd.md' }, { 'doc.md': DESIGN_DECIDE });
		const data = (await load({ params: { id: ID } } as never)) as unknown as {
			cards: { kind: string; title: string; html: string; choices: { label: string; recommended: boolean }[] }[];
		};
		expect(data.cards.map((c) => `${c.kind}:${c.title}`)).toEqual(['decide:Which branch name to keep']);
		expect(data.cards[0].html).toContain('named for the old tool');
		expect(data.cards[0].choices.map((c) => c.recommended)).toEqual([false, true]);
	});

	it('returns a design with no cards when its doc has no brief', async () => {
		await seed(ID, { kind: 'design', file: 'd.md' }, { 'doc.md': '# d' });
		expect(await load({ params: { id: ID } } as never)).toMatchObject({ kind: 'design', cards: [] });
	});

	it('returns a design whose brief parses into the headline block and leaves the brief out of the document', async () => {
		const doc = `# A design\n\n${fixture('pr-40-brief.md').replace('# Send every session-opened PR to approval\n\n', '')}\n## Design\n\nThe plan itself.\n`;
		await seed(ID, { kind: 'design', file: 'd.md' }, { 'doc.md': doc });
		const data = (await load({ params: { id: ID } } as never)) as unknown as {
			headlineHtml: string;
			ledeHtml: string;
			whatChanges: string[];
			ifYouApprove: string[];
			worthKnowing: string;
			details: { label: string }[];
			docHtml: string;
		};
		expect(data.headlineHtml).toBe('Every PR a session opens will now come to you for approval, and approving one will merge it.');
		expect(data.ledeHtml).toContain('Small fixes were skipping');
		expect(data.whatChanges).toHaveLength(2);
		expect(data.ifYouApprove).toHaveLength(3);
		expect(data.worthKnowing).toContain('merge guard');
		expect(data.details.map((d) => d.label)).toEqual(['The reminder', 'The merge permission', 'Testing']);
		expect(data.docHtml).toContain('The plan itself.');
		expect(data.docHtml).not.toContain('What changes');
	});

	it('throws 404 on an unknown id', async () => {
		await expect(load({ params: { id: ID } } as never)).rejects.toMatchObject({ status: 404 });
	});
});

describe('an item of a removed kind', () => {
	it.each(['blueprint', 'page', 'change', 'pr', 'docs'])('answers 404 to every post and to the load while it waits, and opens read-only once decided (%s)', async (kind) => {
		await seed(ID, { kind, repo: 'r', title: 't', created: 'c' }, { 'doc.md': '# doc' });
		for (const run of [() => load({ params: { id: ID } } as never), () => call('approve'), () => call('reject'), () => call('submit')]) {
			await expect(Promise.resolve().then(run)).rejects.toMatchObject({ status: 404 });
		}
		await writeFile(join(state.root, 'items', ID, 'decision.json'), '{"decision":"approve"}');
		expect(await load({ params: { id: ID } } as never)).toMatchObject({ kind: 'retired', itemKind: kind, decision: 'approve' });
		for (const run of [() => call('approve'), () => call('reject'), () => call('submit')]) {
			await expect(Promise.resolve().then(run)).rejects.toMatchObject({ status: 404 });
		}
	});
});

describe('a reject or submit that is not a form post', () => {
	const notForm = () => new Request('http://127.0.0.1:7907/', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
	const noDecision = () => expect(readFile(join(state.root, 'items', ID, 'decision.json'), 'utf8')).rejects.toThrow();

	it('answers a design reject 400 and writes nothing', async () => {
		await seedDesignDoc();
		expect(await actions.reject({ request: notForm(), params: { id: ID } } as never)).toMatchObject({ status: 400, data: { message: 'Not a form post' } });
		await noDecision();
	});

	it('answers a triage submit 400 and writes nothing', async () => {
		await seedTriage();
		expect(await actions.submit({ request: notForm(), params: { id: ID } } as never)).toMatchObject({ status: 400, data: { message: 'Not a form post' } });
		await noDecision();
	});
});
