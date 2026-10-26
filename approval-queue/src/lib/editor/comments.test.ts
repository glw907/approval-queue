import { describe, expect, it } from 'vitest';
import { WATER_HEAD as DOC } from '#lib/fixtures/seed-docs.ts';
import { ambiguousQuote, anchorAt, CONTEXT, place } from './comments.ts';

const FILE = 'docs/guide/water-a-houseplant.md';
const LINE = 'Dry soil at that depth means the plant needs water.';
const at = (doc: string, text: string) => [doc.indexOf(text), doc.indexOf(text) + text.length] as const;

describe('anchorAt', () => {
	it('keeps the quote and CONTEXT characters each side', () => {
		const [from, to] = at(DOC, LINE);
		const anchor = anchorAt(DOC, from, to, 'c1', FILE);
		expect(anchor).toEqual({
			quote: LINE,
			prefix: DOC.slice(from - CONTEXT, from),
			suffix: DOC.slice(to, to + CONTEXT),
			from,
			to,
			commit: 'c1',
			file: FILE
		});
		expect(anchor.prefix).toHaveLength(32);
	});

	it('takes what context there is at the start and the end of the document', () => {
		expect(anchorAt(DOC, 0, 3, 'c1', FILE)).toMatchObject({ quote: '---', prefix: '', suffix: DOC.slice(3, 3 + CONTEXT) });
		const end = anchorAt(DOC, DOC.length - 5, DOC.length, 'c1', FILE);
		expect(end).toMatchObject({ quote: 'our.\n', suffix: '', prefix: DOC.slice(DOC.length - 5 - CONTEXT, DOC.length - 5) });
		expect(anchorAt('abc', 1, 2, 'c1', FILE)).toMatchObject({ prefix: 'a', suffix: 'c' });
	});

});

describe('place', () => {
	const [from, to] = at(DOC, LINE);
	const anchor = anchorAt(DOC, from, to, 'c1', FILE);

	it('keeps the offsets while they still hold the quote', () => {
		expect(place(DOC, anchor)).toEqual({ from, to });
	});

	it('finds the quote by its context once the offsets have moved', () => {
		const moved = DOC.replace('## Check the soil', '## Check the soil\n\nA new paragraph above.');
		const placed = place(moved, anchor);
		expect(placed).not.toEqual({ from, to });
		expect(moved.slice(placed!.from, placed!.to)).toBe(LINE);
	});

	it('picks the occurrence nearest the old offset when the context matches none or several', () => {
		// The word occurs many times, so neither the offsets (after the edit) nor the context finds it.
		const word = DOC.indexOf('water', from);
		const short = anchorAt(DOC, word, word + 5, 'c1', FILE);
		const edited = `Watered.\n${DOC.replace(short.prefix + 'water' + short.suffix, `${short.prefix}water,${short.suffix}`)}`;
		expect(place(edited, short)).toEqual({ from: word + 9, to: word + 14 });
	});

	it('tells two equal contexts apart by the old offset', () => {
		// Lines 1 and 2 of four equal lines have the same prefix and suffix.
		const lines = `${LINE}\n`.repeat(4);
		const third = 2 * (LINE.length + 1);
		const a = anchorAt(lines, third, third + LINE.length, 'c1', FILE);
		expect(place(`z${lines}`, a)).toEqual({ from: third + 1, to: third + 1 + LINE.length });
	});

	it('is null once the quote is gone', () => {
		expect(place(DOC.replace(LINE, 'Water it weekly.'), anchor)).toBeNull();
		expect(place(DOC, { ...anchor, quote: '' })).toBeNull();
	});

	it('places into a CRLF file once it is read as LF, as the server reads it', () => {
		const crlf = DOC.replace(/\n/g, '\r\n');
		const lf = crlf.replace(/\r\n/g, '\n');
		expect(place(lf, anchor)).toEqual({ from, to });
		// Against the raw CRLF text, the LF offsets are wrong, so only the quote still finds the line.
		const raw = place(crlf, anchor)!;
		expect(crlf.slice(raw.from, raw.to)).toBe(LINE);
		expect(raw.from).not.toBe(from);
	});
});

describe('ambiguousQuote', () => {
	const text = 'A red cat. A blue cat. A red cat.';

	it('passes a unique quote and an absent one', () => {
		expect(ambiguousQuote(text, 'blue')).toBe(0);
		expect(ambiguousQuote(text, 'green')).toBe(0);
	});

	it('fails a repeated quote with no context, returning its count', () => {
		expect(ambiguousQuote(text, 'cat')).toBe(3);
	});

	it('passes a repeated quote whose context occurs once', () => {
		expect(ambiguousQuote(text, 'cat', 'blue ')).toBe(0);
		expect(ambiguousQuote(text, 'cat', '', '. A blue')).toBe(0);
	});

	it('fails a repeated context', () => {
		expect(ambiguousQuote(text, 'cat', 'red ')).toBe(3);
	});

	it('counts overlapping occurrences, as place() does', () => {
		expect(ambiguousQuote('aaa', 'aa')).toBe(2);
	});
});
