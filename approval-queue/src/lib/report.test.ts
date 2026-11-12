import { describe, expect, it } from 'vitest';
import { reportBody, reportHeadline } from './report.ts';
import { FIXTURE } from './report-fixture.ts';

const table = (...states: string[]) =>
	`# T\n\n| Pass | State |\n| --- | --- |\n${states.map((s, i) => `| Q${i + 1} | ${s} |`).join('\n')}\n`;

describe('reportHeadline', () => {
	it('counts the merged passes and the one parked', () => {
		expect(reportHeadline(FIXTURE)).toBe('3 of 4 passes merged, 1 parked');
	});

	it('names each other state in the order the table first shows it', () => {
		expect(reportHeadline(table('merged', 'planning', 'parked', 'planning'))).toBe('1 of 4 passes merged, 2 planning, 1 parked');
	});

	it('starts at 0 when no row is merged', () => {
		expect(reportHeadline(table('planning', 'planning'))).toMatch(/^0 of 2 passes merged/);
	});

	it('gives nothing for a report with no table, or a table with no State cell', () => {
		expect(reportHeadline('# T\n\nStops: 0\n')).toBe('');
		expect(reportHeadline('# T\n\n| Pass | PR |\n| --- | --- |\n| Q1 | #1 |\n')).toBe('');
	});
});

describe('reportBody', () => {
	it('drops a first-line heading and keeps every other line', () => {
		expect(reportBody(FIXTURE)).toBe(FIXTURE.split('\n').slice(1).join('\n'));
		expect(reportBody(FIXTURE)).toContain('Round state: running');
	});

	it('returns a text with no heading on its first line whole', () => {
		expect(reportBody('Round state: running\n# later\n')).toBe('Round state: running\n# later\n');
	});
});
