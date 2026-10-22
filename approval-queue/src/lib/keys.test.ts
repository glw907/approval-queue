import { describe, expect, it } from 'vitest';
import { keyAction, type KeyContext } from './keys.ts';

const base: KeyContext = {
	page: 'pr',
	typing: false,
	singleKeys: true,
	sheetOpen: false,
	held: false,
	noteOpen: false,
	approveLocked: false,
	commentOpen: false
};
const none = { ctrl: false, meta: false, alt: false, shift: false };
const ctx = (over: Partial<KeyContext>): KeyContext => ({ ...base, ...over });

describe('keyAction', () => {
	it('approves on a PR and not on triage', () => {
		expect(keyAction('a', none, base)).toBe('approve');
		expect(keyAction('a', none, ctx({ page: 'triage' }))).toBeNull();
	});

	it('does nothing on a while Approve is locked, and still sends back on r', () => {
		expect(keyAction('a', none, ctx({ approveLocked: true }))).toBeNull();
		expect(keyAction('r', none, ctx({ approveLocked: true }))).toBe('open-note');
	});

	it('jumps to the next call on F8, from a field and with single keys off, but not under the sheet', () => {
		expect(keyAction('F8', none, base)).toBe('next-call');
		expect(keyAction('F8', none, ctx({ typing: true, singleKeys: false, page: 'packet' }))).toBe('next-call');
		expect(keyAction('F8', { ...none, ctrl: true }, base)).toBeNull();
		expect(keyAction('F8', none, ctx({ sheetOpen: true }))).toBeNull();
	});

	it('opens the note on r, and focuses the filter on / for a PR or a change only', () => {
		expect(keyAction('r', none, ctx({ page: 'design' }))).toBe('open-note');
		expect(keyAction('/', none, base)).toBe('focus-filter');
		expect(keyAction('/', none, ctx({ page: 'change' }))).toBe('focus-filter');
		expect(keyAction('/', none, ctx({ page: 'design' }))).toBeNull();
	});

	it('moves triage rows with 1, 2, 3 and the arrows', () => {
		const t = ctx({ page: 'triage' });
		expect(keyAction('1', none, t)).toBe('move-now');
		expect(keyAction('2', none, t)).toBe('move-defer');
		expect(keyAction('3', none, t)).toBe('move-drop');
		expect(keyAction('ArrowDown', none, t)).toBe('row-next');
		expect(keyAction('ArrowUp', none, t)).toBe('row-prev');
		expect(keyAction('1', none, base)).toBeNull();
	});

	it('returns null for plain Enter on triage', () => {
		expect(keyAction('Enter', none, ctx({ page: 'triage' }))).toBeNull();
	});

	it('moves the queue with j and k on any page', () => {
		expect(keyAction('j', none, ctx({ page: 'triage' }))).toBe('queue-next');
		expect(keyAction('k', none, ctx({ page: 'design' }))).toBe('queue-prev');
	});

	it('undoes with z only while held', () => {
		expect(keyAction('z', none, base)).toBeNull();
		expect(keyAction('z', none, ctx({ held: true }))).toBe('undo');
	});

	it('returns null for every single key with single keys off or while typing', () => {
		for (const key of ['a', 'r', 'j', 'k', 'z', '?', '/', '1']) {
			expect(keyAction(key, none, ctx({ singleKeys: false, held: true }))).toBeNull();
			expect(keyAction(key, none, ctx({ typing: true, held: true }))).toBeNull();
		}
	});

	it('lets Escape and Ctrl+Enter work with single keys off', () => {
		const off = ctx({ singleKeys: false, noteOpen: true });
		expect(keyAction('Escape', none, off)).toBe('close-note');
		expect(keyAction('Enter', { ...none, ctrl: true }, off)).toBe('send-rejection');
		expect(keyAction('Enter', { ...none, meta: true }, ctx({ page: 'triage', singleKeys: false }))).toBe('submit');
	});

	it('lets Escape and Ctrl+Enter reach the page from a typing target', () => {
		const t = ctx({ typing: true, noteOpen: true });
		expect(keyAction('Escape', none, t)).toBe('close-note');
		expect(keyAction('Enter', { ...none, ctrl: true }, t)).toBe('send-rejection');
	});

	it('does not approve while the note is open, since Approve is not on the page', () => {
		expect(keyAction('a', none, ctx({ page: 'pr', noteOpen: true }))).toBeNull();
		expect(keyAction('a', none, ctx({ page: 'pr', noteOpen: false }))).toBe('approve');
	});

	it('approves a packet on Mod+Enter, locked or not, and never on a single key', () => {
		const mod = { ...none, ctrl: true };
		const packet = ctx({ page: 'packet' });
		expect(keyAction('Enter', mod, packet)).toBe('approve');
		expect(keyAction('Enter', { ...none, meta: true }, packet)).toBe('approve');
		expect(keyAction('Enter', mod, ctx({ page: 'packet', approveLocked: true }))).toBe('approve');
		expect(keyAction('Enter', mod, ctx({ page: 'packet', held: true }))).toBe('approve');
		expect(keyAction('Enter', none, packet)).toBeNull();
		expect(keyAction('a', none, packet)).toBeNull();
		expect(keyAction('r', none, packet)).toBe('open-note');
	});

	it.each(['blueprint', 'page', 'change', 'pr', 'design'] as const)(
		'approves a %s review on Mod+Enter from the editor, locked or not, and never on a single key',
		(page) => {
			const mod = { ...none, ctrl: true };
			const editing = ctx({ page, typing: true });
			expect(keyAction('Enter', mod, editing)).toBe('approve');
			expect(keyAction('Enter', mod, ctx({ page, approveLocked: true }))).toBe('approve');
			expect(keyAction('Enter', mod, ctx({ page, held: true }))).toBe('approve');
			if (page !== 'pr' && page !== 'design') expect(keyAction('a', none, ctx({ page }))).toBeNull();
			expect(keyAction('F8', none, editing)).toBe('next-call');
		}
	);

	it('sends a packet rejection on Mod+Enter with the note open, locked or not', () => {
		const open = ctx({ page: 'packet', noteOpen: true, approveLocked: true });
		expect(keyAction('Enter', { ...none, ctrl: true }, open)).toBe('send-rejection');
	});

	it('sends a rejection on Mod+Enter only with the note open, and approves otherwise', () => {
		expect(keyAction('Enter', { ...none, ctrl: true }, ctx({ noteOpen: true }))).toBe('send-rejection');
		expect(keyAction('Enter', { ...none, ctrl: true }, base)).toBe('approve');
	});

	it('takes every decision key on the open item while another item’s decision is held', () => {
		const held = ctx({ held: true });
		expect(keyAction('a', none, held)).toBe('approve');
		expect(keyAction('r', none, held)).toBe('open-note');
		expect(keyAction('Enter', { ...none, ctrl: true }, held)).toBe('approve');
		expect(keyAction('Enter', { ...none, ctrl: true }, ctx({ held: true, noteOpen: true }))).toBe('send-rejection');
		expect(keyAction('j', none, held)).toBe('queue-next');
		const t = ctx({ page: 'triage', held: true });
		expect(keyAction('2', none, t)).toBe('move-defer');
		expect(keyAction('Enter', { ...none, ctrl: true }, t)).toBe('submit');
		expect(keyAction('z', none, t)).toBe('undo');
	});

	it('toggles the sheet with ?, closed or open, and nothing else works while open', () => {
		expect(keyAction('?', { ...none, shift: true }, base)).toBe('toggle-sheet');
		const open = ctx({ sheetOpen: true });
		expect(keyAction('?', { ...none, shift: true }, open)).toBe('toggle-sheet');
		expect(keyAction('a', none, open)).toBeNull();
		expect(keyAction('Escape', none, ctx({ sheetOpen: true, noteOpen: true }))).toBeNull();
		expect(keyAction('Enter', { ...none, ctrl: true }, ctx({ sheetOpen: true, noteOpen: true }))).toBeNull();
	});

	it('does not treat a modified letter as a single key', () => {
		expect(keyAction('a', { ...none, ctrl: true }, base)).toBeNull();
	});

	it('saves and cancels an open comment box on Ctrl+Enter and Escape, ahead of the note and Approve', () => {
		const open = ctx({ page: 'blueprint', typing: true, commentOpen: true });
		expect(keyAction('Enter', { ...none, ctrl: true }, open)).toBe('save-comment');
		expect(keyAction('Enter', { ...none, meta: true }, open)).toBe('save-comment');
		expect(keyAction('Escape', none, open)).toBe('cancel-comment');
		expect(keyAction('Escape', none, ctx({ page: 'blueprint', noteOpen: true }))).toBe('close-note');
	});

	it('takes the comment chords on a document page only, from the editor and with single keys off', () => {
		const chord = (code: string) => ({ ...none, ctrl: true, alt: true, code });
		const t = ctx({ page: 'page', typing: true, singleKeys: false });
		expect(keyAction('m', chord('KeyM'), t)).toBe('comment');
		expect(keyAction('M', chord('KeyM'), ctx({ page: 'blueprint' }))).toBe('comment');
		expect(keyAction('n', chord('KeyN'), ctx({ page: 'change' }))).toBe('next-comment');
		expect(keyAction('p', chord('KeyP'), t)).toBe('prev-comment');
		expect(keyAction('m', chord('KeyM'), ctx({ page: 'pr' }))).toBeNull();
		expect(keyAction('m', { ...chord('KeyM'), shift: true }, t)).toBeNull();
		expect(keyAction('m', { ...none, ctrl: true, code: 'KeyM' }, t)).toBeNull();
	});

	it('matches the comment chords by physical key, whatever character the layout gives them', () => {
		const t = ctx({ page: 'blueprint', typing: true });
		// Option+M on macOS gives "µ", and AltGr layouts give their own characters.
		expect(keyAction('µ', { ...none, ctrl: true, alt: true, code: 'KeyM' }, t)).toBe('comment');
		expect(keyAction('m', { ...none, ctrl: true, alt: true, code: 'Semicolon' }, t)).toBeNull();
	});
});
