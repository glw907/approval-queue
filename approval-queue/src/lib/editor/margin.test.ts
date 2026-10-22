import { describe, expect, it } from 'vitest';
import { stack } from './margin.ts';

describe('stack', () => {
	it('leaves cards that do not meet at their own lines', () => {
		expect(
			stack(
				[
					{ key: 'a', y: 0, h: 50 },
					{ key: 'b', y: 200, h: 50 }
				],
				null
			)
		).toEqual({ a: 0, b: 200 });
	});

	it('pushes a card down past the one above it, with the gap between', () => {
		expect(
			stack(
				[
					{ key: 'a', y: 10, h: 100 },
					{ key: 'b', y: 40, h: 50 }
				],
				null
			)
		).toEqual({ a: 10, b: 122 });
	});

	it('keeps the current card level with its line and moves the one above it up', () => {
		expect(
			stack(
				[
					{ key: 'a', y: 100, h: 60 },
					{ key: 'b', y: 120, h: 50 }
				],
				'b'
			)
		).toEqual({ a: 48, b: 120 });
	});

	it('pushes a stack that would rise past the floor back down from it', () => {
		expect(
			stack(
				[
					{ key: 'a', y: 0, h: 60 },
					{ key: 'b', y: 20, h: 50 }
				],
				'b'
			)
		).toEqual({ a: 0, b: 72 });
	});

	it('sorts by line, whatever order the cards come in', () => {
		expect(
			stack(
				[
					{ key: 'late', y: 300, h: 10 },
					{ key: 'early', y: -20, h: 10 }
				],
				null
			)
		).toEqual({ early: 0, late: 300 });
	});
});
