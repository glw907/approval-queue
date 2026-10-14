import type { KeyAction } from '#lib/keys.ts';
import type { Row } from '#lib/triage.ts';

/**
 * State the layout, the open item, and the key handler share. The layout owns the keys and the
 * toast; the item panel registers the handlers that act on its own form and clears them when the
 * item changes. Only client code writes it, so one instance serves every request.
 */
class Desk {
	singleKeys = $state(true);
	sheetOpen = $state(false);
	/** A decision is counting down in the toast, so every decision key is dead. */
	held = $state(false);
	noteOpen = $state(false);
	/** Approve is disabled, so the `a` key must not post it either. */
	approveLocked = $state(false);
	page = $state<'pr' | 'design' | 'triage'>('design');
	/** The toast's text; null hides it. */
	toast = $state<string | null>(null);
	/** The toast reports a post that failed. */
	toastError = $state(false);
	/** The toast offers Undo. */
	counting = $state(false);
	/** The live region's text. */
	status = $state('');
	handlers: Partial<Record<KeyAction, () => void>> = {};
	/** Cancels the hold in progress; null when none is counting. */
	undo: (() => void) | null = null;
	/**
	 * Unsent triage calls by item id. The item panel is rebuilt for every item, so calls made
	 * before opening another item live here until they are submitted.
	 */
	drafts = new Map<string, Row[]>();

	/** Blanks the region first so a repeated message is read again. */
	announce(message: string) {
		this.status = '';
		setTimeout(() => (this.status = message), 50);
	}
}

export const desk = new Desk();
