import { describe, expect, it } from 'vitest';
import { curly, proseSpans, splitLead } from './prose.ts';

describe('curly', () => {
	it('curls quotes and apostrophes by what precedes them', () => {
		expect(curly(`He said "it's done" and 'left'`)).toBe('He said “it’s done” and ‘left’');
	});
});

describe('splitLead', () => {
	it('splits at the first sentence end before a capital', () => {
		expect(splitLead('A term means x. It exists because y.')).toEqual({ lead: 'A term means x.', rest: 'It exists because y.' });
	});

	it('leaves a one-sentence paragraph whole', () => {
		expect(splitLead('Only one sentence.')).toEqual({ lead: 'Only one sentence.', rest: '' });
	});
});

describe('proseSpans', () => {
	it('keeps a code span literal and curls the quotes around it', () => {
		expect(proseSpans(`Run "a" then \`it's "b"\` now`)).toEqual([
			{ kind: 'text', text: 'Run “a” then ' },
			{ kind: 'code', text: `it's "b"` },
			{ kind: 'text', text: ' now' }
		]);
	});

	it('sets an ISO date apart so it stays on one line', () => {
		expect(proseSpans('Since 2026-10-12 it fails')).toEqual([
			{ kind: 'text', text: 'Since ' },
			{ kind: 'date', text: '2026-10-12' },
			{ kind: 'text', text: ' it fails' }
		]);
	});
});
