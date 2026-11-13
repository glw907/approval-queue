import { describe, expect, it } from 'vitest';
import { parse } from '#lib/doc/parse.ts';
import type { Fault } from '#lib/doc/types.ts';

const DECIDE = 'kind: decide\napprove: I record it.\nsendback: Nothing is recorded.';
const doc = (header: string, body: string) => `---\n${header}\n---\n${body}`;
const BODY = '# A title\n\nA first paragraph.\n';
const question = (label: string, options = 2, recommended = 1) =>
	[
		`:::question ${label}`,
		...Array.from({ length: options }, (_, i) => `- **Option ${i + 1}** words.${i < recommended ? ' {recommended}' : ''}`),
		':::',
		''
	].join('\n');

/** The one fault a document has, failing when it has none or more than one. */
function only(source: string): Fault {
	const { faults } = parse(source);
	expect(faults.map((f) => f.code)).toHaveLength(1);
	return faults[0];
}

describe('a clean document', () => {
	it('has no fault', () => {
		expect(parse(doc(DECIDE, `${BODY}\n${question('A label')}`)).faults).toEqual([]);
	});
});

describe('the header', () => {
	it('no-header', () => {
		const f = only(BODY);
		expect(f.code).toBe('no-header');
		expect(f.message).toContain('no header');
		expect(f.message).toContain('"kind"');
		expect(f.message).toContain('merge, design, decide, or report');
		expect(f.lines).toEqual([1]);
	});

	it('missing-key for kind', () => {
		const f = only(doc('approve: I record it.\nsendback: Nothing is recorded.', BODY));
		expect(f.code).toBe('missing-key');
		expect(f.message).toContain('"kind"');
		expect(f.message).toContain('merge, design, decide, and report');
		expect(f.lines).toEqual([1]);
	});

	it('missing-key for prs in a merge document', () => {
		const f = only(doc('kind: merge\napprove: I merge it.\nsendback: Nothing merges.', BODY));
		expect(f.code).toBe('missing-key');
		expect(f.message).toContain('"prs"');
		expect(f.message).toContain('a merge document');
		expect(f.lines).toEqual([1]);
	});

	it('missing-key for approve in a design document', () => {
		const f = only(doc('kind: design\nsendback: Nothing is planned.', BODY));
		expect(f.code).toBe('missing-key');
		expect(f.message).toContain('"approve"');
		expect(f.message).toContain('a design document');
		expect(f.lines).toEqual([1]);
	});

	it('missing-key for sendback in a decide document', () => {
		const f = only(doc('kind: decide\napprove: I record it.', BODY));
		expect(f.code).toBe('missing-key');
		expect(f.message).toContain('"sendback"');
		expect(f.message).toContain('a decide document');
		expect(f.lines).toEqual([1]);
	});

	it('bad-kind', () => {
		const f = only(doc('kind: packet\napprove: I do it.\nsendback: Nothing.', BODY));
		expect(f.code).toBe('bad-kind');
		expect(f.message).toContain('"packet"');
		expect(f.message).toContain('merge, design, decide, and report');
		expect(f.lines).toEqual([2]);
	});

	it('bad-pr', () => {
		const header = 'kind: merge\nprs:\n  - glw907/workstation#230 | the fix\n  - 233 | the packet skill\napprove: I merge it.\nsendback: Nothing merges.';
		const f = only(doc(header, BODY));
		expect(f.code).toBe('bad-pr');
		expect(f.message).toContain('"233 | the packet skill"');
		expect(f.message).toContain('owner/repo#n');
		expect(f.lines).toEqual([5]);
	});

	it('gives a report with no approve no fault', () => {
		expect(parse(doc('kind: report', BODY)).faults).toEqual([]);
	});

	it('ignores a header key it does not know', () => {
		expect(parse(doc(`${DECIDE}\ncolor: blue`, BODY)).faults).toEqual([]);
	});
});

describe('the title and the first paragraph', () => {
	it('no-title', () => {
		const f = only(doc(DECIDE, 'Some text first.\n\n# A title\n\nA first paragraph.\n'));
		expect(f.code).toBe('no-title');
		expect(f.message).toContain('no title');
		expect(f.message).toContain('"# "');
		expect(f.lines).toEqual([6]);
	});

	it('no-title at the line after the header when the body is blank', () => {
		const f = only(doc(DECIDE, '\n'));
		expect(f.code).toBe('no-title');
		expect(f.lines).toEqual([6]);
	});

	it('no-paragraph', () => {
		const f = only(doc(DECIDE, '# A title\n\n## A heading\n\nText.\n'));
		expect(f.code).toBe('no-paragraph');
		expect(f.message).toContain('no first paragraph');
		expect(f.lines).toEqual([8]);
	});

	it('no-paragraph when a question block follows the title', () => {
		const f = only(doc(DECIDE, `# A title\n\n${question('A label')}`));
		expect(f.code).toBe('no-paragraph');
		expect(f.lines).toEqual([8]);
	});
});

