import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { SINGLES, type BoardRow } from '#lib/board.ts';
import Page from './+page.svelte';

const row = (id: string, group: string, created: string, extra: Partial<BoardRow> = {}): BoardRow => ({
	id,
	headline: `Headline ${id}`,
	group,
	created,
	asks: 1,
	rules: [],
	repos: 1,
	irreversible: false,
	orphaned: false,
	...extra
});

const body = (rows: BoardRow[]) => render(Page, { props: { data: { queue: [], digest: null, empty: false, sort: 'oldest', rows } as never } }).body;

describe('the board page', () => {
	it('puts the loose row under the initiative, then each round under its heading', () => {
		const html = body([
			row('loose', 'Unattended rounds', '2026-11-11T10:00:00Z'),
			row('q1', 'Unattended rounds', '2026-11-11T11:00:00Z', { round: 'ur-queue', repoNames: ['approval-queue'] }),
			row('q2', 'Unattended rounds', '2026-11-11T12:00:00Z', { round: 'ur-queue', repoNames: ['approval-queue'] }),
			row('w1', 'Unattended rounds', '2026-11-11T13:00:00Z', { round: 'ur-ws' }),
			row('d1', SINGLES, '2026-11-11T09:00:00Z', { single: 'Design' })
		]);
		const at = ['Unattended rounds', 'Headline loose', 'Round ur-queue', 'Headline q1', 'Headline q2', 'Round ur-ws'].map((t) => html.indexOf(t));
		expect(at.every((n) => n >= 0)).toBe(true);
		expect(at).toEqual([...at].sort((a, b) => a - b));
		expect(html).toContain('approval-queue');
		expect(html.match(/Round ur-queue/g)).toHaveLength(1);
		expect(html).toContain(SINGLES);
	});

	it('renders rows with no round with no round heading and one tbody for each group', () => {
		const html = body([row('a', 'One', '2026-11-11T10:00:00Z'), row('b', 'Two', '2026-11-11T11:00:00Z')]);
		expect(html).not.toContain('Round ');
		expect(html.match(/<tbody/g)).toHaveLength(2);
	});
});
