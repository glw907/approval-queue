import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBrief, REGISTER_PATH, validateTriage } from './brief.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

const HEAD = 'Headline sentence. The lede sentence.';
const CHANGES = '### What changes\n\n- one\n- two';
const APPROVE = '### If you approve\n\n1. first\n2. second';
const brief = (...parts: string[]) => `## Brief\n\n${HEAD}\n\n${parts.join('\n\n')}\n`;
const GOOD = [CHANGES, APPROVE];

function refusal(markdown: string): string {
	const result = parseBrief(markdown);
	if (result.ok) throw new Error('expected a refusal');
	expect(result.messages.length).toBeGreaterThan(0);
	for (const message of result.messages) expect(message).toContain(REGISTER_PATH);
	return result.messages.join('\n');
}

describe('detail sections and the one-block sections', () => {
	const brief = (extra: string) =>
		`## Brief\n\nHeadline here. A lede follows.\n\n### What changes\n\n- a\n\n### If you approve\n\n1. b\n${extra}\n`;

	it('keeps a detail section’s list, code block, and second paragraph', () => {
		const result = parseBrief(
			brief('\n### Commands\n\nRun these in order. They are quick.\n\n```sh\nstow -R bin\n```\n\n- first\n- second\n\nA closing paragraph.')
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const [commands] = result.brief.details;
		expect(commands.summary).toBe('Run these in order.');
		expect(commands.body.startsWith('Run these in order. They are quick.')).toBe(true);
		expect(commands.body).toContain('```sh\nstow -R bin\n```');
		expect(commands.body).toContain('- first\n- second');
		expect(commands.body).toContain('A closing paragraph.');
	});

	it('refuses text after the one list or paragraph, since the page would drop it', () => {
		for (const extra of [
			'\n### Worth knowing\n\nOne.\n\nTwo.',
			'\n### Decide: x\n\nQ\n\n- a\n- b'
		]) {
			const result = parseBrief(brief(extra));
			expect(result.ok).toBe(extra.includes('Decide'));
		}
		const result = parseBrief(
			`## Brief\n\nHeadline here. A lede follows.\n\n### What changes\n\n- a\n\nStray paragraph.\n\n### If you approve\n\n1. b\n`
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.messages.join(' ')).toContain('holds only its list');
	});
});

describe('parseBrief fixtures', () => {
	it('parses the PR #40 brief', () => {
		const result = parseBrief(fixture('pr-40-brief.md'));
		if (!result.ok) throw new Error(result.messages.join('\n'));
		const b = result.brief;
		expect(b.headline).toBe('Every PR a session opens will now come to you for approval, and approving one will merge it.');
		expect(b.lede).toBe(
			'Small fixes were skipping your approval, and Claude Code was blocking merges you had already approved. This fixes both.'
		);
		expect(b.whatChanges).toEqual([
			'Every PR a session opens comes here. Before, only full planned passes sent theirs.',
			'A merge you approved goes through. Before, Claude Code blocked it, as with PR #38.'
		]);
		expect(b.ifYouApprove).toEqual([
			'The PR merges.',
			'This machine’s settings rebuild.',
			'Sessions follow it on their next command.'
		]);
		expect(b.decides).toEqual([]);
		expect(b.worthKnowing).toContain('the merge guard keeps a merge from skipping your approval.');
		expect(b.details.map((d) => [d.label, d.summary])).toEqual([
			['The reminder', 'Fires whenever a session opens a PR.'],
			['The merge permission', 'Only the exact commit you approved can merge.'],
			['Testing', 'A new test covers the reminder; the full check passed.']
		]);
		expect(b.details[0].body).toContain('`claude-approval-queue-reminder`');
	});

	it('parses the drafter Pass 0 triage', () => {
		const result = validateTriage(fixture('drafter-pass-0-triage.json'));
		if (!result.ok) throw new Error(result.messages.join('\n'));
		const { triage } = result;
		expect(triage.headline).toBe('One follow-up needs doing before the next docs run.');
		expect(triage.rows.map((r) => r.proposed)).toEqual(['now', 'defer', 'defer', 'defer', 'defer', 'drop', 'drop', 'drop']);
		expect(triage.rows[0].detail).toContain('`<slug>.plan.md`');
	});
});

describe('parseBrief', () => {
	it('parses a Decide block with its source and choices in order', () => {
		const result = parseBrief(
			brief(
				...GOOD,
				'### Decide: Rebuild the settings\n\nThe live settings have to be rebuilt from this PR.\n\nSource: From the session\n\n- The session runs it, then merges (recommended)\n- I’ll run it myself'
			)
		);
		if (!result.ok) throw new Error(result.messages.join('\n'));
		expect(result.brief.decides).toEqual([
			{
				title: 'Rebuild the settings',
				text: 'The live settings have to be rebuilt from this PR.',
				source: 'From the session',
				choices: [
					{ label: 'The session runs it, then merges', recommended: true },
					{ label: 'I’ll run it myself', recommended: false }
				]
			}
		]);
	});

	it('accepts a one-sentence headline with the lede in the next paragraph', () => {
		const result = parseBrief(`# Title\n\n## Brief\n\nOnly a headline.\n\nThe lede.\n\n${CHANGES}\n\n${APPROVE}\n`);
		if (!result.ok) throw new Error(result.messages.join('\n'));
		expect([result.brief.headline, result.brief.lede]).toEqual(['Only a headline.', 'The lede.']);
	});

	it('does not split a sentence at an abbreviation or a PR number', () => {
		const result = parseBrief(`## Brief\n\nSee e.g. the U.S. plan in PR #40. It lands now.\n\n${CHANGES}\n\n${APPROVE}\n`);
		if (!result.ok) throw new Error(result.messages.join('\n'));
		expect(result.brief.headline).toBe('See e.g. the U.S. plan in PR #40.');
		expect(result.brief.lede).toBe('It lands now.');
	});

	it('accepts CRLF line endings', () => {
		const result = parseBrief(brief(...GOOD).replace(/\n/g, '\r\n'));
		expect(result.ok).toBe(true);
	});

	it('refuses an empty body, no Brief, a fenced Brief, or another ## heading first', () => {
		for (const text of [
			'',
			'Just prose.\n',
			'```\n## Brief\n```\n\n### What changes\n',
			'## Summary\n\nx\n\n## Brief\n\n' + HEAD
		]) {
			expect(refusal(text)).toContain('no `## Brief`; it must be the first `##` heading');
		}
	});

	it('refuses a first block that is not a paragraph', () => {
		expect(refusal('## Brief\n\n- a\n- b\n')).toContain('missing headline');
		expect(refusal('## Brief\n\n### What changes\n\n- a\n')).toContain('missing headline');
	});

	it('refuses a one-sentence paragraph with no paragraph after it', () => {
		expect(refusal(`## Brief\n\nOne sentence only.\n\n${CHANGES}\n`)).toContain('missing lede');
	});

	it('refuses a missing or non-bulleted What changes', () => {
		expect(refusal(brief(APPROVE))).toContain('`### What changes` is missing');
		expect(refusal(brief('### What changes\n\n1. numbered\n2. list', APPROVE))).toContain(
			'`### What changes` must open with a bulleted list'
		);
	});

	it('refuses a missing or non-numbered If you approve', () => {
		expect(refusal(brief(CHANGES))).toContain('`### If you approve` is missing');
		expect(refusal(brief(CHANGES, '### If you approve\n\n- bullet\n- list'))).toContain(
			'`### If you approve` must open with a numbered list'
		);
	});

	it('refuses a required heading twice and Worth knowing twice', () => {
		expect(refusal(brief(...GOOD, CHANGES))).toContain('`### What changes` appears twice');
		expect(refusal(brief(...GOOD, APPROVE))).toContain('`### If you approve` appears twice');
		expect(refusal(brief(...GOOD, '### Worth knowing\n\nA.', '### Worth knowing\n\nB.'))).toContain(
			'`### Worth knowing` appears twice'
		);
	});

	it('refuses a heading that matches only when case is ignored', () => {
		expect(refusal(brief('### what changes\n\n- a', APPROVE))).toContain('write it as `### What changes`');
		expect(refusal(brief(...GOOD, '### decide: Y\n\nP.\n\n- a\n- b'))).toContain('write it as `### Decide: <title>`');
	});

	it('refuses a Decide block with no title, fewer than two choices, or two recommended', () => {
		expect(refusal(brief(...GOOD, '### Decide:\n\nP.\n\n- a\n- b'))).toContain('`### Decide:` needs a title');
		expect(refusal(brief(...GOOD, '### Decide: X\n\nP.\n\n- only one'))).toContain(
			'`### Decide: X` needs a list of at least two choices'
		);
		expect(refusal(brief(...GOOD, '### Decide: X\n\nP.'))).toContain('at least two choices');
		expect(refusal(brief(...GOOD, '### Decide: X\n\nP.\n\n- a (recommended)\n- b (recommended)'))).toContain(
			'`### Decide: X` marks more than one choice'
		);
	});

	it('refuses a Source line joined to the paragraph above it', () => {
		expect(refusal(brief(...GOOD, '### Decide: X\n\nP.\nSource: nowhere\n\n- a\n- b'))).toContain(
			'`Source:` must stand as its own paragraph'
		);
	});

	it('refuses a detail section that does not open with a paragraph', () => {
		expect(refusal(brief(...GOOD, '### The reminder\n\n- a bullet first'))).toContain(
			'`### The reminder` must open with a paragraph'
		);
		expect(refusal(brief(...GOOD, '### Empty'))).toContain('`### Empty` must open with a paragraph');
	});

	it('lists every section defect in one refusal', () => {
		const text = refusal(brief('### what changes\n\n- a', '### Empty'));
		expect(text).toContain('write it as `### What changes`');
		expect(text).toContain('`### If you approve` is missing');
		expect(text).toContain('`### Empty` must open with a paragraph');
	});
});

describe('validateTriage', () => {
	const row = { action: 'Do it.', why: 'Because.', proposed: 'now' };
	const file = (over: object = {}) => JSON.stringify({ headline: 'H.', lede: 'L.', rows: [row], ...over });
	function triageRefusal(text: string): string {
		const result = validateTriage(text);
		if (result.ok) throw new Error('expected a refusal');
		for (const message of result.messages) expect(message).toContain(REGISTER_PATH);
		return result.messages.join('\n');
	}

	it('refuses text that is not valid JSON', () => {
		expect(triageRefusal('{nope')).toContain('not valid JSON');
	});

	it('refuses a JSON array as the old shape', () => {
		expect(triageRefusal('[]')).toContain('old triage shape; write `{headline, lede, rows}`');
	});

	it('refuses a missing or empty headline, lede, or rows, naming the field', () => {
		expect(triageRefusal(file({ headline: undefined }))).toContain('`headline`');
		expect(triageRefusal(file({ lede: ' ' }))).toContain('`lede`');
		expect(triageRefusal(file({ rows: [] }))).toContain('`rows`');
		expect(triageRefusal(file({ rows: undefined }))).toContain('`rows`');
	});

	it('refuses a row missing action or why, or with proposed outside now, defer, drop', () => {
		const bad = [row, { ...row, action: '' }, { ...row, why: undefined }, { ...row, proposed: 'later' }];
		const text = triageRefusal(file({ rows: bad }));
		expect(text).toContain('triage row 2: missing `action`');
		expect(text).toContain('triage row 3: missing `why`');
		expect(text).toContain('triage row 4: `proposed` must be now, defer, or drop');
		expect(text).not.toContain('row 1');
	});

	it('accepts a row with no detail', () => {
		const result = validateTriage(file());
		expect(result).toMatchObject({ ok: true, triage: { rows: [row] } });
	});
});
