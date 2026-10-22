import type { KeyAction } from '#lib/keys.ts';
import type { Row } from '#lib/triage.ts';

/** One entry of the open item's outline, which the rail shows under the item and the place bar's Contents menu repeats. */
export interface OutlineEntry {
	key: string;
	/** The section's number, such as "2" or "2.1"; empty for an entry the outline does not number. */
	n: string;
	text: string;
	level: 2 | 3;
	href: string;
	cur: boolean;
	/** A dot for a section holding an open call or a correction. */
	mark: 'call' | 'fix' | null;
	/** Moves the screen to the section, since the editor renders only the lines near the viewport. */
	go: () => void;
}

/**
 * State the layout, the open item, and the key handler share. The layout owns the keys and the
 * toast; the item panel registers the handlers that act on its own form and clears them when the
 * item changes. Only client code writes it, so one instance serves every request.
 */
class Desk {
	singleKeys = $state(true);
	sheetOpen = $state(false);
	noteOpen = $state(false);
	/** The queue rail is open as a drawer (below 1024px). */
	railOpen = $state(false);
	/** The review pane or a document's comment margin is open as a drawer (below 1260px). */
	paneOpen = $state(false);
	/** The id of the drawer `paneOpen` opens: `review`, or the comment margin of one document. */
	pane = $state('review');
	/** A comment box has focus, so Ctrl+Enter saves it and Escape cancels it. */
	commentOpen = $state(false);
	/** The open item's outline for the rail; null on a screen without one. */
	outline = $state.raw<OutlineEntry[] | null>(null);
	/** Approve is disabled, so the `a` key must not post it either. */
	approveLocked = $state(false);
	page = $state<'pr' | 'design' | 'triage' | 'packet' | 'blueprint' | 'page' | 'change'>('design');
	#toast = $state<string | null>(null);
	/** What the plain toast's Undo button does; null shows no button. */
	toastUndo = $state.raw<(() => void) | null>(null);

	/** A plain toast's text; null hides it. A held decision's toast is `held`'s, and takes its place. */
	get toast(): string | null {
		return this.#toast;
	}
	/** Setting the text drops any Undo, which belongs only to the toast `flash` showed it with. */
	set toast(text: string | null) {
		this.#toast = text;
		this.toastUndo = null;
	}
	#toastTimer: ReturnType<typeof setTimeout> | undefined;
	/** The live region's text. */
	status = $state('');
	handlers: Partial<Record<KeyAction, () => void>> = {};
	/**
	 * Unsent triage calls by item id. The item panel is rebuilt for every item, so calls made
	 * before opening another item live here until they are submitted.
	 */
	drafts = new Map<string, Row[]>();

	/**
	 * Adds key handlers and returns the function that removes them again, so a component that
	 * registers from an effect can unregister in its teardown without clearing another's.
	 */
	register(handlers: Partial<Record<KeyAction, () => void>>): () => void {
		this.handlers = { ...this.handlers, ...handlers };
		return () => {
			const kept = { ...this.handlers };
			for (const [action, fn] of Object.entries(handlers) as Array<[KeyAction, () => void]>) {
				if (kept[action] === fn) delete kept[action];
			}
			this.handlers = kept;
		};
	}

	/**
	 * Shows a plain toast and reads it aloud, then clears it unless another took its place. One with
	 * `undo` carries an Undo button and stays longer, as the prototype's do.
	 */
	flash(text: string, undo?: () => void) {
		clearTimeout(this.#toastTimer);
		this.toast = text;
		this.toastUndo = undo ?? null;
		this.announce(text);
		this.#toastTimer = setTimeout(
			() => {
				if (this.toast === text) this.toast = null;
			},
			undo ? 6000 : 3200
		);
	}

	/** Blanks the region first so a repeated message is read again. */
	announce(message: string) {
		this.status = '';
		setTimeout(() => (this.status = message), 50);
	}
}

export const desk = new Desk();
