import { describe, expect, it } from 'vitest';
import { anchorLines } from './anchors.ts';

const DOC = [
	'---',
	'page: Set a section’s starting state',
	'---',
	'',
	'# Overview',
	'',
	'## Set a section\'s starting state',
	'',
	'```md',
	'# Not a heading',
	'```',
	'',
	':::reader',
	'## Nor this one',
	':::',
	'',
	'### Check the `result`',
	''
].join('\n');

describe('anchorLines', () => {
	it('prints each heading outside front matter, code, and containers as slug, tab, and text', () => {
		expect(anchorLines(DOC, 'page')).toBe(
			["overview.heading\tOverview", "set-a-sections-starting-state.heading\tSet a section's starting state", 'check-the-result.heading\tCheck the `result`', ''].join('\n')
		);
	});

	it('slugs an H1 that repeats the title bare, and a ## heading that repeats it takes -1 when there is no H1', () => {
		const h1 = '---\npage: Overview\n---\n\n# Overview\n';
		expect(anchorLines(h1, 'blueprint')).toBe('overview.heading\tOverview\n');
		expect(anchorLines(h1, 'page')).toBe('overview.heading\tOverview\n');
		expect(anchorLines('---\npage: Overview\n---\n\n## Overview\n', 'blueprint')).toBe('overview-1.heading\tOverview\n');
	});

	it('slugs a heading with a named entity as the page does', () => {
		expect(anchorLines('## Q &amp; A\n', 'page')).toBe('q--a.heading\tQ &amp; A\n');
	});

	it('prints nothing for a document with no heading', () => {
		expect(anchorLines('Just a paragraph.\n', 'page')).toBe('');
	});
});
