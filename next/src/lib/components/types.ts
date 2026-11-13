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
	decision: DecisionView | null;
}

/**
 * The server's answer to a decision post: the standing after the write, and on a refusal the
 * sentence the page shows as its reason. `standing` is null when the document can't be read.
 */
export interface DecideAnswer {
	standing: DocStanding | null;
	message?: string;
}
