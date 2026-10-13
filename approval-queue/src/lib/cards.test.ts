import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cardsFor, gate, readChoices } from './cards.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const pr41 = fixture('pr-41-body.md');
const rollup = JSON.parse(fixture('pr-41-pr.json')).statusCheckRollup;
const passing = rollup.map((r: object) => ({ ...r, conclusion: 'SUCCESS' }));

/** PR #41 with a review that asks for a fix and one `### Decide:` block. */
const variant = `${pr41.replace('## Before merge', `${fixture('pr-41-variant.md')}## Before merge`)}
## Review

The reminder skips a PR opened from a script. Verdict: \`fix\`.
`;

describe('cardsFor', () => {
	it('raises no card for a clean PR', () => {
		expect(cardsFor(fixture('pr-40-brief.md'), passing)).toEqual([]);
	});

	it('raises the failed check, then the Before merge step, for PR #41', () => {
		const cards = cardsFor(pr41, rollup);
		expect(cards.map((c) => [c.kind, c.title])).toEqual([
			['check', 'A check failed'],
			['before-merge', 'A step must run before merging']
		]);
		expect(cards[0].text).toContain('tool / app tests');
		expect(cards[0].choices.map((c) => [c.label, c.sendBack])).toEqual([
			['Send back to fix it', true],
			['Approve anyway', false]
		]);
		expect(cards[1].choices.some((c) => c.sendBack)).toBe(false);
	});

	it('orders the check, the review, the Before merge step, then the session’s Decide block', () => {
		const cards = cardsFor(variant, rollup);
		expect(cards.map((c) => c.kind)).toEqual(['check', 'review', 'before-merge', 'decide']);
		const decide = cards[3];
		expect(decide.title).toBe('Which branch name to keep');
		expect(decide.source).toBe('The session, from the rename plan.');
		expect(decide.choices.map((c) => [c.label, c.recommended, c.sendBack])).toEqual([
			['Keep the old name', false, false],
			['Rename it', true, false]
		]);
	});
});

describe('gate and readChoices', () => {
	const cards = cardsFor(pr41, rollup);

	it('locks Approve until every card has a pick, and while one is a send-back', () => {
		expect(gate(cards, []).locked).toBe(true);
		expect(gate(cards, [1]).open).toHaveLength(1);
		expect(gate(cards, [0, 0])).toMatchObject({ sendBack: true, locked: true });
		expect(gate(cards, [1, 0])).toMatchObject({ sendBack: false, locked: false });
	});

	it('accepts a complete post and names each card’s title and choice', () => {
		const post = new Map([['c0', '1'], ['c1', '0']]);
		expect(readChoices(cards, (f) => post.get(f))).toEqual({
			ok: true,
			choices: [
				{ title: 'A check failed', choice: 'Approve anyway' },
				{ title: 'A step must run before merging', choice: 'The session runs it, then merges' }
			]
		});
	});

	it('refuses a missing pick, a send-back pick, and an index out of range', () => {
		const read = (entries: [string, string][]) => {
			const post = new Map(entries);
			return readChoices(cards, (f) => post.get(f));
		};
		expect(read([['c1', '0']])).toMatchObject({ ok: false });
		expect(read([['c0', '0'], ['c1', '0']])).toMatchObject({ ok: false });
		expect(read([['c0', '5'], ['c1', '0']])).toMatchObject({ ok: false });
		expect(read([['c0', '-1'], ['c1', '0']])).toMatchObject({ ok: false });
	});

	it('accepts a post for a PR with no cards', () => {
		expect(readChoices([], () => null)).toEqual({ ok: true, choices: [] });
	});
});
