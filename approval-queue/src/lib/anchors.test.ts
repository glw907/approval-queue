import { describe, expect, it } from 'vitest';
import { anchorAt, CONTEXT, place, placeDiff, type DiffLineRef } from './anchors.ts';

const DOC = '---\ntitle: Water a houseplant\n---\n\n# Water a houseplant\n\nWater a houseplant when the top inch of soil is dry.\n\n## Check the soil\n\nPress a finger into the soil up to the first knuckle. Dry soil at that depth means the plant needs water.\n\n## Water the plant\n\nPour slowly until water runs from the drainage holes. Empty the saucer after ten minutes.\n\n## Fix a drooping plant\n\nA drooping plant is more often overwatered than thirsty. Check the soil before you pour.\n';

const SECTION = 'opening';
const LINE = 'Dry soil at that depth means the plant needs water.';
const at = (doc: string, text: string) => [doc.indexOf(text), doc.indexOf(text) + text.length] as const;

describe('anchorAt', () => {
	it('keeps the quote and CONTEXT characters each side', () => {
		const [from, to] = at(DOC, LINE);
		const anchor = anchorAt(DOC, from, to, SECTION);
		expect(anchor).toEqual({
			quote: LINE,
			prefix: DOC.slice(from - CONTEXT, from),
			suffix: DOC.slice(to, to + CONTEXT),
			from,
			to,
			section: SECTION
		});
		expect(anchor.prefix).toHaveLength(32);
	});

	it('takes what context there is at the start and the end of the document', () => {
		expect(anchorAt(DOC, 0, 3, SECTION)).toMatchObject({ quote: '---', prefix: '', suffix: DOC.slice(3, 3 + CONTEXT) });
		const end = anchorAt(DOC, DOC.length - 5, DOC.length, SECTION);
		expect(end).toMatchObject({ quote: 'our.\n', suffix: '', prefix: DOC.slice(DOC.length - 5 - CONTEXT, DOC.length - 5) });
		expect(anchorAt('abc', 1, 2, SECTION)).toMatchObject({ prefix: 'a', suffix: 'c' });
	});

});

describe('place', () => {
	const [from, to] = at(DOC, LINE);
	const anchor = anchorAt(DOC, from, to, SECTION);

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
		const short = anchorAt(DOC, word, word + 5, SECTION);
		const edited = `Watered.\n${DOC.replace(short.prefix + 'water' + short.suffix, `${short.prefix}water,${short.suffix}`)}`;
		expect(place(edited, short)).toEqual({ from: word + 9, to: word + 14 });
	});

	it('tells two equal contexts apart by the old offset', () => {
		// Lines 1 and 2 of four equal lines have the same prefix and suffix.
		const lines = `${LINE}\n`.repeat(4);
		const third = 2 * (LINE.length + 1);
		const a = anchorAt(lines, third, third + LINE.length, SECTION);
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

describe('placeDiff', () => {
	const row = (side: string, line: number, text: string, file = 'a.ts'): DiffLineRef => ({ pr: 'o/r#1', file, side, line, text });
	const anchor = { pr: 'o/r#1', file: 'a.ts', side: 'new', line: 5, text: 'const x = 1;' };

	it('finds the line by pull request, file, side, and line number', () => {
		const lines = [row('new', 4, 'a'), row('new', 5, 'const x = 1;'), row('old', 5, 'const x = 0;')];
		expect(placeDiff(lines, anchor)).toBe(lines[1]);
	});

	it('finds the line by its text when the line number has moved', () => {
		const lines = [row('new', 5, 'other'), row('new', 9, 'const x = 1;'), row('new', 20, 'const x = 1;'), row('old', 6, 'const x = 1;')];
		expect(placeDiff(lines, anchor)).toBe(lines[1]);
	});

	it('does not look in another file or on the other side', () => {
		const lines = [row('new', 5, 'const x = 1;', 'b.ts'), row('old', 5, 'const x = 1;')];
		expect(placeDiff(lines, anchor)).toBeNull();
	});

	it('is null once the text is gone', () => {
		expect(placeDiff([row('new', 5, 'const x = 2;')], anchor)).toBeNull();
	});
});
