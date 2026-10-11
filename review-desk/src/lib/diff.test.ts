import { describe, expect, it } from 'vitest';
import { classify, classifyDiff } from './diff.ts';

describe('classify', () => {
	it.each([
		['+x', 'added'],
		['-x', 'removed'],
		['@@ -1 +1 @@', 'hunk'],
		['diff --git a/x b/x', 'file'],
		['+++ b/x', 'file'],
		['--- a/x', 'file'],
		[' x', 'context']
	] as const)('labels %s as %s', (line, kind) => {
		expect(classify(line)).toBe(kind);
	});
});

describe('classifyDiff', () => {
	it('labels each line and keeps its text', () => {
		expect(classifyDiff('+a\n b')).toEqual([
			{ kind: 'added', text: '+a' },
			{ kind: 'context', text: ' b' }
		]);
	});
});
