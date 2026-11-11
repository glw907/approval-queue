import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Notes, SAVE_MS } from './notes.svelte.ts';

const note = (id: string, text = '') => ({ id, text, anchor: null });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('Notes', () => {
	it('counts the notes that hold text', () => {
		const notes = new Notes([note('a', 'one'), note('b', '  ')], async () => {});
		expect(notes.count).toBe(1);
		notes.add(note('c', 'two'));
		expect(notes.count).toBe(2);
	});

	it('updates and removes a note by id', () => {
		const notes = new Notes([note('a', 'one'), note('b', 'two')], async () => {});
		notes.update('a', 'changed');
		notes.remove('b');
		expect(notes.items).toEqual([note('a', 'changed')]);
	});

	it('saves the whole list once after typing pauses', async () => {
		const save = vi.fn(async () => {});
		const notes = new Notes([], save);
		notes.add(note('a'));
		notes.update('a', 'h');
		notes.update('a', 'hi');
		expect(save).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(SAVE_MS);
		expect(save).toHaveBeenCalledOnce();
		expect(save).toHaveBeenCalledWith([note('a', 'hi')]);
	});

	it('flushes at once, and cancel drops a pending save', async () => {
		const save = vi.fn(async () => {});
		const notes = new Notes([], save);
		notes.add(note('a', 'x'));
		await notes.flush();
		expect(save).toHaveBeenCalledOnce();
		notes.add(note('b', 'y'));
		notes.cancel();
		await vi.advanceTimersByTimeAsync(SAVE_MS * 2);
		await notes.flush();
		expect(save).toHaveBeenCalledOnce();
	});

	it('marks a failed save and clears the mark on the next one', async () => {
		const save = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(undefined);
		const notes = new Notes([], save);
		notes.add(note('a', 'x'));
		await notes.flush();
		expect(notes.failed).toBe(true);
		notes.update('a', 'xy');
		await notes.flush();
		expect(notes.failed).toBe(false);
	});
});
