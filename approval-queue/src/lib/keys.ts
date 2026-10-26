export type KeyAction =
	| 'toggle-sheet'
	| 'queue-next'
	| 'queue-prev'
	| 'board'
	| 'pick-1'
	| 'pick-2'
	| 'pick-3'
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
	| 'submit'
	| 'comment'
	| 'next-comment'
	| 'prev-comment'
	| 'save-comment'
	| 'cancel-comment';

export interface KeyContext {
	page: 'pr' | 'design' | 'triage' | 'packet' | 'docs';
	/** The event target is a field that takes text. */
	typing: boolean;
	singleKeys: boolean;
	sheetOpen: boolean;
	/** A decision is counting down in the toast, so `z` undoes it. Every other key works as usual. */
	held: boolean;
	noteOpen: boolean;
	/**
	 * Approve is locked: a card has no pick, or a pick sends the PR back. It gates the single key `a`
	 * on a PR or design page. Ctrl+Enter ignores it, because a locked approve moves focus to the
	 * first open ask, card, or call instead of approving.
	 */
	approveLocked: boolean;
	/** A comment box holds focus, so Ctrl+Enter saves it and Escape cancels it instead of deciding. */
	commentOpen: boolean;
}

export interface KeyMods {
	ctrl: boolean;
	meta: boolean;
	alt: boolean;
	shift: boolean;
	/**
	 * The physical key, as `KeyboardEvent.code` names it. The comment chords use it only when `key`
	 * is not a letter, since Option on macOS and AltGr on other layouts turn `key` into another character.
	 */
	code?: string;
}

const MOVES: Record<string, KeyAction> = { '1': 'move-now', '2': 'move-defer', '3': 'move-drop' };
/** On a packet, a digit picks that option of the ask holding focus; the layout finds the ask. */
const PICKS: Record<string, KeyAction> = { '1': 'pick-1', '2': 'pick-2', '3': 'pick-3' };
const DOCS: ReadonlyArray<KeyContext['page']> = ['docs'];
const COMMENT_LETTERS: Record<string, KeyAction> = { m: 'comment', n: 'next-comment', p: 'prev-comment' };
const COMMENT_CODES: Record<string, KeyAction> = { KeyM: 'comment', KeyN: 'next-comment', KeyP: 'prev-comment' };

/**
 * Follows the catalogue's global handler order: the open sheet takes everything but `?`, then
 * Escape and Ctrl+Enter (which work from a field), then the typing and single-key gates.
 * A held decision belongs to an item already left behind, so it gates nothing on the open one.
 */
export function keyAction(key: string, mods: KeyMods, context: KeyContext): KeyAction | null {
	const { page, typing, singleKeys, sheetOpen, held, noteOpen, approveLocked, commentOpen } = context;
	const plain = !mods.ctrl && !mods.meta && !mods.alt;
	if (sheetOpen) return key === '?' && plain ? 'toggle-sheet' : null;

	if (commentOpen) {
		if (key === 'Escape') return 'cancel-comment';
		if (key === 'Enter' && (mods.ctrl || mods.meta)) return 'save-comment';
	}
	// The comment chords work from the editor, which is a typing target, and with single keys off.
	if (DOCS.includes(page) && mods.ctrl && mods.alt && !mods.meta && !mods.shift) {
		// The letter the layout types, so Dvorak and AZERTY follow their own keys; any other character falls back to the physical key.
		const action = /^[a-z]$/i.test(key) ? COMMENT_LETTERS[key.toLowerCase()] : COMMENT_CODES[mods.code ?? ''];
		if (action) return action;
	}

	if (key === 'Escape') return page !== 'triage' && noteOpen ? 'close-note' : null;
	if (key === 'Enter' && (mods.ctrl || mods.meta)) {
		if (page === 'triage') return 'submit';
		if (noteOpen) return 'send-rejection';
		// Locked, the handler moves to the first open ask or call, matching the button it advertises.
		return 'approve';
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
	if (key === 'b') return 'board';
	if (key === 'z') return held ? 'undo' : null;
	if ((page === 'pr' || page === 'design') && key === 'a') return noteOpen || approveLocked ? null : 'approve';
	if (page !== 'triage' && key === 'r') return 'open-note';
	if ((page === 'pr' || page === 'docs') && key === '/') return 'focus-filter';
	if (page === 'triage' && key in MOVES) return MOVES[key];
	if (page === 'packet' && !held && key in PICKS) return PICKS[key];
	return null;
}
