import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidate: vi.fn() }));

const { Held, HOLD_MS, seedFrom } = await import('./held.svelte.ts');
const { desk, FLASH_MS, FLASH_UNDO_MS } = await import('./desk.svelte.ts');
type HeldDecision = import('./held.svelte.ts').HeldDecision;
type ActionResult = import('$app/forms').ActionResult;

const SUCCESS: ActionResult = { type: 'success', status: 200, data: { next: null }, location: '/item/a' };
const failure = (status: number, message: string): ActionResult => ({ type: 'failure', status, data: { message }, location: '/item/a' });

function decision(id: string, outcome: HeldDecision['outcome'] = 'approve'): HeldDecision {
	const form = new FormData();
	form.set('blob', 'abc');
	return {
		id,
		title: `Item ${id}`,
		kind: 'blueprint',
		subject: `the blueprint for ${id}`,
		href: `http://127.0.0.1:7907/item/${id}?/${outcome}`,
		form,
		outcome,
		toast: `Approved the blueprint for ${id}.`
	};
}

function setup(answer: ActionResult | (() => Promise<ActionResult>) = SUCCESS) {
	const post = vi.fn(typeof answer === 'function' ? answer : async () => answer);
	const refresh = vi.fn(async () => {});
	const open = vi.fn(async () => {});
	return { store: new Held({ post, refresh, open }), post, refresh, open };
}

