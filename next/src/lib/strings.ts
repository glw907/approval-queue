/**
 * Every string the queue's pages show, copied from the mockup in `docs/mockup/src/`.
 *
 * @remarks
 * A component or route imports what it shows from here and holds no sentence of its own, which
 * `components/strings.test.ts` checks. A changed or added string goes through the writing process
 * before it merges (`.claude/rules/pages.md`). The file also holds the strings that only passes A4
 * and A5 draw, so neither has to edit it.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

/** "today at 08:16", or "on 11 November at 21:25" for another day. */
export function when(iso: string, now = new Date()): string {
	const d = new Date(iso);
	const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
	if (d.toDateString() === now.toDateString()) return `today at ${time}`;
	return `on ${d.getDate()} ${MONTHS[d.getMonth()]} at ${time}`;
}

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

/** A count as a capitalized word up to ten, as digits past it. */
export const count = (n: number) => WORDS[n] ?? String(n);

/** "Two questions", "One question". */
export const plural = (n: number, one: string, many = one + 's') => `${count(n)} ${n === 1 ? one : many}`;

export const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The names Geoff uses for the tools the repos hold. */
export const TOOLS: Record<string, string> = {
	'glw907/workstation': 'Workstation',
	'glw907/approval-queue': 'Approval Queue',
	'glw907/standards': 'Standards'
};

/** The name of the tool a repo holds: "Workstation" for "glw907/workstation", else the repo's name. */
export const toolName = (repo: string) => TOOLS[repo] ?? repo.split('/')[1] ?? repo;

export const APP = 'Approval Queue';

export const LAYOUT = {
	openRail: 'Open the list of documents',
	closeRail: 'Close the list of documents',
	rail: 'Documents',
	toDecide: (n: number) => `${n} to decide`,
	onThisPage: 'On this page',
	outstanding: 'Outstanding decisions',
	noneOutstanding: 'No decisions are outstanding.',
	reports: 'Reports',
	merged: 'Recently merged PRs',
	readMerged: 'Read what each one changed',
	decidedToday: 'Decided today',
	/** The second line of a decided row in the rail, as the mockup draws it. */
	decidedNote: (action: keyof typeof DECIDED, at: string) => `${DECIDED[action]} ${when(at)}`
};

/** The second line of a decided row in the rail (pass A4). */
export const DECIDED = { approve: 'Approved', sendback: 'Sent back', read: 'Read' } as const;

/** The second line of a waiting row in the rail: the tool it comes from and how much it asks. */
export function railNote(tool: string | null, questions: number, sent: string): string {
	if (!tool) return capital(`${when(sent)}.`) + (questions ? ` ${plural(questions, 'question')}.` : '');
	if (!questions) return tool;
	return `${tool}, ${plural(questions, 'question').toLowerCase()}`;
}

export const FRONT = {
	title: APP,
	noneOutstanding: 'No decisions are outstanding. A document appears here when a session sends one.',
	reports: 'Reports',
	merged: 'Recently merged PRs',
	mergedNote:
		'A session merges a pull request itself when the pull request leaves you nothing to decide and its checks and review have passed.',
	mergedLink: (pr: number, at: string) => `#${pr}, ${when(at)}`
};

/** The small line under a row on the front page: where the document came from, when, and how much it asks. */
export function rowLine(item: { tool: string | null; sent: string; returned?: string; questions: number }): string {
	let s = item.tool ? `${item.tool}, ${when(item.sent)}.` : capital(`${when(item.sent)}.`);
	if (item.returned) s += ` The session returned it with changes ${when(item.returned)}.`;
	if (item.questions) s += ` ${plural(item.questions, 'question')}.`;
	return s;
}

