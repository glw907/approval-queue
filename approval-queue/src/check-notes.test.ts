import { describe, expect, it } from 'vitest';
import { noteDefects } from './check-notes.ts';

const DOC = 'Water the plant. Then water the plant again.\n';

describe('noteDefects', () => {
	it('skips a string anchor', () => {
		expect(noteDefects(DOC, [{ id: 'n1', anchor: 'overview.heading' }])).toEqual([]);
	});

	it('passes a quote that occurs once', () => {
		expect(noteDefects(DOC, [{ id: 'n1', anchor: { quote: 'again' } }])).toEqual([]);
	});

	it('names the note, the quote, the count, and the fix for a repeated quote', () => {
		expect(noteDefects(DOC, [{ id: 'n2', anchor: { quote: 'the plant' } }])).toEqual([
			'note n2: the quote "the plant" occurs 2 times; add a prefix or suffix that occurs once'
		]);
	});
});
