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

import { git, REPOT, REPOT_HEAD, seedDocsItem, seedDocsRepo, WATER, WATER_HEAD } from '#lib/fixtures/seed-docs.ts';
import { seedPacket, seedRevision, SINCE_PATCH } from '#lib/fixtures/seed-packet.ts';
import { anchorAt } from '#lib/editor/comments.ts';
import { queued } from '#lib/server/docs.ts';
import { fileGroups } from '#lib/diff.ts';
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
	const PACKET = fixture('packet-baseline.md').replace('glw907/sample:docs/specs/notes-design.md', 'glw907/sample#43');
	const WITHDRAWN = 'This item was withdrawn by its session; nothing was recorded';
	const noDecision = () => expect(readFile(join(state.root, 'items', ID, 'decision.json'), 'utf8')).rejects.toThrow();
	const fingerprint = async () => ((await load({ params: { id: ID } } as never)) as { fingerprint: string }).fingerprint;

	/** A complete post: #42 held, #43 approved, both asks answered, the irreversible step confirmed. */
	async function fields(over: Record<string, string | null> = {}): Promise<[string, string][]> {
		return Object.entries({
			fingerprint: await fingerprint(),
			'part:glw907/sample#42': 'hold',
			'part:glw907/sample#43': 'approve',
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
			[1, 'gate-failed', 'glw907/sample#41', 3],
			[2, 'owner-call', null, 2]
		]);
		expect(data.routine.map((r: any) => [r.ref, r.verdict])).toEqual([
			['glw907/sample#42', 'approve'],
			['glw907/sample#43', 'approve'],
			['step:1', 'session']
		]);
		expect(data.parts.map((p: any) => [p.ref, p.lane, p.head])).toEqual([
			['glw907/sample#41', 'ask', 'aaa111'],
			['glw907/sample#42', 'routine', 'bbb222'],
			['glw907/sample#43', 'routine', 'ccc333'],
			['step:1', 'routine', undefined]
		]);
	});

	it('load gives a PR part its totals and a design part its rendered document', async () => {
		const patch = 'diff --git a/a.md b/a.md\n--- a/a.md\n+++ b/a.md\n@@ -1 +1,2 @@\n-old\n+new\n+more\ndiff --git a/b.md b/b.md\n--- a/b.md\n+++ b/b.md\n@@ -1 +1,2 @@\n x\n+y\n';
		await rm(join(state.root, 'items', ID), { recursive: true });
		// The baseline packet, whose third PR is a design part.
		await seedPacket(state.root, ID, fixture('packet-baseline.md'));
		await writeFile(join(state.root, 'items', ID, 'parts', '0', 'diff.patch'), patch);
		const data = (await load({ params: { id: ID } } as never)) as Record<string, any>;
		const pr = data.parts.find((p: any) => p.ref === 'glw907/sample#41');
		expect(pr.totals).toEqual({ files: 2, adds: 3, dels: 1 });
		const design = data.parts.find((p: any) => p.kind === 'design');
		expect(design.docHtml).toContain('<h1');
		expect(design.docHtml).toContain('Design');
		expect(data.parts.filter((p: any) => p.kind === 'step').every((p: any) => !('totals' in p) && !('docHtml' in p))).toBe(true);
	});

	it('load leaves the revision fields out of a first packet', async () => {
		const data = (await load({ params: { id: ID } } as never)) as Record<string, any>;
		for (const field of ['revision', 'sentBack', 'whatChanged']) expect(field in data).toBe(false);
		expect(data.parts.some((p: any) => 'since' in p)).toBe(false);
	});

	describe('a revision', () => {
		const EARLIER = '20261010T100000-1';
		const REVISION = PACKET.replace('## If you approve', '## What changed\n- Split the template change out of PR 41.\n\n## If you approve');
		const SENT_BACK = {
			note: 'Split this.',
			calls: [
				{ ref: 'glw907/sample#41', verdict: 'hold' },
				{ ask: 1, question: 'Merge the sample PR whose lint check failed?', choice: 'Hold' }
			]
		};

		it('load returns the round, Geoff’s earlier note and calls, the bullets, and each part’s since', async () => {
			await rm(join(state.root, 'items', ID), { recursive: true });
			await seedRevision(state.root, ID, REVISION, EARLIER, SENT_BACK);
			const data = (await load({ params: { id: ID } } as never)) as Record<string, any>;
			expect(data.revision).toBe(2);
			expect(data.sentBack).toEqual(SENT_BACK);
			expect(data.whatChanged).toEqual(['Split the template change out of PR 41.']);
			const since = (ref: string) => data.parts.find((p: any) => p.ref === ref).since;
			expect(since('glw907/sample#41').groups).toEqual(fileGroups(SINCE_PATCH));
			expect(since('glw907/sample#41').groups[0].files.map((f: any) => f.path)).toEqual(['notes.md']);
			expect(since('glw907/sample#42')).toEqual({ gone: true });
			expect(data.parts.find((p: any) => p.ref === 'glw907/sample#43')).not.toHaveProperty('since');
		});

		it('leaves sentBack out when the earlier item has no decision on disk', async () => {
			await rm(join(state.root, 'items', ID), { recursive: true });
			await seedRevision(state.root, ID, REVISION, EARLIER);
			const data = (await load({ params: { id: ID } } as never)) as Record<string, any>;
			expect(data.revision).toBe(2);
			expect('sentBack' in data).toBe(false);
		});

		it('reads an earlier send-back that holds no calls as an empty list', async () => {
			await rm(join(state.root, 'items', ID), { recursive: true });
			await seedRevision(state.root, ID, REVISION, EARLIER, { note: '', calls: [] });
			await writeFile(join(state.root, 'items', EARLIER, 'decision.json'), JSON.stringify({ decision: 'reject', note: '' }));
			const data = (await load({ params: { id: ID } } as never)) as Record<string, any>;
			expect(data.sentBack).toEqual({ note: '', calls: [] });
		});
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
				{ ref: 'glw907/sample#41', verdict: 'approve' },
				{ ref: 'glw907/sample#42', verdict: 'hold' },
				{ ref: 'glw907/sample#43', verdict: 'approve' },
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
		expect((await decision()).parts[0]).toEqual({ ref: 'glw907/sample#41', verdict: 'hold' });
	});

	it.each([
		['an unanswered ask', { 'ask:1': null }],
		['a label the ask does not hold', { 'ask:2': 'Stable soon' }],
		['a missing part', { 'part:glw907/sample#42': null }],
		['an unknown ref', { 'part:glw907/sample#99': 'approve' }],
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
		expect((await decision()).parts[1]).toEqual({ ref: 'glw907/sample#42', verdict: 'hold' });
	});

	it('two posts racing write one decision and answer the other 409', async () => {
		const post = await fields();
		const results = await Promise.all([call('approve', post), call('approve', post)]);
		expect(results.map((r) => (r as { status?: number }).status ?? 200).sort()).toEqual([200, 409]);
	});

	it('a reject carries the screen’s calls, and refuses nothing for its fields', async () => {
		await call('reject', [...(await fields({ 'part:glw907/sample#42': 'send-back', 'ask:2': null, fingerprint: 'stale' })), ['note', 'not now']]);
		const sent = await decision();
		expect(sent).toMatchObject({ decision: 'reject', note: 'not now' });
		expect(sent.calls).toEqual([
			{ ref: 'glw907/sample#41', verdict: 'approve' },
			{ ref: 'glw907/sample#42', verdict: 'send-back' },
			{ ref: 'glw907/sample#43', verdict: 'approve' },
			{ ref: 'step:1', verdict: 'session' },
			{ ask: 1, question: expect.any(String), choice: 'Merge anyway' },
			{ ask: 2, question: expect.any(String), choice: null }
		]);
		expect(await call('reject', [['note', 'again']])).toMatchObject({ status: 409 });
	});

	it('a reject with only a note still writes every call, each null', async () => {
		await call('reject', [['note', 'not now']]);
		expect((await decision()).calls.every((c: any) => ('verdict' in c ? c.verdict : c.choice) === null)).toBe(true);
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

	describe('an item withdrawn between the read and the write', () => {
		beforeEach(() => {
			state.vanish = true;
		});
		afterEach(() => {
			state.vanish = false;
		});

		it('answers a packet post 410 and leaves no decision', async () => {
			expect(await call('reject', [...(await fields()), ['note', 'not now']])).toMatchObject({
				status: 410,
				data: { message: WITHDRAWN, board: '/' }
			});
			await noDecision();
		});

		it('answers a post that is not from a packet page 404', async () => {
			await rm(join(state.root, 'items', ID), { recursive: true });
			await seedTriage();
			await expect(call('submit', [['disposition', 'now'], ['note', ''], ['disposition', 'defer'], ['note', ''], ['disposition', 'drop'], ['note', '']])).rejects.toMatchObject({ status: 404 });
			await noDecision();
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
			parts: expect.arrayContaining([{ ref: 'glw907/sample#42', verdict: 'hold' }]),
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

const SOIL = 'Dry soil at that depth means the plant needs water.';
const SAUCER = 'Empty the saucer after ten minutes.';
const span = (doc: string, text: string): [string, string][] => [
	['from', String(doc.indexOf(text))],
	['to', String(doc.indexOf(text) + text.length)]
];
const stored = async (id = ID) => JSON.parse(await readFile(join(state.root, 'items', id, 'comments.json'), 'utf8'));
const loaded = async (id = ID) => (await load({ params: { id } } as never)) as Record<string, any>;

describe('a docs review', () => {
	let repo: string;
	let blobs: { water: string; repot: string };
	let head: string;
	beforeEach(async () => {
		repo = await mkdtemp(join(tmpdir(), 'approval-queue-route-docs-'));
		blobs = seedDocsRepo(repo);
		head = git(repo, 'rev-parse', 'HEAD');
		await seedDocsItem(state.root, ID, repo);
	});
	afterEach(() => rm(repo, { recursive: true, force: true }));

	const answered = (water = blobs.water, repot = blobs.repot): [string, string][] => [
		['call:N2', 'Keep the text'],
		['call:N3', 'Leave it out'],
		[`blob:${WATER}`, water],
		[`blob:${REPOT}`, repot]
	];
	const save = (file: string, text: string, blob: string) => call('save', [['file', file], ['text', text], ['blob', blob]]);

	it('load returns the pages at HEAD with their merge-base text and blob, and each note on its quote in its own page', async () => {
		const data = await loaded();
		expect(data).toMatchObject({
			kind: 'docs',
			ref: 'glw907/sample#7',
			head,
			link: { url: 'https://github.com/glw907/sample/pull/7', head: 'repot-page', base: 'main' },
			description: ['The guide had no repotting page.', 'This adds one and tightens the watering step.']
		});
		expect(data.pages.map((p: { path: string; blob: string; missing: boolean }) => [p.path, p.blob, p.missing])).toEqual([
			[WATER, blobs.water, false],
			[REPOT, blobs.repot, false]
		]);
		expect(data.pages[0].doc).toBe(WATER_HEAD);
		expect(data.pages[0].base).toContain('runs out of the drainage holes');
		expect(data.pages[1].base).toBe('');
		const quoted = (page: { doc: string; notes: Array<{ id: string; range: [number, number] }> }) =>
			page.notes.map((n) => [n.id, page.doc.slice(n.range[0], n.range[1])]);
		expect(quoted(data.pages[0])).toEqual([
			['N1', 'runs from the drainage holes'],
			['N2', 'ten minutes']
		]);
		expect(quoted(data.pages[1])).toEqual([['N3', 'one size up']]);
	});

	it('load returns the code diff without the pages', async () => {
		const data = await loaded();
		expect(data.groups.flatMap((g: { files: Array<{ path: string }> }) => g.files.map((f) => f.path))).toEqual(['src/watering.ts']);
		expect(data.totals).toEqual({ files: 1, adds: 1, dels: 1 });
		expect(data).not.toHaveProperty('revision');
		expect(data).not.toHaveProperty('since');
		expect(data).not.toHaveProperty('approved');
	});

	it('load returns the round and the diff since the send-back of a revision', async () => {
		await rm(join(state.root, 'items', ID), { recursive: true });
		await seedDocsItem(state.root, ID, repo, { revises: { item: '20261010T100000-1', revision: 3, commit: head } });
		await writeFile(join(state.root, 'items', ID, 'since.patch'), SINCE_PATCH);
		const data = await loaded();
		expect(data.revision).toBe(3);
		expect(data.since.groups[0].files[0]).toMatchObject({ path: 'notes.md', adds: 1, dels: 1 });
		await rm(join(state.root, 'items', ID, 'since.patch'));
		await writeFile(join(state.root, 'items', ID, 'since.json'), '{"gone":true}');
		expect((await loaded()).since).toEqual({ gone: true });
	});

	it('load returns the diff since the approve of an amend, and no round', async () => {
		await rm(join(state.root, 'items', ID), { recursive: true });
		await seedDocsItem(state.root, ID, repo, { amends: { commit: head } });
		await writeFile(join(state.root, 'items', ID, 'approved.patch'), SINCE_PATCH);
		const data = await loaded();
		expect(data.approved.groups[0].files[0].path).toBe('notes.md');
		expect(data).not.toHaveProperty('revision');
		expect(data).not.toHaveProperty('since');
	});

	it('load shows the queued copy of each page, marked missing, when the worktree is gone', async () => {
		await rm(repo, { recursive: true, force: true });
		const data = await loaded();
		expect(data.pages.map((p: { doc: string; blob: string; missing: boolean }) => [p.doc, p.blob, p.missing])).toEqual([
			[WATER_HEAD, '', true],
			[REPOT_HEAD, '', true]
		]);
	});

	it('save commits that page alone in the worktree and answers its new blob; a stale blob answers 409', async () => {
		const text = WATER_HEAD.replace('top inch', 'top two inches');
		const saved = (await save(WATER, text, blobs.water)) as { blob: string; commit: string };
		expect(saved.blob).toBe(git(repo, 'rev-parse', `HEAD:${WATER}`));
		expect(saved.commit).toBe(git(repo, 'rev-parse', 'HEAD'));
		expect(git(repo, 'log', '-1', '--format=%s')).toBe(`Edit ${WATER} in review`);
		expect(git(repo, 'show', '--name-only', '--format=', 'HEAD')).toBe(WATER);
		expect(await readFile(join(repo, WATER), 'utf8')).toBe(text);
		expect(await save(WATER, `${text}x`, blobs.water)).toMatchObject({ status: 409 });
		expect(git(repo, 'rev-list', '--count', 'HEAD')).toBe('3');
	});

	it('save is checked against the blob of the page it names, not another', async () => {
		expect(await save(WATER, `${WATER_HEAD}x`, blobs.repot)).toMatchObject({ status: 409 });
		expect(await save(REPOT, `${REPOT_HEAD}x`, blobs.repot)).toMatchObject({ blob: expect.any(String) });
	});

	it('save naming no page the review carries, or posting no file, answers 400', async () => {
		expect(await save('docs/other.md', 'x', blobs.water)).toMatchObject({ status: 400 });
		expect(await call('save', [['text', 'x'], ['blob', blobs.water]])).toMatchObject({ status: 400 });
	});

	it('save on a page no longer committed answers 409', async () => {
		git(repo, 'rm', '-q', REPOT);
		git(repo, 'commit', '-q', '-m', 'Drop the page');
		expect(await save(REPOT, 'x', blobs.repot)).toMatchObject({ status: 409 });
	});

	it('a save on a decided item answers 404 and commits nothing', async () => {
		await call('approve', answered());
		await expect(save(WATER, `${WATER_HEAD}late\n`, blobs.water)).rejects.toMatchObject({ status: 404 });
		expect(git(repo, 'rev-parse', 'HEAD')).toBe(head);
	});

	it('approve after saves records the calls, the commit at HEAD, and the comments; a second post answers 409', async () => {
		const water = (await save(WATER, `${WATER_HEAD}more\n`, blobs.water)) as { blob: string };
		await call('approve', answered(water.blob));
		expect(await decision()).toEqual({
			decision: 'approve',
			commit: git(repo, 'rev-parse', 'HEAD'),
			calls: [
				{ id: 'N2', choice: 'Keep the text' },
				{ id: 'N3', choice: 'Leave it out' }
			],
			comments: (await stored()).comments,
			threads: []
		});
		expect((await decision()).commit).not.toBe(head);
		expect(await call('approve', answered(water.blob))).toMatchObject({ status: 409 });
	});

	it('approve with no edit names the PR head as its commit', async () => {
		await call('approve', answered());
		expect((await decision()).commit).toBe(head);
	});

	it('approve with a call open, or an unknown call, answers 400 and writes nothing', async () => {
		expect(await call('approve', answered().filter(([k]) => k !== 'call:N3'))).toMatchObject({ status: 400 });
		expect(await call('approve', [...answered(), ['call:N1', 'x']])).toMatchObject({ status: 400 });
		await expect(decision()).rejects.toThrow();
	});

	it('approve against a stale blob for any page answers 400 and writes nothing', async () => {
		await save(REPOT, `${REPOT_HEAD}more\n`, blobs.repot);
		expect(await call('approve', answered())).toMatchObject({ status: 400 });
		expect(await call('approve', answered().filter(([k]) => k !== `blob:${WATER}`))).toMatchObject({ status: 400 });
		await expect(decision()).rejects.toThrow();
	});

	it('approve with a page changed but not committed answers 400 and writes nothing', async () => {
		await writeFile(join(repo, REPOT), 'dirty');
		expect(await call('approve', answered())).toMatchObject({ status: 400 });
		await expect(decision()).rejects.toThrow();
	});

	it('approve with a page no longer committed answers 409 and writes nothing', async () => {
		git(repo, 'rm', '-q', REPOT);
		git(repo, 'commit', '-q', '-m', 'Drop the page');
		expect(await call('approve', answered())).toMatchObject({ status: 409 });
		await expect(decision()).rejects.toThrow();
	});

	it('reject writes the note, the worktree commit, the calls made so far, and the comments', async () => {
		const saved = (await save(WATER, `${WATER_HEAD}more\n`, blobs.water)) as { commit: string };
		await call('reject', [['note', 'Name the pot material.'], ['call:N2', 'Apply the fix'], ['call:N3', 'Maybe'], ['call:N1', 'x']]);
		expect(await decision()).toEqual({
			decision: 'reject',
			note: 'Name the pot material.',
			commit: saved.commit,
			calls: [{ id: 'N2', choice: 'Apply the fix' }],
			comments: (await stored()).comments,
			threads: []
		});
	});

	it('reject with no call answered writes no calls, and with the worktree gone names the queued head', async () => {
		await rm(repo, { recursive: true, force: true });
		await call('reject', [['note', '']]);
		expect(await decision()).toEqual({ decision: 'reject', note: '', commit: head, comments: (await stored()).comments, threads: [] });
	});

	it('load of a decided item carries its decision', async () => {
		await call('approve', answered());
		expect(await loaded()).toMatchObject({ decided: true, decision: { decision: 'approve', commit: head } });
	});

	it('an approve waits behind a save on any page’s queue, and a save queued after it commits nothing', async () => {
		// A step held open on the second page's queue stands in for a save mid-commit, so the order is fixed.
		let release = () => {};
		const held = queued(repo, REPOT, () => new Promise<void>((r) => (release = r)));
		const settle = (p: Promise<unknown>) => {
			const out = { done: false };
			p.then(
				() => (out.done = true),
				() => (out.done = true)
			);
			return out;
		};
		const approve = Promise.resolve(call('approve', answered()));
		const approving = settle(approve);
		await new Promise((r) => setTimeout(r, 100));
		const late = Promise.resolve(save(WATER, `${WATER_HEAD}raced\n`, blobs.water));
		const saving = settle(late);
		await new Promise((r) => setTimeout(r, 100));
		expect(approving.done).toBe(false);
		expect(saving.done).toBe(false);
		await expect(decision()).rejects.toThrow();

		release();
		await held;
		await approve;
		await expect(late).rejects.toMatchObject({ status: 404 });
		expect((await decision()).commit).toBe(head);
		expect(git(repo, 'rev-list', '--count', 'HEAD')).toBe('2');
	});

	describe('comments', () => {
		const add = (text: string, quote = SOIL, file = WATER, blob = blobs.water, doc = WATER_HEAD) =>
			call('comment', [['op', 'add'], ['text', text], ['file', file], ['blob', blob], ...span(doc, quote)]);

		it('add anchors the comment into the named page committed at the posted blob, and load places it on that page only', async () => {
			const answer = await add('Say how deep a knuckle is.\r\nIn centimetres.');
			const from = WATER_HEAD.indexOf(SOIL);
			const comment = { id: 'C3', text: 'Say how deep a knuckle is.\nIn centimetres.', anchor: anchorAt(WATER_HEAD, from, from + SOIL.length, head, WATER) };
			expect(answer).toMatchObject({ id: 'C3', comments: [expect.objectContaining({ id: 'C2' }), comment] });
			expect((await stored()).next).toBe(4);
			const data = await loaded();
			expect(data.pages[0].comments.map((c: { id: string }) => c.id)).toEqual(['C2', 'C3']);
			expect(data.pages[0].comments[1].placed).toEqual({ from, to: from + SOIL.length });
			expect(data.pages[1].comments).toEqual([]);
		});

		it('add into the second page anchors into that page’s text', async () => {
			const quote = 'Choose a pot one size up';
			await add('Which size?', quote, REPOT, blobs.repot, REPOT_HEAD);
			const [comment] = (await stored()).comments.slice(-1);
			expect(comment.anchor).toMatchObject({ quote, file: REPOT, commit: head });
			expect((await loaded()).pages[1].comments.map((c: { id: string }) => c.id)).toEqual(['C3']);
		});

		it('load re-places a comment after a save moves its text, and shows a deleted one as unplaced', async () => {
			await add('One.');
			await add('Two.', SAUCER);
			const moved = WATER_HEAD.replace('## Check the soil\n', '## Check the soil\n\nA new paragraph.\n').replace(SAUCER, 'Gone.');
			await save(WATER, moved, blobs.water);
			const [, soil, saucer] = (await loaded()).pages[0].comments;
			expect(moved.slice(soil.placed.from, soil.placed.to)).toBe(SOIL);
			expect(soil.placed.from).not.toBe(soil.anchor.from);
			expect(saucer.placed).toBeNull();
		});

		it('add against a stale blob answers 409, naming no page 400, and a bad range 400', async () => {
			const saved = (await save(WATER, `${WATER_HEAD}more\n`, blobs.water)) as { blob: string };
			expect(await add('Late.')).toMatchObject({ status: 409 });
			expect(await add('x', SOIL, 'docs/other.md', saved.blob)).toMatchObject({ status: 400 });
			expect(await call('comment', [['op', 'add'], ['text', 'x'], ['blob', saved.blob], ...span(WATER_HEAD, SOIL)])).toMatchObject({ status: 400 });
			expect(await call('comment', [['op', 'add'], ['text', 'x'], ['file', WATER], ['blob', saved.blob], ['from', '5'], ['to', '5']])).toMatchObject({ status: 400 });
			expect(await call('comment', [['op', 'add'], ['text', 'x'], ['file', WATER], ['blob', saved.blob], ['from', '0'], ['to', '99999']])).toMatchObject({ status: 400 });
			expect(await add('   ', SOIL, WATER, saved.blob)).toMatchObject({ status: 400 });
			expect(await call('comment', [['op', 'nope']])).toMatchObject({ status: 400 });
			expect(await add('Fresh.', SOIL, WATER, saved.blob)).toMatchObject({ id: 'C3' });
		});

		it('add on a page no longer committed answers 409', async () => {
			git(repo, 'rm', '-q', REPOT);
			git(repo, 'commit', '-q', '-m', 'Drop the page');
			expect(await add('Gone.', 'Choose a pot', REPOT, blobs.repot, REPOT_HEAD)).toMatchObject({ status: 409 });
		});

		it('every op on a decided item answers 404 and writes nothing', async () => {
			await add('Before.');
			await call('approve', answered());
			const before = await stored();
			for (const fields of [
				[['op', 'add'], ['text', 'After.'], ['file', WATER], ['blob', blobs.water], ...span(WATER_HEAD, SOIL)],
				[['op', 'edit'], ['id', 'C2'], ['text', 'x']],
				[['op', 'delete'], ['id', 'C2']]
			] as [string, string][][]) {
				await expect(call('comment', fields)).rejects.toMatchObject({ status: 404 });
			}
			expect(await stored()).toEqual(before);
		});

		it('edit and delete act on a comment, and a deleted id is never reused', async () => {
			await add('One.');
			await add('Two.', SAUCER);
			expect(await call('comment', [['op', 'edit'], ['id', 'C3'], ['text', 'One, edited.']])).toMatchObject({ id: 'C3' });
			expect(await call('comment', [['op', 'delete'], ['id', 'C4']])).toMatchObject({ id: 'C4' });
			expect(await add('Three.', SAUCER)).toMatchObject({ id: 'C5' });
			expect((await stored()).comments.map((c: { id: string; text: string }) => [c.id, c.text])).toEqual([
				['C2', 'Say which inch.'],
				['C3', 'One, edited.'],
				['C5', 'Three.']
			]);
			expect(await call('comment', [['op', 'edit'], ['id', 'C4'], ['text', 'x']])).toMatchObject({ status: 400 });
			expect(await call('comment', [['op', 'delete'], ['id', 'C9']])).toMatchObject({ status: 400 });
			expect(await call('comment', [['op', 'edit'], ['id', 'C3'], ['text', ' ']])).toMatchObject({ status: 400 });
		});

		it('on a re-queued item with no comments saved, a new comment takes an id past every thread, and load places the thread on its page', async () => {
			await rm(join(state.root, 'items', ID, 'comments.json'));
			expect(await add('New.')).toMatchObject({ id: 'C2' });
			const data = await loaded();
			const [thread] = JSON.parse(await readFile(join(state.root, 'items', ID, 'replies.json'), 'utf8'));
			expect(data.pages[0].threads).toEqual([]);
			expect(data.pages[1].threads).toEqual([{ ...thread, placed: { from: thread.anchor.from, to: thread.anchor.to }, reply: '', resolved: false }]);
		});

		it('reply, resolve, and reopen act on a thread, and an empty reply removes Geoff’s', async () => {
			await call('comment', [['op', 'reply'], ['id', 'C1'], ['text', 'Thanks.']]);
			expect((await stored()).threads).toEqual([{ id: 'C1', reply: 'Thanks.' }]);
			await call('comment', [['op', 'resolve'], ['id', 'C1']]);
			expect((await loaded()).pages[1].threads.map((t: { reply: string; resolved: boolean }) => [t.reply, t.resolved])).toEqual([['Thanks.', true]]);
			await call('comment', [['op', 'reopen'], ['id', 'C1']]);
			await call('comment', [['op', 'reply'], ['id', 'C1'], ['text', '']]);
			expect((await stored()).threads).toEqual([]);
			expect(await call('comment', [['op', 'reply'], ['id', 'C2'], ['text', 'x']])).toMatchObject({ status: 400 });
			expect(await call('comment', [['op', 'resolve'], ['id', 'C7']])).toMatchObject({ status: 400 });
		});

		it('approve carries the comments and only the threads Geoff replied to', async () => {
			await add('New.');
			await call('comment', [['op', 'reply'], ['id', 'C1'], ['text', 'Fair.']]);
			await call('approve', answered());
			const written = await decision();
			expect(written).toMatchObject({ decision: 'approve', commit: head, threads: [{ id: 'C1', reply: 'Fair.' }] });
			expect(written.comments).toEqual((await stored()).comments);
			expect(written.comments.map((c: { id: string }) => c.id)).toEqual(['C2', 'C3']);
		});

		it('approve leaves out a thread Geoff only resolved', async () => {
			await call('comment', [['op', 'resolve'], ['id', 'C1']]);
			await call('approve', answered());
			expect((await decision()).threads).toEqual([]);
		});

		describe('posted while a decision waits on a page’s queue', () => {
			// A step held open on the page's queue stands in for a save mid-commit, so the order is fixed.
			let release = () => {};
			let held: Promise<void>;
			beforeEach(() => {
				held = queued(repo, WATER, () => new Promise<void>((r) => (release = r)));
			});
			const tick = () => new Promise((r) => setTimeout(r, 50));

			it('is refused with 404 when the decision was queued first, never dropped', async () => {
				const approve = Promise.resolve(call('approve', answered()));
				await tick();
				const comment = Promise.resolve(add('Raced.'));
				await tick();
				release();
				await held;
				await approve;
				await expect(comment).rejects.toMatchObject({ status: 404 });
				expect((await decision()).comments.map((c: { id: string }) => c.id)).toEqual(['C2']);
			});

			it('is carried when it was queued first', async () => {
				const comment = Promise.resolve(add('First.'));
				await tick();
				const reject = Promise.resolve(call('reject', [['note', 'n']]));
				await tick();
				await expect(decision()).rejects.toThrow();
				release();
				await held;
				expect(await comment).toMatchObject({ id: 'C3' });
				await reject;
				expect((await decision()).comments.map((c: { text: string }) => c.text)).toEqual(['Say which inch.', 'First.']);
			});
		});

		it('a CRLF page anchors in LF, so the quote is the line the editor shows', async () => {
			await writeFile(join(repo, WATER), WATER_HEAD.replace(/\n/g, '\r\n'));
			git(repo, 'commit', '-q', '-am', 'Use CRLF');
			const blob = git(repo, 'rev-parse', `HEAD:${WATER}`);
			const answer = (await add('Hm.', SOIL, WATER, blob)) as { comments: Array<{ anchor: { quote: string; from: number; suffix: string } }> };
			const { anchor } = answer.comments.at(-1)!;
			expect(anchor.quote).toBe(SOIL);
			expect(anchor.from).toBe(WATER_HEAD.indexOf(SOIL));
			expect(anchor.suffix).not.toContain('\r');
		});
	});
});

describe('an item of a removed kind', () => {
	it.each(['blueprint', 'page', 'change'])('answers 404 to the load and every post, decided or not (%s)', async (kind) => {
		await seed(ID, { kind, repo: 'r', title: 't', created: 'c' }, { 'doc.md': '# doc' });
		for (const run of [() => load({ params: { id: ID } } as never), () => call('approve'), () => call('reject'), () => call('comment', [['op', 'delete']]), () => call('save'), () => call('defer')]) {
			await expect(Promise.resolve().then(run)).rejects.toMatchObject({ status: 404 });
		}
		await writeFile(join(state.root, 'items', ID, 'decision.json'), '{"decision":"approve"}');
		await expect(load({ params: { id: ID } } as never)).rejects.toMatchObject({ status: 404 });
	});
});

describe('defer', () => {
	const SECOND = '20261011T100100-2';
	const THIRD = '20261011T100200-3';
	const seedAt = (id: string, created: string, meta: object = {}) =>
		seed(id, { kind: 'design', file: 'd.md', created, ...meta }, { 'doc.md': '# d' });
	const deferredFile = (id = ID) => join(state.root, 'items', id, 'deferred.json');

	it('writes deferred.json with the time, leaves item.json, and answers the next item', async () => {
		await seedAt(ID, '2026-10-11T10:00:00Z');
		await seedAt(SECOND, '2026-10-11T10:01:00Z');
		expect(await call('defer')).toEqual({ next: `/item/${SECOND}` });
		expect(JSON.parse(await readFile(deferredFile(), 'utf8')).at).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
		await expect(readFile(join(state.root, 'items', ID, 'item.json'), 'utf8')).resolves.toContain(ID);
		await expect(readFile(join(state.root, 'items', ID, 'decision.json'), 'utf8')).rejects.toThrow();
	});

	it('is null when nothing else waits', async () => {
		await seedAt(ID, '2026-10-11T10:00:00Z');
		expect(await call('defer')).toEqual({ next: null });
	});

	it('refuses a triage with 400 and writes nothing', async () => {
		await seedTriage();
		expect(await call('defer')).toMatchObject({ status: 400 });
		await expect(readFile(deferredFile(), 'utf8')).rejects.toThrow();
	});

	it('refuses a decided item with 409 ALREADY_DECIDED', async () => {
		await seedAt(ID, '2026-10-11T10:00:00Z');
		await call('approve', [['cards', '']]);
		expect(await call('defer')).toMatchObject({ status: 409, data: { message: 'Already decided' } });
		await expect(readFile(deferredFile(), 'utf8')).rejects.toThrow();
	});

	it('refuses an item already deferred with 409', async () => {
		await seedAt(ID, '2026-10-11T10:00:00Z');
		await call('defer');
		const first = await readFile(deferredFile(), 'utf8');
		expect(await call('defer')).toMatchObject({ status: 409, data: { message: 'Already deferred' } });
		expect(await readFile(deferredFile(), 'utf8')).toBe(first);
	});

	it('404s an unknown id', async () => {
		await expect(call('defer')).rejects.toMatchObject({ status: 404 });
	});

	it('never opens a deferred item next, from defer or from a decision', async () => {
		await seedAt(ID, '2026-10-11T10:00:00Z');
		await seedAt(SECOND, '2026-10-11T10:01:00Z');
		await seedAt(THIRD, '2026-10-11T10:02:00Z');
		await call('defer', [], SECOND);
		expect(await call('approve', [['cards', '']])).toEqual({ next: `/item/${THIRD}` });
	});

	it('a later approve writes decision.json as for any item', async () => {
		await seedAt(ID, '2026-10-11T10:00:00Z');
		await call('defer');
		await call('approve', [['cards', '']]);
		expect(await decision()).toEqual({ decision: 'approve', choices: [] });
	});

	it('load carries deferred, orphaned, and canDefer for each state of the item', async () => {
		const data = async () => (await load({ params: { id: ID } } as never)) as unknown as { meta: { deferred: boolean; orphaned: boolean }; canDefer: boolean };
		await seedAt(ID, '2026-10-11T10:00:00Z');
		expect(await data()).toMatchObject({ meta: { deferred: false, orphaned: false }, canDefer: true });
		await call('defer');
		expect(await data()).toMatchObject({ meta: { deferred: true, orphaned: false }, canDefer: false });
		await rm(deferredFile());
		await call('approve', [['cards', '']]);
		expect(await data()).toMatchObject({ canDefer: false });
		await rm(join(state.root, 'items', ID), { recursive: true });
		await seedTriage();
		expect(await data()).toMatchObject({ canDefer: false });
		await rm(join(state.root, 'items', ID), { recursive: true });
		await seedAt(ID, '2026-10-11T10:00:00Z', { pid: 2 ** 22 + 1, pidStart: 1 });
		expect(await data()).toMatchObject({ meta: { deferred: false, orphaned: true }, canDefer: true });
	});
});

describe('a packet whose packet.json does not parse', () => {
	const PACKET = fixture('packet-baseline.md').replace('glw907/sample:docs/specs/notes-design.md', 'glw907/sample#43');
	const WITHDRAWN = 'This item was withdrawn by its session; nothing was recorded';
	beforeEach(async () => {
		await seedPacket(state.root, ID, PACKET);
		await writeFile(join(state.root, 'items', ID, 'packet.json'), '{nope');
	});

	it('404s the load, as for a withdrawn item', async () => {
		await expect(load({ params: { id: ID } } as never)).rejects.toMatchObject({ status: 404 });
	});

	it('answers a post from the open packet page 410 with the withdrawn message, and any other post 404', async () => {
		expect(await call('approve', [['fingerprint', 'abc']])).toMatchObject({ status: 410, data: { message: WITHDRAWN, board: '/' } });
		expect(await call('reject', [['fingerprint', 'abc']])).toMatchObject({ status: 410, data: { message: WITHDRAWN } });
		await expect(call('approve')).rejects.toMatchObject({ status: 404 });
	});
});

describe('a reject or submit that is not a form post', () => {
	const notForm = () => new Request('http://127.0.0.1:7907/', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
	const noDecision = () => expect(readFile(join(state.root, 'items', ID, 'decision.json'), 'utf8')).rejects.toThrow();

	it('answers a PR reject 400 and writes nothing', async () => {
		await seedPr();
		expect(await actions.reject({ request: notForm(), params: { id: ID } } as never)).toMatchObject({ status: 400, data: { message: 'Not a form post' } });
		await noDecision();
	});

	it('answers a triage submit 400 and writes nothing', async () => {
		await seedTriage();
		expect(await actions.submit({ request: notForm(), params: { id: ID } } as never)).toMatchObject({ status: 400, data: { message: 'Not a form post' } });
		await noDecision();
	});
});
