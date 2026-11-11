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
	return {
		...real,
		writeDecisionOnce: async (root: string, id: string, decision: Parameters<typeof real.writeDecisionOnce>[2]) => {
			if (state.vanish) await rm(join(root, 'items', id, 'item.json'));
			return real.writeDecisionOnce(root, id, decision);
		}
	};
});

import { setHeadReader } from '#lib/server/heads.ts';
import { headOf, seedFacts } from '#lib/server/seed-facts.ts';
import { actions, load } from './+page.server.ts';

const ID = '20261011T100000-1';

function call(name: keyof typeof actions, fields: [string, string][] = [], id = ID) {
	const request = new Request('http://127.0.0.1:7907/', { method: 'POST', body: new URLSearchParams(fields) });
	return actions[name]({ request, params: { id } } as never);
}

beforeEach(async () => {
	state.root = await mkdtemp(join(tmpdir(), 'approval-queue-facts-'));
});
afterEach(async () => {
	setHeadReader();
	await rm(state.root, { recursive: true, force: true });
});

describe('a new-shape packet', () => {
	const dir = () => join(state.root, 'items', ID);
	const read = async (name: string) => JSON.parse(await readFile(join(dir(), name), 'utf8'));
	const missing = (name: string) => expect(readFile(join(dir(), name), 'utf8')).rejects.toThrow();
	const NOTE = { id: 'n1', text: 'Check this', anchor: { section: 'opening', quote: 'q', prefix: '', suffix: '', from: 0, to: 1 } };
	const PICKS = JSON.stringify([
		{ call: 1, choice: 'Skip it', changed: false },
		{ call: 2, choice: 'Hold the docs page', changed: true }
	]);
	const DECIDED = JSON.stringify([{ call: 1, choice: 'lib/queue.test.ts', changed: false }]);
	/** The post an approve carries: the picks, the decided-for-you entries, and the notes. */
	const post = (notes: object[] = []): [string, string][] => [
		['calls', PICKS],
		['decidedForYou', DECIDED],
		['notes', JSON.stringify(notes)]
	];
	/** Stubs the head read: each PR answers its pinned head unless `moved` names it. */
	const heads = (moved: Record<string, string> = {}) => {
		const reads: string[] = [];
		setHeadReader(async (ref) => {
			reads.push(ref);
			return moved[ref] ?? headOf(ref, ['aq-fixture/sample#1', 'aq-fixture/sample#2']);
		});
		return reads;
	};
	const loaded = () => load({ params: { id: ID } } as never) as Promise<any>;

	beforeEach(async () => {
		await seedFacts(state.root, ID, 'close');
	});

	it('load returns the packet', async () => {
		await writeFile(join(dir(), 'notes.json'), JSON.stringify([NOTE]));
		await writeFile(join(dir(), 'replies.json'), JSON.stringify([{ note: 'n1', outcome: 'answered', text: 'Done' }]));
		await writeFile(join(dir(), 'stale.json'), JSON.stringify({ ref: 'aq-fixture/sample#1', queued: 'h1', now: 'h9' }));
		const data = await loaded();
		expect(data).toMatchObject({ kind: 'packet', decided: false });
		expect(data.packet.facts.kind).toBe('close');
		expect(data.packet.text.headline).toBeTruthy();
		expect(Object.keys(data.packet.patches)).toEqual(['aq-fixture/sample#1', 'aq-fixture/sample#2']);
		expect(data.packet.prs.map((p: any) => p.ref)).toEqual(['aq-fixture/sample#1', 'aq-fixture/sample#2']);
		expect(data.packet.heads).toEqual([
			{ ref: 'aq-fixture/sample#1', head: 'h1' },
			{ ref: 'aq-fixture/sample#2', head: 'h2' }
		]);
		expect(data.packet.notes).toEqual([NOTE]);
		expect(data.packet.replies).toHaveLength(1);
		expect(data.packet.stale).toEqual({ ref: 'aq-fixture/sample#1', queued: 'h1', now: 'h9' });
	});

	it('load carries a resend\u2019s earlier notes with their replies and marks the paragraphs that changed', async () => {
		const EARLIER = '20261010T100000-1';
		const edir = join(state.root, 'items', EARLIER);
		await mkdir(edir, { recursive: true });
		const text = await readFile(join(dir(), 'text.md'), 'utf8');
		const opening = text.split('\n\n')[1];
		await writeFile(join(edir, 'text.md'), text.replace(opening, 'An older opening paragraph.'));
		await writeFile(join(edir, 'notes.json'), JSON.stringify([NOTE]));
		await writeFile(join(edir, 'replies.json'), JSON.stringify([{ note: 'n1', outcome: 'fixed', text: 'Fixed', ref: 'abc1234' }]));
		await writeFile(join(dir(), 'item.json'), JSON.stringify({ id: ID, kind: 'packet', title: 'A packet', created: '2026-10-11T10:00:00Z', revises: { item: EARLIER, revision: 2 } }));
		const data = await loaded();
		expect(data.earlier).toMatchObject({ item: EARLIER, revision: 2, notes: [NOTE], replies: [{ note: 'n1', outcome: 'fixed' }] });
		expect(data.earlier.changed).toEqual([opening]);
	});

	it('load carries nothing for a packet that revises nothing, or whose earlier item is gone', async () => {
		expect((await loaded()).earlier).toBeUndefined();
		await writeFile(join(dir(), 'item.json'), JSON.stringify({ id: ID, kind: 'packet', title: 'A packet', created: 'c', revises: { item: 'gone', revision: 2 } }));
		expect((await loaded()).earlier).toBeUndefined();
	});

	it('load returns an old-shape packet as its stored text, read-only', async () => {
		await rm(dir(), { recursive: true });
		await mkdir(dir(), { recursive: true });
		await writeFile(join(dir(), 'packet.md'), '# Old packet\n');
		await writeFile(join(dir(), 'item.json'), JSON.stringify({ id: ID, kind: 'packet', title: 'Old', created: '2026-10-11T10:00:00Z' }));
		expect(await loaded()).toMatchObject({ kind: 'legacy', decided: false, text: '# Old packet\n' });
	});

	it('load renders a design packet’s document with demoted headings and a styled table', async () => {
		await rm(dir(), { recursive: true });
		await seedFacts(state.root, ID, 'design');
		await writeFile(join(dir(), 'design.md'), '# The design\n\n## Part\n\n| a | b |\n| - | - |\n| 1 | 2 |\n');
		const { designHtml } = await loaded();
		expect(designHtml).toContain('<h3>The design</h3>');
		expect(designHtml).toContain('<h4>Part</h4>');
		expect(designHtml).toContain('<table class="table');
	});

	it('load reads a damaged notes.json and replies.json as empty lists', async () => {
		await writeFile(join(dir(), 'notes.json'), '{nope');
		await writeFile(join(dir(), 'replies.json'), '{nope');
		const data = await loaded();
		expect([data.packet.notes, data.packet.replies]).toEqual([[], []]);
	});

	it('saves notes as typed: a note saved comes back on reload', async () => {
		expect(await call('notes', [['notes', JSON.stringify([NOTE])]])).toEqual({ saved: true });
		expect((await loaded()).packet.notes).toEqual([NOTE]);
		await call('notes', [['notes', JSON.stringify([NOTE, { id: 'n2', text: 'Whole', anchor: null }])]]);
		expect((await read('notes.json')).map((n: any) => n.id)).toEqual(['n1', 'n2']);
	});

	it('refuses notes that are not a list of notes', async () => {
		expect(await call('notes', [['notes', '[{"id":1}]']])).toMatchObject({ status: 400 });
		await missing('notes.json');
	});

	it('refuses notes on a decided item', async () => {
		heads();
		await call('approve', post());
		expect(await call('notes', [['notes', '[]']])).toMatchObject({ status: 409 });
	});

	it('approve writes the notes, then the decision with the same notes, and returns the next item', async () => {
		heads();
		expect(await call('approve', post([NOTE]))).toEqual({ next: null });
		expect(await read('notes.json')).toEqual([NOTE]);
		expect(await read('decision.json')).toEqual({
			decision: 'approve',
			calls: JSON.parse(PICKS),
			decidedForYou: JSON.parse(DECIDED),
			notes: [NOTE]
		});
	});

	it('refuses an approve whose head moved with 409 and writes nothing', async () => {
		heads({ 'aq-fixture/sample#2': 'moved' });
		expect(await call('approve', post([NOTE]))).toMatchObject({ status: 409 });
		await missing('decision.json');
		await missing('notes.json');
	});

	it('refuses an approve with 503 when gh fails, and writes nothing', async () => {
		setHeadReader(async () => {
			throw new Error('gh: not found');
		});
		expect(await call('approve', post([NOTE]))).toMatchObject({ status: 503 });
		await missing('decision.json');
		await missing('notes.json');
	});

	it('an approve answers every call with one of its options', async () => {
		heads();
		expect(await call('approve', [['calls', JSON.stringify([{ call: 1, choice: 'Skip it', changed: false }])], ['decidedForYou', DECIDED]])).toMatchObject({ status: 400 });
		const bad = JSON.stringify([{ call: 1, choice: 'Not an option', changed: false }, { call: 2, choice: 'Hold the docs page', changed: true }]);
		expect(await call('approve', [['calls', bad], ['decidedForYou', DECIDED]])).toMatchObject({ status: 400 });
		await missing('decision.json');
	});

	it('drops a blank note from the decision and from notes.json', async () => {
		heads();
		const blank = { ...NOTE, id: 'blank', text: '   ' };
		await call('approve', post([NOTE, blank]));
		expect(await read('notes.json')).toEqual([NOTE]);
		expect((await read('decision.json')).notes).toEqual([NOTE]);
	});

	it('a second approve answers 409 and keeps the first decision and its notes', async () => {
		heads();
		await call('approve', post([NOTE]));
		expect(await call('approve', post([{ ...NOTE, text: 'second' }]))).toMatchObject({ status: 409 });
		expect((await read('decision.json')).notes).toEqual([NOTE]);
		expect(await read('notes.json')).toEqual([NOTE]);
	});

	it('a decided item reloads with its notes and its decision', async () => {
		heads();
		await call('approve', post([NOTE]));
		const data = await loaded();
		expect(data).toMatchObject({ decided: true, decision: { decision: 'approve' } });
		expect(data.packet.notes).toEqual([NOTE]);
	});

	it('refuses a reject with no note, or only a blank one, and writes nothing', async () => {
		expect(await call('reject', post())).toMatchObject({ status: 400 });
		expect(await call('reject', post([{ id: 'n1', text: '  ', anchor: null }]))).toMatchObject({ status: 400 });
		await missing('decision.json');
	});

	it('a reject with a note writes it without reading any head', async () => {
		const reads = heads();
		expect(await call('reject', post([NOTE]))).toEqual({ next: null });
		expect(reads).toEqual([]);
		expect((await read('decision.json')).decision).toBe('reject');
		expect(await read('notes.json')).toEqual([NOTE]);
	});

	it('a reject carries the picks made so far, which need not cover every call', async () => {
		await call('reject', [['calls', JSON.stringify([{ call: 2, choice: 'Hold the docs page', changed: true }])], ['notes', JSON.stringify([NOTE])]]);
		expect((await read('decision.json')).calls).toEqual([{ call: 2, choice: 'Hold the docs page', changed: true }]);
	});

	it('answers an approve 410 when the item is withdrawn between the read and the write, leaving no decision', async () => {
		heads();
		state.vanish = true;
		try {
			expect(await call('approve', post([NOTE]))).toMatchObject({ status: 410, data: { board: '/' } });
		} finally {
			state.vanish = false;
		}
		await missing('decision.json');
		await missing('notes.json');
	});

	it('answers a post for an item already withdrawn 410, from a notes or approve post', async () => {
		await rm(join(dir(), 'item.json'));
		expect(await call('notes', [['notes', '[]']])).toMatchObject({ status: 410 });
		expect(await call('approve', post())).toMatchObject({ status: 410 });
	});

	describe('a design packet', () => {
		beforeEach(async () => {
			await rm(dir(), { recursive: true });
			await seedFacts(state.root, ID, 'design');
		});
		afterEach(() => {
			delete process.env.APPROVAL_QUEUE_PROJECTS;
		});
		const designPost: [string, string][] = [
			['calls', JSON.stringify([{ call: 1, choice: 'Drop it', changed: false }])],
			['notes', '[]']
		];
		const source = async (text: string) => {
			process.env.APPROVAL_QUEUE_PROJECTS = join(state.root, 'projects');
			await mkdir(join(state.root, 'projects', 'sample', 'docs', 'specs'), { recursive: true });
			await writeFile(join(state.root, 'projects', 'sample', 'docs', 'specs', '2026-11-10-sample-design.md'), text);
		};

		it('approves when the design file still has the pinned hash', async () => {
			await source('# The design\n');
			expect(await call('approve', designPost)).toEqual({ next: null });
		});

		it('refuses with 409 when the design file changed, and writes nothing', async () => {
			await source('# Edited\n');
			expect(await call('approve', designPost)).toMatchObject({ status: 409 });
			await missing('decision.json');
		});
	});
});

describe('the fold log', () => {
	it('appends {time, item, fold} to folds.jsonl each time a fold opens', async () => {
		await seedFacts(state.root, ID, 'close');
		await call('fold', [['fold', 'Reference']]);
		await call('fold', [['fold', 'Deep dive']]);
		const lines = (await readFile(join(state.root, 'folds.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
		expect(lines.map((l) => [l.item, l.fold])).toEqual([[ID, 'Reference'], [ID, 'Deep dive']]);
		expect(Date.parse(lines[0].time)).not.toBeNaN();
	});

	it('refuses a fold with no name, and an item that is not there', async () => {
		await seedFacts(state.root, ID, 'close');
		expect(await call('fold', [['fold', ' ']])).toMatchObject({ status: 400 });
		await expect(call('fold', [['fold', 'x']], '20261011T100000-9')).rejects.toMatchObject({ status: 404 });
		await expect(readFile(join(state.root, 'folds.jsonl'), 'utf8')).rejects.toThrow();
	});
});
