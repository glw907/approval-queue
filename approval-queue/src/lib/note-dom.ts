// The notes margin's contact with the page's DOM: turning a selection into an anchor, finding an
// anchor's passage again, and marking the paragraphs a resend changed. Browser-only; the pure
// placement steps live in `anchors.ts`.
import { anchorAt, place, placeDiff, type DiffLineRef } from '#lib/anchors.ts';
import type { DiffAnchor, ProseAnchor } from '#lib/server/items.ts';

export const BODY = 'packet-body';

/** The elements a prose anchor's `section` names: a `section`, a fold, or the "Not checked" note. */
const SECTION = 'section[id], details[id], #not-checked';

export const isDiff = (anchor: ProseAnchor | DiffAnchor): anchor is DiffAnchor => 'pr' in anchor;

const elementOf = (node: Node) => (node instanceof Element ? node : node.parentElement);

/** The element whose `textContent` a section's offsets index; the whole reading column when the section is unknown. */
export function sectionRoot(id: string): HTMLElement | null {
	return document.getElementById(id) ?? document.getElementById(BODY);
}

/** The section a node sits in. */
function sectionOf(node: Node): HTMLElement | null {
	return elementOf(node)?.closest<HTMLElement>(SECTION) ?? document.getElementById(BODY);
}

/** The DOM range over `root`'s text from offset `from` to `to`, or null past its end. */
export function rangeAt(root: Node, from: number, to: number): Range | null {
	const range = document.createRange();
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let seen = 0;
	let started = false;
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const length = node.nodeValue?.length ?? 0;
		if (!started && from < seen + length) {
			range.setStart(node, from - seen);
			started = true;
		}
		if (started && to <= seen + length) {
			range.setEnd(node, to - seen);
			return range;
		}
		seen += length;
	}
	return null;
}

/** The offsets of `range` in `root`'s text. */
function offsetsOf(root: Node, range: Range): { from: number; to: number } {
	const before = document.createRange();
	before.selectNodeContents(root);
	before.setEnd(range.startContainer, range.startOffset);
	const from = before.toString().length;
	return { from, to: from + range.toString().length };
}

/** The rows of every diff on the page, in document order. */
const diffRows = () => [...document.querySelectorAll<HTMLTableRowElement>(`#${BODY} tr[data-line]`)];

const codeOf = (row: HTMLTableRowElement) => row.querySelector('.cd')?.textContent ?? '';

function rowRef(row: HTMLTableRowElement): DiffLineRef {
	const { pr = '', file = '', side = '', line = '0' } = row.dataset;
	return { pr, file, side, line: Number(line), text: codeOf(row) };
}

/** What a selection anchors: the diff line it starts on, or its text in its section. Null outside the reading column. */
export function anchorOfRange(range: Range): { anchor: ProseAnchor | DiffAnchor; quote: string } | null {
	const body = document.getElementById(BODY);
	if (!body || !body.contains(range.startContainer) || !body.contains(range.endContainer)) return null;
	const row = elementOf(range.startContainer)?.closest<HTMLTableRowElement>('tr[data-line]');
	if (row) {
		const anchor = rowRef(row);
		return { anchor, quote: anchor.text };
	}
	const root = sectionOf(range.startContainer);
	if (!root) return null;
	const clipped = range.cloneRange();
	if (!root.contains(clipped.endContainer)) clipped.setEnd(root, root.childNodes.length);
	const doc = root.textContent ?? '';
	let { from, to } = offsetsOf(root, clipped);
	while (from < to && /\s/.test(doc[from])) from++;
	while (to > from && /\s/.test(doc[to - 1])) to--;
	if (from >= to) return null;
	const anchor = anchorAt(doc, from, to, root.id || BODY);
	return { anchor, quote: anchor.quote };
}

/** Where an anchor's passage sits on the page now: its range and the element to measure when the range has no size. */
export interface Located {
	range: Range;
	el: Element;
}

/** Finds an anchor's passage in the DOM as it is now, by the placement steps of `anchors.ts`; null when it is gone. */
export function locate(anchor: ProseAnchor | DiffAnchor): Located | null {
	if (isDiff(anchor)) {
		const rows = diffRows();
		const refs = rows.map(rowRef);
		const hit = placeDiff(refs, anchor);
		const cell = hit ? rows[refs.indexOf(hit)].querySelector('.cd') : null;
		if (!cell) return null;
		const range = document.createRange();
		range.selectNodeContents(cell);
		return { range, el: cell };
	}
	const root = sectionRoot(anchor.section);
	const found = root ? place(root.textContent ?? '', anchor) : null;
	const range = root && found ? rangeAt(root, found.from, found.to) : null;
	const el = range && elementOf(range.startContainer);
	return range && el ? { range, el } : null;
}

/** The element to measure for a note: the summary of the closed fold that hides it, else the passage itself. */
export function visibleAnchor(el: Element): Element {
	let shown = el;
	for (let d = el.parentElement?.closest('details'); d; d = d.parentElement?.closest('details')) {
		const summary = d.querySelector(':scope > summary');
		if (!d.open && summary && !summary.contains(el)) shown = summary;
	}
	return shown;
}

/** A section's own element, for a note whose passage is gone but whose section is still on the page. */
export const sectionTop = (id: string): Element | null => document.getElementById(id) ?? document.getElementById(BODY);

/** Paints the ranges under a CSS Custom Highlight name; a browser without the API shows no highlight. */
export function highlight(name: string, ranges: Range[]) {
	if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined') return;
	if (ranges.length) CSS.highlights.set(name, new Highlight(...ranges));
	else CSS.highlights.delete(name);
}

const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Marks each paragraph, list item, or claim of the reading column whose text is one of `paragraphs`
 * (the paragraphs of `text.md` a resend changed). The page renders the markdown, so the comparison
 * keeps letters and digits only; a claim's line carries its citation in the source, so it matches by
 * its start.
 */
export function markChanged(paragraphs: string[]) {
	const body = document.getElementById(BODY);
	if (!body) return;
	const changed = paragraphs.map(squash);
	const same = new Set(changed);
	for (const el of body.querySelectorAll('p, li, [data-para]')) {
		const text = squash(el.textContent ?? '');
		const hit = text !== '' && (same.has(text) || (el.hasAttribute('data-para') && text.length >= 24 && changed.some((c) => c.startsWith(text))));
		el.classList.toggle('changed-para', hit);
	}
}
