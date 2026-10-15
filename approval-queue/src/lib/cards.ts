import { beforeMerge } from '#lib/before-merge.ts';
import { parseBrief } from '#lib/brief.ts';
import { checksSummary, reviewVerdict } from '#lib/pr-summary.ts';

export interface CardChoice {
	label: string;
	/** Picking it returns the PR to the session instead of approving it. */
	sendBack: boolean;
	recommended: boolean;
}

/** One "Decide first" card; the app builds its own, and the brief's `### Decide:` blocks follow them. */
export interface Card {
	kind: 'check' | 'review' | 'before-merge' | 'decide';
	title: string;
	/** Where the card came from, printed after its text. */
	source: string;
	/** Markdown for the before-merge card (a session's own steps), plain prose with inline code otherwise. */
	text: string;
	choices: CardChoice[];
}

const SEND_BACK = 'Send back to fix it';

const choice = (label: string, sendBack = false, recommended = false): CardChoice => ({ label, sendBack, recommended });

/**
 * The cards a PR body and its checks raise, in the order the page shows them: a failed check, a
 * review that asks for a fix, a Before merge step, then the session's own Decide blocks. The page and
 * the `approve` action both call this, so the server checks the same list the reader saw.
 */
export function cardsFor(body: string, rollup: Parameters<typeof checksSummary>[0]): Card[] {
	const cards: Card[] = [];
	const failed = checksSummary(rollup).rows.filter((r) => r.state === 'fail');
	if (failed.length > 0) {
		cards.push({
			kind: 'check',
			title: 'A check failed',
			source: 'Found automatically',
			text: `Failed on the latest commit: ${failed.map((r) => r.name).join(', ')}.`,
			choices: [choice(SEND_BACK, true), choice('Approve anyway')]
		});
	}
	const verdict = reviewVerdict(body);
	if (verdict === 'fix' || verdict === 'escalate') {
		cards.push({
			kind: 'review',
			title: verdict === 'fix' ? 'The review asks for a fix' : 'The review escalated this',
			source: 'From the review',
			text:
				verdict === 'fix'
					? 'The review’s verdict is fix. Its notes are under Evidence.'
					: 'The review’s verdict is escalate: it needs your judgment. Its notes are under Evidence.',
			choices: [choice(SEND_BACK, true), choice('Approve anyway')]
		});
	}
	const merge = beforeMerge(body);
	if (merge !== null) {
		cards.push({
			kind: 'before-merge',
			title: 'A step must run before merging',
			source: 'From the session',
			text: merge,
			choices: [choice('The session runs it, then merges'), choice('I’ll run it myself')]
		});
	}
	return [...cards, ...decideCards(body)];
}

/** The cards a brief's `### Decide:` blocks raise; a design item has only these. A text with no brief raises none. */
export function decideCards(text: string): Card[] {
	const brief = parseBrief(text);
	if (!brief.ok) return [];
	return brief.brief.decides.map((block) => ({
		kind: 'decide',
		title: block.title,
		source: block.source ?? 'From the session',
		text: block.text,
		choices: block.choices.map((c) => choice(c.label, false, c.recommended))
	}));
}

/** Names the card list a page showed, so a post made against a different list is refused rather than shifted. */
export const fingerprint = (cards: readonly Card[]) => cards.map((c) => `${c.kind}:${c.title}`).join('|');

export type Choices = { ok: true; choices: Array<{ title: string; choice: string }> } | { ok: false; message: string };

/**
 * Reads each card's pick from the post (field `c<card>`, value the choice's index) and refuses
 * unless every card has a valid pick and none is a send-back choice.
 */
export function readChoices(cards: readonly Card[], read: (field: string) => unknown): Choices {
	const choices: Array<{ title: string; choice: string }> = [];
	for (const [i, card] of cards.entries()) {
		const raw = read(`c${i}`);
		const at = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : -1;
		const picked = card.choices[at];
		if (!picked) return { ok: false, message: `Decide “${card.title}” first` };
		if (picked.sendBack) return { ok: false, message: `“${card.title}” is set to send back` };
		choices.push({ title: card.title, choice: picked.label });
	}
	return { ok: true, choices };
}

/** What the picks so far allow: Approve needs every card picked and none sent back. */
export function gate<T extends Card>(cards: readonly T[], picks: ReadonlyArray<number | undefined>) {
	const open = cards.filter((_, i) => picks[i] === undefined);
	const sendBack = cards.some((card, i) => picks[i] !== undefined && card.choices[picks[i]!]?.sendBack);
	return { open, sendBack, locked: open.length > 0 || sendBack };
}
