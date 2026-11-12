import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

const line = (n: number, claim: string, repo: string, round?: string) => ({
	line: n,
	time: `2026-11-1${n}T10:00:00Z`,
	ref: `${repo}#${n}`,
	head: 'abc',
	claim,
	lane: 'land',
	notes: [],
	replies: [],
	...(round && { round })
});

const body = (groups: Array<{ repo: string; lines: ReturnType<typeof line>[] }>) => render(Page, { props: { data: { queue: [], digest: null, groups } as never, form: null } }).body;

describe('the digest page', () => {
	it("groups a round's lines under its id and the rest under \"No round\"", () => {
		const html = body([
			{
				repo: 'aq-fixture/sample',
				lines: [line(4, 'Claim four', 'aq-fixture/sample', 'ur-queue'), line(3, 'Claim three', 'aq-fixture/sample', 'ur-queue'), line(2, 'Claim two', 'aq-fixture/sample')]
			},
			{ repo: 'aq-fixture/other', lines: [line(1, 'Claim one', 'aq-fixture/other')] }
		]);
		expect(html.match(/Round ur-queue/g)).toHaveLength(1);
		expect(html.match(/No round/g)).toHaveLength(1);
		const at = ['Round ur-queue', 'Claim four', 'Claim three', 'No round', 'Claim two'].map((t) => html.indexOf(t));
		expect(at.every((n) => n >= 0)).toBe(true);
		expect(at).toEqual([...at].sort((a, b) => a - b));
		// The second repo has no round line, so it gets no heading.
		expect(html.match(/<h3/g)).toHaveLength(2);
	});
});
