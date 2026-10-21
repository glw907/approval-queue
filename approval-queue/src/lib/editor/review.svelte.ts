import type { EditorView } from '@codemirror/view';
import { isCall, outline, type Heading, type PlacedNote, type Range } from './notes.ts';
import { headingAbove, jumpTo, noteRanges, replaceNoteText, setDecided, type EditorHooks } from './setup.ts';

/** What a save answered: the blob the file now has at HEAD, or why nothing was saved. */
export type SaveResult = { ok: true; blob: string } | { ok: false; message: string };

export interface ReviewInit {
	doc: string;
	original: string;
	/** The blob of the file at HEAD as the page loaded it, the base the first save is checked against. */
	blob: string;
	notes: PlacedNote[];
	/** Writes and commits the text; `base` is the blob the text was edited from. */
	save: (text: string, base: string) => Promise<SaveResult>;
}

const PAUSE_MS = 800;

/**
 * The state one document review shares between its editor, its review pane, and the decision bar:
 * the text, each call's choice, where each note sits, and the save. Edits save after a pause in
 * typing and on Ctrl+S, one save at a time, each against the blob the last one returned, so a file
 * changed outside the review is refused rather than overwritten.
 */
export class DocReview {
	text = $state('');
	/** The chosen choice's index, by note id. */
	decided = $state<Record<string, number>>({});
	/** Each note's start after the edits so far, for the pane's links and the outline's marks. */
	starts = $state<Record<string, number | null>>({});
	blob = $state('');
	saveStatus = $state('No edits');
	saveFailed = $state(false);
	markChanges = $state(false);
	/** The outline heading the reader has scrolled to. */
	current = $state<number | null>(null);

	readonly notes: PlacedNote[];
	readonly original: string;
	private readonly originalLines: Set<string>;
	private readonly saver: ReviewInit['save'];
	private view: EditorView | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private dirty = false;
	private inFlight: Promise<void> | null = null;

	constructor(init: ReviewInit) {
		this.text = init.doc;
		this.original = init.original;
		this.originalLines = new Set(init.original.split('\n'));
		this.blob = init.blob;
		this.notes = init.notes;
		this.saver = init.save;
		this.starts = Object.fromEntries(init.notes.map((n) => [n.id, n.range?.[0] ?? null]));
		this.calls = init.notes.filter(isCall);
		this.openCalls = $derived(this.calls.filter((n) => this.decided[n.id] === undefined));
		this.changedLines = $derived(this.text.split('\n').filter((l) => l.trim() && !this.originalLines.has(l)).length);
	}

	readonly headings: Heading[] = $derived(outline(this.text));
	/** The notes that ask for a choice, in file order. */
	readonly calls: PlacedNote[];
	readonly openCalls: PlacedNote[];
	/** Lines that are not in the queued text, the count the bar reports. */
	readonly changedLines: number;

	/** The hooks the editor calls; arrow functions, so `this` survives being handed over. */
	readonly hooks: EditorHooks = {
		change: (view) => {
			this.text = view.state.doc.toString();
			this.syncStarts();
			this.dirty = true;
			this.saveFailed = false;
			this.saveStatus = 'Saving…';
			if (this.timer) clearTimeout(this.timer);
			this.timer = setTimeout(() => void this.flush(), PAUSE_MS);
		},
		save: () => void this.flush(),
		choose: (id, index) => this.choose(id, index),
		reopen: (id) => {
			const { [id]: _, ...rest } = this.decided;
			this.decided = rest;
			if (this.view) setDecided(this.view, rest);
		}
	};

	attach(view: EditorView | null) {
		this.view = view;
	}

	private syncStarts() {
		if (!this.view) return;
		const ranges = noteRanges(this.view);
		this.starts = Object.fromEntries(Object.entries(ranges).map(([id, r]) => [id, r?.[0] ?? null]));
	}

	/** Records a call's choice; a choice with text rewrites the anchored line, one marked `edit` selects it to rewrite. */
	choose(id: string, index: number) {
		const note = this.notes.find((n) => n.id === id);
		const c = note?.choices?.[index];
		if (!note || !c) return;
		this.decided = { ...this.decided, [id]: index };
		const view = this.view;
		if (!view) return;
		if (c.text !== undefined) replaceNoteText(view, id, c.text);
		setDecided(view, this.decided);
		const r: Range | null = noteRanges(view)[id];
		if (r) {
			view.dispatch({ selection: c.edit ? { anchor: r[0], head: r[1] } : { anchor: r[0] } });
			view.focus();
		}
	}

	/** Saves now if anything is unsaved, and resolves once every save so far has finished. */
	async flush(): Promise<void> {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		while (this.inFlight || this.dirty) {
			if (this.inFlight) {
				await this.inFlight;
				continue;
			}
			this.dirty = false;
			this.inFlight = this.saveOnce().finally(() => (this.inFlight = null));
		}
	}

	private async saveOnce() {
		const text = this.text;
		let result: SaveResult;
		try {
			result = await this.saver(text, this.blob);
		} catch (err) {
			result = { ok: false, message: err instanceof Error ? err.message : 'the save did not reach the app' };
		}
		if (result.ok) {
			this.blob = result.blob;
			if (!this.dirty) this.saveStatus = 'All changes saved';
		} else {
			this.saveFailed = true;
			this.saveStatus = `Not saved: ${result.message}`;
			// A refused save is not retried on its own; the next edit tries again.
			this.dirty = false;
		}
	}

	/** Scrolls to a note's line and puts the caret there. */
	jumpToNote(id: string) {
		const pos = this.starts[id];
		if (this.view && pos !== null && pos !== undefined) jumpTo(this.view, pos);
	}

	jumpToPos(pos: number) {
		if (this.view) jumpTo(this.view, Math.min(pos, this.view.state.doc.length));
	}

	/** Moves to the next open call after the caret, wrapping to the first. */
	nextCall() {
		const view = this.view;
		if (!view) return;
		const open = this.openCalls
			.map((n) => [n.id, this.starts[n.id] ?? 0] as const)
			.sort((a, b) => a[1] - b[1]);
		if (!open.length) return;
		const head = view.state.selection.main.head;
		const next = open.find(([, pos]) => pos > head + 1) ?? open[0];
		jumpTo(view, next[1]);
	}

	/** Follows the window's scroll to the outline heading the reader is in. */
	track(limit = 130) {
		if (this.view) this.current = headingAbove(this.view, this.headings.map((h) => h.pos), limit);
	}
}
