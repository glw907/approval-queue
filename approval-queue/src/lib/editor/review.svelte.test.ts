import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlacedNote } from './notes.ts';
import { DocReview, type ReviewInit, type SaveResult } from './review.svelte.ts';

const KEY = 'desk.calls.test';

const notes: PlacedNote[] = [
	{
		id: 'B3',
		kind: 'decide',
		anchor: 'a.p1',
		title: 'Why',
		body: [],
		range: null,
		choices: [
			{ label: 'Use the code reason', text: 'Rewritten line.', done: 'Used it' },
			{ label: 'Keep it', done: 'Kept it' }
		]
	},
	{
		id: 'Q1',
		kind: 'question',
		anchor: 'a.p2',
		title: 'Keep it here?',
		body: [],
		range: null,
		choices: [{ label: 'Keep it here', done: 'Kept here' }]
	}
];

function review(blob: string, save: ReviewInit['save'] = async () => ({ ok: true, blob: 'saved' }), doc = 'Old line.') {
	return new DocReview({ doc, original: 'Old line.', blob, notes, save, remember: KEY });
}

/** What the editor's change hook is handed when a choice rewrites its line. */
const edited = { state: { doc: { toString: () => 'Rewritten line.' } } } as unknown as EditorView;

describe('DocReview remembered choices', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		const store = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, v)
		});
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('recalls a choice stored against the blob the page loaded', () => {
		review('b1').choose('B3', 1);
		expect(review('b1').decided).toEqual({ B3: 1 });
	});

	it('opens a choice again when its stored blob is stale', () => {
		review('b1').choose('B3', 1);
		expect(review('b2').decided).toEqual({});
	});

	it('opens a choice again when the rewrite it made was never saved', async () => {
		const failing = async (): Promise<SaveResult> => ({ ok: false, message: 'refused' });
		const r = review('b1', failing);
		r.hooks.change(edited);
		r.choose('B3', 0);
		expect(review('b1').decided).toEqual({});
		await r.flush();
		expect(review('b1').decided).toEqual({});
	});

	it('stores a rewriting choice against the blob its save returned', async () => {
		const r = review('b1');
		r.hooks.change(edited);
		r.choose('B3', 0);
		await r.flush();
		expect(review('b1').decided).toEqual({});
		expect(review('saved', undefined, 'Rewritten line.').decided).toEqual({ B3: 0 });
	});

	it('keeps a rewriting choice open after a failed save, whatever is chosen next', async () => {
		const failing = async (): Promise<SaveResult> => ({ ok: false, message: 'refused' });
		const r = review('b1', failing);
		r.hooks.change(edited);
		r.choose('B3', 0);
		await r.flush();
		r.choose('Q1', 0);
		expect(review('b1').decided).not.toHaveProperty('B3');
	});

	it('recalls a rewriting choice only when the loaded file holds its text', () => {
		localStorage.setItem(KEY, JSON.stringify({ blob: 'b1', decided: { B3: 0, Q1: 0 } }));
		expect(review('b1').decided).toEqual({ Q1: 0 });
		expect(review('b1', undefined, 'Rewritten line.').decided).toEqual({ B3: 0, Q1: 0 });
	});

	it('reports every saved pause as all edits saved', async () => {
		const r = review('b1');
		r.hooks.change(edited);
		await r.flush();
		expect(r.saveStatus).toBe('All edits saved');
	});
});

describe('DocReview comments', () => {
	const anchor = (from: number, to: number) => ({ quote: 'x', prefix: '', suffix: '', from, to, commit: 'c' });
	const doc = 'One line.\nTwo line.';
	const make = () =>
		new DocReview({
			doc,
			original: doc,
			blob: 'b1',
			notes: [],
			save: async () => ({ ok: true, blob: 'b2' }),
			comments: [
				{ id: 'C2', text: 'Later', anchor: anchor(10, 13), placed: { from: 10, to: 13 } },
				{ id: 'C1', text: 'Gone', anchor: anchor(40, 44), placed: null }
			],
			threads: [
				{ id: 'T1', status: 'done', text: 'Fixed', quote: 'One', anchor: anchor(0, 3), placed: { from: 0, to: 3 }, reply: '', resolved: false },
				{ id: 'T2', status: 'kept', text: 'Kept', quote: 'line', anchor: anchor(4, 8), placed: { from: 4, to: 8 }, reply: 'Fine', resolved: true }
			]
		});

	it('orders the cards by where their text starts and sets a gone one at its clamped offset', () => {
		const r = make();
		expect(r.cards.map((c) => c.key)).toEqual(['thread:T1', 'thread:T2', 'comment:C2', 'comment:C1']);
		expect(r.ranges['comment:C1']).toEqual([doc.length, doc.length]);
		expect(r.cards.find((c) => c.key === 'comment:C1')).toMatchObject({ gone: true });
	});

	it('counts the cards still open, the replies unread, and Geoff’s own replies', () => {
		const r = make();
		expect(r.cardCount).toBe(3);
		expect(r.unread).toBe(1);
		expect(r.replied).toBe(1);
	});

	it('takes comments only with a poster and while commentable', () => {
		const r = make();
		r.commentable = true;
		expect(r.canComment).toBe(false);
	});
});
