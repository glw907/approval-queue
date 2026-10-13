import { describe, expect, it } from 'vitest';
import { changedCount, groupRows, moveRow, type Row } from './triage.ts';

const rows: Row[] = [
	{ action: '1', why: '', disposition: 'now', proposed: 'now', note: 'a' },
	{ action: '2', why: '', disposition: 'defer', proposed: 'defer', note: 'b' },
	{ action: '10', why: '', disposition: 'now', proposed: 'now', note: 'c' },
	{ action: '3', why: '', disposition: 'drop', proposed: 'drop', note: 'd' }
];

describe('moveRow', () => {
	it('changes only that row and never the order', () => {
		const moved = moveRow(rows, 1, 'drop');
		expect(moved.map((r) => r.action)).toEqual(['1', '2', '10', '3']);
		expect(moved[1].disposition).toBe('drop');
		expect(moved[1].proposed).toBe('defer');
		expect(moved.filter((_, i) => i !== 1)).toEqual(rows.filter((_, i) => i !== 1));
		expect(rows[1].disposition).toBe('defer');
	});
});

describe('groupRows', () => {
	it('keeps item-number order, the position in the list, inside a section', () => {
		const text = [
			{ action: 'zebra stripes', why: '', disposition: 'now', proposed: 'now', note: '' },
			{ action: 'apple', why: '', disposition: 'defer', proposed: 'defer', note: '' },
			{ action: 'mango', why: '', disposition: 'drop', proposed: 'drop', note: '' }
		] satisfies Row[];
		const g = groupRows(moveRow(text, 2, 'now'));
		expect(g.now.map((r) => r.index)).toEqual([0, 2]);
		expect(g.now.map((r) => r.row.action)).toEqual(['zebra stripes', 'mango']);
		expect(g.defer.map((r) => r.index)).toEqual([1]);
		expect(g.drop).toEqual([]);
	});
});

describe('changedCount', () => {
	it('counts against proposed and drops back to 0 on return', () => {
		expect(changedCount(rows)).toBe(0);
		const moved = moveRow(rows, 0, 'drop');
		expect(changedCount(moved)).toBe(1);
		expect(changedCount(moveRow(moved, 0, 'now'))).toBe(0);
	});
});
