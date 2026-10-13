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
		}
	}
});

/** Renders markdown to HTML with every raw HTML token, block and inline, escaped. */
export function render(source: string): string {
	return marked.parse(source, { async: false });
}
