import { describe, expect, it } from 'vitest';
import { age, boardGroups, DEFERRED, SINGLES, spokenAge, type BoardRow } from './board.ts';

const row = (id: string, group: string, created: string, asks = 0): BoardRow => ({
	id,
	group,
	created,
	irreversible: false,
	asks,
	headline: id,
	rules: [],
	repos: 1,
	deferred: false,
	orphaned: false
});

const rows = [
	row('a', 'Old', '2026-10-11T10:00:00Z', 0),
	row('b', 'Busy', '2026-10-11T11:00:00Z', 2),
	row('c', 'Busy', '2026-10-11T10:30:00Z', 1),
	row('d', SINGLES, '2026-10-11T09:00:00Z')
];

describe('boardGroups', () => {
	it('puts the group with the most asks first, then its busiest row, and singles last', () => {
		const groups = boardGroups(rows, 'asks');
		expect(groups.map((g) => g.title)).toEqual(['Busy', 'Old', SINGLES]);
		expect(groups[0].rows.map((r) => r.id)).toEqual(['b', 'c']);
	});

	it('orders by age when asked, still with singles last', () => {
		const groups = boardGroups(rows, 'oldest');
		expect(groups.map((g) => g.title)).toEqual(['Old', 'Busy', SINGLES]);
		expect(groups[1].rows.map((r) => r.id)).toEqual(['c', 'b']);
	});
});

describe('boardGroups with deferred rows', () => {
	it('moves a deferred row under Deferred, after Single items, whatever its own group', () => {
		const deferred = [
			...rows,
			{ ...row('e', 'Busy', '2026-10-11T08:00:00Z', 3), deferred: true },
			{ ...row('f', SINGLES, '2026-10-11T08:30:00Z'), deferred: true }
		];
		const groups = boardGroups(deferred, 'asks');
		expect(groups.map((g) => g.title)).toEqual(['Busy', 'Old', SINGLES, DEFERRED]);
		expect(groups[0].rows.map((r) => r.id)).toEqual(['b', 'c']);
		expect(groups[3].rows.map((r) => r.id)).toEqual(['e', 'f']);
	});
});

describe('age', () => {
	it('counts minutes, hours, then days', () => {
		const now = Date.parse('2026-10-12T10:00:00Z');
		expect(age('2026-10-12T09:15:00Z', now)).toBe('45m');
		expect(age('2026-10-12T07:00:00Z', now)).toBe('3h');
		expect(age('2026-10-09T10:00:00Z', now)).toBe('3d');
	});

	it('spells the same age out for a screen reader', () => {
		const now = Date.parse('2026-10-12T10:00:00Z');
		expect(spokenAge('2026-10-12T09:15:00Z', now)).toBe('45 minutes');
		expect(spokenAge('2026-10-12T09:00:00Z', now)).toBe('1 hour');
		expect(spokenAge('2026-10-09T10:00:00Z', now)).toBe('3 days');
	});
});
