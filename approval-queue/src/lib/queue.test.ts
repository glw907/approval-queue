import { describe, expect, it } from 'vitest';
import { nextItem } from './queue.ts';

const queue = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

describe('nextItem', () => {
	it('returns the item after the current one', () => {
		expect(nextItem(queue, 'a')?.id).toBe('b');
	});

	it('returns the oldest other item when the current is last', () => {
		expect(nextItem(queue, 'c')?.id).toBe('a');
	});

	it('returns null when nothing else waits', () => {
		expect(nextItem([{ id: 'a' }], 'a')).toBeNull();
		expect(nextItem([], 'a')).toBeNull();
	});

	it('returns the oldest when the current is not in the queue', () => {
		expect(nextItem(queue, 'zz')?.id).toBe('a');
	});

	it('skips a deferred item, after the current one and when wrapping to the oldest', () => {
		const deferred = [{ id: 'a' }, { id: 'b', deferred: true }, { id: 'c' }, { id: 'd', deferred: true }];
		expect(nextItem(deferred, 'a')?.id).toBe('c');
		expect(nextItem(deferred, 'c')?.id).toBe('a');
		expect(nextItem([{ id: 'a', deferred: true }, { id: 'b' }], 'b')).toBeNull();
	});

	it('returns null when every other item is deferred', () => {
		expect(nextItem([{ id: 'a' }, { id: 'b', deferred: true }], 'a')).toBeNull();
	});
});
