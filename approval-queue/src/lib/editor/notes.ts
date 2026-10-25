// The review notes a document carries and the anchors that tie each one to a line. Pure functions,
// shared by the server (which resolves the anchors once for the page) and the editor.
import { decodeNamedCharacterReference } from 'decode-named-character-reference';
import GithubSlugger from 'github-slugger';
import { Lexer, type Token } from 'marked';
import { place } from './comments.ts';
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
	/** A name from `anchors()`, or a quote the document holds, with optional context to settle a repeat. */
	anchor: string | { quote: string; prefix?: string; suffix?: string };
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
 * The text a heading renders as, which rehype-slug slugs: inline Markdown reduced to its words. marked
 * decodes numeric references but leaves named ones as text, so those go through the decoder cairn's
 * parser runs; an unknown name stays as written.
 */
function plainText(tokens: Token[]): string {
	return tokens
		.map((t) => {
			if (t.type === 'image' || t.type === 'html' || t.type === 'br') return '';
			if ('tokens' in t && t.tokens) return plainText(t.tokens);
			return 'text' in t ? t.text.replace(/&(\w+);/g, (whole: string, name: string) => decodeNamedCharacterReference(name) || whole) : '';
		})
		.join('');
}

/** The slug the page gives a heading, taking `-1`, `-2` for a repeat the way the page does. */
type Slugger = (heading: string) => string;

/**
 * One slugger per document, as rehype-slug runs one per page. A blueprint's slugs the front matter's
 * `page` first, as drafter does, so a heading that repeats the title takes `-1`.
 */
function sluggerFor(doc: string, kind: DocKind): Slugger {
	const github = new GithubSlugger();
	if (kind === 'blueprint') {
		const title = frontMatter(doc).page;
		if (title) github.slug(title);
	}
	return (heading) => github.slug(plainText(new Lexer().inlineTokens(heading)));
}

