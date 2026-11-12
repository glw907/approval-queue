import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import ReportPage from '#lib/components/ReportPage.svelte';

const data = (over: object = {}) => ({
	meta: { title: 'Round ur-queue', created: '2026-11-12T20:00:00Z' },
	read: false,
	html: '<p>Round state: running</p>',
	waiting: [{ id: 'p1', title: 'A packet' }],
	landed: [{ ref: 'o/r#14', claim: 'landed it', url: 'https://github.com/o/r/pull/14' }],
	...over
});
const body = (d: object) => render(ReportPage, { props: { data: d as never } }).body;

describe('the report page', () => {
	it('shows the title, the body, both lists, and one Mark read form', () => {
		const html = body(data());
		expect(html).toContain('<h1');
		expect(html).toContain('Round ur-queue');
		expect(html).toContain('Round report, 12 November 2026');
		expect(html).toContain('Round state: running');
		expect(html).toContain('href="/item/p1"');
		expect(html).toContain('href="https://github.com/o/r/pull/14"');
		expect(html.match(/Mark read/g)).toHaveLength(1);
		expect(html).toContain('action="?/read"');
	});

	it('says so when nothing waits or landed', () => {
		const html = body(data({ waiting: [], landed: [] }));
		expect(html).toContain('No packet from this round is waiting.');
		expect(html).toContain('No pull request has landed in this round.');
	});

	it('shows Read and no button once read', () => {
		const html = body(data({ read: true }));
		expect(html).toContain('Read, 12 November 2026');
		expect(html).not.toContain('Mark read');
	});
});
