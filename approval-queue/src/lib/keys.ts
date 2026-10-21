export type KeyAction =
	| 'toggle-sheet'
	| 'queue-next'
	| 'queue-prev'
	| 'undo'
	| 'approve'
	| 'open-note'
	| 'close-note'
	| 'next-call'
	| 'send-rejection'
	| 'focus-filter'
	| 'row-next'
	| 'row-prev'
	| 'move-now'
	| 'move-defer'
	| 'move-drop'
	| 'submit';

export interface KeyContext {
	page: 'pr' | 'design' | 'triage' | 'packet' | 'blueprint';
	/** The event target is a field that takes text. */
	typing: boolean;
	singleKeys: boolean;
	sheetOpen: boolean;
	/** A decision is counting down in the toast. */
	held: boolean;
	noteOpen: boolean;
	/**
	 * Approve is locked: a card has no pick, or a pick sends the PR back. It gates the single key `a`
	 * on a PR or design page. Ctrl+Enter on a packet ignores it, because the page moves focus to the
	 * first open ask instead of approving.
	 */
	approveLocked: boolean;
}

export interface KeyMods {
	ctrl: boolean;
	meta: boolean;
	alt: boolean;
	shift: boolean;
}

const MOVES: Record<string, KeyAction> = { '1': 'move-now', '2': 'move-defer', '3': 'move-drop' };

/**
 * Follows the catalogue's global handler order: the open sheet takes everything but `?`, then
 * Escape and Ctrl+Enter (which work from a field), then the typing and single-key gates.
 * A held decision ignores every decision key, since the buttons lock but a key would not.
 */
export function keyAction(key: string, mods: KeyMods, context: KeyContext): KeyAction | null {
	const { page, typing, singleKeys, sheetOpen, held, noteOpen, approveLocked } = context;
	const plain = !mods.ctrl && !mods.meta && !mods.alt;
	if (sheetOpen) return key === '?' && plain ? 'toggle-sheet' : null;

	if (key === 'Escape') return page !== 'triage' && noteOpen ? 'close-note' : null;
	if (key === 'Enter' && (mods.ctrl || mods.meta)) {
		if (held) return null;
		if (page === 'triage') return 'submit';
		if (noteOpen) return 'send-rejection';
		// Locked, the handler moves to the first open ask or call, matching the button it advertises.
		return page === 'packet' || page === 'blueprint' ? 'approve' : null;
	}

	// F8 is a function key, so like Ctrl+Enter it works from a field and ignores the single-key switch.
	if (key === 'F8' && plain && !mods.shift) return 'next-call';

	if (typing) return null;
	if (page === 'triage' && plain) {
		if (key === 'ArrowDown') return 'row-next';
		if (key === 'ArrowUp') return 'row-prev';
	}
	if (key.length !== 1 || !plain || !singleKeys) return null;

	if (key === '?') return 'toggle-sheet';
	if (key === 'j') return 'queue-next';
	if (key === 'k') return 'queue-prev';
	if (key === 'z') return held ? 'undo' : null;
	if (held) return null;
	if ((page === 'pr' || page === 'design') && key === 'a') return noteOpen || approveLocked ? null : 'approve';
	if (page !== 'triage' && key === 'r') return 'open-note';
	if (page === 'pr' && key === '/') return 'focus-filter';
	if (page === 'triage' && key in MOVES) return MOVES[key];
	return null;
}
