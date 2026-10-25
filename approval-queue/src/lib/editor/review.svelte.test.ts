import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { desk } from '#lib/desk.svelte.ts';
import type { PlacedNote } from './notes.ts';
import { DocReview, heldBySave, RESTORE_GONE, noteStart, restoredDrafted, sendBackDraft, type CommentAnswer, type ReviewInit, type SaveResult } from './review.svelte.ts';

// The editor's state fields need a DOM-built view, so the review's calls into them read a stand-in's plain ranges.
type Ranges = Record<string, [number, number]>;
vi.mock('./setup.ts', async (importOriginal) => ({
	...(await importOriginal<typeof import('./setup.ts')>()),
	commentRanges: (view: { ranges: Ranges }) => view.ranges,
	setCommentRange: (view: { ranges: Ranges }, key: string, range: [number, number] | null) => {
		if (range) view.ranges[key] = range;
		else delete view.ranges[key];
	},
	noteRanges: () => ({}),
	setCurrent: () => {},
	setDecided: () => {}
}));

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

	// The panel opens the note, closes it, and opens it again; `text` and `drafted` are its two fields.
	it('rebuilds an untouched send-back draft when a call was answered while the note was closed', () => {
		const r = review('b1');
		const draft = () => sendBackDraft(r.openCalls, r.changedLines, 'plan');
		let text = noteStart('', '', draft());
		const drafted = text;
		expect(text).toBe('- Still open: Why\n- Still open: Keep it here?\n');
		r.choose('Q1', 0);
		text = noteStart(text, drafted, draft());
		expect(r.openCalls.map((n) => n.id)).toEqual(['B3']);
		expect(text).toBe('- Still open: Why\n');
	});

	it('treats a send-back draft Undo restored untouched as untouched, so a call answered since rebuilds it', () => {
		const r = review('b1');
		const draft = () => sendBackDraft(r.openCalls, r.changedLines, 'plan');
		const restored = draft();
		const drafted = restoredDrafted(restored, draft());
		r.choose('Q1', 0);
		expect(noteStart(restored, drafted, draft())).toBe('- Still open: Why\n');
	});

	it('treats a restored send-back note that differs from the rebuilt draft as typed', () => {
		const r = review('b1');
		const typed = `${sendBackDraft(r.openCalls, 0, 'plan')}Tighten the second section.`;
		const drafted = restoredDrafted(typed, sendBackDraft(r.openCalls, 0, 'plan'));
		r.choose('Q1', 0);
		expect(noteStart(typed, drafted, sendBackDraft(r.openCalls, 0, 'plan'))).toBe(typed);
	});

	it('keeps a send-back note the reader has typed in', () => {
		const r = review('b1');
		const drafted = sendBackDraft(r.openCalls, 0, 'plan');
		r.choose('Q1', 0);
		const typed = `${drafted}Tighten the second section.`;
		expect(noteStart(typed, drafted, sendBackDraft(r.openCalls, 0, 'plan'))).toBe(typed);
	});

	it('holds a decision back while the last save failed, naming the decision', async () => {
		const r = review('b1', async () => ({ ok: false, message: 'refused' }));
		expect(heldBySave(r, 'reject')).toBeNull();
		r.hooks.change(edited);
		await r.flush();
		expect(heldBySave(r, 'reject')).toBe('Not sent back: Not saved: refused');
		expect(heldBySave(r, 'approve')).toBe('Not approved: Not saved: refused');
		expect(heldBySave(r, 'defer')).toBe('Not deferred: Not saved: refused');
	});

	it('retries a refused save on the next flush, so a decision press is the retry', async () => {
		let accept = false;
		const saver = vi.fn(async (): Promise<SaveResult> => (accept ? { ok: true, blob: 'b2' } : { ok: false, message: 'refused' }));
		const r = review('b1', saver);
		r.hooks.change(edited);
		await r.flush();
		expect(r.saveFailed).toBe(true);
		accept = true;
		await r.flush();
		expect(saver).toHaveBeenCalledTimes(2);
		expect(r.saveFailed).toBe(false);
		expect(heldBySave(r, 'reject')).toBeNull();
	});
});

describe('DocReview comments', () => {
	const anchor = (from: number, to: number) => ({ quote: 'x', prefix: '', suffix: '', from, to, commit: 'c' });
	const doc = 'One line.\nTwo line.';
	const make = (comment?: ReviewInit['comment']) =>
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
			],
			comment
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

	it('posts one comment op at a time, so a second press sends nothing, and settles once it lands', async () => {
		vi.stubGlobal('document', { getElementById: () => null });
		let answer: (a: CommentAnswer) => void = () => {};
		const poster = vi.fn(() => new Promise<CommentAnswer>((resolve) => (answer = resolve)));
		const r = make(poster);
		r.commentable = true;
		const first = r.resolveThread('T1', true);
		await r.resolveThread('T1', true);
		let settled = false;
		const waiting = r.settled().then(() => (settled = true));
		await Promise.resolve();
		expect(poster).toHaveBeenCalledTimes(1);
		expect(settled).toBe(false);
		answer({ ok: true, id: 'T1', comments: [], threads: [{ id: 'T1', resolved: true }] });
		await first;
		await waiting;
		expect(settled).toBe(true);
		expect(r.threads.find((t) => t.id === 'T1')?.resolved).toBe(true);
		vi.unstubAllGlobals();
	});
});

