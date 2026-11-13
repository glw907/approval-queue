import { describe, expect, it } from 'vitest';
import { curly, localImages, typeset } from '#lib/components/typeset.ts';

describe('curly', () => {
	it('turns straight double quotes in text into curly ones', () => {
		expect(curly('<p>He said "hi" to me.</p>')).toBe('<p>He said “hi” to me.</p>');
	});

	it('turns an apostrophe between letters into a curly one', () => {
		expect(curly("<p>it's done</p>")).toBe('<p>it’s done</p>');
	});

	it('changes the escaped forms the same way', () => {
		expect(curly('<p>&quot;x&quot; and it&#39;s</p>')).toBe('<p>“x” and it’s</p>');
	});

	it('opens a quote after an opening bracket', () => {
		expect(curly('<p>(“a”) and ("b") and (\'c\')</p>')).toBe('<p>(“a”) and (“b”) and (‘c’)</p>');
	});

	it('opens a quote at the start of a text run and after a dash', () => {
		expect(curly('<p><em>"x"</em> a-"b"</p>')).toBe('<p><em>“x”</em> a-“b”</p>');
	});

	it('closes a quote after punctuation', () => {
		expect(curly('<p>"Stop."</p>')).toBe('<p>“Stop.”</p>');
	});

	it('leaves quotes inside code, pre, kbd, and samp alone', () => {
		const html =
			'<p>Run <code>echo "a" &#39;b&#39;</code>.</p><pre><code>x = "y"\n</code></pre><kbd>"</kbd><samp>\'</samp>';
		expect(curly(html)).toBe(html);
	});

	it('leaves quotes inside a tag and its attribute values alone', () => {
		const html = '<a href="/x" title="it&#39;s">link</a>';
		expect(curly(html)).toBe(html);
	});

	it('takes up text again after a code element closes', () => {
		expect(curly('<p><code>"a"</code> then "b"</p>')).toBe('<p><code>"a"</code> then “b”</p>');
	});
});

describe('localImages', () => {
	it('removes the address of a remote image and keeps its alt', () => {
		expect(localImages('<img src="https://example.com/x.png" alt="a">')).toBe('<img alt="a">');
	});

	it('removes a protocol-relative address', () => {
		expect(localImages('<img src="//example.com/x" alt="b">')).toBe('<img alt="b">');
	});

	it('keeps a path on the queue and a data address', () => {
		const html = '<img src="/a.png" alt="a"><img src="data:image/png;base64,AA" alt="d">';
		expect(localImages(html)).toBe(html);
	});

	it('removes an address in single quotes or with no quotes', () => {
		expect(localImages("<img alt='c' src='http://x.test/y'>")).toBe("<img alt='c'>");
		expect(localImages('<img src=http://x.test/y alt="e">')).toBe('<img alt="e">');
	});
});

describe('typeset', () => {
	it('runs both passes', () => {
		expect(typeset('<p>"a" <img src="https://x.test/i.png" alt="i"></p>')).toBe('<p>“a” <img alt="i"></p>');
	});
});