export const DOC = {
	pageTitle: (title: string) => `${title} | ${APP}`,
	missing: 'The queue has no document at this address.',
	sent: (tool: string | null, at: string) => (tool ? `A session in ${tool} sent this ${when(at)}.` : `A session sent this ${when(at)}.`),
	returned: (at: string, changes: number) =>
		`You sent this back with notes. It came back ${when(at)} with ${plural(changes, 'passage').toLowerCase()} changed.`,
	showChanges: 'Show what changed',
	merges: (n: number, tool: string) =>
		`Approving this merges ${plural(n, 'pull request').toLowerCase()} into ${tool}${n > 1 ? ', in this order:' : ':'}`,
	prLine: (i: number, words: string, number: number) => `${i}. ${capital(words)} (#${number})`,
	prLink: (number: number) => `Read the changes in #${number} on GitHub`,
	recommended: 'Recommended',
	decision: 'Your decision',
	approved: (at: string) => `You approved this ${when(at)}.`,
	sentBack: (at: string) => `You sent this back ${when(at)}.`,
	markedRead: (at: string) => `You marked this read ${when(at)}.`,
	recorded: 'The queue has recorded it.',
	undoApprove: 'Undo the approval',
	undoSendback: 'Undo the send-back',
	markUnread: 'Mark as unread',
	reportHeading: 'This report has no questions.',
	reportNote: 'Mark it as read to take it off your list. The session gets any notes you leave either way.',
	markRead: 'Mark as read',
	/** Where the reader stands on a document's questions (pass A4). */
	standing(total: number, answered: number, differing: number): string {
		if (!total) return '';
		const n = count(total).toLowerCase();
		if (answered < total) return `You have answered ${count(answered).toLowerCase()} of ${n} questions.`;
		if (total === 1) return differing ? 'Your answer differs from the recommended one.' : 'The question is set to the recommended answer.';
		if (!differing) return `${total === 2 ? 'Both' : `All ${n}`} questions are set to the recommended answer.`;
		return `${plural(differing, 'answer')} of ${n} ${differing === 1 ? 'differs' : 'differ'} from the recommended one.`;
	},
	answers: 'Your answers',
	notAnswered: 'Not answered yet',
	notRecommended: '(not the recommended answer)',
	approve: 'Approve',
	approveWithAnswers: 'Approve with the answers selected above',
	sendBack: 'Send back with my notes',
	notesWaiting: (n: number) => `You have ${plural(n, 'note').toLowerCase()} waiting for an answer.`,
	noNotesWaiting: 'You have no notes waiting for an answer. To write one, select any words in the document.',
	queueDown: "The queue isn't running.",
	answerUnsent: "Your answer shows on this page but isn't saved. If you reload the page, you lose it.",
	readUnsent: "The report isn't marked as read. Start the queue, and then select Mark as read again.",
	decisionUnsent: "Your decision wasn't recorded, and the session hasn't seen it. Start the queue, and then choose again.",
	undoUnsent: 'Your decision still stands. Start the queue, and then undo it again.',
	/** The strings below are pass A4's, which the mockup doesn't draw. */
	tryAgain: 'Try again',
	tooSlow: "The queue didn't answer within 10 seconds.",
	handoffBefore: "The session picks up your decision 20 seconds after you make it, if it's waiting. Until then, you can undo it.",
	handoffAfter: "The session has picked up your decision, so it can't be undone.",
	undoLate: 'The session picked up your decision before your Undo reached the queue, so your decision stands.',
	withdrawn: "The session withdrew this document, so there's nothing left to decide.",
	/** Spoken only, when another tab undoes the decision this page shows. */
	reopened: 'Your decision was undone in another tab. This document is open again.',
	/** Spoken only, when an Undo on this page is recorded. */
	undone: 'Your decision is undone. This document is open again.',
	unanswered: (labels: string[]) => `Answer ${joinAnd(labels)} first.`,
	headsMissing: "The queue has no record of the commits the session sent, so you can't approve this.",
	notSaved: (detail: string) => `The queue couldn't save it: ${detail}`,
	refused: "The queue is running but didn't record this. The reason is below.",
	nothingToUndo: "There's no decision to undo.",
	specimen: "This page shows how a document looks, so you can't decide anything on it.",
	badOrigin: 'The queue takes decisions only from pages it serves.',
	badRequest: "The page sent a request the queue can't read.",
	badAction: "The page asked for a decision this document can't take.",
	badAnswer: "The page sent an answer to a question this document doesn't ask.",
	alreadyDecided: 'You have already decided this document. To change the decision, undo it first.'
};

/** "a", "a and b", "a, b, and c". */
export function joinAnd(items: string[]): string {
	if (items.length < 3) return items.join(' and ');
	return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

export const NOTES = {
	margin: 'Notes',
	hint: 'To write a note, select any words in the document.',
	heading: 'Notes',
	close: 'Close the notes',
	closeSheet: 'Close',
	open: (n: number) => (n === 1 ? '1 open note' : `${n} open notes`),
	addNote: 'Add a note',
	saveNote: 'Add note',
	cancel: 'Cancel',
	draftLabel: 'Your note on the highlighted passage',
	draftPlaceholder: 'Write your note',
	replyLabel: 'Your reply',
	replyPlaceholder: 'Reply',
	reply: 'Reply',
	resolve: 'Resolve',
	reopen: 'Reopen',
	delete: 'Delete',
	resolved: 'Resolved',
	orphan: 'The passage this note is about is no longer in the document. It read:',
	was: 'Before the edit, this read:',
	geoff: 'Geoff',
	claude: 'Claude',
	example: ', an example',
	unsaved: "The queue isn't running, so your note wasn't saved. What you wrote is still here."
};
