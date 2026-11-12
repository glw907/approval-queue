import { describe, expect, it } from 'vitest';
import { age, boardGroups, digestDay, digestSections, decisionWord, digestLine, longDay, openingRow, railLine, railRounds, ROUND_REPORT, SINGLES, spokenAge, type BoardRow } from './board.ts';

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

const rrow = (id: string, group: string, created: string, round: string | undefined, asks = 0, repoNames?: string[]): BoardRow => ({
	...row(id, group, created, asks),
	...(round && { round }),
	...(repoNames && { repoNames })
});

describe('boardGroups with rounds', () => {
	const mixed = [
		rrow('loose', 'Init', '2026-10-11T10:00:00Z', undefined),
		rrow('q1', 'Init', '2026-10-11T11:00:00Z', 'ur-queue', 1, ['approval-queue']),
		rrow('q2', 'Init', '2026-10-11T12:00:00Z', 'ur-queue', 1, ['approval-queue']),
		rrow('w1', 'Init', '2026-10-11T10:30:00Z', 'ur-ws', 0)
	];

	it('puts the loose rows first, then each round once with its rows together', () => {
		const [group] = boardGroups(mixed, 'oldest');
		expect(group.sections.map((s) => [s.heading, s.rows.map((r) => r.id)])).toEqual([
			[undefined, ['loose']],
			['Round ur-ws', ['w1']],
			['Round ur-queue \u00b7 approval-queue', ['q1', 'q2']]
		]);
		expect(group.rows.map((r) => r.id)).toEqual(['loose', 'w1', 'q1', 'q2']);
	});

	it('lists a section\'s repos in name order, and none when its rows name none', () => {
		const list = [
			rrow('a', 'Init', '2026-10-11T10:00:00Z', 'ur-ws', 0, ['workstation', 'standards']),
			rrow('b', 'Init', '2026-10-11T10:30:00Z', 'ur-ws', 0, ['standards']),
			rrow('c', 'Init', '2026-10-11T11:00:00Z', 'ur-queue')
		];
		const [group] = boardGroups(list, 'oldest');
		expect(group.sections.map((s) => s.heading)).toEqual(['Round ur-ws \u00b7 standards, workstation', 'Round ur-queue']);
	});

	it('gives one section in each group for the same round id under two initiatives', () => {
		const list = [rrow('a', 'One', '2026-10-11T10:00:00Z', 'ur-queue'), rrow('b', 'Two', '2026-10-11T11:00:00Z', 'ur-queue')];
		expect(boardGroups(list, 'oldest').map((g) => g.sections.length)).toEqual([1, 1]);
	});

	it('ranks round sections by asks under "Asks first" and by age under "Oldest first"', () => {
		expect(boardGroups(mixed, 'asks')[0].sections.map((s) => s.round)).toEqual([undefined, 'ur-queue', 'ur-ws']);
		expect(boardGroups(mixed, 'oldest')[0].sections.map((s) => s.round)).toEqual([undefined, 'ur-ws', 'ur-queue']);
	});

	it('gives rows with no round one section with no heading', () => {
		const groups = boardGroups(rows, 'asks');
		expect(groups.map((g) => g.sections.map((s) => [s.heading, s.rows.length]))).toEqual([[[undefined, 2]], [[undefined, 1]], [[undefined, 1]]]);
	});
});

describe('railRounds', () => {
	const item = (id: string, created: string, round?: string, initiativeTitle = 'Init') => ({ id, created, initiative: 'x', initiativeTitle, ...(round && { round }) });

	it('keeps rows with no round in the order given and groups the rest under their initiative and round', () => {
		const items = [item('a', '1'), item('r1', '2', 'ur-queue'), item('b', '3'), item('r2', '4', 'ur-ws'), item('r3', '5', 'ur-queue')];
		const out = railRounds(items);
		expect(out.loose.map((i) => i.id)).toEqual(['a', 'b']);
		expect(out.groups.map((g) => [g.title, g.rounds.map((r) => [r.round, r.items.map((i) => i.id)])])).toEqual([
			['Init', [['ur-queue', ['r1', 'r3']], ['ur-ws', ['r2']]]]
		]);
	});

	it('gives nothing for an empty list, and drops a round and its group with their last item', () => {
		expect(railRounds([])).toEqual({ loose: [], groups: [] });
		const out = railRounds([item('a', '1'), item('r1', '2', 'ur-queue', 'Other')]);
		expect(out.groups.map((g) => g.title)).toEqual(['Other']);
		expect(railRounds([item('a', '1')]).groups).toEqual([]);
	});
});

