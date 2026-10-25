// Geoff's comments on a document review and the author's replies to them, with the anchor that ties
// each to its text. Pure functions, shared by the server (which builds and re-places the anchors) and
// the editor. Every offset is into LF-normalized text, as `readBlueprint` and `readChange` read it.

/** How the author answered a comment: made the change, kept the text with a reason, or answered a question. */
export type ReplyStatus = 'done' | 'kept' | 'answered';

/**
 * Where a comment sits: the W3C Web Annotation text quote selector (`quote` with up to `CONTEXT`
 * characters of `prefix` and `suffix`) plus the offsets it was made at, end exclusive.
 */
export interface Anchor {
	quote: string;
	prefix: string;
	suffix: string;
	from: number;
	to: number;
	/** The commit the text was read at: the posted blob's on a blueprint or page, `meta.head` on a change. */
	commit: string;
	/** A change review's document path; absent on a blueprint or page. */
	file?: string;
}

export interface Comment {
	id: string;
	text: string;
	anchor: Anchor;
}

/** One entry of a `--replies` file: the original comment's `id`, `quote`, and anchor, with the author's reply in `text`. */
export interface Thread {
	id: string;
	status: ReplyStatus;
	text: string;
	quote: string;
	anchor: Anchor;
}

/** Characters of context kept on each side of a quote, as Hypothesis keeps. */
export const CONTEXT = 32;

/** The anchor of `doc.slice(from, to)`; the caller has checked the range lies inside `doc`. */
export function anchorAt(doc: string, from: number, to: number, commit: string, file?: string): Anchor {
	return {
		quote: doc.slice(from, to),
		prefix: doc.slice(Math.max(0, from - CONTEXT), from),
		suffix: doc.slice(to, to + CONTEXT),
		from,
		to,
		commit,
		...(file !== undefined && { file })
	};
}

/**
 * Finds an anchor's text in `doc`, which may have changed since the anchor was made. Tries the
 * offsets when they still hold the quote, then the one occurrence of the quote in its context, then
 * the occurrence of the quote nearest the old offset. Returns null when the quote is gone. Matching
 * is exact.
 */
export function place(doc: string, anchor: Anchor): { from: number; to: number } | null {
	const { quote, prefix, suffix, from, to } = anchor;
	if (!quote) return null;
	if (doc.slice(from, to) === quote) return { from, to };
	const context = prefix + quote + suffix;
	const first = doc.indexOf(context);
	if (first !== -1 && doc.indexOf(context, first + 1) === -1) {
		const at = first + prefix.length;
		return { from: at, to: at + quote.length };
	}
	let best = -1;
	for (let at = doc.indexOf(quote); at !== -1; at = doc.indexOf(quote, at + 1)) {
		if (best === -1 || Math.abs(at - from) < Math.abs(best - from)) best = at;
	}
	return best === -1 ? null : { from: best, to: best + quote.length };
}

/** How often `needle` occurs in `doc`, overlapping occurrences included, as `place()` walks them. */
function occurrences(doc: string, needle: string): number {
	let count = 0;
	for (let at = doc.indexOf(needle); at !== -1; at = doc.indexOf(needle, at + 1)) count++;
	return count;
}

/**
 * The quote's count in `doc` when `place()` would have to choose among several occurrences, else 0:
 * a unique or absent quote, or one whose context occurs exactly once, is settled. A missing `prefix`
 * or `suffix` reads as empty.
 */
export function ambiguousQuote(doc: string, quote: string, prefix = '', suffix = ''): number {
	if (!quote) return 0;
	const count = occurrences(doc, quote);
	if (count < 2) return 0;
	return occurrences(doc, prefix + quote + suffix) === 1 ? 0 : count;
}
