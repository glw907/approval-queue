import type { Kind, Segment } from '#lib/doc/types.ts';

/** One waiting document as the rail and the front page list it. */
export interface Row {
	id: string;
	kind: Kind | null;
	/** Plain text with curly quotes. */
	title: string;
	summary: string;
	/** The tool the first pull request's repo holds, or null for a document with none. */
	tool: string | null;
	/** ISO time the document was created. */
	sent: string;
	/** ISO time of the newest version, for a document the session returned with changes. */
	returned?: string;
	questions: number;
}

export interface MergedLine {
	number: number;
	/** The sentence as inline HTML with curly quotes. */
	html: string;
	at: string;
}

/** The merged lines of one tool, newest first. */
export interface MergedGroup {
	tool: string;
	repo: string;
	lines: MergedLine[];
}

/** A heading "On this page" lists. */
export interface OutlineHeading {
	id: string;
	level: 2 | 3;
	text: string;
}

/** A document ready for its page, every HTML string already through `typeset`. */
export interface PageDoc {
	id: string;
	kind: Kind | null;
	tool: string | null;
	sent: string;
	returned?: string;
	/** The number of passages the returned version changed. */
	changes: number;
	prs: { number: number; words: string; url: string }[];
	approve: string | null;
	sendback: string | null;
	title: string;
	titleHtml: string;
	segments: Segment[];
	outline: OutlineHeading[];
	questions: number;
}
