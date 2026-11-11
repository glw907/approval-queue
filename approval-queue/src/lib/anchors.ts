// Where a note sits on a packet page, and how to find that place again once the page has changed.
// Pure functions. A prose anchor's offsets index its section's `textContent` with LF endings; a diff
// anchor names a line of a pull request's file at the pinned head.
import type { DiffAnchor, ProseAnchor } from '#lib/server/items.ts';

/** Characters of context kept on each side of a quote, as Hypothesis keeps. */
export const CONTEXT = 32;

/** The anchor of `doc.slice(from, to)` in `section`; the caller has checked the range lies inside `doc`. */
export function anchorAt(doc: string, from: number, to: number, section: string): ProseAnchor {
	return {
		section,
		quote: doc.slice(from, to),
		prefix: doc.slice(Math.max(0, from - CONTEXT), from),
		suffix: doc.slice(to, to + CONTEXT),
		from,
		to
	};
}

/**
 * Finds an anchor's text in `doc`, which may have changed since the anchor was made. Tries the
 * offsets when they still hold the quote, then the one occurrence of the quote in its context, then
 * the occurrence of the quote nearest the old offset. Returns null when the quote is gone. Matching
 * is exact.
 */
export function place(doc: string, anchor: ProseAnchor): { from: number; to: number } | null {
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

/** One line of a pull request's diff as the page shows it: `side` is `old` or `new`. */
export type DiffLineRef = DiffAnchor;

/**
 * Finds a diff anchor's line among `lines`. Tries the line with the anchor's pull request, file,
 * side, and number that still holds its text, then the line on that side of that file with the same
 * text nearest the old number. Returns null when the text is gone.
 */
export function placeDiff(lines: DiffLineRef[], anchor: DiffAnchor): DiffLineRef | null {
	const here = lines.filter((l) => l.pr === anchor.pr && l.file === anchor.file && l.side === anchor.side);
	const same = here.filter((l) => l.text === anchor.text);
	const exact = same.find((l) => l.line === anchor.line);
	if (exact) return exact;
	let best: DiffLineRef | null = null;
	for (const l of same) if (!best || Math.abs(l.line - anchor.line) < Math.abs(best.line - anchor.line)) best = l;
	return best;
}
