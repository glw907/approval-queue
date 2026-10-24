import type { EditorView } from '@codemirror/view';
import { tick } from 'svelte';
import { setDrawer } from '#lib/components/frame/drawers.ts';
import { desk } from '#lib/desk.svelte.ts';
import { anchorAt, place, type Anchor, type Comment, type ReplyStatus, type Thread } from './comments.ts';
import { WIDE_MARGIN } from './margin.ts';
import { isCall, outline, type Heading, type PlacedNote, type Range } from './notes.ts';
import {
	cardId,
	commentRanges,
	headingAbove,
	jumpTo,
	lineTop,
	noteRanges,
	replaceNoteText,
	setCommentRange,
	setCurrent,
	setDecided,
	setResolved,
	type EditorHooks
} from './setup.ts';

/** What a save answered: the blob the file now has at HEAD, or why nothing was saved. */
export type SaveResult = { ok: true; blob: string } | { ok: false; message: string };

/** Where the server placed a stored comment or thread in the document as it is now; null when its text is gone. */
type Placed = { placed: { from: number; to: number } | null };
export type PlacedComment = Comment & Placed;
export type PlacedThread = Thread & Placed & { reply: string; resolved: boolean };

/** What the `comment` action answered: the whole stored state after the op, or why it refused. */
export type CommentAnswer =
	| { ok: true; id: string; comments: Comment[]; threads: Array<{ id: string; reply?: string; resolved?: boolean }> }
	| { ok: false; message: string };

export interface ReviewInit {
	doc: string;
	original: string;
	/** The blob of the file at HEAD as the page loaded it, the base the first save is checked against. */
	blob: string;
	notes: PlacedNote[];
	/** Writes and commits the text; `base` is the blob the text was edited from. */
	save: (text: string, base: string) => Promise<SaveResult>;
	/** The calls already made, by note id: a decided item's recorded answers. */
	decided?: Record<string, number>;
	/**
	 * Where the reader's open choices are remembered across a reload, a `localStorage` key; omitted
	 * for a decided item, whose choices come from its decision.
	 */
	remember?: string;
	/** The text takes no edits at all, as in a change review: a choice records its answer only. */
	readonly?: boolean;
	comments?: PlacedComment[];
	threads?: PlacedThread[];
	/** Posts one op to the item's `comment` action; without it the comments are read only. */
	comment?: (fields: Record<string, string>) => Promise<CommentAnswer>;
	/** A change review's document path, which its comments name; absent on a blueprint or page, whose adds name the blob. */
	file?: string;
	/** The id of this document's comment margin, which is the drawer below 1260px. */
	margin?: string;
}

export interface ReviewComment {
	id: string;
	text: string;
	quote: string;
	/** The offset the comment was made at, where its card sits once its text is gone. */
	at: number;
}

export interface ReviewThread {
	id: string;
	status: ReplyStatus;
	/** The author's reply. */
	text: string;
	quote: string;
	/** Geoff's reply to it, or empty. */
	reply: string;
	resolved: boolean;
}

/** The one comment box a screen may have open: a new comment on a selection, an edit, or a reply to a thread. */
export type CommentBox =
	| { kind: 'new'; text: string; sel: { anchor: number; head: number } }
	| { kind: 'edit' | 'reply'; id: string; text: string };

export type MarginCard =
	| { key: string; kind: 'note'; note: PlacedNote }
	| { key: string; kind: 'comment'; comment: ReviewComment; gone: boolean }
	| { key: string; kind: 'thread'; thread: ReviewThread; gone: boolean }
	| { key: 'draft'; kind: 'draft' };

export const OPEN_FIRST = 'Save or cancel the comment you have open first';
export const SELECT_FIRST = 'Select the text you want to comment on first';
export const RESTORE_GONE = 'The comment was not restored: the text you commented on is gone.';

/** The review whose comment box is open, across every document on the screen, since only one box opens at a time. */
export const boxes = $state<{ open: DocReview | null }>({ open: null });

/** Refuses an action while a comment box is open: says so and puts focus in the box. */
export function refuseOpenBox(): boolean {
	if (!boxes.open) return false;
	void boxes.open.focusBox();
	desk.flash(OPEN_FIRST);
	return true;
}

