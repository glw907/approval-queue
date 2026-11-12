import { KINDS, type Facts, type Fault, type Kind } from '#lib/doc/types.ts';

export const QUESTION_LIMIT = 30;
export const SIZE_LIMIT = 204_800;

const FOUR = 'The four kinds are merge, design, decide, and report.';

/** Header keys each kind needs, beyond `kind` itself. */
const REQUIRED: Record<Kind, string[]> = {
	merge: ['prs', 'approve', 'sendback'],
	design: ['approve', 'sendback'],
	decide: ['approve', 'sendback'],
	report: []
};

type Check = (facts: Facts) => Fault[];

const fault = (code: string, message: string, lines: number[] = []): Fault => ({ code, message, lines });

const noHeader: Check = (f) =>
	f.header
		? []
		: [
				fault(
					'no-header',
					'no header. A document starts with a header between two --- lines that sets "kind", one of merge, design, decide, or report.',
					[1]
				)
			];

const missingKey: Check = (f) => {
	if (!f.header) return [];
	const keys = f.header.keys;
	if (!keys.kind) return [fault('missing-key', `the header has no "kind", which every document needs. ${FOUR}`, [1])];
	const kind = keys.kind.value as Kind;
	if (!KINDS.includes(kind)) return [];
	return REQUIRED[kind]
		.filter((key) => (key === 'prs' ? f.prs.length === 0 : !keys[key]?.value))
		.map((key) => fault('missing-key', `the header has no "${key}", which a ${kind} document needs. ${FOUR}`, [1]));
};

const badKind: Check = (f) => {
	const kind = f.header?.keys.kind;
	if (!kind || (KINDS as readonly string[]).includes(kind.value)) return [];
	return [fault('bad-kind', `"${kind.value}" isn't a kind. ${FOUR}`, [kind.line])];
};

const badPr: Check = (f) =>
	f.prs
		.filter((p) => !p.pr)
		.map((p) =>
			fault('bad-pr', `"${p.text}" isn't a pull request. Write each as owner/repo#n, a bar, and a few plain words.`, [p.line])
		);

const noTitle: Check = (f) =>
	f.title?.ok ? [] : [fault('no-title', 'no title. The first line after the header is "# " and the title.', f.title ? [f.title.line] : [])];

const noParagraph: Check = (f) => {
	if (!f.title?.ok || f.firstBlock?.paragraph) return [];
	return [fault('no-paragraph', 'no first paragraph. A paragraph follows the title.', [f.firstBlock?.line ?? f.title.line])];
};

const openQuestion: Check = (f) =>
	f.questions
		.filter((q) => !q.closed)
		.map((q) => fault('open-question', `the question block "${q.label}" has no closing ::: line.`, [q.line]));

const noLabel: Check = (f) =>
	f.questions
		.filter((q) => !q.label)
		.map((q) => fault('no-label', 'a question block has no label. Write a few plain words after :::question.', [q.line]));

const optionCount: Check = (f) =>
	f.questions
		.filter((q) => q.options < 2 || q.options > 6)
		.map((q) =>
			fault('option-count', `the question block "${q.label}" has ${q.options} options. A question has two to six.`, [q.line])
		);

const twoRecommended: Check = (f) =>
	f.questions
		.filter((q) => q.recommended > 1)
		.map((q) =>
			fault(
				'two-recommended',
				`the question block "${q.label}" marks ${q.recommended} options {recommended}. One at most.`,
				[q.line]
			)
		);

const duplicateLabel: Check = (f) => {
	const first = new Map<string, number>();
	const out: Fault[] = [];
	for (const q of f.questions) {
		if (!q.label) continue;
		const seen = first.get(q.label);
		if (seen === undefined) first.set(q.label, q.line);
		else out.push(fault('duplicate-label', `two questions have the label "${q.label}".`, [seen, q.line]));
	}
	return out;
};

const secondDecide: Check = (f) =>
	f.decides
		.slice(1)
		.map((line) => fault('second-decide', 'a second :::decide mark. The buttons go at the first.', [f.decides[0], line]));

const tooManyQuestions: Check = (f) =>
	f.questions.length > QUESTION_LIMIT
		? [fault('too-many-questions', `the document has ${f.questions.length} questions. The limit is ${QUESTION_LIMIT}.`)]
		: [];

const tooLarge: Check = (f) =>
	f.bytes > SIZE_LIMIT
		? [fault('too-large', `the file is ${Math.ceil(f.bytes / 1024)} KB. The limit is ${SIZE_LIMIT / 1024} KB.`)]
		: [];

/**
 * Every fault check but the pull-request ones, in report order. Each entry sits on its own line, so
 * `scripts/check-mutations.sh` can remove one check by deleting one line.
 */
export const CHECKS: readonly Check[] = [
	noHeader,
	missingKey,
	badKind,
	badPr,
	noTitle,
	noParagraph,
	openQuestion,
	noLabel,
	optionCount,
	twoRecommended,
	duplicateLabel,
	secondDecide,
	tooManyQuestions,
	tooLarge
];

export function faults(facts: Facts): Fault[] {
	return CHECKS.flatMap((check) => check(facts));
}