describe('DocReview comment removal and its Undo', () => {
	const anchor = (from: number, to: number) => ({ quote: 'x', prefix: '', suffix: '', from, to, commit: 'c' });
	const doc = 'One line.\nTwo line.';
	const stored = [
		{ id: 'C1', text: 'First', anchor: anchor(0, 3) },
		{ id: 'C2', text: 'Second', anchor: anchor(10, 13) }
	];
	const asked: Array<Record<string, string>> = [];

	/** The smallest stand-in for the view: the document, the ranges the review keeps, and a focus that counts. */
	function standIn(text = doc) {
		return {
			state: EditorState.create({ doc: text }),
			ranges: { 'comment:C1': [0, 3], 'comment:C2': [10, 13] } as Record<string, [number, number]>,
			focused: 0,
			dispatch() {},
			focus() {
				this.focused++;
			}
		};
	}

	function make(answers: Array<() => Promise<CommentAnswer>>) {
		asked.length = 0;
		const poster = vi.fn((fields: Record<string, string>) => {
			asked.push(fields);
			return (answers.shift() ?? (async () => ({ ok: true as const, id: 'N1', comments: [], threads: [] })))();
		});
		const r = new DocReview({
			doc,
			original: doc,
			blob: 'b1',
			notes: [],
			save: async () => ({ ok: true, blob: 'b2' }),
			comments: stored.map((c) => ({ ...c, placed: { from: c.anchor.from, to: c.anchor.to } })),
			comment: poster
		});
		r.commentable = true;
		const view = standIn();
		r.attach(view as unknown as EditorView);
		return { r, view, poster };
	}
	const remaining = (ids: string[]) => async (): Promise<CommentAnswer> => ({
		ok: true,
		id: ids[0],
		comments: stored.filter((c) => ids.includes(c.id)),
		threads: []
	});

	beforeEach(() => {
		vi.stubGlobal('matchMedia', () => ({ matches: true }));
		vi.stubGlobal('document', { getElementById: () => null });
	});
	afterEach(() => {
		desk.toast = null;
		vi.unstubAllGlobals();
	});

	it('adds a deleted comment again on its text as the editor holds it now', async () => {
		const { r, view } = make([remaining(['C1']), async () => ({ ok: true, id: 'N1', comments: stored, threads: [] })]);
		await r.deleteComment('C2');
		expect(desk.toast).toBe('Comment deleted');
		// Edits since the delete moved the text; the comment comes back where "Two" now sits.
		view.state = EditorState.create({ doc: 'Added.\n' + doc });
		desk.toastUndo?.();
		await r.settled();
		expect(asked.at(-1)).toMatchObject({ op: 'add', text: 'Second', from: '17', to: '20' });
	});

	it('says so, and posts nothing, when the text a deleted comment was on is gone', async () => {
		const { r, view, poster } = make([remaining(['C1'])]);
		await r.deleteComment('C2');
		view.state = EditorState.create({ doc: 'Nothing is left.' });
		desk.toastUndo?.();
		await r.settled();
		expect(desk.toast).toBe(RESTORE_GONE);
		expect(poster).toHaveBeenCalledTimes(1);
	});

	it('puts focus on the next card after a delete, else the previous one, else the editor', async () => {
		const buttons: Record<string, { focus: () => void }> = {};
		const card = (id: string) => {
			const button = { focus: vi.fn() };
			buttons[id] = button;
			return { querySelector: () => button, focus: vi.fn() };
		};
		const present: Record<string, ReturnType<typeof card>> = { 'comment-C2': card('comment-C2') };
		vi.stubGlobal('document', { getElementById: (id: string) => present[id] ?? null });
		const first = make([remaining(['C2'])]);
		await first.r.deleteComment('C1');
		expect(buttons['comment-C2'].focus).toHaveBeenCalled();
		const second = make([remaining(['C1'])]);
		delete present['comment-C2'];
		present['comment-C1'] = card('comment-C1');
		await second.r.deleteComment('C2');
		expect(buttons['comment-C1'].focus).toHaveBeenCalled();
		const third = make([remaining(['C1'])]);
		delete present['comment-C1'];
		await third.r.deleteComment('C2');
		expect(third.view.focused).toBe(1);
	});

	it('leaves a box open while an op is on its way, and closes it once the op has landed', async () => {
		let answer: (a: CommentAnswer) => void = () => {};
		const { r } = make([() => new Promise<CommentAnswer>((resolve) => (answer = resolve))]);
		const op = r.deleteComment('C1');
		r.box = { kind: 'edit', id: 'C2', text: 'Second' };
		await r.cancelBox();
		expect(r.box).not.toBeNull();
		answer({ ok: true, id: 'C1', comments: stored.slice(1), threads: [] });
		await op;
		await r.cancelBox();
		expect(r.box).toBeNull();
	});

	it('settles only once an op started while it waited has landed too', async () => {
		const answers: Array<(a: CommentAnswer) => void> = [];
		const pending = () => new Promise<CommentAnswer>((resolve) => answers.push(resolve));
		const { r } = make([pending, pending]);
		const first = r.deleteComment('C1');
		let settled = false;
		const waiting = r.settled().then(() => (settled = true));
		answers[0]({ ok: true, id: 'C1', comments: stored.slice(1), threads: [] });
		// The first op's slot clears, and the next op starts before the waiter looks again.
		let second: Promise<void> | undefined;
		while (!second) {
			await Promise.resolve();
			if (!(r as unknown as { op: unknown }).op) second = r.deleteComment('C2');
		}
		await Promise.resolve();
		await Promise.resolve();
		expect(settled).toBe(false);
		answers[1]({ ok: true, id: 'C2', comments: [], threads: [] });
		await waiting;
		await first;
		await second;
		expect(settled).toBe(true);
	});
});
