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
	}
];

function review(blob: string, save: ReviewInit['save'] = async () => ({ ok: true, blob: 'saved' })) {
	return new DocReview({ doc: 'Old line.', original: 'Old line.', blob, notes, save, remember: KEY });
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
		expect(review('saved').decided).toEqual({ B3: 0 });
	});
});
