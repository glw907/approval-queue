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
	/** True when the returned version shares nothing with the one before, so no marks are drawn. */
	whole: boolean;
	/** The newest version's number, which a note opened on this page records. */
	version: number;
	prs: { number: number; words: string; url: string }[];
	approve: string | null;
	sendback: string | null;
	title: string;
	titleHtml: string;
	segments: Segment[];
	outline: OutlineHeading[];
	questions: number;
}

/** A row of the rail's "Decided today": a document decided or handed today, and its decision. */
export interface DecidedRow extends Row {
	action: 'approve' | 'sendback' | 'read';
	/** ISO time of the decision. */
	at: string;
}

/** The four states a document's records fold to. */
export type StateName = 'waiting' | 'decided' | 'handed' | 'withdrawn';

/** One answer as a decision records it: the option's index and its label as the page shows it. */
export interface RecordedAnswer {
	pick: number;
	label: string;
}

/** The decision a decided or handed document shows. */
export interface DecisionView {
	action: 'approve' | 'sendback' | 'read';
	at: string;
	answers?: Record<string, RecordedAnswer>;
}

/**
 * Where a document stands, as the page reads it at load and the server answers it after a write:
 * the folded state, the number of the decision record it rests on, and that decision.
 */
export interface DocStanding {
	state: StateName;
	/** The current decision's record number, or null while waiting or withdrawn. */
	n: number | null;
	/** How many records the document holds, so a waiting spell after an Undo differs from the one before. */
	seq: number;
	decision: DecisionView | null;
}

/** Who wrote a note entry: Geoff on the page, or a session through `reply`. */
export type Who = 'geoff' | 'claude';

export type Entry = { who: Who; text: string; at: string };

/** A note thread as the fold of a document's note records gives it. */
export type Thread = {
	/** The number of the record that opened it, which the page posts and never shows. */
	id: number;
	/** The passage the thread is about, as plain text. */
	quote: string;
	/** Where the quote starts in the page's text index, when the page that wrote it knew. */
	start?: number;
	/** The passage's words before a later version changed them. */
	was?: string;
	/** True when the passage is no longer in the document. */
	orphan?: boolean;
	resolved: boolean;
	entries: Entry[];
};

/**
 * The server's answer to a decision post: the standing after the write, and on a refusal the
 * sentence the page shows as its reason. `standing` is null when the document can't be read.
 */
export interface DecideAnswer {
	standing: DocStanding | null;
	message?: string;
	/** The document's threads after a note operation. */
	threads?: Thread[];
}

/** The most characters a note or a reply can hold, counted as code points. */
export const NOTE_LIMIT = 4000;

/** A note's length as the page, the server, and the command all count it: its code points. */
export const noteLength = (text: string) => [...text].length;
