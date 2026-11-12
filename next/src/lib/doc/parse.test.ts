import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CHECKS } from '#lib/doc/faults.ts';
import { parse } from '#lib/doc/parse.ts';
import type { Doc, Question } from '#lib/doc/types.ts';

const MOCKUP = new URL('../../../../docs/mockup/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, MOCKUP), 'utf8');

const questions = (doc: Doc) => doc.segments.filter((s): s is Question => s.type === 'question');
const recommended = (q: Question) => q.options.filter((o) => o.recommended).map((o) => o.label);

const HEADER = '---\nkind: decide\napprove: I record it.\nsendback: Nothing is recorded.\n---\n';

interface Expected {
	file: string;
	kind: string;
	title: string;
	summary: string;
	labels: string[];
	recommended: string[];
}

const DOCUMENTS: Expected[] = [
	{
		file: 'content/10-merge-gaps.md',
		kind: 'merge',
		title: 'Merge the busy-check fix and the round rules with three known gaps?',
		summary:
			'Three workstation pull requests are ready to merge. The first (#230) stops the busy check from calling a worktree busy when nothing is running in it. The second (#231) makes the monthly pass report count how often a plan was wrong. The third (#232) writes the rules for unattended rounds into the pass-core skill. A round is one approved design that a chain of sessions carries out without you. Each of the three questions below is about a gap one of them leaves. I recommend merging now and closing each gap later, and the first option in each question does that.',
		labels: [
			'Stray test processes',
			'The conductor and the busy check',
			'Three details left out of the round rules'
		],
		recommended: ['Merge as it is', 'Merge as written', 'Merge and add them later']
	},
	{
		file: 'content/20-survey-edit.md',
		kind: 'merge',
		title: 'Keep an edit to a file Survey owns, and accept a test with ten findings?',
		summary:
			'Two workstation pull requests are ready to merge. One of them raises two questions, and neither merges until you answer. The first, #233, updates the packet skill for rounds. The second, #234, makes the launch guard stricter. I recommend the first option in each.',
		labels: ['The edit to a file Survey owns', 'The test with ten findings'],
		recommended: ['Keep the edit', 'Accept the test']
	},
	{
		file: 'content/30-round-report.md',
		kind: 'report',
		title: 'The rules for unattended rounds are now in force on this machine',
		summary:
			"Every session that plans, runs, or conducts a pass now reads the round rules from the pass-core skill, and the launch guard refuses a plan that has no Evidence: line. That guard change stops 17 older plans from launching. The busy check no longer mistakes a finished session for a running one. Getting here took five pull requests, workstation #230 to #234, all merged on 2026-11-12. One of them stopped for six hours on a mistake in its plan, the plans were wrong 16 times in all, and the week's usage ended at 89 percent. Nothing is waiting for you.",
		labels: [],
		recommended: []
	},
	{
		file: 'content/40-queue-design.md',
		kind: 'design',
		title: 'Rebuild the Approval Queue so every item is one document its session wrote?',
		summary:
			'Approving this design starts a rewrite of the Approval Queue. Today the queue has a separate page, with separate rules, for each of packets, designs, triage lists, reports, and digest lines. After the rewrite it has one page, and that page shows a document. A session writes the document as one Markdown file and marks the questions in it. The queue shows it with the notes margin beside it. The design leaves you one question, about the workstation\'s freeze, and I recommend its first option.',
		labels: ['The removals-only freeze'],
		recommended: ['Count the skill changes as part of the overhaul']
	},
	{
		file: 'content/50-backlog.md',
		kind: 'decide',
		title: 'Close the backlog items the queue rewrite makes moot, and write the rest into its design?',
		summary:
			'The Approval Queue has 13 open backlog items. Ten describe a fault in something the rewrite removes, so I recommend closing each when the rewrite merges. Three describe a fault the rewrite could repeat, and I recommend writing each into the design as a requirement.',
		labels: [
			'The lost approve (#71)',
			'One layout and one notes margin (#70)',
			'The report page (#69)',
			"The report's landed list (#68)",
			'The reply message on a report (#67)',
			'The round on a recorded merge (#66)',
			'The order of the next item (#65)',
			'The wording on a stopped pass (#64)',
			'The unchecked design approve (#62)',
			'The Undo toasts (#38)',
			'The restart rollback (#63)',
			'Withdrawing a decided item (#49)',
			'Reading a decision that is taken back (#41)'
		],
		recommended: [
			...Array<string>(10).fill('Close it'),
			...Array<string>(3).fill('Write it into the design')
		]
	}
];

describe('the five documents', () => {
	for (const want of DOCUMENTS) {
		it(`parses ${want.file}`, () => {
			const { doc, faults } = parse(read(want.file));
			expect(faults).toEqual([]);
			expect(doc.kind).toBe(want.kind);
			expect(doc.title).toBe(want.title);
			expect(doc.summary).toBe(want.summary);
			const qs = questions(doc);
			expect(qs.map((q) => q.label)).toEqual(want.labels);
			expect(qs.map((q) => q.options.length)).toEqual(want.labels.map(() => 2));
			expect(qs.map(recommended)).toEqual(want.recommended.map((r) => [r]));
			expect(qs.map((q) => q.id)).toEqual(want.labels.map((_, i) => `q${i + 1}`));
			expect(doc.questions).toBe(want.labels.length);
		});
	}

	it('gives each question its line in the file', () => {
		const { doc } = parse(read('content/10-merge-gaps.md'));
		expect(questions(doc).map((q) => q.line)).toEqual([16, 24, 32]);
	});
});

describe('the specimens', () => {
	it('parses both with no fault', () => {
		expect(parse(read('specimen/long.md')).faults).toEqual([]);
		const { doc, faults } = parse(read('specimen/markdown.md'));
		expect(faults).toEqual([]);
		expect(doc.title).toBe('Every form of Markdown a document can use');
	});

	it('addresses every heading of markdown.md', () => {
		const { doc } = parse(read('specimen/markdown.md'));
		const ids = [
			'every-form-of-markdown-a-document-can-use',
			'text',
			'headings',
			'a-third-level-heading',
			'a-fourth-level-heading',
			'a-fifth-level-heading',
			'a-sixth-level-heading',
			'lists',
			'tables',
			'quotations',
			'code',
			'rules',
			'raw-html',
			'a-folded-section',
			'images'
		];
		expect(doc.headings.map((h) => h.id)).toEqual(ids);
		expect(doc.headings[0]).toEqual({
			id: 'every-form-of-markdown-a-document-can-use',
			level: 1,
			text: 'Every form of Markdown a document can use'
		});
		expect(doc.titleId).toBe('every-form-of-markdown-a-document-can-use');
		expect(doc.headings.map((h) => h.level)).toEqual([1, 2, 2, 3, 4, 5, 6, 2, 2, 2, 2, 2, 2, 3, 2]);
		const html = doc.segments.map((s) => (s.type === 'html' ? s.html : '')).join('');
		for (const id of ids.slice(1)) expect(html).toContain(` id="${id}"`);
	});
});

describe('addresses', () => {
	it('adds -1 and -2 to a repeated heading', () => {
		const src = `${HEADER}# Notes\n\nA first paragraph.\n\n## Notes\n\nOne.\n\n## Notes\n\nTwo.\n\n## Notes\n\nThree.\n`;
		const { doc } = parse(src);
		expect(doc.titleId).toBe('notes');
		expect(doc.headings.map((h) => h.id)).toEqual(['notes', 'notes-1', 'notes-2', 'notes-3']);
	});

	it('gives three repeated body headings notes, notes-1, and notes-2', () => {
		const src = `${HEADER}# A title\n\nA first paragraph.\n\n## Notes\n\nOne.\n\n## Notes\n\nTwo.\n\n## Notes\n\nThree.\n`;
		const { doc } = parse(src);
		expect(doc.headings.map((h) => h.id)).toEqual(['a-title', 'notes', 'notes-1', 'notes-2']);
	});

	it('forms an address from the plain text alone', () => {
		const src = `${HEADER}# A title\n\nA first paragraph.\n\n## The \`check\` command, *again*!\n\nText.\n\n## ???\n\nText.\n`;
		const { doc } = parse(src);
		expect(doc.headings.map((h) => h.id)).toEqual(['a-title', 'the-check-command-again', 'section']);
	});
});

describe('fences', () => {
	for (const fence of ['```', '~~~']) {
		it(`reads a question block inside a ${fence} fence as text`, () => {
			const src = `${HEADER}# A title\n\nA first paragraph.\n\n${fence}markdown\n:::question Inside a fence\n- **One** {recommended}\n- **Two**\n:::\n:::decide\n${fence}\n\nAfter.\n`;
			const { doc, faults } = parse(src);
			expect(faults).toEqual([]);
			expect(questions(doc)).toEqual([]);
			const html = doc.segments.map((s) => (s.type === 'html' ? s.html : '')).join('');
			expect(html).toContain('<pre>');
			expect(html).toContain(':::question Inside a fence');
			expect(html).toContain(':::decide');
			expect(doc.segments.filter((s) => s.type === 'decide')).toHaveLength(1);
			expect(doc.segments.at(-1)?.type).toBe('decide');
		});
	}
});

describe('the decide mark', () => {
	it('goes at the end when left out', () => {
		const { doc } = parse(read('content/30-round-report.md'));
		expect(doc.segments.at(-1)?.type).toBe('decide');
		expect(doc.segments.filter((s) => s.type === 'decide')).toHaveLength(1);
	});

	it('stays where the document puts it', () => {
		const { doc } = parse(read('content/10-merge-gaps.md'));
		const types = doc.segments.map((s) => s.type);
		expect(types.filter((t) => t === 'decide')).toHaveLength(1);
		const at = types.indexOf('decide');
		expect(at).toBe(types.lastIndexOf('question') + 1);
		expect(at).toBeLessThan(types.length - 1);
		expect(types.slice(at + 1)).toEqual(['html']);
	});
});

// Kept out of faults.test.ts, so that removing a check in check-mutations.sh fails only that check's own test.
it('runs one check per entry of CHECKS', () => {
	expect(CHECKS.length).toBe(14);
});

describe('the header', () => {
	it('reads the pull requests of a merge document in order', () => {
		const { doc } = parse(read('content/10-merge-gaps.md'));
		expect(doc.prs).toEqual([
			{ repo: 'glw907/workstation', number: 230, words: 'the busy-check fix', line: 4 },
			{ repo: 'glw907/workstation', number: 231, words: 'the planning-miss count in the pass report', line: 5 },
			{ repo: 'glw907/workstation', number: 232, words: 'the round rules', line: 6 }
		]);
	});

	it('reads a pull request item written without an indent', () => {
		const src = '---\nkind: merge\nprs:\n- glw907/workstation#7 | a fix\napprove: I merge it.\nsendback: Nothing merges.\n---\n# A title\n\nA first paragraph.\n';
		const { doc, faults } = parse(src);
		expect(faults).toEqual([]);
		expect(doc.prs).toEqual([{ repo: 'glw907/workstation', number: 7, words: 'a fix', line: 4 }]);
	});

	it('gives approve and sendback as text and inline HTML', () => {
		const { doc } = parse(read('content/20-survey-edit.md'));
		expect(doc.approve?.text).toBe(
			'I merge the packet-skill pull request, then the launch-guard one, pull `~/.dotfiles`, and write the round\'s report.'
		);
		expect(doc.approve?.html).toContain('<code>~/.dotfiles</code>');
		expect(doc.sendback?.text).toBe('Nothing merges. I answer each note and send the document back to you.');
	});

	it('gives a report no approve and no sendback', () => {
		const { doc } = parse(read('content/30-round-report.md'));
		expect(doc.approve).toBeNull();
		expect(doc.sendback).toBeNull();
	});
});

describe('options', () => {
	it('labels an option with no bold text by the whole option, less a final period', () => {
		const src = `${HEADER}# A title\n\nA first paragraph.\n\n:::question Plain options\n- Keep it as it is. {recommended}\n- Drop it\n:::\n`;
		const { doc, faults } = parse(src);
		expect(faults).toEqual([]);
		const [q] = questions(doc);
		expect(q.options.map((o) => o.label)).toEqual(['Keep it as it is', 'Drop it']);
		expect(q.options.map((o) => o.recommended)).toEqual([true, false]);
		expect(q.line).toBe(10);
	});
});