describe('question blocks', () => {
	it('open-question', () => {
		const body = `${BODY}\n:::question Stray test processes\n- **Merge** it. {recommended}\n- **Hold** it.\n`;
		const f = only(doc(DECIDE, body));
		expect(f.code).toBe('open-question');
		expect(f.message).toContain('"Stray test processes"');
		expect(f.message).toContain('no closing ::: line');
		expect(f.lines).toEqual([10]);
	});

	it('no-label', () => {
		const body = `${BODY}\n:::question\n- **Merge** it. {recommended}\n- **Hold** it.\n:::\n`;
		const f = only(doc(DECIDE, body));
		expect(f.code).toBe('no-label');
		expect(f.message).toContain('no label');
		expect(f.message).toContain(':::question');
		expect(f.lines).toEqual([10]);
	});

	it('option-count with one option', () => {
		const f = only(doc(DECIDE, `${BODY}\n${question('Too few', 1)}`));
		expect(f.code).toBe('option-count');
		expect(f.message).toContain('"Too few"');
		expect(f.message).toContain('has 1 options');
		expect(f.message).toContain('two to six');
		expect(f.lines).toEqual([10]);
	});

	it('option-count with seven options', () => {
		const f = only(doc(DECIDE, `${BODY}\n${question('Too many', 7)}`));
		expect(f.code).toBe('option-count');
		expect(f.message).toContain('has 7 options');
		expect(f.lines).toEqual([10]);
	});

	it('takes six options', () => {
		expect(parse(doc(DECIDE, `${BODY}\n${question('Six', 6)}`)).faults).toEqual([]);
	});

	it('two-recommended', () => {
		const f = only(doc(DECIDE, `${BODY}\n${question('Both marked', 3, 2)}`));
		expect(f.code).toBe('two-recommended');
		expect(f.message).toContain('"Both marked"');
		expect(f.message).toContain('marks 2 options {recommended}');
		expect(f.lines).toEqual([10]);
	});

	it('duplicate-label', () => {
		const f = only(doc(DECIDE, `${BODY}\n${question('Same words')}\n${question('Same words')}`));
		expect(f.code).toBe('duplicate-label');
		expect(f.message).toContain('"Same words"');
		expect(f.lines).toEqual([10, 15]);
	});

	it('second-decide', () => {
		const f = only(doc(DECIDE, `${BODY}\n:::decide\n\nMore text.\n\n:::decide\n`));
		expect(f.code).toBe('second-decide');
		expect(f.message).toContain('second :::decide');
		expect(f.lines).toEqual([10, 14]);
	});
});

describe('the limits', () => {
	const many = (n: number) =>
		doc(DECIDE, `${BODY}\n${Array.from({ length: n }, (_, i) => question(`Label ${i + 1}`)).join('\n')}`);

	it('takes 30 questions', () => {
		expect(parse(many(30)).faults).toEqual([]);
	});

	it('too-many-questions at 31', () => {
		const f = only(many(31));
		expect(f.code).toBe('too-many-questions');
		expect(f.message).toContain('31 questions');
		expect(f.message).toContain('The limit is 30');
		expect(f.lines).toEqual([]);
	});

	const sized = (bytes: number) => {
		const head = doc(DECIDE, `${BODY}\n`);
		return head + 'x'.repeat(bytes - Buffer.byteLength(head) - 1) + '\n';
	};

	it('takes 204,800 bytes', () => {
		const src = sized(204_800);
		expect(Buffer.byteLength(src)).toBe(204_800);
		expect(parse(src).faults).toEqual([]);
	});

	it('too-large at 204,801 bytes', () => {
		const src = sized(204_801);
		expect(Buffer.byteLength(src)).toBe(204_801);
		const f = only(src);
		expect(f.code).toBe('too-large');
		expect(f.message).toContain('201 KB');
		expect(f.message).toContain('The limit is 200 KB');
		expect(f.lines).toEqual([]);
	});
});
