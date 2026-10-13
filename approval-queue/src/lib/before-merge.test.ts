import { describe, expect, it } from 'vitest';
import { beforeMerge } from './before-merge.ts';

describe('beforeMerge', () => {
	it('returns the section up to the next heading', () => {
		const body = 'Intro\n\n## Before merge\n\n1. `stow -R bin`\n2. Check it\n\n## Found, not done\n\nnone';
		expect(beforeMerge(body)).toBe('1. `stow -R bin`\n2. Check it');
	});

	it('runs to the end of the body and keeps subheadings', () => {
		expect(beforeMerge('## Before merge\nDo it\n### Detail\nmore')).toBe('Do it\n### Detail\nmore');
	});

	it('matches the heading case-insensitively', () => {
		expect(beforeMerge('## before MERGE\nx')).toBe('x');
	});

	it.each(['no section here', '## Before merge', '## Before merging\nx', '### Before merge\nx'])(
		'returns null for %j',
		(body) => {
			expect(beforeMerge(body)).toBeNull();
		}
	);
});