/** The slug the first version of this tool gave a heading, which notes written then still use. */
function oldSlug(text: string): string {
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
 * code blocks, and lines inside other directive containers define nothing. Slugs follow the page's
 * rule (see `sluggerFor`), so a repeated heading takes `-1`, `-2`. A key spelled with the first
 * version's slug resolves too, unless a current key holds that name.
 */
export function anchors(doc: string, kind: DocKind = 'blueprint'): Map<string, Range> {
	const { out, alias } = scan(doc, kind);
	for (const [key, range] of alias) if (!out.has(key)) out.set(key, range);
	return out;
}

/** The headings `anchors()` names with the current rule, each as its slug and its text. */
export function headingList(doc: string, kind: DocKind = 'blueprint'): Array<{ slug: string; text: string }> {
	return [...scan(doc, kind).out]
		.filter(([key]) => key.endsWith('.heading'))
		.map(([key, [from, to]]) => ({ slug: key.slice(0, -'.heading'.length), text: doc.slice(from, to) }));
}

/** The anchors by the current rule, and those by the first version's rule that differ from them. */
interface Scan {
	out: Map<string, Range>;
	alias: Map<string, Range>;
}

/** Records a key under the current slug and, where the first version's slug differs, under that. */
function recorder(out: Map<string, Range>, alias: Map<string, Range>) {
	let section = '';
	let old = '';
	// The first version resolved a repeated heading's slug to its first section only, so a later section
	// bearing the same old slug records no aliases.
	const bore = new Set<string>();
	let aliased = false;
	return {
		enter(name: string, oldName: string) {
			section = name;
			old = oldName;
			aliased = !bore.has(oldName);
			bore.add(oldName);
		},
		put(suffix: string, range: Range) {
			const key = section + suffix;
			if (!out.has(key)) out.set(key, range);
			const oldKey = old + suffix;
			if (aliased && oldKey !== key && !alias.has(oldKey)) alias.set(oldKey, range);
		},
		// Replaces the range of a key this section already holds, as a growing page block does.
		set(suffix: string, range: Range) {
			out.set(section + suffix, range);
			if (aliased && old !== section) alias.set(old + suffix, range);
		}
	};
}

function scan(doc: string, kind: DocKind): Scan {
	if (kind === 'page') return scanPage(doc);
	const out = new Map<string, Range>();
	const alias = new Map<string, Range>();
	const rec = recorder(out, alias);
	const slugOf = sluggerFor(doc, kind);
	const lines = doc.split('\n');
	const scanned = fenceScan(lines);
	const front = frontmatterSpan(doc);
	let inSection = false;
	let n = 0;
	let row: { suffix: string; from: number } | null = null;
	let offset = 0;
	for (const [i, line] of lines.entries()) {
		const from = offset;
		offset += line.length + 1;
		if ((front && from < front.to) || scanned.inCode[i]) continue;
		const depth = scanned.depths[i];
		const role = scanned.roles[i];
		if (role === 'opener' && depth === 1) {
			if (inSection && directiveOpenerName(line) === 'row') {
				row = { suffix: `.p${n++}`, from };
			}
			continue;
		}
		if (role === 'closer' && depth === 1) {
			if (row) rec.put(row.suffix, [row.from, from + line.length]);
			row = null;
			continue;
		}
		if (depth !== null) {
			const part = row && PART.exec(line);
			if (row && part) rec.put(`${row.suffix}.${part[1].toLowerCase()}`, textSpan(line, from, part[0].length));
			continue;
		}
		const heading = HEADING.exec(line);
		if (heading) {
			const name = slugOf(heading[2]);
			rec.enter(name, oldSlug(heading[2]));
			inSection = true;
			n = 0;
			const [start, end] = heading.indices![2]!;
			if (name) rec.put('.heading', [from + start, from + end]);
			continue;
		}
		const item = ITEM.exec(line);
		if (item && inSection) rec.put(`.p${n++}`, textSpan(line, from, item[0].length));
	}
	return { out, alias };
}

interface PageBlock {
	suffix: string;
	start: number;
	kind: 'para' | 'item' | 'table';
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
 * directive containers and leaves count for nothing.
 */
function scanPage(doc: string): Scan {
	const out = new Map<string, Range>();
	const alias = new Map<string, Range>();
	const rec = recorder(out, alias);
	const slugOf = sluggerFor(doc, 'page');
	const lines = doc.split('\n');
	const scanned = fenceScan(lines);
	const front = frontmatterSpan(doc);
	let inSection = false;
	let n = 0;
	let block: PageBlock | null = null as PageBlock | null;
	// The block a blank line closed, which an indented line right after the blank still belongs to.
	let item = null as PageBlock | null;
	let offset = 0;
	const open = (kind: PageBlock['kind'], start: number): PageBlock => ({ suffix: `.p${n++}`, start, kind });
	// A block grows line by line, so its range is set again as each line joins it.
	const extend = (b: PageBlock, line: string, from: number) => {
		const tail = TRAILING_FACTS.exec(line);
		rec.set(b.suffix, [b.start, from + (tail ? tail.index : line.trimEnd().length)]);
	};
	for (const [i, line] of lines.entries()) {
		const from = offset;
		offset += line.length + 1;
		if ((front && from < front.to) || scanned.inCode[i] || CODE_DELIMITER.test(line) || scanned.depths[i] !== null || directiveLineKind(line) === 'leaf') {
			block = item = null;
			continue;
		}
		const heading = HEADING.exec(line);
		if (heading) {
			block = item = null;
			const name = slugOf(heading[2]);
			rec.enter(name, oldSlug(heading[2]));
			inSection = true;
			n = 0;
			const [start, end] = heading.indices![2]!;
			if (name) rec.put('.heading', [from + start, from + end]);
			continue;
		}
		if (line.trim() === '') {
			item = block?.kind === 'item' ? block : null;
			block = null;
			continue;
		}
		if (!inSection || RULE.test(line)) {
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
	return { out, alias };
}

/** Places each note on its anchor's range; a note whose anchor names nothing gets a null range. */
export function placeNotes(doc: string, notes: readonly Note[], kind: DocKind = 'blueprint'): PlacedNote[] {
	const found = anchors(doc, kind);
	return notes.map((note) => {
		const { anchor } = note;
		if (typeof anchor === 'string') return { ...note, range: found.get(anchor) ?? null };
		const at = place(doc, { quote: anchor.quote, prefix: anchor.prefix ?? '', suffix: anchor.suffix ?? '', from: 0, to: 0, commit: '' });
		return { ...note, range: at ? ([at.from, at.to] as Range) : null };
	});
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
