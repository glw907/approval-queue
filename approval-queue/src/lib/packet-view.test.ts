import { describe, expect, it } from 'vitest';
import { filesLine } from './packet-view.ts';

describe('filesLine', () => {
	it('counts the files across groups and names each group', () => {
		expect(filesLine([{ name: 'docs', files: [1] }, { name: 'src', files: [1, 2] }])).toBe('3 in 2 groups: docs, src');
	});

	it('says no files changed for an empty list', () => {
		expect(filesLine([])).toBe('No files changed');
	});

	it('uses the singular for one group', () => {
		expect(filesLine([{ name: 'notes.md', files: [1] }])).toBe('1 in 1 group: notes.md');
	});
});
