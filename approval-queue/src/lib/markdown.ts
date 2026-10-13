import { Marked } from 'marked';

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

/** Renders markdown to HTML with every raw HTML token, block and inline, escaped. */
export function render(source: string): string {
	return marked.parse(source, { async: false });
}

/** Renders one line of markdown without a wrapping paragraph, for headlines, list items, and card text. */
export function renderInline(source: string): string {
	return marked.parseInline(source, { async: false });
}
