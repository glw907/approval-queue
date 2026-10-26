import { deserialize, type ActionResult } from '$app/forms';
import { goto, invalidate } from '$app/navigation';
import { desk } from '#lib/desk.svelte.ts';
import { startHold } from '#lib/hold.ts';

/** How long a decision waits for Undo before it posts. */
export const HOLD_MS = 5000;

export const UNDONE = 'Decision undone. Nothing was sent.';
export const COUNTING = 'This item’s decision is already counting down. Undo it first to decide again.';
export const RESTORE_BLOCKED = 'Save or cancel your comment, then Undo opens the item again.';

/** A decision taken on one item, waiting out its hold or posting. */
export interface HeldDecision {
	id: string;
	title: string;
	kind: typeof desk.page;
	/** The item as the toasts name it, such as "the page Troubleshoot your site". */
	subject: string;
	/** The absolute form action `enhance` supplied, such as `http://127.0.0.1:7907/item/x?/approve`. */
	href: string;
	form: FormData;
	outcome: 'approve' | 'reject' | 'submit' | 'defer';
	toast: string;
}

/** A post that failed, which the error toast names and links to. */
export interface Failure {
	text: string;
	href: string;
	link: string;
}

/** What the store needs from the page, injected so a test can stand in for the network and the router. */
export interface HeldDeps {
	/** Posts the form as `enhance` would and reads the answer; it may reject on a network failure. */
	post: (href: string, body: FormData) => Promise<ActionResult>;
	refresh: () => Promise<void>;
	open: (url: string) => Promise<void>;
}

/** The panel state a held decision's form data carries, for the item Undo opens again. */
export interface Seed {
	note: string;
	/** A packet's answered asks, by ask index. */
	answers: Record<number, string>;
	/** A packet's routine verdicts, by part ref. */
	verdicts: Record<string, string>;
	/** A PR's or design's card picks, by card index. */
	picks: Array<number | undefined>;
	/** A triage list's rows in order; empty on every other kind. */
	rows: Array<{ disposition: string; note: string }>;
}

/** Reads back the fields `ItemPanel`'s form and its `form="decision-form"` inputs post. */
export function seedFrom(form: FormData, kind: HeldDecision['kind']): Seed {
	const seed: Seed = { note: '', answers: {}, verdicts: {}, picks: [], rows: [] };
	if (kind === 'triage') {
		// Triage rows post `disposition` and `note` in pairs; it has no send-back note.
		const notes = form.getAll('note').map(String);
		seed.rows = form.getAll('disposition').map((d, i) => ({ disposition: String(d), note: notes[i] ?? '' }));
		return seed;
	}
	seed.note = String(form.get('note') ?? '');
	for (const [name, value] of form.entries()) {
		const text = String(value);
		let m: RegExpExecArray | null;
		if ((m = /^ask:(\d+)$/.exec(name))) seed.answers[Number(m[1])] = text;
		else if ((m = /^part:(.+)$/.exec(name))) seed.verdicts[m[1]] = text;
		else if ((m = /^c(\d+)$/.exec(name))) seed.picks[Number(m[1])] = Number(text);
	}
	return seed;
}

/**
 * The decision held for Undo, at the layout so it outlives the item panel that took it: the panel
 * hands the decision over and opens the next item at once, and the post goes after `HOLD_MS`.
 * Only one decision counts down at a time, so a second one posts the first at once. Closing or
 * reloading the tab sends nothing, because the timer dies with the page. A post that succeeds does
 * what the panel's own success did; one that fails leaves the item waiting and shows `failure`.
 */
export class Held {
	/** The decision counting down in the toast; null when none is. */
	current = $state<HeldDecision | null>(null);
	/** Decisions past their hold whose post or queue reload has not finished. */
	sending = $state<HeldDecision[]>([]);
	failure = $state<Failure | null>(null);
	/** How the last hold ended, which sets whether its toast fades: only one that left on its timer does. */
	ended = $state<'sent' | 'undone'>('sent');
	#timer: ReturnType<typeof startHold> | null = null;
	#pausers = new Set<string>();
	#restoring: HeldDecision | null = null;
	/** Whether an open comment box stopped the navigation Undo started, so the item still has to open. */
	restoreBlocked = $state(false);
	#deps: HeldDeps;

	constructor(deps: HeldDeps) {
		this.#deps = deps;
	}

	/** Every item held or posting, which the rail, the board, and the next-item pick leave out. */
	get ids(): Set<string> {
		return new Set([...(this.current ? [this.current.id] : []), ...this.sending.map((d) => d.id)]);
	}

