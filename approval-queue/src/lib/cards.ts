import { parseBrief } from '#lib/brief.ts';

export interface CardChoice {
	label: string;
	/** Picking it returns the PR to the session instead of approving it. */
	sendBack: boolean;
	recommended: boolean;
}

/** One "Decide first" card, from a brief's `### Decide:` block. */
export interface Card {
	kind: 'decide';
	title: string;
	/** Where the card came from, printed after its text. */
	source: string;
	/** Plain prose with inline code. */
	text: string;
	choices: CardChoice[];
}

const choice = (label: string, sendBack = false, recommended = false): CardChoice => ({ label, sendBack, recommended });

/** The cards a brief's `### Decide:` blocks raise. A text with no brief raises none. */
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
