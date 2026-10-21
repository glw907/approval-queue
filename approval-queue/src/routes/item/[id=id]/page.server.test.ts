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

import {
	CHANGE_DOCS,
	git,
	PAGE_DOC,
	PAGE_FILE,
	PAGE_HEAD,
	PAGE_PR,
	SAMPLE_DOC,
	SAMPLE_FILE,
	seedBlueprintItem,
	seedChangeItem,
	seedPageItem,
	seedPageRepo,
	seedRepo
} from '#lib/fixtures/seed-blueprint.ts';
import { seedPacket } from '#lib/fixtures/seed-packet.ts';
import { anchorAt, type Thread } from '#lib/editor/comments.ts';
import { queued } from '#lib/server/blueprint.ts';
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

	it('a reject that is not a form post answers 400 and writes nothing', async () => {
		const request = new Request('http://127.0.0.1:7907/', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
		expect(await actions.reject({ request, params: { id: ID } } as never)).toMatchObject({ status: 400 });
		await noDecision();
	});

	it('load returns the recorded decision for a decided packet, so the page shows what was chosen', async () => {
		await call('approve', await fields());
		const data = (await load({ params: { id: ID } } as never)) as Record<string, any>;
		expect(data.decided).toBe(true);
		expect(data.decision).toMatchObject({
			decision: 'approve',
			parts: expect.arrayContaining([{ ref: 'glw907/drafter#42', verdict: 'hold' }]),
			asks: [
				{ index: 1, choice: 'Merge anyway' },
				{ index: 2, choice: 'Beta' }
			]
		});
	});

	it('refuses submit, which is the triage action', async () => {
		expect(await call('submit')).toMatchObject({ status: 400 });
	});
});

