import { describe, expect, it } from 'vitest';
import { keyAction, type KeyContext } from './keys.ts';

const base: KeyContext = {
	page: 'design',
	typing: false,
	singleKeys: true,
	sheetOpen: false,
	held: false,
	noteOpen: false,
	approveLocked: false
};
const none = { ctrl: false, meta: false, alt: false, shift: false };
const ctx = (over: Partial<KeyContext>): KeyContext => ({ ...base, ...over });

describe('keyAction', () => {
	it('approves on a design and not on triage', () => {
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

	it('opens the note on r', () => {
		expect(keyAction('r', none, ctx({ page: 'design' }))).toBe('open-note');
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

	it('goes to the board on b from any page, and not with single keys off or while typing', () => {
		for (const page of ['design', 'packet', 'triage'] as const) expect(keyAction('b', none, ctx({ page }))).toBe('board');
		expect(keyAction('b', none, ctx({ singleKeys: false }))).toBeNull();
		expect(keyAction('b', none, ctx({ typing: true }))).toBeNull();
		expect(keyAction('b', { ...none, ctrl: true }, base)).toBeNull();
	});

	it('picks an ask option with 1, 2, or 3 on a packet only, never during a hold or while typing', () => {
		const packet = ctx({ page: 'packet' });
		expect(['1', '2', '3'].map((d) => keyAction(d, none, packet))).toEqual(['pick-1', 'pick-2', 'pick-3']);
		expect(keyAction('4', none, packet)).toBeNull();
		expect(keyAction('1', none, ctx({ page: 'packet', held: true }))).toBeNull();
		expect(keyAction('1', none, ctx({ page: 'packet', typing: true }))).toBeNull();
		expect(keyAction('1', none, ctx({ page: 'design' }))).toBeNull();
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
		expect(keyAction('a', none, ctx({ page: 'design', noteOpen: true }))).toBeNull();
		expect(keyAction('a', none, ctx({ page: 'design', noteOpen: false }))).toBe('approve');
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

	it('approves a design on Mod+Enter from a field, locked or not', () => {
		const mod = { ...none, ctrl: true };
		const editing = ctx({ page: 'design', typing: true });
		expect(keyAction('Enter', mod, editing)).toBe('approve');
		expect(keyAction('Enter', mod, ctx({ page: 'design', approveLocked: true }))).toBe('approve');
		expect(keyAction('Enter', mod, ctx({ page: 'design', held: true }))).toBe('approve');
		expect(keyAction('F8', none, editing)).toBe('next-call');
	});

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
});

describe('keyAction on a round report', () => {
	const report = ctx({ page: 'report' });

	it('answers nothing to a decision key, F8, Escape, or Ctrl+Enter', () => {
		for (const key of ['a', 'r', '1', '2', '3', 'F8', 'Escape']) expect(keyAction(key, none, report)).toBeNull();
		expect(keyAction('Enter', { ...none, ctrl: true }, ctx({ page: 'report', noteOpen: true }))).toBeNull();
	});

	it('keeps j, k, and ?', () => {
		expect(keyAction('j', none, report)).toBe('queue-next');
		expect(keyAction('k', none, report)).toBe('queue-prev');
		expect(keyAction('?', none, report)).toBe('toggle-sheet');
	});
});
