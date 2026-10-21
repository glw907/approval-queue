// The review notes a document carries and the anchors that tie each one to a line. Pure functions,
// shared by the server (which resolves the anchors once for the page) and the editor.
import { directiveLineKind, directiveOpenerName, fenceScan, frontmatterSpan } from './directives.ts';

export type NoteKind = 'info' | 'decide' | 'question';

export interface NoteChoice {
	label: string;
	/** Replaces the anchored text when chosen. */
	text?: string;
	/** What the note says once this choice is made. */
	done: string;
	/** Selects the anchored text for the reader to rewrite. */
	edit?: boolean;
}

/** One note, in the shape of the prototype's `blueprint-notes.json`. */
export interface Note {
	id: string;
	/** `info` is a correction already made; `decide` and `question` are calls for the reader. */
	kind: NoteKind;
	anchor: string;
	title: string;
	body: string[];
	was?: string;
	now?: string;
	sides?: Array<{ who: string; text: string }>;
	choices?: NoteChoice[];
	/** In a change review, the changed document the anchor belongs to; unused in a single-document review. */
	file?: string;
}

/** Which anchor scheme a document uses: a blueprint counts items and `:::row` blocks, a page counts paragraphs, list items, and tables. */
export type DocKind = 'blueprint' | 'page';

/** A character range in the document, end exclusive. */
export type Range = [number, number];

/** A note with the range its anchor resolved to, or null when the anchor names nothing. */
export type PlacedNote = Note & { range: Range | null };

/** Whether a note asks the reader for a choice. */
export const isCall = (note: Note) => note.kind !== 'info';

/**
 * A heading's anchor slug: inline-code backticks dropped, lowercased, each run of characters other
 * than a-z and 0-9 replaced by one hyphen, and hyphens trimmed from both ends.
 */
