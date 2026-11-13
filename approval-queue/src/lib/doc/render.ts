import { Marked, type MarkedExtension, type Tokens, type TokenizerAndRendererExtension } from 'marked';

// The comparison writes these marks; a session never types them. They are inline tokens, so a
// mark inside a code span or block stays as typed.
function changeMark(name: string, open: string, close: string, tag: string): TokenizerAndRendererExtension {
	return {
		name,
		level: 'inline',
		start: (src) => src.indexOf(open),
		tokenizer(src) {
			if (!src.startsWith(open)) return undefined;
			const end = src.indexOf(close, open.length);
			if (end < 0) return undefined;
			const text = src.slice(open.length, end);
			return { type: name, raw: src.slice(0, end + close.length), text, tokens: this.lexer.inlineTokens(text) };
		},
		renderer(token) {
			return `<${tag}>${this.parser.parseInline(token.tokens ?? [])}</${tag}>`;
		}
	};
}

// The nine tags the GitHub Flavored Markdown specification turns into text (section 6.11).
const FILTERED = /<(?=\/?(?:title|textarea|style|xmp|iframe|noembed|noframes|script|plaintext)(?:[\s/>]|$))/gi;

const BASE: MarkedExtension = {
	gfm: true,
	renderer: {
		// Struck text is <s>, so it never reads as a passage the session removed.
		del(token: Tokens.Del) {
			return `<s>${this.parser.parseInline(token.tokens)}</s>`;
		},
		html(token: Tokens.HTML | Tokens.Tag) {
			return token.text.replace(FILTERED, '&lt;');
		}
	}
};

const MARKS: MarkedExtension = {
	extensions: [changeMark('removed', '{--', '--}', 'del'), changeMark('added', '{++', '++}', 'ins')]
};

// Two instances, never the shared `marked`, so the marks reach only a caller that asks for them.
const PLAIN = new Marked(BASE);
const CHANGES = new Marked(BASE, MARKS);

export function renderInline(src: string, changes = false): string {
	return (changes ? CHANGES : PLAIN).parseInline(src, { async: false });
}

/** Renders block Markdown, wrapping each table in a frame that scrolls on its own on a narrow page. */
export function renderBlock(src: string, changes = false): string {
	return (changes ? CHANGES : PLAIN)
		.parse(src, { async: false })
		.replaceAll('<table>', '<div class="table-frame" tabindex="0" role="group" aria-label="Table"><table>')
		.replaceAll('</table>', '</table></div>');
}

/** The block tokens of a Markdown source, from the instance with no change marks. */
export function lex(src: string): Tokens.Generic[] {
	return PLAIN.lexer(src);
}

/** The text a reader sees in rendered HTML. Removed passages are dropped. */
export function plain(html: string): string {
	return html
		.replace(/<del>.*?<\/del>\s*/gs, '')
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.trim();
}
