import { describe, expect, it } from 'vitest';
import { changedCount, groupRows, moveRow, type Row } from './triage.ts';

const rows: Row[] = [
	{ item: '1', disposition: 'now', proposed: 'now', reason: 'a' },
	{ item: '2', disposition: 'defer', proposed: 'defer', reason: 'b' },
	{ item: '10', disposition: 'now', proposed: 'now', reason: 'c' },
	{ item: '3', disposition: 'drop', proposed: 'drop', reason: 'd' }
];

describe('moveRow', () => {
	it('changes only that row and never the order', () => {
		const moved = moveRow(rows, 1, 'drop');
		expect(moved.map((r) => r.item)).toEqual(['1', '2', '10', '3']);
		expect(moved[1].disposition).toBe('drop');
		expect(moved[1].proposed).toBe('defer');
		expect(moved.filter((_, i) => i !== 1)).toEqual(rows.filter((_, i) => i !== 1));
		expect(rows[1].disposition).toBe('defer');
	});
});

describe('groupRows', () => {
	it('keeps item-number order inside a section', () => {
		const g = groupRows(moveRow(rows, 3, 'now'));
		expect(g.now.map((r) => r.item)).toEqual(['1', '3', '10']);
		expect(g.defer.map((r) => r.item)).toEqual(['2']);
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
