// The review notes a docs review carries and the quote anchors that tie each one to its page. Pure
// functions, shared by the server (which places the anchors once for the page) and the editor.
import { place } from './comments.ts';
import { fenceScan, frontmatterSpan } from './directives.ts';

export type NoteKind = 'info' | 'decide' | 'question';

export interface NoteChoice {
	label: string;
	/** What the note says once this choice is made. */
	done: string;
}

/** One note, in the shape of the contract's notes file. */
export interface Note {
	id: string;
	/** The changed page the anchor belongs to, as its path at the PR's head. */
	file: string;
	/** `info` is a correction already made; `decide` and `question` are calls for the reader. */
	kind: NoteKind;
	/** A quote the page holds, with optional context to settle a repeat. */
	anchor: { quote: string; prefix?: string; suffix?: string };
	title: string;
	body: string[];
	was?: string;
	now?: string;
	sides?: Array<{ who: string; text: string }>;
	choices?: NoteChoice[];
}

/** A character range in the page, end exclusive. */
export type Range = [number, number];

/** A note with the range its anchor resolved to; a collapsed range at the top when the quote is gone. */
export type PlacedNote = Note & { range: Range };

/** Whether a note asks the reader for a choice. */
export const isCall = (note: Note) => note.kind !== 'info';

/**
 * Places each note at the one place its `prefix + quote + suffix` occurs, else at the first
 * occurrence of the quote, else at the top of the page, where the empty range draws no highlight.
 */
export function placeNotes(doc: string, notes: readonly Note[]): PlacedNote[] {
	return notes.map((note) => {
		const { quote, prefix = '', suffix = '' } = note.anchor;
		const at = place(doc, { quote, prefix, suffix, from: 0, to: 0, commit: '', file: note.file });
		return { ...note, range: at ? [at.from, at.to] : [0, 0] };
	});
}

/** One `##` or `###` heading, for the outline. */
export interface Heading {
	/** The heading line's start. */
	pos: number;
	level: 2 | 3;
	text: string;
}

const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/d;

/** The page's second- and third-level headings, outside front matter, code, and containers. */
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