/** What a document review's send-back note starts with: each call still open, and how much was edited. */
export function sendBackDraft(openCalls: PlacedNote[], changedLines: number, what: string): string {
	const lines = openCalls.map((n) => `- Still open: ${n.title}`);
	if (changedLines) lines.push(`- ${changedLines} ${changedLines === 1 ? 'line' : 'lines'} changed in the ${what}`);
	return lines.length ? `${lines.join('\n')}\n` : '';
}

/**
 * The text the send-back note opens with. A draft the reader left untouched is rebuilt, since the
 * calls it listed may have been answered while the note was closed; anything they typed stays.
 */
export function noteStart(text: string, drafted: string, fresh: string): string {
	return text === '' || text === drafted ? fresh : text;
}

/**
 * The draft `noteStart` should compare against for a note Undo restored: the note itself when it is
 * still the draft rebuilt now, so it counts as untouched; empty otherwise, so it counts as typed.
 */
export function restoredDrafted(note: string, fresh: string): string {
	return note === fresh ? note : '';
}

/** The announcement for a decision a failed save holds back, or null when the last edit is saved. */
export function heldBySave(review: Pick<DocReview, 'saveFailed' | 'saveStatus'>, outcome: 'approve' | 'reject'): string | null {
	return review.saveFailed ? `${outcome === 'reject' ? 'Not sent back' : 'Not approved'}: ${review.saveStatus}` : null;
}

const PAUSE_MS = 800;

const wide = () => matchMedia(WIDE_MARGIN).matches;

/**
 * The stored choices, when they were stored against `blob` and still name one of these notes'
 * choices. A choice that rewrites its line comes back only when `doc` holds the rewrite, whatever
 * the store says: a reload that lost the edit opens the call again rather than approve it beside a
 * file that lacks its text.
 */
function recalled(key: string | undefined, notes: PlacedNote[], blob: string, doc: string): Record<string, number> {
	if (!key) return {};
	let stored: unknown;
	try {
		stored = JSON.parse(localStorage.getItem(key) ?? '{}');
	} catch {
		return {};
	}
	if (!stored || typeof stored !== 'object' || !('blob' in stored) || stored.blob !== blob) return {};
	if (!('decided' in stored) || !stored.decided || typeof stored.decided !== 'object') return {};
	return Object.fromEntries(
		Object.entries(stored.decided).filter(([id, i]) => {
			if (typeof i !== 'number') return false;
			const c = notes.find((n) => n.id === id && isCall(n))?.choices?.[i];
			return c !== undefined && (c.text === undefined || doc.includes(c.text));
		})
	);
}

/** The corrections resolved in the margin, kept beside the remembered choices; they change no decision. */
function recalledResolved(key: string | undefined, notes: PlacedNote[]): string[] {
	if (!key) return [];
	try {
		const stored: unknown = JSON.parse(localStorage.getItem(`${key}.resolved`) ?? '[]');
		return Array.isArray(stored) ? stored.filter((id) => notes.some((n) => n.id === id && !isCall(n))) : [];
	} catch {
		return [];
	}
}

/**
 * The state one document review shares between its editor, its comment margin, and the decision
 * bar: the text, each call's choice, where each note and comment sits, the comments themselves, and
 * the save. Edits save after a pause in typing and on Ctrl+S, one save at a time, each against the
 * blob the last one returned, so a file changed outside the review is refused rather than
 * overwritten. A comment posts when its box is saved, behind any pending edit.
 */
export class DocReview {
	text = $state('');
	/** The chosen choice's index, by note id. */
	decided = $state<Record<string, number>>({});
	/** Each note's start after the edits so far, for the margin and the outline's marks. */
	starts = $state<Record<string, number | null>>({});
	/** Each comment's and thread's range after the edits so far, keyed as the editor keys them. */
	ranges = $state<Record<string, Range>>({});
	blob = $state('');
	saveStatus = $state('No edits');
	saveFailed = $state(false);
	markChanges = $state(false);
	/** The outline heading the reader has scrolled to. */
	current = $state<number | null>(null);
	/** No text edits are taken, so a choice records its answer without rewriting its line. */
	readonly = $state(false);
	/** The calls are frozen too, as once the item is decided. */
	locked = $state(false);
	/** Comments can be added and changed: the item waits and its file is there. */
	commentable = $state(false);
	comments = $state<ReviewComment[]>([]);
	threads = $state<ReviewThread[]>([]);
	/** The corrections resolved in the margin. */
	resolved = $state<string[]>([]);
	box = $state<CommentBox | null>(null);
	/** The card that is current, by key; its highlight deepens and the margin keeps it level with its text. */
	currentCard = $state<string | null>(null);
	selectionEmpty = $state(true);
	selectionFrom = $state(0);
	/** A mouse button is down in the text, so a selection is still being made. */
	dragging = $state(false);
	/** Bumped whenever the editor's geometry changes, so the margin lays its cards out again. */
	geometry = $state(0);