describe('a blueprint', () => {
	let repo: string;
	let base: string;
	beforeEach(async () => {
		repo = await mkdtemp(join(tmpdir(), 'approval-queue-route-repo-'));
		base = await seedRepo(repo);
		await seedBlueprintItem(state.root, ID, repo, base);
	});
	afterEach(() => rm(repo, { recursive: true, force: true }));

	const answered = (blob: string): [string, string][] => [
		['call:D1', "Use the code's cause"],
		['call:Q1', 'Fold it in'],
		['blob', blob]
	];

	it('load returns the file at HEAD, its blob, the front matter, and each note on its anchor', async () => {
		const data = (await load({ params: { id: ID } } as never)) as Record<string, any>;
		expect(data).toMatchObject({
			kind: 'blueprint',
			doc: SAMPLE_DOC,
			original: SAMPLE_DOC,
			blob: base,
			page: 'Fix a slow build',
			pageType: 'troubleshooting',
			missing: false
		});
		const d1 = data.notes.find((n: { id: string }) => n.id === 'D1');
		expect(SAMPLE_DOC.slice(d1.range[0], d1.range[1])).toBe('Every image is resized on every build.');
		expect(data.notes.find((n: { id: string }) => n.id === 'X1').range).toBeNull();
	});

	it('save commits the text in the worktree and answers the new blob; a stale base answers 409', async () => {
		const text = SAMPLE_DOC.replace('a minute', 'two minutes');
		const saved = (await call('save', [['text', text], ['base', base]])) as { blob: string; commit: string };
		expect(saved.blob).toBe(git(repo, 'rev-parse', `HEAD:${SAMPLE_FILE}`));
		expect(saved.commit).toBe(git(repo, 'rev-parse', 'HEAD'));
		expect(await readFile(join(repo, SAMPLE_FILE), 'utf8')).toBe(text);
		expect(await call('save', [['text', `${text}x`], ['base', base]])).toMatchObject({ status: 409 });
	});

	it('approve after a save records the calls and the commit and blob at HEAD, and a second post answers 409', async () => {
		const saved = (await call('save', [['text', `${SAMPLE_DOC}more\n`], ['base', base]])) as { blob: string };
		await call('approve', answered(saved.blob));
		expect(await decision()).toEqual({
			decision: 'approve',
			calls: [
				{ id: 'D1', choice: "Use the code's cause" },
				{ id: 'Q1', choice: 'Fold it in' }
			],
			waived: [],
			commit: git(repo, 'rev-parse', 'HEAD'),
			blob: saved.blob,
			comments: [],
			threads: []
		});
		expect(await call('approve', answered(saved.blob))).toMatchObject({ status: 409 });
	});

	it('approve with an open call, or against a stale blob, answers 400 and writes nothing', async () => {
		expect(await call('approve', [['call:Q1', 'Keep it'], ['blob', base]])).toMatchObject({ status: 400 });
		await call('save', [['text', `${SAMPLE_DOC}more\n`], ['base', base]]);
		expect(await call('approve', answered(base))).toMatchObject({ status: 400 });
		await expect(decision()).rejects.toThrow();
	});

	it('reject writes the note', async () => {
		await call('reject', [['note', 'Fold the event section in.']]);
		expect(await decision()).toEqual({ decision: 'reject', note: 'Fold the event section in.', comments: [], threads: [] });
	});

	it('a save on a decided item answers 404 and commits nothing', async () => {
		await call('approve', answered(base));
		const head = git(repo, 'rev-parse', 'HEAD');
		await expect(call('save', [['text', `${SAMPLE_DOC}late\n`], ['base', base]])).rejects.toMatchObject({ status: 404 });
		expect(git(repo, 'rev-parse', 'HEAD')).toBe(head);
	});

	it('an approve on a missing item answers 404', async () => {
		await expect(call('approve', answered(base), '20261011T100000-9')).rejects.toMatchObject({ status: 404 });
		await expect(call('approve', answered(base), '20261011T100000-9')).rejects.toMatchObject({ status: 404 });
	});

	it('an approve waits behind a save already on the file’s queue, and a save queued after it commits nothing', async () => {
		// A step held open on the file's queue stands in for a save mid-commit, so the order is fixed.
		let release = () => {};
		const held = queued(repo, SAMPLE_FILE, () => new Promise<void>((r) => (release = r)));
		const settle = (p: Promise<unknown>) => {
			const out = { done: false };
			p.then(
				() => (out.done = true),
				() => (out.done = true)
			);
			return out;
		};
		const approve = Promise.resolve(call('approve', answered(base)));
		const approving = settle(approve);
		await new Promise((r) => setTimeout(r, 100));
		const save = Promise.resolve(call('save', [['text', `${SAMPLE_DOC}raced\n`], ['base', base]]));
		const saving = settle(save);
		await new Promise((r) => setTimeout(r, 100));
		expect(approving.done).toBe(false);
		expect(saving.done).toBe(false);
		await expect(decision()).rejects.toThrow();

		release();
		await held;
		await approve;
		await expect(save).rejects.toMatchObject({ status: 404 });
		const written = await decision();
		expect(written.commit).toBe(git(repo, 'rev-parse', 'HEAD'));
		expect(written.blob).toBe(base);
		expect(git(repo, 'rev-list', '--count', 'HEAD')).toBe('1');
	});
});

