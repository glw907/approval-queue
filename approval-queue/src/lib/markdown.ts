import { Marked, type RendererObject } from 'marked';

function escape(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// A PR body is external input. Raw markup needs no script to forge a decision (a
// same-origin <form> passes the CSRF check), so every raw HTML token renders as text.
const marked = new Marked({
	renderer: {
		html({ text }) {
			return escape(text);
		},
		// A scheme other than http, https, or mailto (javascript:, data:) renders as its text, not a link.
		// Browsers drop tabs, newlines, and leading control characters from a URL before reading its scheme, so the check does too.
		link({ href, title, tokens }) {
			const text = this.parser.parseInline(tokens);
			const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href.replace(/[\u0000-\u0020]/g, ''))?.[1].toLowerCase();
			if (scheme !== undefined && !['http', 'https', 'mailto'].includes(scheme)) return text;
			return `<a href="${escape(href)}"${title ? ` title="${escape(title)}"` : ''}>${text}</a>`;
		}
	}
});

// A design renders under the page's own `h1` headline and `h2` section titles, so its `#` is an `h3`;
// a table takes daisyUI's `table` class and scrolls inside its own box rather than widening the page.
const designRenderer: RendererObject = {
	html({ text }) {
		return escape(text);
	},
	link({ href, title, tokens }) {
		const text = this.parser.parseInline(tokens);
		const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href.replace(/[\u0000- ]/g, ''))?.[1].toLowerCase();
		if (scheme !== undefined && !['http', 'https', 'mailto'].includes(scheme)) return text;
		return `<a href="${escape(href)}"${title ? ` title="${escape(title)}"` : ''}>${text}</a>`;
	},
	heading({ tokens, depth }) {
		const level = Math.min(depth + 2, 6);
		return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`;
	},
	table(token) {
		const head = token.header.map((cell, i) => `<th${alignOf(token.align[i])}>${this.parser.parseInline(cell.tokens)}</th>`).join('');
		const body = token.rows
			.map((row) => `<tr>${row.map((cell, i) => `<td${alignOf(token.align[i])}>${this.parser.parseInline(cell.tokens)}</td>`).join('')}</tr>`)
			.join('\n');
		return `<div class="overflow-x-auto"><table class="table table-zebra"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>\n`;
	}
};
const design = new Marked({ renderer: designRenderer });
// A round report writes one field to a line, so a single line break stays a break. Its table and escaping are the design's.
const report = new Marked({ breaks: true, renderer: designRenderer });

const alignOf = (align: 'left' | 'right' | 'center' | null | undefined) => (align ? ` style="text-align:${align}"` : '');

// A pane row is a link itself, and a link may not hold another, so a row's label keeps each link's text only.
const unlinked = new Marked({
	renderer: {
		html({ text }) {
			return escape(text);
		},
		link({ tokens }) {
			return this.parser.parseInline(tokens);
		}
	}
});

/** Renders markdown to HTML with every raw HTML token, block and inline, escaped. */
export function render(source: string): string {
	return marked.parse(source, { async: false });
}

/** Renders a design document in full: raw HTML escaped, headings demoted two levels (backlog #39), tables styled. */
export function renderDesign(source: string): string {
	return design.parse(source, { async: false });
}

/** Renders a round report: the design renderer's markup, with a single line break rendered as a break. */
export function renderReport(source: string): string {
	return report.parse(source, { async: false });
}

/** Renders one line of markdown without a wrapping paragraph, for headlines, list items, and card text. */
export function renderInline(source: string): string {
	return marked.parseInline(source, { async: false });
}

/** Renders one line of markdown as `renderInline` does, with each link reduced to its text, for a label inside a link. */
export function renderLabel(source: string): string {
	return unlinked.parseInline(source, { async: false });
}
