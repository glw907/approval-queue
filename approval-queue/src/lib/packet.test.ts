import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REGISTER_PATH } from './brief.ts';
import { descriptionDefects, descriptionParagraphs, parsePacket, titleDefects } from './packet.ts';

const baseline = readFileSync(new URL('./fixtures/packet-baseline.md', import.meta.url), 'utf8');
const designExists = (repo: string, path: string) => repo === 'drafter' && path === 'docs/specs/notes-design.md';

/** The baseline with one edit; the edit must hit, so a typo here cannot pass as a clean refusal. */
function edited(from: string | RegExp, to: string): string {
	const out = baseline.replace(from, to);
	if (out === baseline) throw new Error(`edit did not apply: ${from}`);
	return out;
}

function refusal(markdown: string): string {
	const result = parsePacket(markdown, { designExists });
	if (result.ok) throw new Error('expected a refusal');
	for (const message of result.messages) expect(message).toContain(REGISTER_PATH);
	return result.messages.join('\n');
}

const ASK1 = 'ask 1 (Merge the drafter PR whose lint check failed?)';

describe('the baseline packet', () => {
	const result = parsePacket(baseline, { designExists });
	if (!result.ok) throw new Error(result.messages.join('\n'));
	const { packet } = result;

	it('parses the title, description, and not-checked text', () => {
		expect(packet.headline).toBe('Drafter release notes, first stage');
		expect(packet.background).toBe(
			'The drafter initiative replaces hand-written release notes with generated ones. This packet carries the last pass of the first stage. The earlier packet landed the template engine.'
		);
		expect(packet.summary).toEqual([
			'The pass is ready to land as two drafter PRs and one design. One PR failed a lint check, and one question is yours to settle first.',
			'Approving merges each approved PR in order and publishes the drafter release. You refresh your registry login before the publish.'
		]);
		expect(packet.notChecked).toBe("The release notes were not read on the registry's preview page.");
	});

	it('parses the tagged steps', () => {
		expect(packet.steps).toEqual([
			{ n: 1, tag: 'session', text: 'Merge each approved PR in the order listed.' },
			{ n: 2, tag: 'irreversible', text: 'Publish the drafter release to the package registry.' },
			{ n: 3, tag: 'you', label: 'refresh your registry login', text: 'Run the publish login before step 2.' }
		]);
	});

	it('parses each ask’s fields', () => {
		expect(packet.asks).toHaveLength(2);
		const [first, second] = packet.asks;
		expect(first.question).toBe('Merge the drafter PR whose lint check failed?');
		expect(first.rule).toBe('gate-failed');
		expect(first.part).toMatchObject({ ref: 'glw907/drafter#41', kind: 'pr', number: 41 });
		expect(first.recommended).toBe(2);
		expect(first.reason).toContain('waives');
		expect(first.summary).toContain('PR 41 changes the note template');
		expect(first.background).toContain('A lint check scans every file');
		expect(first.factsLead).toBe('The only failure is in a generated file.');
		expect(first.facts).toEqual([
			{ text: 'The lint check reports one error, in `notes.generated.ts`', source: 'glw907/drafter#41' },
			{ text: 'The waiver policy lists generated files', source: 'docs/policy.md' }
		]);
		expect(first.choices.map((c) => [c.label, c.verdict])).toEqual([
			['Merge anyway', 'approve'],
			['Hold', 'hold'],
			['Send back', 'send-back']
		]);
		expect(first.choices[0].consequence).toBe('merges the PR with the lint check red; a revert PR undoes it');
		expect(first.evidence).toEqual({
			lead: 'The lint output names a generated file only.',
			excerpt: 'notes.generated.ts:12:1  error  line too long (max-len)'
		});
		expect(second.part).toBeNull();
		expect(second.choices.every((c) => c.verdict === undefined)).toBe(true);
		expect(second.evidence).toBeUndefined();
	});

	it('parses the routine rows and exposes every part with its kind', () => {
		expect(packet.routine.map((r) => [r.part.ref, r.part.kind, r.verdict])).toEqual([
			['glw907/drafter#42', 'pr', 'approve'],
			['glw907/drafter:docs/specs/notes-design.md', 'design', 'approve'],
			['step:1', 'step', 'session']
		]);
		expect(packet.routine[0].fact).toBe('All checks pass and the review verdict is accept.');
		expect(packet.parts.map((p) => [p.part.ref, p.in])).toEqual([
			['glw907/drafter#41', 'ask'],
			['glw907/drafter#42', 'routine'],
			['glw907/drafter:docs/specs/notes-design.md', 'routine'],
			['step:1', 'routine']
		]);
	});

	it('ignores a `## ` heading inside a fence', () => {
		const text = edited('notes.generated.ts:12:1', '## Not a section\nnotes.generated.ts:12:1');
		expect(parsePacket(text, { designExists }).ok).toBe(true);
	});
});

