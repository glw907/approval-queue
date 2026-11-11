import { describe, expect, it } from 'vitest';
import { age, boardGroups, digestDay, decisionWord, digestLine, longDay, openingRow, railLine, SINGLES, spokenAge, type BoardRow } from './board.ts';

const row = (id: string, group: string, created: string, asks = 0): BoardRow => ({
	id,
	group,
	created,
	irreversible: false,
	asks,
	headline: id,
	rules: [],
	repos: 1,
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

describe('openingRow', () => {
	it('picks the oldest packet, never a single item', () => {
		const list = [
			{ ...row('s', SINGLES, '2026-10-11T08:00:00Z'), single: 'Design' },
			row('late', 'G', '2026-10-11T12:00:00Z'),
			row('early', 'G', '2026-10-11T09:00:00Z')
		];
		expect(openingRow(list)?.id).toBe('early');
	});

	it('picks nothing when only single items wait, or nothing does', () => {
		expect(openingRow([{ ...row('s', SINGLES, '2026-10-11T08:00:00Z'), single: 'Triage' }])).toBeUndefined();
		expect(openingRow([])).toBeUndefined();
	});
});

describe('railLine', () => {
	const now = Date.parse('2026-11-10T12:20:00Z');
	it('says a stopped packet paused, with its calls and age', () => {
		expect(railLine({ kind: 'packet', packetKind: 'stop', asks: 3, created: '2026-11-10T12:00:00Z' }, now)).toBe('Pass paused, 3 calls, 20 minutes ago');
	});
	it('says a closed packet finished, and counts one call as one', () => {
		expect(railLine({ kind: 'packet', packetKind: 'close', asks: 1, created: '2026-11-10T11:20:00Z' }, now)).toBe('Pass finished, 1 call, 1 hour ago');
		expect(railLine({ kind: 'packet', packetKind: 'close', asks: 0, created: '2026-11-10T11:20:00Z' }, now)).toBe('Pass finished, no calls, 1 hour ago');
	});
	it('names a design packet, a design, and a triage list by kind', () => {
		expect(railLine({ kind: 'packet', packetKind: 'design', asks: 2, created: '2026-11-08T12:20:00Z' }, now)).toBe('Design, 2 calls, 2 days ago');
		expect(railLine({ kind: 'design', asks: 0, created: '2026-11-10T12:20:00Z' }, now)).toBe('Design, 0 minutes ago');
		expect(railLine({ kind: 'triage', asks: 0, created: '2026-11-10T12:00:00Z' }, now)).toBe('Triage list, 20 minutes ago');
	});
});

describe('digestLine', () => {
	it('counts the changes on the newest day, in its own words', () => {
		const lines = [
			{ time: '2026-11-09T12:00:00Z' },
			{ time: '2026-11-10T12:00:00Z' },
			{ time: '2026-11-10T12:30:00Z' }
		];
		expect(digestDay(lines)).toEqual({ count: 2, day: '10 November' });
		expect(digestLine(digestDay(lines))).toBe('2 changes on 10 November');
		expect(digestLine(digestDay([{ time: '2026-11-10T12:00:00Z' }]))).toBe('1 change on 10 November');
	});
	it('says nothing merged when the digest is empty', () => {
		expect(digestDay([])).toBeNull();
		expect(digestLine(null)).toBe('Nothing has merged yet');
	});
});

describe('longDay and decisionWord', () => {
	it('spells a date and a decision in words', () => {
		expect(longDay('2026-11-09T12:00:00Z')).toBe('9 November 2026');
		expect(decisionWord('reject')).toBe('Sent back');
		expect(decisionWord('whatever')).toBe('Decided');
	});
});
