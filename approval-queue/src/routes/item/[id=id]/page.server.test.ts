import { readFileSync } from 'node:fs';
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

import { seedPacket } from '#lib/fixtures/seed-packet.ts';
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
const PR41 = fixture('pr-41-body.md');
const PR41_META = fixture('pr-41-pr.json');
/** PR #41 with a `fix` review and one `### Decide:` block, as T5's variant. */
const PR41_VARIANT = `${PR41.replace('## Before merge', `${fixture('pr-41-variant.md')}## Before merge`)}\n## Review\n\nA gap. Verdict: \`fix\`.\n`;
const FP41 = 'check:A check failed|before-merge:A step must run before merging';
const FP_VARIANT = 'check:A check failed|review:The review asks for a fix|before-merge:A step must run before merging|decide:Which branch name to keep';
/** PR #40's brief as a design doc, with T5's Decide block before its Worth knowing. */
const DESIGN_DECIDE = `# A design\n\n${fixture('pr-40-brief.md')
	.replace('# Send every session-opened PR to approval\n\n', '')
	.replace('### Worth knowing', `${fixture('pr-41-variant.md')}\n### Worth knowing`)}\n## Design\n\nThe plan itself.\n`;
const FP_DESIGN = 'decide:Which branch name to keep';
const seedPr41 = (body = PR41) =>
	seed(ID, { kind: 'pr', head: 'abc', number: 41 }, { 'body.md': body, 'diff.patch': '+a', 'pr.json': PR41_META });

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
	it('approve writes the decision, with no choices for a PR that raises no card', async () => {
		await seedPr();
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

	describe('the Approve lock', () => {
		const noDecision = () => expect(readFile(join(state.root, 'items', ID, 'decision.json'), 'utf8')).rejects.toThrow();

		it('writes the choices with the titles from the server’s list', async () => {
			await seedPr41();
			await call('approve', [['cards', FP41], ['c0', '1'], ['c1', '1']]);
			expect(await decision()).toEqual({
				decision: 'approve',
				choices: [
					{ title: 'A check failed', choice: 'Approve anyway' },
					{ title: 'A step must run before merging', choice: 'I’ll run it myself' }
				]
			});
		});

		it('refuses a post with a missing choice', async () => {
			await seedPr41();
			expect(await call('approve', [['cards', FP41], ['c0', '1']])).toMatchObject({ status: 400 });
			await noDecision();
		});

		it('refuses a send-back choice', async () => {
			await seedPr41();
			expect(await call('approve', [['cards', FP41], ['c0', '0'], ['c1', '0']])).toMatchObject({ status: 400 });
			await noDecision();
		});

		it('refuses an out-of-range index', async () => {
			await seedPr41();
			expect(await call('approve', [['cards', FP41], ['c0', '1'], ['c1', '9']])).toMatchObject({ status: 400 });
			await noDecision();
		});

		it('refuses a post that skips the cards the body raises', async () => {
			await seedPr41();
			expect(await call('approve', [['cards', FP41]])).toMatchObject({ status: 400 });
			await noDecision();
		});

		it('refuses a post made against a different card list, so no pick shifts onto another card', async () => {
			await seedPr41();
			// The reader saw only the Before merge card; a failing check has since added a card in front of it.
			const stale = 'before-merge:A step must run before merging';
			expect(await call('approve', [['cards', stale], ['c0', '1'], ['c1', '1']])).toMatchObject({ status: 400 });
			expect(await call('approve', [['c0', '1'], ['c1', '1']])).toMatchObject({ status: 400 });
			await noDecision();
		});

		it('checks the session’s Decide block too', async () => {
			await seedPr41(PR41_VARIANT);
			expect(await call('approve', [['cards', FP_VARIANT], ['c0', '1'], ['c1', '1'], ['c2', '1']])).toMatchObject({ status: 400 });
			await call('approve', [['cards', FP_VARIANT], ['c0', '1'], ['c1', '1'], ['c2', '1'], ['c3', '1']]);
			expect((await decision()).choices.at(-1)).toEqual({ title: 'Which branch name to keep', choice: 'Rename it' });
		});
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

	it('loads PR #40 with its brief, details, and no cards', async () => {
		await seed(ID, { kind: 'pr', head: 'abc', number: 40 }, {
			'body.md': fixture('pr-40-brief.md'),
			'diff.patch': '+a',
			'pr.json': JSON.stringify({ ...JSON.parse(PR41_META), number: 40, statusCheckRollup: [] })
		});
		const data = (await load({ params: { id: ID } } as never)) as unknown as {
			headlineHtml: string;
			ledeHtml: string;
			whatChanges: string[];
			ifYouApprove: string[];
			worthKnowing: string;
			details: { label: string; summaryHtml: string; bodyHtml: string }[];
			cards: unknown[];
			technicalHtml: string;
		};
		expect(data.headlineHtml).toBe('Every PR a session opens will now come to you for approval, and approving one will merge it.');
		expect(data.ledeHtml).toContain('Small fixes were skipping');
		expect(data.whatChanges).toHaveLength(2);
		expect(data.ifYouApprove).toHaveLength(3);
		expect(data.worthKnowing).toContain('merge guard');
		expect(data.details.map((d) => d.label)).toEqual(['The reminder', 'The merge permission', 'Testing']);
		expect(data.details[0].summaryHtml).toBe('Fires whenever a session opens a PR.');
		expect(data.details[0].bodyHtml).toContain('<code>claude-approval-queue-reminder</code>');
		expect(data.details[0].bodyHtml).not.toContain('Fires whenever');
		expect(data.cards).toEqual([]);
		expect(data.technicalHtml).toContain('What landed');
	});

	it('loads PR #41 with the failed check, then the Before merge step', async () => {
		await seedPr41();
		const data = (await load({ params: { id: ID } } as never)) as unknown as {
			cards: { kind: string; html: string; choices: { sendBack: boolean }[] }[];
			checks: { text: string };
			link: { head: string; base: string };
		};
		expect(data.cards.map((c) => c.kind)).toEqual(['check', 'before-merge']);
		expect(data.cards[1].html).toContain('<li>');
		expect(data.checks.text).toBe('2 passed, 1 failed');
		expect(data.link).toMatchObject({ head: 'desk-hook', base: 'main' });
	});

	it('loads four cards in order for the variant with a fix review and a Decide block', async () => {
		await seedPr41(PR41_VARIANT);
		const data = (await load({ params: { id: ID } } as never)) as unknown as { cards: { kind: string }[]; verdict: string };
		expect(data.cards.map((c) => c.kind)).toEqual(['check', 'review', 'before-merge', 'decide']);
		expect(data.verdict).toBe('fix');
	});

	it('returns a PR without pr.json with no link and no checks', async () => {
		await seedPr();
		expect(await load({ params: { id: ID } } as never)).toMatchObject({
			link: null,
			headlineHtml: 't',
			cards: [],
			verdict: null,
			checks: { text: 'No checks' }
		});
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
				{ action: 'one', why: 'a', detail: 'tech', proposed: 'now', disposition: 'now', note: '' },
				{ action: 'two', proposed: 'defer', disposition: 'defer', note: '' },
				{ action: 'three', proposed: 'drop', disposition: 'drop', note: '' }
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
				{ action: 'one', disposition: 'drop', note: 'not needed' },
				{ action: 'two', disposition: 'defer', note: '' },
				{ action: 'three', disposition: 'now', note: '' }
			]
		};
		await writeFile(join(state.root, 'items', ID, 'decision.json'), JSON.stringify(submitted));
		expect(await load({ params: { id: ID } } as never)).toMatchObject({
			decided: true,
			rows: [
				{ action: 'one', proposed: 'now', disposition: 'drop', note: 'not needed' },
				{ action: 'two', proposed: 'defer', disposition: 'defer', note: '' },
				{ action: 'three', proposed: 'drop', disposition: 'now', note: '' }
			]
		});
	});

	it('returns a design with a card for each Decide block and none of the PR-only cards', async () => {
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

describe('a packet', () => {
	/** Two asks (#41 bound as gate-failed, one with no part), routine #42 and #43, and step 1. */
	const PACKET = fixture('packet-baseline.md').replace('glw907/drafter:docs/specs/notes-design.md', 'glw907/drafter#43');
	const WITHDRAWN = 'This item was withdrawn by its session; nothing was recorded';
	const noDecision = () => expect(readFile(join(state.root, 'items', ID, 'decision.json'), 'utf8')).rejects.toThrow();
	const fingerprint = async () => ((await load({ params: { id: ID } } as never)) as { fingerprint: string }).fingerprint;

	/** A complete post: #42 held, #43 approved, both asks answered, the irreversible step confirmed. */
	async function fields(over: Record<string, string | null> = {}): Promise<[string, string][]> {
		return Object.entries({
			fingerprint: await fingerprint(),
			'part:glw907/drafter#42': 'hold',
			'part:glw907/drafter#43': 'approve',
			'part:step:1': 'session',
			'ask:1': 'Merge anyway',
			'ask:2': 'Beta',
			irreversible: 'yes',
			...over
		}).filter((e): e is [string, string] => e[1] !== null);
	}

	beforeEach(() => seedPacket(state.root, ID, PACKET));

	it('load returns the parts, asks, routine rows, fingerprint, and irreversible steps', async () => {
		const data = (await load({ params: { id: ID } } as never)) as Record<string, any>;
		expect(data).toMatchObject({ kind: 'packet', decided: false, irreversible: true, irreversibleSteps: [2] });
		expect(data.fingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(data.asks.map((a: any) => [a.index, a.rule, a.part, a.choices.length])).toEqual([
			[1, 'gate-failed', 'glw907/drafter#41', 3],
			[2, 'owner-call', null, 2]
		]);
		expect(data.routine.map((r: any) => [r.ref, r.verdict])).toEqual([
			['glw907/drafter#42', 'approve'],
			['glw907/drafter#43', 'approve'],
			['step:1', 'session']
		]);
		expect(data.parts.map((p: any) => [p.ref, p.lane, p.head])).toEqual([
			['glw907/drafter#41', 'ask', 'aaa111'],
			['glw907/drafter#42', 'routine', 'bbb222'],
			['glw907/drafter#43', 'routine', 'ccc333'],
			['step:1', 'routine', undefined]
		]);
	});

	it('check 2: an approve with ask 2 unanswered returns 400 and writes nothing', async () => {
		expect(await call('approve', await fields({ 'ask:2': null }))).toMatchObject({ status: 400 });
		await noDecision();
	});

	it('check 3, server half: #42 is held and #43 approved, every part once, with no head or hash', async () => {
		const result = await call('approve', await fields());
		expect(result).toEqual({ next: null });
		expect(await decision()).toEqual({
			decision: 'approve',
			parts: [
				{ ref: 'glw907/drafter#41', verdict: 'approve' },
				{ ref: 'glw907/drafter#42', verdict: 'hold' },
				{ ref: 'glw907/drafter#43', verdict: 'approve' },
				{ ref: 'step:1', verdict: 'session' }
			],
			asks: [
				{ index: 1, choice: 'Merge anyway' },
				{ index: 2, choice: 'Beta' }
			]
		});
	});

	it('a held ask-bound part is written held', async () => {
		await call('approve', await fields({ 'ask:1': 'Hold' }));
		expect((await decision()).parts[0]).toEqual({ ref: 'glw907/drafter#41', verdict: 'hold' });
	});

	it.each([
		['an unanswered ask', { 'ask:1': null }],
		['a label the ask does not hold', { 'ask:2': 'Stable soon' }],
		['a missing part', { 'part:glw907/drafter#42': null }],
		['an unknown ref', { 'part:glw907/drafter#99': 'approve' }],
		['a verdict outside the kind', { 'part:step:1': 'hold' }],
		['a stale fingerprint', { fingerprint: 'stale' }],
		['a missing irreversible confirmation', { irreversible: null }]
	])('refuses %s with 400 and writes nothing', async (_name, over) => {
		expect(await call('approve', await fields(over))).toMatchObject({ status: 400 });
		await noDecision();
	});

	it('a second post returns 409 and leaves the first decision', async () => {
		const post = await fields();
		await call('approve', post);
		expect(await call('approve', post)).toMatchObject({ status: 409, data: { message: 'Already decided' } });
		expect((await decision()).parts[1]).toEqual({ ref: 'glw907/drafter#42', verdict: 'hold' });
	});

	it('two posts racing write one decision and answer the other 409', async () => {
		const post = await fields();
		const results = await Promise.all([call('approve', post), call('approve', post)]);
		expect(results.map((r) => (r as { status?: number }).status ?? 200).sort()).toEqual([200, 409]);
	});

	it('a reject carries no parts and no asks', async () => {
		await call('reject', [['note', 'not now'], ['fingerprint', await fingerprint()]]);
		expect(await decision()).toEqual({ decision: 'reject', note: 'not now' });
		expect(await call('reject', [['note', 'again']])).toMatchObject({ status: 409 });
	});

	describe('a withdrawn item', () => {
		beforeEach(() => rm(join(state.root, 'items', ID, 'item.json')));

		it('answers an approve from the open page with the withdrawn message and the board', async () => {
			expect(await call('approve', [['fingerprint', 'abc']])).toMatchObject({
				status: 410,
				data: { message: WITHDRAWN, board: '/' }
			});
			await noDecision();
		});

		it('answers a reject from the open page the same way', async () => {
			expect(await call('reject', [['fingerprint', 'abc']])).toMatchObject({ status: 410, data: { message: WITHDRAWN } });
		});

		it('still 404s a post that never came from a packet page', async () => {
			await expect(call('approve')).rejects.toMatchObject({ status: 404 });
		});
	});

	it('refuses submit, which is the triage action', async () => {
		expect(await call('submit')).toMatchObject({ status: 400 });
	});
});