describe('refusals, one edit each', () => {
	it('refuses a missing title, a title with closing punctuation, and one over 80 characters', () => {
		expect(refusal(baseline.replace(/^# .*\n/, ''))).toContain('missing title');
		expect(refusal(edited('first stage\n', 'first stage.\n'))).toContain('drop its closing punctuation');
		expect(refusal(edited('first stage\n', `${'x'.repeat(60)}\n`))).toContain('the title runs 83 characters; keep it to 80');
	});

	it('accepts a description of two paragraphs', () => {
		expect(parsePacket(edited(/\nApproving merges each.*\n/, ''), { designExists }).ok).toBe(true);
	});

	it('refuses a description of one paragraph or of four', () => {
		expect(refusal(edited(/The pass is ready[^]*?publish\.\n/, ''))).toContain('a background paragraph, then one or two summary paragraphs');
		expect(refusal(edited('before the publish.\n', 'before the publish.\n\nA fourth paragraph.\n'))).toContain('the description has 4 paragraphs');
	});

	it('refuses a Background section, pointing at the description', () => {
		expect(refusal(edited('## If you approve', '## Background\nOld text.\n\n## If you approve'))).toContain(
			'`## Background` is not a packet section; its text is the first paragraph under the title'
		);
	});

	it('refuses a required section absent, empty, or out of order', () => {
		expect(refusal(edited(/## Not checked\n.*\n\n/, ''))).toContain('`## Not checked` is missing');
		expect(refusal(edited(/(## Not checked\n).*\n/, '$1'))).toContain('`## Not checked` is empty');
		expect(refusal(edited('## Routine', '## Not checked\nA second one.\n\n## Routine'))).toContain('`## Not checked` appears twice');
		const swapped = edited('## If you approve', '## Not checked\nNothing.\n\n## If you approve');
		expect(refusal(swapped)).toContain('`## If you approve` is out of order');
	});

	describe('## What changed', () => {
		const SECTION = '## What changed\n- Split the template change out of PR 41.\n- Added the missing waiver note.\n\n';
		const revised = (section = SECTION) => edited('## If you approve', `${section}## If you approve`);

		it('is accepted after the description and read as bullets', () => {
			const result = parsePacket(revised(), { designExists });
			if (!result.ok) throw new Error(result.messages.join('\n'));
			expect(result.packet.whatChanged).toEqual(['Split the template change out of PR 41.', 'Added the missing waiver note.']);
		});

		it('joins a wrapped bullet and leaves a first packet without the field', () => {
			const wrapped = revised('## What changed\n- Split the template\n  change out of PR 41.\n\n');
			const result = parsePacket(wrapped, { designExists });
			if (!result.ok) throw new Error(result.messages.join('\n'));
			expect(result.packet.whatChanged).toEqual(['Split the template change out of PR 41.']);
			const first = parsePacket(baseline, { designExists });
			expect(first.ok && 'whatChanged' in first.packet).toBe(false);
		});

		it('is refused twice, empty, with prose outside the list, and out of order', () => {
			expect(refusal(revised(SECTION + SECTION))).toContain('`## What changed` appears twice');
			expect(refusal(revised('## What changed\n\n'))).toContain('`## What changed` is empty');
			expect(refusal(revised('## What changed\nSome prose.\n\n'))).toContain('`## What changed` is a bulleted list and nothing else');
			expect(refusal(revised('## What changed\n- One.\n\nTrailing prose.\n\n'))).toContain('a bulleted list and nothing else');
			expect(refusal(edited('## Not checked', `${SECTION}## Not checked`))).toContain('`## What changed` is out of order');
			expect(refusal(edited('## Routine', `${SECTION}## Routine`))).toContain('`## What changed` is out of order');
		});
	});

	it('exposes the title and description rules parsePacket applies', () => {
		expect(titleDefects('A fine title')).toEqual([]);
		expect(titleDefects('Ends in a period.')).toEqual(['the title is a heading: drop its closing punctuation']);
		expect(titleDefects('x'.repeat(81))).toEqual(['the title runs 81 characters; keep it to 80']);
		expect(descriptionDefects(['a'])).toEqual(['the description is a background paragraph, then one or two summary paragraphs, under the title']);
		expect(descriptionDefects(['a', 'b'])).toEqual([]);
		expect(descriptionDefects(['a', 'b', 'c'])).toEqual([]);
		expect(descriptionDefects(['a', 'b', 'c', 'd'])).toEqual(['the description has 4 paragraphs; keep it to a background paragraph and one or two summary paragraphs']);
		expect(descriptionParagraphs('One\nwrapped line.\n\nTwo.\n')).toEqual(['One wrapped line.', 'Two.']);
	});

	it('refuses any other heading', () => {
		expect(refusal(edited('## Routine', '## Appendix\nText.\n\n## Routine'))).toContain('`## Appendix` is not a packet section');
	});

	it('refuses an untagged, unknown-tag, or unlabeled step, naming its number', () => {
		expect(refusal(edited('1. [session] Merge', '1. Merge'))).toContain('step 1 needs a tag');
		expect(refusal(edited('2. [irreversible]', '2. [maybe]'))).toContain('step 2 needs a tag');
		expect(refusal(edited('[you: refresh your registry login]', '[you]'))).toContain('step 3 is `[you]` with no label');
	});

	it('refuses more than three asks', () => {
		const ask = (n: number) =>
			`## Ask: Extra ${n}?\nRule: owner-call\nPart: none\nRecommended: 1\nReason: r\nSummary: s\n\nBackground: b\n\nFacts: f\n- a (\`x\`)\n\nChoices:\n- One: first\n- Two: second\n\n`;
		expect(refusal(edited('## Routine', `${ask(1)}${ask(2)}## Routine`))).toContain('at most three asks; split the packet or settle one');
	});

	it('refuses a rule outside the seven, naming the ask and the rules', () => {
		const message = refusal(edited('Rule: gate-failed', 'Rule: scary'));
		expect(message).toContain(ASK1);
		expect(message).toContain('contradicts-ruling');
	});

	it.each(['Rule', 'Part', 'Summary', 'Background', 'Facts', 'Choices', 'Recommended', 'Reason'])('refuses an ask missing %s', (field) => {
		const text = edited(new RegExp(`^${field}:.*\\n`, 'm'), '');
		expect(refusal(text)).toContain(`${ASK1} is missing \`${field}:\``);
	});

	it('refuses too few choices, a choice with no consequence, and a repeated label', () => {
		expect(refusal(edited(/^- Hold: .*\n- Send back: .*\n/m, ''))).toContain(`${ASK1} needs at least two choices`);
		expect(refusal(edited('- Hold: leaves the PR open with nothing done [hold]', '- Hold [hold]'))).toContain('choice `Hold [hold]` has no `: <consequence>`');
		expect(refusal(edited('- Hold: leaves', '- Merge anyway: leaves'))).toContain('two choices share the label `Merge anyway`');
	});

	it('refuses a Recommended that is not a choice number', () => {
		expect(refusal(edited('Recommended: 2', 'Recommended: 4'))).toContain(`${ASK1}: \`Recommended: 4\` is not the number`);
		expect(refusal(edited('Recommended: 2', 'Recommended: two'))).toContain('`Recommended: two`');
	});

	it('refuses choice tags that do not set the part’s verdict', () => {
		const head = `${ASK1}: each choice sets the part's verdict`;
		expect(refusal(edited(' [hold]\n', '\n'))).toContain(head);
		expect(refusal(edited('[send-back]', '[session]'))).toContain(head);
		expect(refusal(edited('- Beta: the notes go to the beta channel and can be replaced', '- Beta: the notes go to the beta channel [approve]'))).toContain(
			"ask 2 (Which release channel should the first notes go to?): each choice sets the part's verdict"
		);
	});

	it('refuses a fact with no bullet or no source', () => {
		expect(refusal(edited(/^- The lint check reports.*\n- The waiver.*\n/m, ''))).toContain('every fact names its source');
		expect(refusal(edited(' (`docs/policy.md`)', ''))).toContain('every fact names its source');
	});

	it('refuses a ref not in canonical form, a step outside the plan, and a missing design', () => {
		expect(refusal(edited('glw907/drafter#42', 'drafter#42'))).toContain('`drafter#42` is not a canonical ref');
		expect(refusal(edited('Part: glw907/drafter#41', 'Part: #41 Note template (drafter)'))).toContain('is not a canonical ref');
		expect(refusal(edited('| step:1 |', '| step:9 |'))).toContain('`step:9` is outside the plan');
		expect(refusal(edited('notes-design.md |', 'missing-design.md |'))).toContain('the design `glw907/drafter:docs/specs/missing-design.md` does not exist');
	});

	it('refuses a part listed twice', () => {
		expect(refusal(edited('| glw907/drafter#42 |', '| glw907/drafter#41 |'))).toContain('`glw907/drafter#41` is listed twice');
	});

	it('refuses a Routine that is not one table with the header', () => {
		expect(refusal(edited('| Part | Verdict | Fact | Why |', '| Part | Verdict | Why |'))).toContain('one table with the header');
		expect(refusal(edited(/\|---\|---\|---\|---\|\n/, ''))).toContain('one table with the header');
		expect(refusal(edited('## Routine\n', '## Routine\nSome prose.\n'))).toContain('one table with the header');
	});

	it('refuses a routine row with a different cell count, naming the row', () => {
		expect(refusal(edited('| Nothing in it needs a call. |', '|'))).toContain('routine row 1 (glw907/drafter#42) has 3 cells; it needs 4');
	});

	it('refuses a routine verdict outside its kind’s verdicts', () => {
		expect(refusal(edited('#42 | approve', '#42 | session'))).toContain('routine row 1 (glw907/drafter#42): a pr takes approve, hold, send-back, not `session`');
		expect(refusal(edited('step:1 | session', 'step:1 | approve'))).toContain('a step takes session, you, skip');
	});

	it('refuses a packet with no PR or design part', () => {
		const text = edited(/^## Ask: Merge[\s\S]*?(?=## Ask: Which)/m, '').replace(/^\| glw907\/drafter[#:].*\n/gm, '');
		expect(refusal(text)).toContain('a packet holds at least one PR or design');
	});
});
