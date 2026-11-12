export type Kind = 'merge' | 'design' | 'decide' | 'report';

export interface Option {
	html: string;
	label: string;
	recommended: boolean;
}

export type Segment =
	| { type: 'html'; html: string }
	| { type: 'question'; id: string; name: string; options: Option[] }
	| { type: 'decide' };

export interface PullRequest {
	number: number;
	name: string;
	url: string;
}

/** A heading the rail lists under "On this page". */
export interface Heading {
	id: string;
	level: 2 | 3;
	text: string;
}

export interface Doc {
	id: string;
	kind: Kind;
	repo: string;
	sent: string;
	returned?: string;
	prs: PullRequest[];
	approve: string;
	sendback: string;
	mock: string;
	titleHtml: string;
	title: string;
	summary: string;
	segments: Segment[];
	outline: Heading[];
	questions: number;
	changes: number;
}

export interface Entry {
	who: 'geoff' | 'claude';
	text: string;
	time: string;
	example?: boolean;
}

export interface Thread {
	id: string;
	quote: string;
	/** Offset of the quote in the page's text when the note was made. */
	start?: number;
	/** The words the note was first made on, when the passage has since changed. */
	was?: string;
	resolved?: boolean;
	entries: Entry[];
}

export interface Decision {
	type: 'approve' | 'sendback' | 'read';
	at: string;
	answers: Record<string, number>;
}

export interface DocState {
	answers: Record<string, number>;
	decision?: Decision;
	threads: Thread[];
}

export interface ListItem {
	id: string;
	kind: Kind;
	title: string;
	summary: string;
	repo: string;
	sent: string;
	returned?: string;
	questions: number;
	decision?: Decision;
}