describe('a page', () => {
	let repo: string;
	let base: string;
	beforeEach(async () => {
		repo = await mkdtemp(join(tmpdir(), 'approval-queue-route-page-'));
		base = await seedPageRepo(repo);
		await seedPageItem(state.root, ID, repo, base);
	});
	afterEach(() => rm(repo, { recursive: true, force: true }));

	const answered = (blob: string): [string, string][] => [
		['call:D1', 'Keep the author\'s wording'],
		['call:Q1', 'Keep it'],
		['blob', blob]
	];

	it('load returns the page at HEAD, its pull request and head, and each note on its page anchor', async () => {
		const data = (await load({ params: { id: ID } } as never)) as Record<string, any>;
		expect(data).toMatchObject({
			kind: 'page',
			doc: PAGE_DOC,
			blob: base,
			page: 'Fix a slow build',
			pageType: 'troubleshooting',
			pr: { ref: PAGE_PR, url: 'https://github.com/glw907/sample/pull/7', head: PAGE_HEAD }
		});
		const text = (id: string) => {
			const r = data.notes.find((n: { id: string }) => n.id === id).range;
			return PAGE_DOC.slice(r[0], r[1]);
		};
		expect(text('D1')).toBe('Every image is resized on every build because the cache key includes the build time.');
		expect(text('Q1')).toMatch(/^\| Step \| Typical time \|/);
	});

	it('a blueprint loads with no pull request', async () => {
		await seedBlueprintItem(state.root, '20261011T100000-2', repo, base);
		const data = (await load({ params: { id: '20261011T100000-2' } } as never)) as Record<string, any>;
		expect(data).toMatchObject({ kind: 'blueprint', pr: null });
	});

	it('save commits the text with the review message; a stale base answers 409', async () => {
		const text = PAGE_DOC.replace('a minute', 'two minutes');
		const saved = (await call('save', [['text', text], ['base', base]])) as { blob: string };
		expect(saved.blob).toBe(git(repo, 'rev-parse', `HEAD:${PAGE_FILE}`));
		expect(git(repo, 'log', '-1', '--format=%s')).toBe(`Edit ${PAGE_FILE} in review`);
		expect(await call('save', [['text', `${text}x`], ['base', base]])).toMatchObject({ status: 409 });
	});

	it('approve records the calls, the waived dispute, and the commit and blob at HEAD, and a second post answers 409', async () => {
		await call('approve', answered(base));
		expect(await decision()).toEqual({
			decision: 'approve',
			calls: [
				{ id: 'D1', choice: "Keep the author's wording" },
				{ id: 'Q1', choice: 'Keep it' }
			],
			waived: [{ id: 'D1', choice: "Keep the author's wording", reason: "Kept the author's wording" }],
			commit: git(repo, 'rev-parse', 'HEAD'),
			blob: base,
			comments: [],
			threads: []
		});
		expect(await call('approve', answered(base))).toMatchObject({ status: 409 });
		await expect(call('save', [['text', PAGE_DOC], ['base', base]])).rejects.toMatchObject({ status: 404 });
	});

	it('approve with an open call, or against a stale blob, answers 400 and writes nothing', async () => {
		expect(await call('approve', [['call:Q1', 'Keep it'], ['blob', base]])).toMatchObject({ status: 400 });
		await call('save', [['text', `${PAGE_DOC}more\n`], ['base', base]]);
		expect(await call('approve', answered(base))).toMatchObject({ status: 400 });
		await expect(decision()).rejects.toThrow();
	});

	it('reject writes the note', async () => {
		await call('reject', [['note', 'Say what the table measures.']]);
		expect(await decision()).toEqual({ decision: 'reject', note: 'Say what the table measures.', comments: [], threads: [] });
	});
});

