export const KINDS = ['merge', 'design', 'decide', 'report'] as const;
export type Kind = (typeof KINDS)[number];

export interface PullRequest {
	/** `owner/repo`. */
	repo: string;
	number: number;
	/** The plain words the page shows in place of the number alone. */
	words: string;
	line: number;
}

/** A header sentence the page prints on a button. */
export interface ButtonText {
	text: string;
	html: string;
}

export interface Option {
	html: string;
	/** The option's bold text, or the whole option when it has none, without a final period. */
	label: string;
	recommended: boolean;
}

export interface Question {
	type: 'question';
	/** `q1`, `q2`, and on, in document order. */
	id: string;
	label: string;
	line: number;
	options: Option[];
}

export type Segment = { type: 'html'; html: string } | Question | { type: 'decide' };

export interface Heading {
	id: string;
	level: 1 | 2 | 3 | 4 | 5 | 6;
	text: string;
}

export interface Doc {
	/** Null when the header sets no kind or one that isn't among the four. */
	kind: Kind | null;
	prs: PullRequest[];
	approve: ButtonText | null;
	sendback: ButtonText | null;
	title: string;
	titleHtml: string;
	titleId: string;
	/** The first paragraph as plain text, or empty when the title isn't followed by one. */
	summary: string;
	/** Always holds exactly one decide segment, at the end when the document leaves it out. */
	segments: Segment[];
	/** Every heading in document order, the title first at level 1. */
	headings: Heading[];
	questions: number;
}

export interface Fault {
	code: string;
	message: string;
	/** Zero, one, or two line numbers in the file, counted from 1. */
	lines: number[];
}

/** What the parser saw, in the form the fault checks read. Line numbers count from 1. */
export interface Facts {
	bytes: number;
	/** Null when the file doesn't open with a header between two `---` lines. */
	header: { keys: Record<string, { value: string; line: number }> } | null;
	/** Each list item under `prs`, with its parsed form or null when it isn't one. */
	prs: { text: string; line: number; pr: PullRequest | null }[];
	/** The first non-blank line after the header, or the line after the header when the body is blank. */
	title: { line: number; ok: boolean };
	/** The first block after a well-formed title, or null when nothing follows it. */
	firstBlock: { line: number; paragraph: boolean } | null;
	questions: { label: string; line: number; closed: boolean; options: number; recommended: number }[];
	decides: number[];
}
