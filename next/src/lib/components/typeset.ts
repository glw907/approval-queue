/**
 * The last changes the page makes to a document's rendered HTML before it shows it: curly quotes
 * in the prose, and no address for an image the queue doesn't serve.
 */

const TAG = /<[^>]*>/g;
const CODE = new Set(['code', 'pre', 'kbd', 'samp']);
/** Tags a sentence runs through, so a quote after one keeps the text before it in view. */
const INLINE = new Set(['a', 'abbr', 'b', 'del', 'em', 'i', 'ins', 'mark', 's', 'small', 'span', 'strong', 'sub', 'sup']);
const PIECE = /&quot;|&#34;|&#39;|&#x27;|&[a-z0-9#]+;|[\s\S]/gi;
const OPENS_AFTER = /[\s([{\-–—]/;
const WORD = /[\p{L}\p{N}]/u;

function quotes(text: string, before: string): { text: string; last: string } {
	let out = '';
	let prev = before;
	for (const piece of text.match(PIECE) ?? []) {
		const p = piece.toLowerCase();
		const double = piece === '"' || p === '&quot;' || p === '&#34;';
		const single = piece === "'" || p === '&#39;' || p === '&#x27;';
		const opens = prev === '' || OPENS_AFTER.test(prev);
		if (double) out += opens ? '“' : '”';
		else if (single) out += WORD.test(prev) || !opens ? '’' : '‘';
		else out += piece;
		prev = piece.length === 1 ? piece : double || single ? (double ? '"' : "'") : ';';
	}
	return { text: out, last: prev };
}

/**
 * Turns the straight quotes in the text of `html` into curly ones, raw or escaped as `&quot;` and
 * `&#39;`.
 *
 * @remarks
 * Text inside a tag, an attribute value, or a `code`, `pre`, `kbd`, or `samp` element is left
 * alone. A double quote opens at the start of a text run or after a space, a bracket, or a dash,
 * and closes elsewhere. A single quote after a letter or digit is an apostrophe; otherwise it
 * opens or closes by the double quote's rule. A text run starts at any tag but an inline one such
 * as `em` or `a`.
 */
export function curly(html: string): string {
	let out = '';
	let depth = 0;
	let prev = '';
	let at = 0;
	const text = (end: number) => {
		const run = html.slice(at, end);
		if (depth > 0) {
			out += run;
			if (run) prev = run.at(-1)!;
			return;
		}
		const done = quotes(run, prev);
		out += done.text;
		prev = done.last;
	};
	for (const m of html.matchAll(TAG)) {
		text(m.index);
		const tag = /^<(\/?)([a-z][a-z0-9]*)/i.exec(m[0]);
		const name = tag?.[2].toLowerCase() ?? '';
		if (CODE.has(name)) depth = Math.max(0, depth + (tag![1] ? -1 : 1));
		if (!INLINE.has(name) && !CODE.has(name)) prev = '';
		out += m[0];
		at = m.index + m[0].length;
	}
	text(html.length);
	return out;
}

const IMG = /<img\b[^>]*>/gi;
const SRC = /\s+src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/i;
const OUTSIDE = /^(?:[a-z][a-z0-9+.-]*:|[/\\]{2})/i;

/**
 * Removes the `src` of every `<img>` in `html` whose address is outside the queue, so the page
 * never asks another host for an image. A path on the queue and a `data:` address are kept, as is
 * every `alt`.
 */
export function localImages(html: string): string {
	return html.replace(IMG, (img) => {
		const m = SRC.exec(img);
		if (!m) return img;
		const address = (m[1] ?? m[2] ?? m[3] ?? '').replace(/[\s\u0000-\u001f]/g, '');
		if (/^data:/i.test(address) || !OUTSIDE.test(address)) return img;
		return img.slice(0, m.index) + img.slice(m.index + m[0].length);
	});
}

/** Both of the module's changes, the images first. */
export const typeset = (html: string) => curly(localImages(html));