describe('Held', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		desk.drafts.clear();
	});
	afterEach(() => vi.useRealTimers());

	it('posts after five seconds and not before, then reloads the queue and forgets the drafts', async () => {
		const { store, post, refresh } = setup();
		desk.drafts.set('a', []);
		const d = decision('a');
		store.hold(d);
		expect(store.ids).toEqual(new Set(['a']));
		await vi.advanceTimersByTimeAsync(HOLD_MS - 1);
		expect(post).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(post).toHaveBeenCalledWith(d.href, d.form);
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(store.current).toBeNull();
		expect(store.sending).toEqual([]);
		expect(store.ids.size).toBe(0);
		expect(desk.drafts.has('a')).toBe(false);
		expect(store.ended).toBe('sent');
	});

	it('keeps the drafts of a deferred item, which comes back to the reader', async () => {
		const { store, post, refresh } = setup();
		desk.drafts.set('a', []);
		store.hold(decision('a', 'defer'));
		await vi.advanceTimersByTimeAsync(HOLD_MS);
		expect(post).toHaveBeenCalledTimes(1);
		expect(refresh).toHaveBeenCalledTimes(1);
		expect(desk.drafts.has('a')).toBe(true);
	});

	it('sends nothing on Undo, opens the item again, and hands its decision back once', async () => {
		const { store, post, open } = setup();
		const d = decision('a');
		store.hold(d);
		await vi.advanceTimersByTimeAsync(3000);
		await store.undo();
		await vi.advanceTimersByTimeAsync(HOLD_MS * 2);
		expect(post).not.toHaveBeenCalled();
		expect(open).toHaveBeenCalledWith('/item/a');
		expect(store.current).toBeNull();
		expect(store.ended).toBe('undone');
		expect(store.take('b')).toBeNull();
		expect(store.take('a')).toBe(d);
		expect(store.take('a')).toBeNull();
	});

	it('ignores a second decision on an item already held or posting, keeping the first clock', async () => {
		let answer!: (r: ActionResult) => void;
		const { store, post } = setup(() => new Promise((resolve) => (answer = resolve)));
		const first = decision('a');
		store.hold(first);
		await vi.advanceTimersByTimeAsync(2000);
		store.hold(decision('a', 'reject'));
		expect(store.current).toBe(first);
		expect(post).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(HOLD_MS - 2000);
		expect(post).toHaveBeenCalledTimes(1);
		store.hold(decision('a', 'reject'));
		expect(store.current).toBeNull();
		answer(SUCCESS);
		await vi.advanceTimersByTimeAsync(HOLD_MS * 2);
		expect(post).toHaveBeenCalledTimes(1);
		expect(post).toHaveBeenLastCalledWith(first.href, first.form);
	});

	it('refuses a second decision on a held item, so the panel can say the first is counting down', () => {
		const { store } = setup();
		const first = decision('a');
		expect(store.hold(first)).toBe(true);
		expect(store.hold(decision('a', 'reject'))).toBe(false);
		expect(store.current).toBe(first);
		expect(store.hold(decision('b'))).toBe(true);
	});

	it('keeps an Undo cancelled by an open comment box, and opens the item once the box closes', async () => {
		const { store, post, open } = setup();
		const d = decision('a');
		store.hold(d);
		open.mockImplementationOnce(async () => {
			expect(store.blockRestore('/item/b')).toBe(false);
			expect(store.blockRestore('/item/a')).toBe(true);
		});
		await store.undo();
		expect(store.restoreBlocked).toBe(true);
		expect(store.current).toBeNull();
		await vi.advanceTimersByTimeAsync(HOLD_MS * 2);
		expect(post).not.toHaveBeenCalled();
		expect(open).toHaveBeenCalledTimes(1);
		await store.resumeRestore();
		expect(open).toHaveBeenCalledTimes(2);
		expect(open).toHaveBeenLastCalledWith('/item/a');
		expect(store.restoreBlocked).toBe(false);
		expect(store.take('a')).toBe(d);
		await store.resumeRestore();
		expect(open).toHaveBeenCalledTimes(2);
	});

	it('keeps a second decision paused while the pointer stays on the toast', async () => {
		const { store, post } = setup();
		store.hold(decision('a'));
		store.pause('pointer');
		store.hold(decision('b'));
		expect(post).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(HOLD_MS * 2);
		expect(post).toHaveBeenCalledTimes(1);
		store.resume('pointer');
		await vi.advanceTimersByTimeAsync(HOLD_MS);
		expect(post).toHaveBeenCalledTimes(2);
	});

	it('posts a held decision at once when a second one is taken, and holds the second', async () => {
		const { store, post } = setup();
		const a = decision('a');
		const b = decision('b', 'reject');
		store.hold(a);
		await vi.advanceTimersByTimeAsync(1000);
		store.hold(b);
		expect(post).toHaveBeenCalledTimes(1);
		expect(post).toHaveBeenLastCalledWith(a.href, a.form);
		expect(store.current).toBe(b);
		await vi.advanceTimersByTimeAsync(HOLD_MS - 1);
		expect(post).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(post).toHaveBeenLastCalledWith(b.href, b.form);
	});

	it.each([
		[400, 'the blob is stale'],
		[404, 'Not Found'],
		[409, 'the file changed'],
		[410, 'withdrawn']
	])('names the item and links to it when the post answers %i', async (status, message) => {
		const { store, refresh } = setup(failure(status, message));
		desk.drafts.set('a', []);
		store.hold(decision('a'));
		await vi.advanceTimersByTimeAsync(HOLD_MS);
		expect(refresh).not.toHaveBeenCalled();
		expect(store.failure).toEqual({
			text: `The decision on the blueprint for a was not sent: ${message}`,
			href: '/item/a',
			link: 'Open it'
		});
		expect(store.ids.size).toBe(0);
		expect(desk.drafts.has('a')).toBe(true);
	});

	it('links a withdrawn packet to the board it answers with, and reports a network failure', async () => {
		const withdrawn: ActionResult = { type: 'failure', status: 410, data: { message: 'withdrawn', board: '/' }, location: '/item/a' };
		const first = setup(withdrawn);
		first.store.hold(decision('a'));
		await vi.advanceTimersByTimeAsync(HOLD_MS);
		expect(first.store.failure).toMatchObject({ href: '/', link: 'Open the board' });

		const second = setup(async () => {
			throw new Error('Failed to fetch');
		});
		second.store.hold(decision('a'));
		await vi.advanceTimersByTimeAsync(HOLD_MS);
		expect(second.store.failure?.text).toBe('The decision on the blueprint for a was not sent: Failed to fetch');
	});

	it('keeps the item out of the queue while its post is in flight', async () => {
		let answer: (result: ActionResult) => void = () => {};
		const { store } = setup(() => new Promise<ActionResult>((resolve) => (answer = resolve)));
		store.hold(decision('a'));
		await vi.advanceTimersByTimeAsync(HOLD_MS);
		expect(store.current).toBeNull();
		expect(store.ids).toEqual(new Set(['a']));
		answer(SUCCESS);
		await vi.advanceTimersByTimeAsync(0);
		expect(store.ids.size).toBe(0);
	});

	it('stops the clock while the pointer or focus is on the toast, until both have left', async () => {
		const { store, post } = setup();
		store.hold(decision('a'));
		await vi.advanceTimersByTimeAsync(2000);
		store.pause('pointer');
		store.pause('focus');
		await vi.advanceTimersByTimeAsync(60000);
		store.resume('pointer');
		await vi.advanceTimersByTimeAsync(60000);
		expect(post).not.toHaveBeenCalled();
		store.resume('focus');
		await vi.advanceTimersByTimeAsync(2999);
		expect(post).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(post).toHaveBeenCalledTimes(1);
	});
});