	readonly notes: PlacedNote[];
	readonly original: string;
	readonly file: string | undefined;
	readonly margin: string;
	/** Whether the text is the reviewer's to edit at all; a change review never is. */
	readonly editable: boolean;
	private readonly originalLines: Set<string>;
	private readonly saver: ReviewInit['save'];
	private readonly poster: ReviewInit['comment'];
	private readonly remember: string | undefined;
	private view: EditorView | null = null;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private dirty = false;
	private inFlight: Promise<void> | null = null;
	private savedOnce = false;
	/** The comment op on its way, from its first await to its answer; null when none is. */
	private op: Promise<unknown> | null = null;
	private mouseSelecting = false;

	constructor(init: ReviewInit) {
		this.text = init.doc;
		this.original = init.original;
		this.originalLines = new Set(init.original.split('\n'));
		this.blob = init.blob;
		this.notes = init.notes;
		this.saver = init.save;
		this.poster = init.comment;
		this.file = init.file;
		this.margin = init.margin ?? 'margin';
		this.remember = init.remember;
		this.editable = !init.readonly;
		this.readonly = !this.editable;
		this.decided = init.decided ?? recalled(init.remember, init.notes, init.blob, init.doc);
		this.resolved = recalledResolved(init.remember, init.notes);
		this.starts = Object.fromEntries(init.notes.map((n) => [n.id, n.range?.[0] ?? null]));
		const end = init.doc.length;
		// A comment whose text is gone sits where it was made, clamped to the document.
		const at = (p: Placed['placed'], from: number): Range => (p ? [p.from, p.to] : [Math.min(from, end), Math.min(from, end)]);
		this.comments = (init.comments ?? []).map((c) => ({ id: c.id, text: c.text, quote: c.anchor.quote, at: c.anchor.from }));
		this.threads = (init.threads ?? []).map((t) => ({
			id: t.id,
			status: t.status,
			text: t.text,
			quote: t.quote,
			reply: t.reply,
			resolved: t.resolved
		}));
		this.ranges = Object.fromEntries([
			...(init.threads ?? []).map((t) => [`thread:${t.id}`, at(t.placed, t.anchor.from)] as const),
			...(init.comments ?? []).map((c) => [`comment:${c.id}`, at(c.placed, c.anchor.from)] as const)
		]);
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

	/** Every card the margin shows, in the order of the text they are about. */
	readonly cards: MarginCard[] = $derived.by(() => {
		const gone = (key: string) => {
			const r = this.ranges[key];
			return !r || r[1] <= r[0];
		};
		const cards: MarginCard[] = [
			...this.notes.map((note) => ({ key: `note:${note.id}`, kind: 'note' as const, note })),
			...this.threads.map((thread) => ({ key: `thread:${thread.id}`, kind: 'thread' as const, thread, gone: gone(`thread:${thread.id}`) })),
			...this.comments.map((comment) => ({ key: `comment:${comment.id}`, kind: 'comment' as const, comment, gone: gone(`comment:${comment.id}`) })),
			...(this.box?.kind === 'new' ? [{ key: 'draft' as const, kind: 'draft' as const }] : [])
		];
		return cards.sort((a, b) => this.positionOf(a.key) - this.positionOf(b.key));
	});

	/** The cards still asking for attention: open notes, unresolved threads, and saved comments. */
	readonly cardCount: number = $derived.by(
		() =>
			this.notes.filter((n) => this.decided[n.id] === undefined && !this.resolved.includes(n.id)).length +
			this.threads.filter((t) => !t.resolved).length +
			this.comments.length
	);
	/** The author's replies Geoff has neither resolved nor answered. */
	readonly unread: number = $derived(this.threads.filter((t) => !t.resolved && !t.reply).length);
	readonly replied: number = $derived(this.threads.filter((t) => t.reply).length);

	/** The hooks the editor calls; arrow functions, so `this` survives being handed over. */
	readonly hooks: EditorHooks = {
		change: (view) => {
			this.text = view.state.doc.toString();
			this.syncRanges();
			if (!this.editable) return;
			this.dirty = true;
			this.saveFailed = false;
			this.saveStatus = 'Saving…';
			if (this.timer) clearTimeout(this.timer);
			this.timer = setTimeout(() => void this.flush(), PAUSE_MS);
		},
		save: () => void this.flush(),
		select: (view) => {
			const s = view.state.selection.main;
			this.selectionEmpty = s.empty;
			this.selectionFrom = s.from;
			if (this.box) return;
			const hit = this.cardAt(s.head);
			// The editor is mid-update here, so its current highlight moves on the next microtask.
			if (hit && hit !== this.currentCard) queueMicrotask(() => this.setCurrentCard(hit));
		},
		geometry: () => this.geometry++,
		comment: () => void this.openBox()
	};

	/** An edit is waiting for its pause, being saved, or not yet sent. */
	get pending(): boolean {
		return this.dirty || this.timer !== null || this.inFlight !== null;
	}

	/** Resolves once the comment op on its way, if any, has its answer, so a decision never reads the comments before it lands. */
	async settled(): Promise<void> {
		await this.op?.catch(() => {});
	}

	/**
	 * Runs one comment op at a time. One asked for while another is on its way is dropped and gives
	 * null, so a second press of Save or Delete during a slow save posts nothing twice.
	 */
	private async exclusive<T>(run: () => Promise<T>): Promise<T | null> {
		if (this.op) return null;
		const op = run();
		this.op = op;
		try {
			return await op;
		} finally {
			this.op = null;
		}
	}

	/** New comments can be made and saved ones changed. */
	get canComment(): boolean {
		return this.commentable && this.poster !== undefined;
	}

	/** The editor holds focus. */
	get focused(): boolean {
		return this.view?.hasFocus ?? false;
	}

	/** Sets whether text edits are taken; a review that takes none, as a change's, stays so. */
	setReadonly(readonly: boolean) {
		this.readonly = !this.editable || readonly;
	}

	attach(view: EditorView | null) {
		this.view = view;
	}

	/** Where a card's text starts; a note whose anchor named nothing sits at the top. */
	positionOf(key: string): number {
		if (key.startsWith('note:')) return this.starts[key.slice(5)] ?? 0;
		return this.ranges[key]?.[0] ?? 0;
	}

	/** The viewport y of the line a card belongs to, or null before the editor is built. */
	topOf(key: string): number | null {
		return this.view ? lineTop(this.view, this.positionOf(key)) : null;
	}

	/** The viewport y of the selection's first line, where the margin's Comment button sits. */
	selectionTop(): number | null {
		return this.view ? lineTop(this.view, this.selectionFrom) : null;
	}

	/** The card whose highlighted text holds `pos`, notes first. */
	private cardAt(pos: number): string | null {
		for (const n of this.notes) {
			const r = this.view ? noteRanges(this.view)[n.id] : n.range;
			if (r && r[1] > r[0] && pos >= r[0] && pos <= r[1] && this.decided[n.id] === undefined && !this.resolved.includes(n.id)) return `note:${n.id}`;
		}
		for (const [key, r] of Object.entries(this.ranges)) if (key !== 'draft' && r[1] > r[0] && pos >= r[0] && pos <= r[1]) return key;
		return null;
	}

	private syncRanges() {
		if (!this.view) return;
		const notes = noteRanges(this.view);
		this.starts = Object.fromEntries(Object.entries(notes).map(([id, r]) => [id, r?.[0] ?? null]));
		this.ranges = { ...commentRanges(this.view) };
	}

	setCurrentCard(key: string | null) {
		this.currentCard = key;
		if (this.view) setCurrent(this.view, key);
	}

	private setChoices(decided: Record<string, number>) {
		this.decided = decided;
		if (this.view) setDecided(this.view, decided);
		this.store(this.pending || this.saveFailed ? null : this.blob);
	}

	/** Remembers the choices with the blob that holds every edit so far, or with none while one is unsaved. */
	private store(blob: string | null) {
		if (!this.remember) return;
		try {
			localStorage.setItem(this.remember, JSON.stringify({ blob, decided: this.decided }));
		} catch {
			// Storage only carries the choices across a reload; the review works without it.
		}
	}

	/** Records a call's choice; a choice with text rewrites the anchored line, one marked `edit` selects it to rewrite. */
	choose(id: string, index: number) {
		const note = this.notes.find((n) => n.id === id);
		const c = note?.choices?.[index];
		if (!note || !c || this.locked) return;
		const view = this.view;
		if (view && c.text !== undefined && !this.readonly) replaceNoteText(view, id, c.text);
		this.setChoices({ ...this.decided, [id]: index });
		desk.announce(`Decided: ${c.done}`);
		const r: Range | null = view ? noteRanges(view)[id] : null;
		if (view && r) {
			view.dispatch({ selection: c.edit && !this.readonly ? { anchor: r[0], head: r[1] } : { anchor: r[0] } });
			view.focus();
		}
	}

	/** Opens a decided call again and puts focus on its first choice, since the button pressed is gone. */
	async reopen(id: string) {
		const note = this.notes.find((n) => n.id === id);
		if (!note || this.locked) return;
		const { [id]: _, ...rest } = this.decided;
		this.setChoices(rest);
		desk.announce(`Reopened ${note.title}`);
		await tick();
		document.querySelector<HTMLElement>(`#note-${CSS.escape(id)} button`)?.focus();
	}

	/** Collapses a correction in the margin, or opens it again; only this browser remembers it. */
	async resolveNote(id: string, resolved: boolean) {
		this.resolved = resolved ? [...this.resolved, id] : this.resolved.filter((r) => r !== id);
		if (this.view) setResolved(this.view, this.resolved);
		if (resolved && this.currentCard === `note:${id}`) this.setCurrentCard(null);
		try {
			if (this.remember) localStorage.setItem(`${this.remember}.resolved`, JSON.stringify(this.resolved));
		} catch {
			// A convenience only; a reload shows the correction open again.
		}
		await tick();
		document.querySelector<HTMLElement>(`#note-${CSS.escape(id)} button`)?.focus();
	}

	/** Saves now if anything is unsaved, and resolves once every save so far has finished. */
	async flush(): Promise<void> {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		// A refused save is retried here, so pressing a decision control is itself the retry.
		if (this.saveFailed) this.dirty = true;
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
			this.saveFailed = false;
			if (!this.dirty && !this.timer) {
				this.saveStatus = 'All edits saved';
				// No edit came after this save's text, so the choices are stored against its blob.
				this.store(this.blob);
			}
			// Only the first save is read aloud; every later pause in typing would repeat it.
			if (!this.savedOnce) desk.announce('Your edits are saving as you type.');
			this.savedOnce = true;
		} else {
			this.saveFailed = true;
			this.saveStatus = `Not saved: ${result.message}`;
			desk.announce(this.saveStatus);
			// A refused save is not retried on its own; the next edit or flush tries again.
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
		this.setCurrentCard(`note:${next[0]}`);
		jumpTo(view, next[1]);
	}

	/**
	 * Moves to the next or previous comment or thread from the caret, wrapping around, and makes its
	 * card current. `wrap` false stops at the document's end instead, for a screen of several documents.
	 */
	nextComment(dir: 1 | -1, wrap = true): boolean {
		const view = this.view;
		if (!view) return false;
		const all = Object.entries(this.ranges)
			.filter(([key]) => key !== 'draft')
			.sort((a, b) => a[1][0] - b[1][0]);
		if (!all.length) return false;
		const head = view.state.selection.main.head;
		const after = all.find(([, r]) => r[0] > head);
		const before = all.findLast(([, r]) => r[0] < head);
		const hit = dir > 0 ? (after ?? (wrap ? all[0] : undefined)) : (before ?? (wrap ? all.at(-1) : undefined));
		if (!hit) return false;
		this.setCurrentCard(hit[0]);
		jumpTo(view, hit[1][0]);
		desk.announce(`Comment ${all.indexOf(hit) + 1} of ${all.length}, on: ${this.quoteOf(hit[0], hit[1])}`);
		return true;
	}

	/** The text a comment or thread is on as it reads now, or its original quote once that text is gone. */
	private quoteOf(key: string, r: Range): string {
		if (r[1] > r[0]) return this.text.slice(r[0], r[1]);
		const id = key.slice(key.indexOf(':') + 1);
		return (key.startsWith('thread:') ? this.threads : this.comments).find((x) => x.id === id)?.quote ?? '';
	}

	/** Moves the caret to the first or last comment, for a screen walking several documents. */
	edgeComment(dir: 1 | -1): boolean {
		if (!this.view || !Object.keys(this.ranges).some((k) => k !== 'draft')) return false;
		this.view.dispatch({ selection: { anchor: dir > 0 ? 0 : this.view.state.doc.length } });
		return this.nextComment(dir);
	}

	/** Follows the window's scroll to the outline heading the reader is in. */
	track(limit = 130) {
		if (this.view) this.current = headingAbove(this.view, this.headings.map((h) => h.pos), limit);
	}

	/** A mouse press in the text, which drops an empty box left open; a later release may open one. */
	pointerDown(inText: boolean) {
		this.mouseSelecting = inText;
		this.dragging = inText;
		// The empty box may be another document's, on a screen of several, and it would refuse this one's.
		if (inText) boxes.open?.dropEmptyBox();
	}

	/** A mouse release ends a selection made with the mouse, which opens a comment box where the margin is beside the page. */
	pointerUp() {
		this.dragging = false;
		if (!this.mouseSelecting) return;
		this.mouseSelecting = false;
		if (!wide() || !this.canComment) return;
		// The editor settles the selection after the release, so it is read on the next turn.
		setTimeout(() => {
			if (!this.selectionEmpty) void this.openBox(true);
		});
	}

	/**
	 * Opens a comment box on the selection. A box opened by a mouse selection gives way to one already
	 * open; any other refuses with a toast, as a press with nothing selected does. Returns whether a
	 * box opened.
	 */
	async openBox(auto = false): Promise<boolean> {
		const view = this.view;
		if (!view || !this.canComment) return false;
		const s = view.state.selection.main;
		if (s.empty) {
			if (!auto) desk.flash(SELECT_FIRST);
			return false;
		}
		if (boxes.open) {
			if (!auto) refuseOpenBox();
			return false;
		}
		this.box = { kind: 'new', text: '', sel: { anchor: s.anchor, head: s.head } };
		boxes.open = this;
		setCommentRange(view, 'draft', [s.from, s.to]);
		// The draft's highlight now shows the text, and the selection comes back if the box is cancelled.
		view.dispatch({ selection: { anchor: s.to } });
		this.syncRanges();
		this.setCurrentCard('draft');
		await this.focusBox();
		return true;
	}

	/** Puts focus in the open box, opening this document's comment drawer first where the margin is one. */
	async focusBox() {
		if (!wide() && !(desk.paneOpen && desk.pane === this.margin)) await setDrawer('pane', true, null, this.margin);
		await tick();
		const area = document.getElementById('comment-box');
		if (!(area instanceof HTMLTextAreaElement)) return;
		// Beside the page a new card is placed after this, level with its text, which is already in
		// view; scrolling to it here would scroll to where it waits unplaced.
		area.focus({ preventScroll: true });
		if (!wide()) area.scrollIntoView({ block: 'nearest' });
		area.setSelectionRange(area.value.length, area.value.length);
	}

	private closeBox() {
		this.box = null;
		if (boxes.open === this) boxes.open = null;
		desk.commentOpen = false;
	}

	/** A click back into the text drops a new box that holds nothing, leaving the click's own caret. */
	dropEmptyBox() {
		if (this.box?.kind !== 'new' || this.box.text.trim() || !this.view) return;
		this.closeBox();
		setCommentRange(this.view, 'draft', null);
		this.syncRanges();
		this.setCurrentCard(null);
	}

	/** Closes the open box without saving; a new comment's selection comes back, so Escape leaves the text selected. */
	async cancelBox() {
		const box = this.box;
		const view = this.view;
		// A save on its way would land after the cancel and keep the comment, so the box waits for it.
		if (!box || !view || this.op) return;
		this.closeBox();
		if (box.kind !== 'new') {
			// The card's own first button is where its box was opened from, beside the page or in the drawer.
			await tick();
			this.focusCard(`${box.kind === 'edit' ? 'comment' : 'thread'}:${box.id}`);
			return;
		}
		setCommentRange(view, 'draft', null);
		this.syncRanges();
		this.setCurrentCard(null);
		view.dispatch({ selection: box.sel });
		if (!wide()) await setDrawer('pane', false);
		view.focus();
	}

	private async post(fields: Record<string, string>): Promise<CommentAnswer> {
		if (!this.poster) return { ok: false, message: 'comments are read only here' };
		try {
			return await this.poster(fields);
		} catch (err) {
			return { ok: false, message: err instanceof Error ? err.message : 'the comment did not reach the app' };
		}
	}

	/** Takes the stored state an op answered: this document's comments, and Geoff's replies and resolutions. */
	private resync(answer: Extract<CommentAnswer, { ok: true }>) {
		const mine = answer.comments.filter((c) => c.anchor.file === this.file);
		this.comments = mine.map((c) => ({ id: c.id, text: c.text, quote: c.anchor.quote, at: c.anchor.from }));
		const stored = new Map(answer.threads.map((t) => [t.id, t]));
		this.threads = this.threads.map((t) => ({ ...t, reply: stored.get(t.id)?.reply ?? '', resolved: stored.get(t.id)?.resolved === true }));
		const view = this.view;
		if (!view) return;
		const ranges = commentRanges(view);
		for (const c of this.comments) {
			const at = Math.min(c.at, view.state.doc.length);
			if (!ranges[`comment:${c.id}`]) setCommentRange(view, `comment:${c.id}`, [at, at]);
		}
		for (const key of Object.keys(ranges)) {
			if (key.startsWith('comment:') && !this.comments.some((c) => `comment:${c.id}` === key)) setCommentRange(view, key, null);
		}
		this.syncRanges();
	}

	/** Posts an op and takes its answer, or shows why it was refused; returns the answer when it went through. */
	private async send(fields: Record<string, string>) {
		const answer = await this.post(fields);
		if (!answer.ok) {
			desk.flash(`The comment was not saved: ${answer.message}`);
			return null;
		}
		this.resync(answer);
		return answer;
	}

	/** Puts focus on a card's first button, or on the card when it has none. */
	private focusCard(key: string) {
		const card = document.getElementById(cardId(key));
		(card?.querySelector<HTMLElement>('button') ?? card)?.focus();
	}

	/**
	 * Puts focus where a removed card was, since its focused button went with it. Beside the page that
	 * is the next card's first button, else the previous card's, else the editor; in the drawer, the
	 * next card, else the drawer's close button.
	 */
	private async focusAfterRemoving(keys: string[], at: number) {
		await tick();
		const after = keys.slice(at + 1);
		const near = wide() ? [...after, ...keys.slice(0, at).reverse()] : after;
		for (const key of near) {
			const card = document.getElementById(cardId(key));
			if (!card) continue;
			if (wide()) this.focusCard(key);
			else card.focus();
			return;
		}
		if (wide()) this.view?.focus();
		else document.getElementById(this.margin)?.querySelector<HTMLElement>('.drawer-x')?.focus();
	}

	/**
	 * Adds a comment on `range` once any pending edit lands, so the server anchors it in the text the
	 * editor shows. From the open box, the comment takes the draft's range as it stands when the
	 * answer comes, since the text may have moved meanwhile.
	 */
	private async add(text: string, range: Range, fromDraft = false): Promise<string | null> {
		const fields: Record<string, string> = { op: 'add', text, from: String(range[0]), to: String(range[1]) };
		if (this.file !== undefined) fields.file = this.file;
		else {
			await this.flush();
			if (this.saveFailed) {
				desk.flash(this.saveStatus);
				return null;
			}
			fields.blob = this.blob;
		}
		const answer = await this.post(fields);
		if (!answer.ok) {
			desk.flash(`The comment was not saved: ${answer.message}`);
			return null;
		}
		const view = this.view;
		// The range is set before the answer is taken, so the new comment is not given a fallback one.
		if (view) {
			const now = fromDraft ? (commentRanges(view).draft ?? range) : range;
			if (fromDraft) setCommentRange(view, 'draft', null);
			setCommentRange(view, `comment:${answer.id}`, now);
		}
		this.resync(answer);
		return answer.id;
	}

	/** Saves the open box: a new comment, an edit, or a reply. An empty new comment or edit is cancelled instead. */
	async saveBox() {
		const box = this.box;
		const view = this.view;
		if (!box || !view || this.op) return;
		const text = box.text.trim();
		if (!text && box.kind !== 'reply') return this.cancelBox();
		const key = await this.exclusive(async () => {
			if (box.kind === 'new') {
				const range = commentRanges(view).draft;
				const id = range ? await this.add(text, range, true) : null;
				return id && `comment:${id}`;
			}
			if (box.kind === 'edit') return (await this.send({ op: 'edit', id: box.id, text })) && `comment:${box.id}`;
			return (await this.send({ op: 'reply', id: box.id, text })) && `thread:${box.id}`;
		});
		if (!key) return;
		this.closeBox();
		this.syncRanges();
		this.setCurrentCard(key);
		desk.announce(box.kind === 'reply' ? 'Reply saved' : 'Comment saved');
		await tick();
		// A new comment was started from the text beside the page; an edit or a reply from its card's
		// button, and in the drawer the editor sits behind the scrim, so focus goes to the saved card.
		if (wide() && box.kind === 'new') view.focus();
		else this.focusCard(key);
	}

	/** Opens a saved comment's box to change its text. */
	async editComment(id: string) {
		const c = this.comments.find((x) => x.id === id);
		if (!c || refuseOpenBox()) return;
		this.box = { kind: 'edit', id, text: c.text };
		boxes.open = this;
		this.setCurrentCard(`comment:${id}`);
		await this.focusBox();
	}

	/**
	 * Deletes a saved comment. The toast's Undo adds it again under a new id, on its text as found by
	 * quote and context when Undo is pressed, since edits made meanwhile may have moved it. A comment
	 * whose text is already gone has nothing to come back on, so its toast offers no Undo.
	 */
	async deleteComment(id: string) {
		const key = `comment:${id}`;
		const c = this.comments.find((x) => x.id === id);
		const range = this.ranges[key];
		const view = this.view;
		if (!c || !range || !view || refuseOpenBox()) return;
		const anchor = range[1] > range[0] ? anchorAt(view.state.doc.toString(), range[0], range[1], '') : null;
		const keys = this.cards.map((card) => card.key);
		if (!(await this.exclusive(() => this.send({ op: 'delete', id })))) return;
		if (this.currentCard === key) this.setCurrentCard(null);
		desk.flash('Comment deleted', anchor ? () => void this.restore(c.text, anchor) : undefined);
		await this.focusAfterRemoving(keys, keys.indexOf(key));
	}

	/** Adds a deleted comment again where its anchor now places it, or says why it cannot. */
	private async restore(text: string, anchor: Anchor) {
		if (!this.view) return;
		// The layout drops the toast's Undo before calling it, so a refusal offers the Undo again.
		if (boxes.open || this.op) {
			void boxes.open?.focusBox();
			desk.flash(boxes.open ? `${OPEN_FIRST}, then press Undo.` : 'Comment deleted', () => void this.restore(text, anchor));
			return;
		}
		const at = place(this.view.state.doc.toString(), anchor);
		if (!at) {
			desk.flash(RESTORE_GONE);
			return;
		}
		await this.exclusive(() => this.add(text, [at.from, at.to]));
	}

	/** Opens the reply box on one of the author's threads, holding Geoff's reply so far. */
	async replyTo(id: string) {
		const t = this.threads.find((x) => x.id === id);
		if (!t || refuseOpenBox()) return;
		this.box = { kind: 'reply', id, text: t.reply };
		boxes.open = this;
		this.setCurrentCard(`thread:${id}`);
		await this.focusBox();
	}

	/** Removes Geoff's reply to a thread; its Edit and Delete give way to Resolve and Reply, so focus moves to those. */
	async deleteReply(id: string) {
		if (refuseOpenBox()) return;
		if (!(await this.exclusive(() => this.send({ op: 'reply', id, text: '' })))) return;
		await tick();
		this.focusCard(`thread:${id}`);
	}

	/** Resolves a thread, or opens it again; only Geoff resolves one. */
	async resolveThread(id: string, resolved: boolean) {
		if (refuseOpenBox()) return;
		if (!(await this.exclusive(() => this.send({ op: resolved ? 'resolve' : 'reopen', id })))) return;
		if (resolved && this.currentCard === `thread:${id}`) this.setCurrentCard(null);
		await tick();
		this.focusCard(`thread:${id}`);
	}

	/** Makes a card current, opening this document's drawer and showing the card there where the margin is one. */
	async showCard(key: string) {
		this.setCurrentCard(key);
		if (wide()) return;
		await setDrawer('pane', true, null, this.margin);
		await tick();
		document.getElementById(cardId(key))?.scrollIntoView({ block: 'center' });
	}
}
