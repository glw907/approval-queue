export type KeyAction =
	| 'toggle-sheet'
	| 'queue-next'
	| 'queue-prev'
	| 'undo'
	| 'approve'
	| 'open-note'
	| 'close-note'
	| 'send-rejection'
	| 'focus-filter'
	| 'row-next'
	| 'row-prev'
	| 'move-now'
	| 'move-defer'
	| 'move-drop'
	| 'submit';

export interface KeyContext {
	page: 'pr' | 'design' | 'triage';
	/** The event target is a field that takes text. */
	typing: boolean;
	singleKeys: boolean;
	sheetOpen: boolean;
	/** A decision is counting down in the toast. */
	held: boolean;
	noteOpen: boolean;
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
	const { page, typing, singleKeys, sheetOpen, held, noteOpen } = context;
	const plain = !mods.ctrl && !mods.meta && !mods.alt;
	if (sheetOpen) return key === '?' && plain ? 'toggle-sheet' : null;

	if (key === 'Escape') return page !== 'triage' && noteOpen ? 'close-note' : null;
	if (key === 'Enter' && (mods.ctrl || mods.meta)) {
		if (held) return null;
		if (page === 'triage') return 'submit';
		return noteOpen ? 'send-rejection' : null;
	}

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
	if (page !== 'triage' && key === 'a') return noteOpen ? null : 'approve';
	if (page !== 'triage' && key === 'r') return 'open-note';
	if (page === 'pr' && key === '/') return 'focus-filter';
	if (page === 'triage' && key in MOVES) return MOVES[key];
	return null;
}