describe('digestSections', () => {
	const dl = (claim: string, time: string, round?: unknown) => ({ claim, time, ...(round !== undefined && { round }) });

	it('gives lines with no round one unheaded section', () => {
		expect(digestSections([dl('a', '3'), dl('b', '2')])).toEqual([{ lines: [dl('a', '3'), dl('b', '2')] }]);
	});

	it('orders rounds by newest line and puts "No round" last, and a bad round counts as none', () => {
		const lines = [dl('n1', '9', 'ur-ws'), dl('x', '8'), dl('q', '7', 'ur-queue'), dl('num', '6', 7), dl('blank', '5', ''), dl('w', '4', 'ur-ws')];
		expect(digestSections(lines).map((s) => [s.heading, s.lines.map((l) => l.claim)])).toEqual([
			['Round ur-ws', ['n1', 'w']],
			['Round ur-queue', ['q']],
			['No round', ['x', 'num', 'blank']]
		]);
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

describe('a round report', () => {
	const rep = (id: string, created: string, round = 'ur-queue') => ({ ...rrow(id, 'Init', created, round), single: ROUND_REPORT });

	it('leads its round section whatever its age or the sort', () => {
		const list = [rrow('p1', 'Init', '2026-11-12T07:00:00Z', 'ur-queue', 3), rep('rep', '2026-11-12T09:00:00Z'), rrow('p2', 'Init', '2026-11-12T08:00:00Z', 'ur-queue', 1)];
		for (const sort of ['asks', 'oldest'] as const) {
			const [group] = boardGroups(list, sort);
			expect(group.sections[0].rows.map((r) => r.id)).toEqual(['rep', 'p1', 'p2']);
		}
	});

	it('does not move a round ahead of another because of its report', () => {
		const list = [rrow('a', 'Init', '2026-11-12T07:00:00Z', 'ur-a', 1), rrow('b', 'Init', '2026-11-12T08:00:00Z', 'ur-b', 1), rep('rep', '2026-11-12T06:00:00Z', 'ur-b')];
		const [group] = boardGroups(list, 'asks');
		expect(group.sections.map((s) => s.round)).toEqual(['ur-a', 'ur-b']);
	});

	it('heads a round holding only its report "Round <id>", and is never the opening row', () => {
		const [group] = boardGroups([rep('rep', '2026-11-12T09:00:00Z')], 'asks');
		expect(group.sections[0].heading).toBe('Round ur-queue');
		expect(openingRow([rep('rep', '2026-11-12T09:00:00Z')])).toBeUndefined();
	});

	it('puts the report first in the rail round, words its line, and names its decision', () => {
		const out = railRounds([
			{ id: 'p', created: '1', kind: 'packet', initiative: 'x', initiativeTitle: 'Init', round: 'ur-queue' },
			{ id: 'r', created: '2', kind: 'report', initiative: 'x', initiativeTitle: 'Init', round: 'ur-queue' }
		]);
		expect(out.groups[0].rounds[0].items.map((i) => i.id)).toEqual(['r', 'p']);
		const now = Date.parse('2026-11-10T12:20:00Z');
		expect(railLine({ kind: 'report', asks: 0, created: '2026-11-10T12:00:00Z' }, now)).toBe('Round report, 20 minutes ago');
		expect(decisionWord('read')).toBe('Read');
	});
});
