import type { Note } from '#lib/server/items.ts';

/** How long typing pauses before the notes are saved. */
export const SAVE_MS = 600;

/**
 * A packet's notes on the page: the list the load returned, changed by `add`, `update`, and `remove`,
 * and saved as typed. Each change schedules one save of the whole list after typing pauses, so a
 * burst of keys posts once; `flush` saves at once and `cancel` drops a pending save (a decision
 * carries the notes itself). `count` is the notes with text, the number the decision bar names.
 */
export class Notes {
	items = $state<Note[]>([]);
	/** The last save failed; the notes still stand on the page and the next change tries again. */
	failed = $state(false);
	#timer: ReturnType<typeof setTimeout> | undefined;
	#save: (notes: Note[]) => Promise<void>;
	#delay: number;

	constructor(initial: Note[], save: (notes: Note[]) => Promise<void>, delay = SAVE_MS) {
		this.items = initial;
		this.#save = save;
		this.#delay = delay;
	}

	get count(): number {
		return this.items.filter((n) => n.text.trim() !== '').length;
	}

	add(note: Note) {
		this.items = [...this.items, note];
		this.#later();
	}

	update(id: string, text: string) {
		this.items = this.items.map((n) => (n.id === id ? { ...n, text } : n));
		this.#later();
	}

	remove(id: string) {
		this.items = this.items.filter((n) => n.id !== id);
		this.#later();
	}

	/** Saves now, unless nothing is pending. */
	async flush() {
		if (this.#timer === undefined) return;
		clearTimeout(this.#timer);
		this.#timer = undefined;
		try {
			await this.#save($state.snapshot(this.items));
			this.failed = false;
		} catch {
			this.failed = true;
		}
	}

	cancel() {
		clearTimeout(this.#timer);
		this.#timer = undefined;
	}

	#later() {
		clearTimeout(this.#timer);
		this.#timer = setTimeout(() => void this.flush(), this.#delay);
	}
}

/** Posts the whole list to the page's `notes` action, as `enhance` would. */
export async function postNotes(href: string, notes: Note[]): Promise<void> {
	const body = new FormData();
	body.set('notes', JSON.stringify(notes));
	const res = await fetch(href, { method: 'POST', body, headers: { accept: 'application/json', 'x-sveltekit-action': 'true' } });
	if (!res.ok) throw new Error(`notes not saved: ${res.status}`);
	const result = JSON.parse(await res.text()) as { type: string };
	if (result.type !== 'success') throw new Error(`notes not saved: ${result.type}`);
}
