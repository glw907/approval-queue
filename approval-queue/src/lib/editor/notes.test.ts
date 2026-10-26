import { describe, expect, it } from 'vitest';
import { DOCS_NOTES, REPOT, REPOT_HEAD, WATER, WATER_HEAD } from '#lib/fixtures/seed-docs.ts';
import { codeSpans, wordDiff } from './inline.ts';
import { isCall, outline, placeNotes, type Note } from './notes.ts';

const NOTES = JSON.parse(DOCS_NOTES) as Note[];
const note = (id: string, anchor: Note['anchor'], file = WATER): Note => ({ id, file, kind: 'info', anchor, title: id, body: [] });
const text = (doc: string, range: [number, number]) => doc.slice(range[0], range[1]);

describe('placeNotes', () => {
	it('places each fixture note on its quote in its own page', () => {
		const [info, decide] = placeNotes(WATER_HEAD, NOTES.filter((n) => n.file === WATER));
		expect(text(WATER_HEAD, info.range)).toBe('runs from the drainage holes');
		expect(text(WATER_HEAD, decide.range)).toBe('ten minutes');
		const [question] = placeNotes(REPOT_HEAD, NOTES.filter((n) => n.file === REPOT));
		expect(text(REPOT_HEAD, question.range)).toBe('one size up');
	});

	it('settles a repeated quote by its context, else takes the first occurrence', () => {
		const doc = 'Water the plant. Then water the plant again.\n';
		const [byPrefix, first, bySuffix] = placeNotes(doc, [
			note('a', { quote: 'the plant', prefix: 'Then water ' }),
			note('b', { quote: 'the plant' }),
			note('c', { quote: 'the plant', suffix: ' again' })
		]);
		expect(byPrefix.range).toEqual([doc.lastIndexOf('the plant'), doc.lastIndexOf('the plant') + 9]);
		expect(first.range).toEqual([doc.indexOf('the plant'), doc.indexOf('the plant') + 9]);
		expect(bySuffix.range).toEqual(byPrefix.range);
	});

	it('puts a quote that matches nothing at the top of the page, where it draws no highlight', () => {
		const [gone] = placeNotes(WATER_HEAD, [note('a', { quote: 'not on this page' })]);
		expect(gone.range).toEqual([0, 0]);
	});

	it('keeps the note’s own fields beside its range', () => {
		const [placed] = placeNotes(WATER_HEAD, NOTES);
		expect(placed).toMatchObject({ id: 'N1', file: WATER, kind: 'info', was: expect.any(String), now: expect.any(String) });
	});
});

describe('isCall', () => {
	it('asks for a choice on a decide or question note and not on an info note', () => {
		expect(NOTES.map(isCall)).toEqual([false, true, true]);
	});
});

describe('outline', () => {
	it('lists the second- and third-level headings outside front matter and code', () => {
		const doc = '---\ntitle: T\n# not a heading\n---\n\n# Title\n\n## One\n\n```\n## code\n```\n\n### Two\n\n#### Four\n';
		expect(outline(doc).map((h) => [h.level, h.text])).toEqual([
			[2, 'One'],
			[3, 'Two']
		]);
		expect(outline(WATER_HEAD).map((h) => h.text)).toEqual(['Check the soil', 'Water the plant', 'Fix a drooping plant']);
	});
});

describe('inline', () => {
	it('splits code spans and keeps an unpaired backtick literal', () => {
		expect(codeSpans('a `b` c `d')).toEqual([
			{ text: 'a ', code: false },
			{ text: 'b', code: true },
			{ text: ' c `d', code: false }
		]);
	});

	it('diffs by word and rebuilds both sides', () => {
		const runs = wordDiff('a step over ten seconds', 'a step over a minute');
		expect(runs.filter((r) => r.op !== 'ins').map((r) => r.text).join('')).toBe('a step over ten seconds');
		expect(runs.filter((r) => r.op !== 'del').map((r) => r.text).join('')).toBe('a step over a minute');
		expect(runs[0]).toEqual({ op: 'same', text: 'a step over ' });
	});
});
