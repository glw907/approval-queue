import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compare } from '#lib/doc/compare.ts';

const mockup = fileURLToPath(new URL('../../../../docs/mockup/', import.meta.url));
const read = (rel: string) => readFileSync(mockup + rel, 'utf8');

describe('compare, the second close packet', () => {
	const sent = read('versions/20-survey-edit.sent.md');
	const returned = read('content/20-survey-edit.md');

	// Typed from the record's hand marks (plan, task 3, test case 1).
	const expected = [
		{
			removed: 'Two answers needed before workstation #233 and #234 merge',
			added: 'Keep an edit to a file Survey owns, and accept a test with ten findings?',
			line: 9
		},
		{
			removed:
				'Both pull requests are ready. Both questions are about #233, and I recommend the first option in each.',
			added:
				'Two workstation pull requests are ready to merge. One of them raises two questions, and neither merges until you answer. The first, #233, updates the packet skill for rounds. The second, #234, makes the launch guard stricter. I recommend the first option in each.',
			line: 11
		},
		{
			removed: "because its branch is cut from #233's",
			added: "because #234 was built on top of #233 and can't merge before it",
			line: 17
		}
	];

	it('returns the three hand-marked passages in order', () => {
		const result = compare(sent, returned);
		expect(result.whole).toBe(false);
		expect(result.passages).toEqual(expected);
	});

	it('places each pair of marks in the returned source', () => {
		let marked = returned;
		for (const p of expected) {
			marked = marked.replace(p.added, `{--${p.removed}--}{++${p.added}++}`);
		}
		expect(compare(sent, returned).marked).toBe(marked);
		expect(marked).toContain("waits too, {--because its branch is cut from #233's--}{++because #234");
		expect(marked).toContain("can't merge before it++}.\n");
	});
});

describe('compare, a document with itself', () => {
	for (const name of ['10-merge-gaps', '30-round-report', '40-queue-design', '50-backlog']) {
		it(`finds no change in ${name}`, () => {
			const source = read(`content/${name}.md`);
			const result = compare(source, source);
			expect(result.passages).toEqual([]);
			expect(result.whole).toBe(false);
			expect(result.marked).toBe(source);
		});
	}
});

describe('compare, small documents', () => {
	it('sets whole when no block or clause is shared', () => {
		const sent = '---\nkind: report\n---\n# Apples\n\nApples are red and crisp.\n';
		const returned = '---\nkind: report\n---\n# Bananas\n\nBananas, when ripe, turn yellow.\n';
		const result = compare(sent, returned);
		expect(result.whole).toBe(true);
		expect(result.passages).toEqual([]);
	});

	it('marks only the changed clause of a long paragraph', () => {
		const sent =
			'# Notes\n\nThe queue holds every document, and each one has a header. The page shows the title, the first paragraph, and the questions.\n';
		const returned =
			'# Notes\n\nThe queue holds every document, and each one has a header. The screen shows the title, the first paragraph, and the questions.\n';
		const result = compare(sent, returned);
		expect(result.whole).toBe(false);
		expect(result.passages).toEqual([
			{ removed: 'The page shows the title', added: 'The screen shows the title', line: 3 }
		]);
	});

	it('pairs two adjacent changed paragraphs by position', () => {
		const sent = '# Weather\n\nThe cat sat still.\n\nThe sun rose early.\n\nThe end.\n';
		const returned = '# Weather\n\nA dog ran off.\n\nRain fell all day.\n\nThe end.\n';
		const result = compare(sent, returned);
		expect(result.whole).toBe(false);
		expect(result.passages).toEqual([
			{ removed: 'The cat sat still.', added: 'A dog ran off.', line: 3 },
			{ removed: 'The sun rose early.', added: 'Rain fell all day.', line: 5 }
		]);
	});

	it('gives one passage with empty removed text for an added paragraph', () => {
		const sent = '# Plan\n\nFirst paragraph stays.\n\nLast paragraph stays.\n';
		const returned =
			'# Plan\n\nFirst paragraph stays.\n\nA new paragraph arrives.\n\nLast paragraph stays.\n';
		const result = compare(sent, returned);
		expect(result.whole).toBe(false);
		expect(result.passages).toEqual([
			{ removed: '', added: 'A new paragraph arrives.', line: 5 }
		]);
		expect(result.marked).toBe(
			'# Plan\n\nFirst paragraph stays.\n\n{++A new paragraph arrives.++}\n\nLast paragraph stays.\n'
		);
	});
});