describe('a change', () => {
	beforeEach(() => seedChangeItem(state.root, ID));

	it('load returns each changed document with its diff and notes, and the code diff without them', async () => {
		const data = (await load({ params: { id: ID } } as never)) as Record<string, any>;
		expect(data).toMatchObject({ kind: 'change', ref: 'glw907/cairn-cms#77', head: PAGE_HEAD });
		expect(data.docs.map((d: { path: string }) => d.path)).toEqual(CHANGE_DOCS.map((d) => d.path));
		expect(data.docs.map((d: { file: { adds: number } }) => d.file.adds)).toEqual([24, 1, 1]);
		expect(data.groups.flatMap((g: { files: Array<{ path: string }> }) => g.files.map((f) => f.path))).toEqual(['drafter.toml']);
		expect(data.totals).toEqual({ files: 1, adds: 3, dels: 1 });
		const share = data.docs[2];
		expect(share.notes.map((n: { id: string }) => n.id)).toEqual(['L1']);
		const r = share.notes[0].range;
		expect(share.doc.slice(r[0], r[1])).toMatch(/^The file reads `PUBLIC_ORIGIN`[\s\S]*\[Debug your site\]\(debug-your-site\.md#eventplatform-is-undefined\)[\s\S]*checks\.$/);
		const audit = data.docs[1];
		expect(audit.doc.slice(audit.notes[0].range[0]).startsWith('The engine, installed by the setup command')).toBe(true);
		expect(audit.original).not.toBe(audit.doc);
	});

	it('approve records only the calls, and a second post answers 409', async () => {
		await call('approve', [['call:Q1', 'Keep it']]);
		expect(await decision()).toEqual({ decision: 'approve', calls: [{ id: 'Q1', choice: 'Keep it' }], comments: [], threads: [] });
		expect(await call('approve', [['call:Q1', 'Keep it']])).toMatchObject({ status: 409 });
	});

	it('approve with the call open, or an unknown call, answers 400 and writes nothing', async () => {
		expect(await call('approve', [])).toMatchObject({ status: 400 });
		expect(await call('approve', [['call:Q1', 'Keep it'], ['call:L1', 'x']])).toMatchObject({ status: 400 });
		await expect(decision()).rejects.toThrow();
	});

	it('reject writes the note, and save is refused', async () => {
		expect(await call('save', [['text', 'x'], ['base', 'y']])).toMatchObject({ status: 400 });
		await call('reject', [['note', 'Keep the old text.']]);
		expect(await decision()).toEqual({ decision: 'reject', note: 'Keep the old text.', comments: [], threads: [] });
	});

	it('reject records the calls made so far, leaving out an unknown call or label', async () => {
		await call('reject', [['note', ''], ['call:Q1', 'Keep it'], ['call:L1', 'x']]);
		expect(await decision()).toEqual({
			decision: 'reject',
			note: '',
			calls: [{ id: 'Q1', choice: 'Keep it' }],
			comments: [],
			threads: []
		});
	});
});

const COMMENTS_DOC = fixture('comments/comments.blueprint.md');
const COMMENTS_NOTES = fixture('comments/notes.json');
const SOIL = 'Dry soil at that depth means the plant needs water.';
const ROW = 'The pot has no drainage hole, so the roots sit in water.';
const span = (doc: string, text: string): [string, string][] => [
	['from', String(doc.indexOf(text))],
	['to', String(doc.indexOf(text) + text.length)]
];
const stored = async (id = ID) => JSON.parse(await readFile(join(state.root, 'items', id, 'comments.json'), 'utf8'));
const loaded = async (id = ID) => (await load({ params: { id } } as never)) as Record<string, any>;

/** A `--replies` file's threads, anchored into `doc` at `commit`. */
async function seedReplies(doc: string, commit: string, file?: string, id = ID): Promise<Thread[]> {
	const thread = (tid: string, status: Thread['status'], quote: string): Thread => {
		const from = doc.indexOf(quote);
		return { id: tid, status, text: `Reply to ${tid}.`, quote, anchor: anchorAt(doc, from, from + quote.length, commit, file) };
	};
	const threads = [thread('C1', 'done', SOIL), thread('C2', 'kept', ROW)];
	await writeFile(join(state.root, 'items', id, 'replies.json'), JSON.stringify(threads));
	return threads;
}

describe('comments on a blueprint', () => {
	let repo: string;
	let base: string;
	let head: string;
	beforeEach(async () => {
		repo = await mkdtemp(join(tmpdir(), 'approval-queue-route-comments-'));
		base = await seedRepo(repo, COMMENTS_DOC);
		head = git(repo, 'rev-parse', 'HEAD');
		await seedBlueprintItem(state.root, ID, repo, base, COMMENTS_NOTES);
	});
	afterEach(() => rm(repo, { recursive: true, force: true }));

	const add = (text: string, quote = SOIL, blob = base, doc = COMMENTS_DOC) =>
		call('comment', [['op', 'add'], ['text', text], ['blob', blob], ...span(doc, quote)]);
	const answered: [string, string][] = [['call:D1', "Keep the author's wording"]];

	it('add anchors the comment into the file committed at the posted blob, and load places it', async () => {
		const answer = await add('Say how deep a knuckle is.\r\nIn centimetres.');
		const from = COMMENTS_DOC.indexOf(SOIL);
		const comment = { id: 'C1', text: 'Say how deep a knuckle is.\nIn centimetres.', anchor: anchorAt(COMMENTS_DOC, from, from + SOIL.length, head) };
		expect(answer).toEqual({ id: 'C1', comments: [comment], threads: [] });
		expect(await stored()).toEqual({ comments: [comment], threads: [], next: 2 });
		expect(comment.anchor.quote).toBe(SOIL);
		expect((await loaded()).comments).toEqual([{ ...comment, placed: { from, to: from + SOIL.length } }]);
	});

	it('load re-places a comment after a save moves its text, and shows a deleted one as unplaced', async () => {
		await add('One.');
		await add('Two.', ROW);
		const moved = COMMENTS_DOC.replace('## Check the soil\n', '## Check the soil\n\nA new paragraph.\n').replace(ROW, 'Gone.');
		await call('save', [['text', moved], ['base', base]]);
		const [soil, row] = (await loaded()).comments;
		expect(moved.slice(soil.placed.from, soil.placed.to)).toBe(SOIL);
		expect(soil.placed.from).not.toBe(soil.anchor.from);
		expect(row.placed).toBeNull();
	});

	it('add against a stale blob answers 409, and against a range outside the file 400', async () => {
		const saved = (await call('save', [['text', `${COMMENTS_DOC}more\n`], ['base', base]])) as { blob: string };
		expect(await add('Late.')).toMatchObject({ status: 409 });
		expect(await call('comment', [['op', 'add'], ['text', 'x'], ['blob', saved.blob], ['from', '5'], ['to', '5']])).toMatchObject({ status: 400 });
		expect(await call('comment', [['op', 'add'], ['text', 'x'], ['blob', saved.blob], ['from', '0'], ['to', '99999']])).toMatchObject({ status: 400 });
		expect(await add('   ', SOIL, saved.blob)).toMatchObject({ status: 400 });
		expect(await call('comment', [['op', 'nope']])).toMatchObject({ status: 400 });
		expect(await add('Fresh.', SOIL, saved.blob)).toMatchObject({ id: 'C1' });
	});

	it('add on a file no longer committed answers 409', async () => {
		git(repo, 'rm', '-q', SAMPLE_FILE);
		git(repo, 'commit', '-q', '-m', 'Remove the blueprint');
		expect(await add('Gone.')).toMatchObject({ status: 409 });
	});

	it('every op on a decided item answers 404 and writes nothing', async () => {
		await add('Before.');
		await call('approve', [...answered, ['blob', base]]);
		const before = await stored();
		for (const fields of [
			[['op', 'add'], ['text', 'After.'], ['blob', base], ...span(COMMENTS_DOC, SOIL)],
			[['op', 'edit'], ['id', 'C1'], ['text', 'x']],
			[['op', 'delete'], ['id', 'C1']]
		] as [string, string][][]) {
			await expect(call('comment', fields)).rejects.toMatchObject({ status: 404 });
		}
		expect(await stored()).toEqual(before);
	});

	it('edit and delete act on a comment, and a deleted id is never reused', async () => {
		await add('One.');
		await add('Two.', ROW);
		expect(await call('comment', [['op', 'edit'], ['id', 'C1'], ['text', 'One, edited.']])).toMatchObject({ id: 'C1' });
		expect(await call('comment', [['op', 'delete'], ['id', 'C2']])).toMatchObject({ id: 'C2' });
		expect(await add('Three.', ROW)).toMatchObject({ id: 'C3' });
		expect((await stored()).comments.map((c: { id: string; text: string }) => [c.id, c.text])).toEqual([
			['C1', 'One, edited.'],
			['C3', 'Three.']
		]);
		expect(await call('comment', [['op', 'edit'], ['id', 'C2'], ['text', 'x']])).toMatchObject({ status: 400 });
		expect(await call('comment', [['op', 'delete'], ['id', 'C9']])).toMatchObject({ status: 400 });
		expect(await call('comment', [['op', 'edit'], ['id', 'C1'], ['text', ' ']])).toMatchObject({ status: 400 });
	});

	it('on a re-queued item, a new comment takes an id past every thread, and load places each thread', async () => {
		const threads = await seedReplies(COMMENTS_DOC, head);
		expect(await add('New.')).toMatchObject({ id: 'C3' });
		const data = await loaded();
		expect(data.threads).toEqual(
			threads.map((t) => ({ ...t, placed: { from: t.anchor.from, to: t.anchor.to }, reply: '', resolved: false }))
		);
	});

	it('reply, resolve, and reopen act on a thread, and an empty reply removes Geoff’s', async () => {
		await seedReplies(COMMENTS_DOC, head);
		await call('comment', [['op', 'reply'], ['id', 'C1'], ['text', 'Thanks.']]);
		await call('comment', [['op', 'resolve'], ['id', 'C2']]);
		expect((await stored()).threads).toEqual([{ id: 'C1', reply: 'Thanks.' }, { id: 'C2', resolved: true }]);
		expect((await loaded()).threads.map((t: { reply: string; resolved: boolean }) => [t.reply, t.resolved])).toEqual([
			['Thanks.', false],
			['', true]
		]);
		await call('comment', [['op', 'reopen'], ['id', 'C2']]);
		await call('comment', [['op', 'reply'], ['id', 'C1'], ['text', '']]);
		expect((await stored()).threads).toEqual([]);
		await add('Mine.');
		expect(await call('comment', [['op', 'reply'], ['id', 'C3'], ['text', 'x']])).toMatchObject({ status: 400 });
		expect(await call('comment', [['op', 'resolve'], ['id', 'C7']])).toMatchObject({ status: 400 });
	});

	it('approve carries the comments and only the threads Geoff replied to', async () => {
		await seedReplies(COMMENTS_DOC, head);
		await add('New.');
		await call('comment', [['op', 'reply'], ['id', 'C2'], ['text', 'Fair.']]);
		await call('comment', [['op', 'resolve'], ['id', 'C1']]);
		await call('approve', [...answered, ['blob', base]]);
		const written = await decision();
		expect(written).toMatchObject({ decision: 'approve', commit: head, blob: base, threads: [{ id: 'C2', reply: 'Fair.' }] });
		expect(written.comments).toEqual((await stored()).comments);
		expect(written.comments.map((c: { id: string }) => c.id)).toEqual(['C3']);
	});

	it('reject carries the comments and replies with the note and the calls made', async () => {
		await seedReplies(COMMENTS_DOC, head);
		await add('New.');
		await call('comment', [['op', 'reply'], ['id', 'C1'], ['text', 'Not quite.']]);
		await call('reject', [['note', ''], ...answered]);
		expect(await decision()).toEqual({
			decision: 'reject',
			note: '',
			calls: [{ id: 'D1', choice: "Keep the author's wording" }],
			comments: (await stored()).comments,
			threads: [{ id: 'C1', reply: 'Not quite.' }]
		});
	});

	describe('a comment posted while a decision waits on the file’s queue', () => {
		// A step held open on the file's queue stands in for a save mid-commit, so the order is fixed.
		let release = () => {};
		let held: Promise<void>;
		beforeEach(() => {
			held = queued(repo, SAMPLE_FILE, () => new Promise<void>((r) => (release = r)));
		});
		const tick = () => new Promise((r) => setTimeout(r, 50));

		it('is refused with 404 when the decision was queued first, never dropped', async () => {
			const approve = Promise.resolve(call('approve', [...answered, ['blob', base]]));
			await tick();
			const comment = Promise.resolve(add('Raced.'));
			await tick();
			release();
			await held;
			await approve;
			await expect(comment).rejects.toMatchObject({ status: 404 });
			expect((await decision()).comments).toEqual([]);
		});

		it('is carried when it was queued first', async () => {
			const comment = Promise.resolve(add('First.'));
			await tick();
			const reject = Promise.resolve(call('reject', [['note', 'n']]));
			await tick();
			await expect(decision()).rejects.toThrow();
			release();
			await held;
			expect(await comment).toMatchObject({ id: 'C1' });
			await reject;
			expect((await decision()).comments.map((c: { text: string }) => c.text)).toEqual(['First.']);
		});
	});

	it('a CRLF file anchors in LF, so the quote is the line the editor shows', async () => {
		const crlf = COMMENTS_DOC.replace(/\n/g, '\r\n');
		await writeFile(join(repo, SAMPLE_FILE), crlf);
		git(repo, 'commit', '-q', '-am', 'Use CRLF');
		const blob = git(repo, 'rev-parse', `HEAD:${SAMPLE_FILE}`);
		const answer = (await add('Hm.', SOIL, blob)) as { comments: Array<{ anchor: { quote: string; from: number; suffix: string } }> };
		const [{ anchor }] = answer.comments;
		expect(anchor.quote).toBe(SOIL);
		expect(anchor.from).toBe(COMMENTS_DOC.indexOf(SOIL));
		expect(anchor.suffix).not.toContain('\r');
	});
});

describe('comments on a page', () => {
	let repo: string;
	let base: string;
	beforeEach(async () => {
		repo = await mkdtemp(join(tmpdir(), 'approval-queue-route-page-comments-'));
		base = await seedPageRepo(repo);
		await seedPageItem(state.root, ID, repo, base);
	});
	afterEach(() => rm(repo, { recursive: true, force: true }));

	const quote = 'Every image is resized on every build';

	it('approve and reject both carry the comments, anchored at the commit HEAD names', async () => {
		await call('comment', [['op', 'add'], ['text', 'Why?'], ['blob', base], ...span(PAGE_DOC, quote)]);
		const [comment] = (await stored()).comments;
		expect(comment.anchor).toMatchObject({ quote, commit: git(repo, 'rev-parse', 'HEAD') });
		expect(comment.anchor).not.toHaveProperty('file');
		await call('reject', [['note', 'See the comment.']]);
		expect(await decision()).toEqual({ decision: 'reject', note: 'See the comment.', comments: [comment], threads: [] });

		await seedPageItem(state.root, '20261011T100000-2', repo, base);
		const two = '20261011T100000-2';
		await call('comment', [['op', 'add'], ['text', 'Why?'], ['blob', base], ...span(PAGE_DOC, quote)], two);
		await call('approve', [['call:D1', "Keep the author's wording"], ['call:Q1', 'Keep it'], ['blob', base]], two);
		const approved = JSON.parse(await readFile(join(state.root, 'items', two, 'decision.json'), 'utf8'));
		expect(approved).toMatchObject({ decision: 'approve', blob: base, comments: [comment], threads: [] });
	});
});

describe('comments on a change', () => {
	beforeEach(() => seedChangeItem(state.root, ID));
	const docOf = (k: number) => fixture(`change/head/${CHANGE_DOCS[k].path}`);
	const quote = 'The engine, installed by the setup command';
	const addTo = (k: number, text = 'Why?') =>
		call('comment', [['op', 'add'], ['text', text], ['file', CHANGE_DOCS[k].path], ...span(docOf(k), quote)]);

	it('add anchors into the named document at the change’s head, and load places it on that document only', async () => {
		const answer = (await addTo(1)) as { comments: Array<{ anchor: Record<string, unknown> }> };
		const from = docOf(1).indexOf(quote);
		expect(answer.comments[0].anchor).toEqual(anchorAt(docOf(1), from, from + quote.length, PAGE_HEAD, CHANGE_DOCS[1].path));
		const data = await loaded();
		expect(data.docs.map((d: { comments: unknown[] }) => d.comments.length)).toEqual([0, 1, 0]);
		expect(data.docs[1].comments[0].placed).toEqual({ from, to: from + quote.length });
	});

	it('add naming no document the change carries answers 400, and needs no blob', async () => {
		expect(await call('comment', [['op', 'add'], ['text', 'x'], ['file', 'docs/other.md'], ['from', '0'], ['to', '3']])).toMatchObject({ status: 400 });
		expect(await call('comment', [['op', 'add'], ['text', 'x'], ['from', '0'], ['to', '3']])).toMatchObject({ status: 400 });
	});

	it('load places each thread on the document its anchor names', async () => {
		const doc = docOf(1);
		const from = doc.indexOf(quote);
		const thread: Thread = { id: 'C1', status: 'answered', text: 'It is.', quote, anchor: anchorAt(doc, from, from + quote.length, PAGE_HEAD, CHANGE_DOCS[1].path) };
		await writeFile(join(state.root, 'items', ID, 'replies.json'), JSON.stringify([thread]));
		const data = await loaded();
		expect(data.docs[1].threads).toEqual([{ ...thread, placed: { from, to: from + quote.length }, reply: '', resolved: false }]);
		expect(data.docs[0].threads).toEqual([]);
		expect(await addTo(1)).toMatchObject({ id: 'C2' });
	});

	it('approve and reject both carry the comments', async () => {
		await addTo(1);
		const { comments } = await stored();
		await call('approve', [['call:Q1', 'Keep it']]);
		expect(await decision()).toEqual({ decision: 'approve', calls: [{ id: 'Q1', choice: 'Keep it' }], comments, threads: [] });
		await expect(addTo(1)).rejects.toMatchObject({ status: 404 });

		await seedChangeItem(state.root, '20261011T100000-2');
		const two = '20261011T100000-2';
		await call('comment', [['op', 'add'], ['text', 'Why?'], ['file', CHANGE_DOCS[1].path], ...span(docOf(1), quote)], two);
		await call('reject', [['note', 'n']], two);
		expect(JSON.parse(await readFile(join(state.root, 'items', two, 'decision.json'), 'utf8'))).toEqual({ decision: 'reject', note: 'n', comments, threads: [] });
	});
});
