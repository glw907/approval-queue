// The comment margin's layout: each card at its anchor's line, stacked so none overlaps another.
// Pure, so the stacking is tested without a browser.

/** Above this width the margin sits beside the page; below it, it is a drawer. */
export const WIDE_MARGIN = '(min-width: 1260px)';

/** Space between two stacked cards, round 6's 12px. */
export const CARD_GAP = 12;

export interface CardBox {
	key: string;
	/** Where the card wants its top: its anchor's line, in the margin's own coordinates. */
	y: number;
	h: number;
}

/**
 * Each card's top. The current card sits at its own line, the cards below it stack downward from
 * it, and the cards above it stack upward; a stack that runs past `floor` is pushed back down from
 * there. With no current card the first card anchors the stack.
 */
export function stack(cards: readonly CardBox[], current: string | null, gap = CARD_GAP, floor = 0): Record<string, number> {
	const it = [...cards].sort((p, q) => p.y - q.y);
	if (!it.length) return {};
	const top: number[] = [];
	const a = Math.max(0, it.findIndex((c) => c.key === current));
	top[a] = Math.max(floor, it[a].y);
	for (let i = a + 1; i < it.length; i++) top[i] = Math.max(it[i].y, top[i - 1] + it[i - 1].h + gap);
	for (let i = a - 1; i >= 0; i--) top[i] = Math.min(it[i].y, top[i + 1] - it[i].h - gap);
	for (let i = 0; i < it.length; i++) top[i] = Math.max(top[i], i ? top[i - 1] + it[i - 1].h + gap : floor);
	return Object.fromEntries(it.map((c, i) => [c.key, top[i]]));
}