describe('seedFrom', () => {
	it('reads a packet’s note, answers, and verdicts back from its form data', () => {
		const form = new FormData();
		form.set('fingerprint', 'f');
		form.set('note', 'Please split it.');
		form.set('ask:0', 'Ship it');
		form.set('ask:2', 'Wait');
		form.set('part:glw907/x#4', 'reject');
		expect(seedFrom(form, 'packet')).toEqual({
			note: 'Please split it.',
			answers: { 0: 'Ship it', 2: 'Wait' },
			verdicts: { 'glw907/x#4': 'reject' },
			picks: [],
			rows: []
		});
	});

	it('reads a design’s card picks as indexes', () => {
		const form = new FormData();
		form.set('cards', 'fp');
		form.set('c0', '1');
		form.set('c2', '0');
		const seed = seedFrom(form, 'design');
		expect(seed.picks).toEqual([1, undefined, 0]);
		expect(seed.note).toBe('');
	});

	it('reads triage rows in order, pairing each disposition with its note', () => {
		const form = new FormData();
		for (const [d, n] of [['now', ''], ['drop', 'Not worth it'], ['defer', '']]) {
			form.append('disposition', d);
			form.append('note', n);
		}
		const seed = seedFrom(form, 'triage');
		expect(seed.rows).toEqual([
			{ disposition: 'now', note: '' },
			{ disposition: 'drop', note: 'Not worth it' },
			{ disposition: 'defer', note: '' }
		]);
		expect(seed.note).toBe('');
	});

	it('reads a document review’s send-back note', () => {
		const form = new FormData();
		form.set('blob', 'abc');
		form.set('call:B3', 'Keep it');
		form.set('note', '- Still open: Why\n');
		expect(seedFrom(form, 'blueprint')).toMatchObject({ note: '- Still open: Why\n', answers: {}, picks: [] });
	});
});

describe('desk.flash', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		desk.toast = null;
		vi.useRealTimers();
	});

	it('keeps a plain toast for 3.2 seconds and an Undo toast for 10', () => {
		desk.flash('Plain');
		vi.advanceTimersByTime(FLASH_MS);
		expect(desk.toast).toBeNull();
		desk.flash('Comment deleted', () => {});
		vi.advanceTimersByTime(FLASH_UNDO_MS - 1);
		expect(desk.toast).toBe('Comment deleted');
		vi.advanceTimersByTime(1);
		expect(desk.toast).toBeNull();
	});

	it('stops the clock while paused and carries on from the time left', () => {
		desk.flash('Comment deleted', () => {});
		vi.advanceTimersByTime(4000);
		desk.pauseFlash('pointer');
		vi.advanceTimersByTime(60_000);
		expect(desk.toast).toBe('Comment deleted');
		desk.resumeFlash('pointer');
		vi.advanceTimersByTime(FLASH_UNDO_MS - 4000 - 1);
		expect(desk.toast).toBe('Comment deleted');
		vi.advanceTimersByTime(1);
		expect(desk.toast).toBeNull();
	});

	it('resumes only when pointer and focus have both let go', () => {
		desk.flash('Comment deleted', () => {});
		desk.pauseFlash('pointer');
		desk.pauseFlash('focus');
		desk.resumeFlash('pointer');
		vi.advanceTimersByTime(FLASH_UNDO_MS * 2);
		expect(desk.toast).toBe('Comment deleted');
		desk.resumeFlash('focus');
		vi.advanceTimersByTime(FLASH_UNDO_MS);
		expect(desk.toast).toBeNull();
	});

	it('keeps the clock stopped for a new message while focus is still on the toast', () => {
		desk.flash('Comment deleted', () => {});
		desk.pauseFlash('focus');
		desk.flash('Reply deleted', () => {});
		vi.advanceTimersByTime(FLASH_UNDO_MS * 2);
		expect(desk.toast).toBe('Reply deleted');
		desk.resumeFlash('focus');
		vi.advanceTimersByTime(FLASH_UNDO_MS);
		expect(desk.toast).toBeNull();
	});

	it('lets a message with no Undo run, since the focused button is gone', () => {
		desk.flash('Comment deleted', () => {});
		desk.pauseFlash('focus');
		desk.flash('Saved');
		vi.advanceTimersByTime(FLASH_MS);
		expect(desk.toast).toBeNull();
	});

	it('ends both pauses when the toast unmounts', () => {
		desk.flash('Comment deleted', () => {});
		desk.pauseFlash('pointer');
		desk.pauseFlash('focus');
		desk.releaseFlash();
		vi.advanceTimersByTime(FLASH_UNDO_MS);
		expect(desk.toast).toBeNull();
	});
});