export function slug(text: string): string {
	return text
		.replace(/`/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/d;
const ITEM = /^(?:[-*+]|\d+[.)])[ \t]+/;
const PART = /^\*\*([A-Za-z]+)\.\*\*[ \t]+/;
const TRAILING_FACTS = /(?:[ \t]*:fact\[[^\]]*\])+[ \t]*$/;

/** The span of a line's text from `start`, ending before any trailing `:fact[...]` tags. */
function textSpan(line: string, from: number, start: number): Range {
	const body = line.slice(start);
	const tail = TRAILING_FACTS.exec(body);
	return [from + start, from + start + (tail ? tail.index : body.length)];
}

/**
 * Every anchor the document defines, by name. `<slug>.heading` is a heading's text; `<slug>.p<n>`
 * is the n-th item under that heading, counting from 0 over its top-level bullets, numbered steps,
 * and `:::row` blocks in one sequence; `<slug>.p<n>.<part>` is a row's `**Part.**` line, lowercased.
 * Each heading counts its own items, so items under a deeper heading belong to it. Front matter,
 * code blocks, and lines inside other directive containers define nothing. The first heading with
 * a slug keeps it.
 */
export function anchors(doc: string, kind: DocKind = 'blueprint'): Map<string, Range> {
	if (kind === 'page') return pageAnchors(doc);
	const out = new Map<string, Range>();
	const lines = doc.split('\n');
	const scan = fenceScan(lines);
	const front = frontmatterSpan(doc);
	let section: string | null = null;
	let n = 0;
	let row: { key: string; from: number } | null = null;
	let offset = 0;
	for (const [i, line] of lines.entries()) {
		const from = offset;
		offset += line.length + 1;
		if ((front && from < front.to) || scan.inCode[i]) continue;
		const depth = scan.depths[i];
		const role = scan.roles[i];
		if (role === 'opener' && depth === 1) {
			if (section !== null && directiveOpenerName(line) === 'row') {
				row = { key: `${section}.p${n++}`, from };
			}
			continue;
		}
		if (role === 'closer' && depth === 1) {
			if (row && !out.has(row.key)) out.set(row.key, [row.from, from + line.length]);
			row = null;
			continue;
		}
		if (depth !== null) {
			const part = row && PART.exec(line);
			if (row && part) {
				const key = `${row.key}.${part[1].toLowerCase()}`;
				if (!out.has(key)) out.set(key, textSpan(line, from, part[0].length));
			}
			continue;
		}
		const heading = HEADING.exec(line);
		if (heading) {
			const name = slug(heading[2]);
			section = name;
			n = 0;
			const key = `${name}.heading`;
			const [start, end] = heading.indices![2]!;
			if (name && !out.has(key)) out.set(key, [from + start, from + end]);
			continue;
		}
		const item = ITEM.exec(line);
		if (item && section !== null) {
			const key = `${section}.p${n++}`;
			if (!out.has(key)) out.set(key, textSpan(line, from, item[0].length));
		}
	}
	return out;
}

interface PageBlock {
	key: string;
	start: number;
	kind: 'para' | 'item' | 'table';
	/** The heading's slug was already taken, so the block defines nothing. */
	dead: boolean;
}

const TABLE = /^\s{0,3}\|/;
const CODE_DELIMITER = /^\s{0,3}(`{3,}|~{3,})/;
const RULE = /^\s{0,3}([-*_][ \t]*){3,}$/;
const INDENTED = /^(?: {2,}|\t)\S/;

/**
 * The anchors of a page: `<slug>.heading` is a heading's text, and `<slug>.p<n>` is the n-th block
 * under that heading, counting from 0 over its paragraphs, top-level list items, and tables in one
 * sequence. A paragraph or table spans its lines; a list item spans from its text to the end of its
 * indented continuation and nested items. Blank lines, front matter, code blocks, rules, and
 * directive containers and leaves count for nothing. The first heading with a slug keeps it.
 */
function pageAnchors(doc: string): Map<string, Range> {
	const out = new Map<string, Range>();
	const lines = doc.split('\n');
	const scan = fenceScan(lines);
	const front = frontmatterSpan(doc);
	let section: string | null = null;
	let n = 0;
	let block: PageBlock | null = null as PageBlock | null;
	// The block a blank line closed, which an indented line right after the blank still belongs to.
	let item = null as PageBlock | null;
	let offset = 0;
	const open = (kind: PageBlock['kind'], start: number): PageBlock => {
		const key = `${section}.p${n++}`;
		return { key, start, kind, dead: out.has(key) };
	};
	const extend = (b: PageBlock, line: string, from: number) => {
		if (b.dead) return;
		const tail = TRAILING_FACTS.exec(line);
		out.set(b.key, [b.start, from + (tail ? tail.index : line.trimEnd().length)]);
	};
	for (const [i, line] of lines.entries()) {
		const from = offset;
		offset += line.length + 1;
		if ((front && from < front.to) || scan.inCode[i] || CODE_DELIMITER.test(line) || scan.depths[i] !== null || directiveLineKind(line) === 'leaf') {
			block = item = null;
			continue;
		}
		const heading = HEADING.exec(line);
		if (heading) {
			block = item = null;
			const name = slug(heading[2]);
			section = name;
			n = 0;
			const key = `${name}.heading`;
			const [start, end] = heading.indices![2]!;
			if (name && !out.has(key)) out.set(key, [from + start, from + end]);
			continue;
		}
		if (line.trim() === '') {
			item = block?.kind === 'item' ? block : null;
			block = null;
			continue;
		}
		if (section === null || RULE.test(line)) {
			block = item = null;
			continue;
		}
		const reopened = item;
		item = null;
		const marker = ITEM.exec(line);
		const lead = from + line.length - line.trimStart().length;
		if (marker) {
			block = open('item', from + marker[0].length);
		} else if (block?.kind === 'item') {
			// A lazy continuation or nested item stays in its item.
		} else if (reopened && INDENTED.test(line)) {
			block = reopened;
		} else if (TABLE.test(line)) {
			if (block?.kind !== 'table') block = open('table', lead);
		} else if (block?.kind !== 'para') {
			block = open('para', lead);
		}
		extend(block!, line, from);
	}
	return out;
}

/** Places each note on its anchor's range; a note whose anchor names nothing gets a null range. */
export function placeNotes(doc: string, notes: readonly Note[], kind: DocKind = 'blueprint'): PlacedNote[] {
	const found = anchors(doc, kind);
	return notes.map((note) => ({ ...note, range: found.get(note.anchor) ?? null }));
}

/** One `##` or `###` heading, for the outline. */
export interface Heading {
	/** The heading line's start. */
	pos: number;
	level: 2 | 3;
	text: string;
}

/** The document's second- and third-level headings, outside front matter, code, and containers. */
export function outline(doc: string): Heading[] {
	const out: Heading[] = [];
	const lines = doc.split('\n');
	const scan = fenceScan(lines);
	const front = frontmatterSpan(doc);
	let offset = 0;
	for (const [i, line] of lines.entries()) {
		const from = offset;
		offset += line.length + 1;
		if ((front && from < front.to) || scan.inCode[i] || scan.depths[i] !== null) continue;
		const h = HEADING.exec(line);
		if (h && (h[1].length === 2 || h[1].length === 3)) out.push({ pos: from, level: h[1].length as 2 | 3, text: h[2] });
	}
	return out;
}

/** The front matter's `key: value` lines, unquoted; nested YAML is not read. */
export function frontMatter(doc: string): Record<string, string> {
	const span = frontmatterSpan(doc);
	if (!span) return {};
	const out: Record<string, string> = {};
	for (const line of doc.slice(0, span.to).split('\n').slice(1, -1)) {
		const m = /^([\w-]+):[ \t]*(.*?)[ \t]*$/.exec(line);
		if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
	}
	return out;
}
