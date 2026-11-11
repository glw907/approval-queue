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

import { seedPacket, seedRevision, SINCE_PATCH } from '#lib/fixtures/seed-packet.ts';
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

describe('an item of a removed kind', () => {
	it.each(['blueprint', 'page', 'change', 'pr', 'docs'])('answers 404 to the load and every post, decided or not (%s)', async (kind) => {
		await seed(ID, { kind, repo: 'r', title: 't', created: 'c' }, { 'doc.md': '# doc' });
		for (const run of [() => load({ params: { id: ID } } as never), () => call('approve'), () => call('reject'), () => call('submit')]) {
			await expect(Promise.resolve().then(run)).rejects.toMatchObject({ status: 404 });
		}
		await writeFile(join(state.root, 'items', ID, 'decision.json'), '{"decision":"approve"}');
		await expect(load({ params: { id: ID } } as never)).rejects.toMatchObject({ status: 404 });
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
