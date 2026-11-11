import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decideCards, fingerprint, gate, readChoices, type Card } from './cards.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

/** PR #40's brief as a design doc, with one `### Decide:` block before its Worth knowing. */
const doc = `# A design\n\n${fixture('pr-40-brief.md')
	.replace('# Send every session-opened PR to approval\n\n', '')
	.replace('### Worth knowing', `${fixture('pr-41-variant.md')}\n### Worth knowing`)}\n## Design\n\nThe plan itself.\n`;

describe('decideCards', () => {
	it('raises no card for a brief with no Decide block', () => {
		expect(decideCards(fixture('pr-40-brief.md'))).toEqual([]);
	});

	it('raises no card for a text with no brief', () => {
		expect(decideCards('# d')).toEqual([]);
	});

	it('raises one card for a Decide block, with its source and choices', () => {
		const cards = decideCards(doc);
		expect(cards.map((c) => [c.kind, c.title])).toEqual([['decide', 'Which branch name to keep']]);
		expect(cards[0].source).toBe('The session, from the rename plan.');
		expect(cards[0].choices.map((c) => [c.label, c.recommended, c.sendBack])).toEqual([
			['Keep the old name', false, false],
			['Rename it', true, false]
		]);
		expect(fingerprint(cards)).toBe('decide:Which branch name to keep');
	});
});

describe('gate and readChoices', () => {
	const choice = (label: string, sendBack = false) => ({ label, sendBack, recommended: false });
	const cards: Card[] = [
		{ kind: 'decide', title: 'A', source: 's', text: 't', choices: [choice('Send it back', true), choice('Go on')] },
		{ kind: 'decide', title: 'B', source: 's', text: 't', choices: [choice('Yes'), choice('No')] }
	];

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
				{ title: 'A', choice: 'Go on' },
				{ title: 'B', choice: 'Yes' }
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

	it('accepts a post for a design with no cards', () => {
		expect(readChoices([], () => null)).toEqual({ ok: true, choices: [] });
	});
});
