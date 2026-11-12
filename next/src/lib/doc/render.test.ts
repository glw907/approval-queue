import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from '#lib/doc/parse.ts';
import { renderBlock, renderInline } from '#lib/doc/render.ts';
import type { Doc } from '#lib/doc/types.ts';

const specimen = readFileSync(new URL('../../../../docs/mockup/specimen/markdown.md', import.meta.url), 'utf8');
const bodyHtml = (doc: Doc) => doc.segments.map((s) => (s.type === 'html' ? s.html : '')).join('');

const HEADER = '---\nkind: report\n---\n';

describe('the Markdown specimen', () => {
	const { doc } = parse(specimen);
	const html = bodyHtml(doc);

	it('frames each table', () => {
		const frame = '<div class="table-frame" tabindex="0" role="group" aria-label="Table"><table>';
		expect(html.split(frame)).toHaveLength(3);
		expect(html.split('</table></div>')).toHaveLength(3);
	});

	it('draws a task list as disabled checkboxes', () => {
		const inputs = html.match(/<input[^>]*>/g) ?? [];
		expect(inputs).toHaveLength(6);
		for (const input of inputs) {
			expect(input).toContain('disabled');
			expect(input).toContain('type="checkbox"');
		}
	});

	it('draws struck text as <s>', () => {
		expect(html).toContain('<s>Struck text</s>');
	});

	it('makes a link of a bare address', () => {
		expect(html).toContain('<a href="https://github.github.com/gfm/">https://github.github.com/gfm/</a>');
	});

	it('draws code blocks and a quotation', () => {
		expect(html.split('<pre>')).toHaveLength(3);
		expect(html).toContain('<blockquote>');
	});

	it('gives each body heading an id and the title level 1', () => {
		for (const level of [2, 3, 4, 5, 6]) expect(html).toContain(`<h${level} id=`);
		expect(html).not.toContain('<h1');
		expect(doc.headings[0].level).toBe(1);
	});

	it('addresses a heading inside a summary', () => {
		expect(html).toContain('<summary><h3 id="a-folded-section">A folded section</h3></summary>');
	});

	it('turns a filtered tag into text', () => {
		expect(html).not.toContain('<script');
		expect(html).toContain('&lt;script');
	});

	it('draws no change marks', () => {
		expect(html).not.toContain('<del>');
		expect(html).not.toContain('<ins>');
	});
});

describe('headings', () => {
	it('renders a level-one heading in the body with an id', () => {
		const { doc } = parse(`${HEADER}# A title\n\nA first paragraph.\n\n# Another top heading\n\nText.\n`);
		expect(bodyHtml(doc)).toContain('<h1 id="another-top-heading">');
		expect(doc.headings.map((h) => h.level)).toEqual([1, 1]);
	});
});

describe('change marks', () => {
	const line = 'a {--b--} c {++d++}';

	it('draws the marks as <del> and <ins> when asked', () => {
		const html = renderBlock(line, true);
		expect(html).toContain('<del>b</del>');
		expect(html).toContain('<ins>d</ins>');
	});

	it('leaves the marks as typed by default', () => {
		const html = renderBlock(line, false);
		expect(html).toContain('{--b--}');
		expect(html).toContain('{++d++}');
		expect(html).not.toContain('<del>');
		expect(html).not.toContain('<ins>');
	});

	it('leaves a mark inside code as typed', () => {
		expect(renderInline('`{--b--}`', true)).toBe('<code>{--b--}</code>');
		const fenced = renderBlock('```\n{++d++}\n```', true);
		expect(fenced).toContain('<pre>');
		expect(fenced).toContain('{++d++}');
		expect(fenced).not.toContain('<ins>');
	});

	it('draws struck text as <s> either way', () => {
		expect(renderInline('~~e~~', true)).toBe('<s>e</s>');
		expect(renderInline('~~e~~', false)).toBe('<s>e</s>');
	});

	it('marks the title, the body, and the options of a parsed document', () => {
		const src = `${HEADER}# The {--old--}{++new++} title\n\nA {++first++} paragraph.\n\n:::question A label\n- **Keep {--it--}** now. {recommended}\n- **Drop it**\n:::\n`;
		const { doc } = parse(src, { changes: true });
		expect(doc.titleHtml).toBe('The <del>old</del><ins>new</ins> title');
		expect(doc.title).toBe('The new title');
		expect(doc.summary).toBe('A first paragraph.');
		expect(bodyHtml(doc)).toContain('<ins>first</ins>');
		const q = doc.segments.find((s) => s.type === 'question');
		expect(q?.type === 'question' && q.options[0].html).toContain('<del>it</del>');
		const plain = parse(src);
		expect(plain.doc.titleHtml).toBe('The {--old--}{++new++} title');
	});
});
