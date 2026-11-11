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
});
