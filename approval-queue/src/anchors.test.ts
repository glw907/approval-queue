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

	it('seeds a blueprint with its page title, so a heading that repeats it takes -1', () => {
		const doc = '---\npage: Overview\n---\n\n# Overview\n';
		expect(anchorLines(doc, 'blueprint')).toBe('overview-1.heading\tOverview\n');
		expect(anchorLines(doc, 'page')).toBe('overview.heading\tOverview\n');
	});

	it('prints nothing for a document with no heading', () => {
		expect(anchorLines('Just a paragraph.\n', 'page')).toBe('');
	});
});