	/** Holds `decision`, posting any decision already held; one for an item held or posting is refused with false. */
	hold(decision: HeldDecision): boolean {
		if (this.ids.has(decision.id)) return false;
		// The toast stays mounted only when this replaces a decision still showing, so only then can a
		// pointer or focus already on it hold the new clock; an unmounted toast never sent its leave.
		const showing = this.current !== null;
		this.#timer?.flush();
		this.failure = null;
		if (!showing) this.#pausers.clear();
		this.current = decision;
		// Only the queue reload after a sent decision can reject, and the layout's poll reloads it again.
		this.#timer = startHold(HOLD_MS, { tick: () => {}, fire: () => void this.#send().catch(() => {}) });
		if (this.#pausers.size) this.#timer.pause();
		return true;
	}

	/** Stops the clock while the pointer or focus is on the toast; `by` names which, so each resumes only its own. */
	pause(by: string) {
		this.#pausers.add(by);
		this.#timer?.pause();
	}

	resume(by: string) {
		this.#pausers.delete(by);
		if (this.#pausers.size === 0) this.#timer?.resume();
	}

	/** Cancels the post and opens the held item again, whose panel takes the decision back with `take`. */
	async undo() {
		const decision = this.current;
		if (!decision) return;
		this.#timer?.cancel();
		this.#timer = null;
		this.ended = 'undone';
		this.current = null;
		this.#restoring = decision;
		this.restoreBlocked = false;
		await this.#deps.open(this.#restorePath(decision));
	}

	/**
	 * Records that a guard cancelled a navigation to `pathname`, and whether that was the one Undo
	 * started. The decision stays cancelled, and `resumeRestore` opens the item once the guard lets go.
	 */
	blockRestore(pathname: string): boolean {
		const blocked = this.#restoring !== null && pathname === this.#restorePath(this.#restoring);
		if (blocked) this.restoreBlocked = true;
		return blocked;
	}

	/** Opens the item Undo is restoring after a guard held it back; does nothing when none is held back. */
	async resumeRestore() {
		if (!this.restoreBlocked || !this.#restoring) return;
		this.restoreBlocked = false;
		await this.#deps.open(this.#restorePath(this.#restoring));
	}

	#restorePath(decision: HeldDecision) {
		return `/item/${encodeURIComponent(decision.id)}`;
	}

	/** The decision Undo handed back for item `id`, once; null for any other item or a second call. */
	take(id: string): HeldDecision | null {
		const decision = this.#restoring;
		if (decision?.id !== id) return null;
		this.#restoring = null;
		return decision;
	}

	async #send() {
		const decision = this.current;
		if (!decision) return;
		this.#timer = null;
		this.ended = 'sent';
		this.current = null;
		this.sending = [...this.sending, decision];
		try {
			const result = await this.#post(decision);
			if (result.type === 'success') {
				// A deferred item comes back to the reader, so its draft and remembered calls stay.
				if (decision.outcome !== 'defer') forget(decision.id);
				await this.#deps.refresh();
				return;
			}
			const reason =
				result.type === 'error' ? result.error.message : result.type === 'failure' ? String(result.data?.message ?? 'refused') : 'unexpected answer';
			const board = result.type === 'failure' && result.data?.board ? String(result.data.board) : null;
			this.failure = {
				text: `The decision on ${decision.subject} was not sent: ${reason}`,
				href: board ?? `/item/${encodeURIComponent(decision.id)}`,
				link: board ? 'Open the board' : 'Open it'
			};
			desk.announce(this.failure.text);
		} finally {
			this.sending = this.sending.filter((d) => d !== decision);
		}
	}

	async #post(decision: HeldDecision): Promise<ActionResult> {
		try {
			return await this.#deps.post(decision.href, decision.form);
		} catch (err) {
			return { type: 'error', error: { status: 0, message: err instanceof Error ? err.message : String(err) } };
		}
	}
}

/** Drops what a decided item no longer needs: its triage draft and its remembered calls. */
function forget(id: string) {
	desk.drafts.delete(id);
	const remember = `desk.calls.${id}`;
	try {
		for (const key of Object.keys(localStorage)) if (key === remember || key.startsWith(`${remember}.`)) localStorage.removeItem(key);
	} catch {
		// The remembered choices are a convenience; a stale entry is ignored once the item is decided.
	}
}

export const held = new Held({
	post: async (href, body) => {
		const res = await fetch(href, { method: 'POST', body, headers: { accept: 'application/json', 'x-sveltekit-action': 'true' } });
		return deserialize(await res.text());
	},
	refresh: () => invalidate('desk:queue'),
	open: (url) => goto(url, { replace: true })
});
