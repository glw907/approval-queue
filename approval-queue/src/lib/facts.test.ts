import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkClaimRanges, parseFacts, parseText, type Facts } from './facts.ts';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const snapshotDir = new URL('./fixtures/snapshot', import.meta.url).pathname;

function facts(name: string): Facts {
	const r = parseFacts(fixture(name));
	if (!r.ok) throw new Error(r.messages.join('\n'));
	return r.value;
}

/** Parses a facts fixture after `edit` changed its JSON; returns the result. */
function withEdit(name: string, edit: (f: any) => void) {
	const f = JSON.parse(fixture(name));
	edit(f);
	return parseFacts(JSON.stringify(f));
}

const messages = (r: { ok: boolean; messages?: string[] }) => (r.ok ? [] : (r.messages ?? []));

describe('fact file', () => {
	it.each(['design', 'close', 'stop'])('accepts the %s fixture', (kind) => {
		const r = parseFacts(fixture(`${kind}-facts.json`));
		expect(messages(r)).toEqual([]);
		expect(r.ok).toBe(true);
	});

	const ROUND_RULE = 'lowercase letters, digits, and hyphens, starting with a letter, 12 characters at most';

	it('keeps a round id the fact file names', () => {
		const r = withEdit('close-facts.json', (f) => (f.round = 'ur-queue'));
		expect(messages(r)).toEqual([]);
		expect(r.ok && r.value.round).toBe('ur-queue');
	});

	it.each(['a', 'r2-d2', 'a23456789012'])('accepts the round id %s', (id) => {
		expect(messages(withEdit('close-facts.json', (f) => (f.round = id)))).toEqual([]);
	});

	it.each(['ur-queue-long', 'Ur-queue', '1round', 'ur_queue', '-ur', 'ur queue', '', 7, null])('refuses the round %j with the rule named', (id) => {
		const r = withEdit('close-facts.json', (f) => (f.round = id));
		expect(r.ok).toBe(false);
		expect(messages(r).join('\n')).toContain(ROUND_RULE);
	});

	it('parses a fact file with no round to a value with no round key', () => {
		const r = parseFacts(fixture('close-facts.json'));
		expect(r.ok).toBe(true);
		expect(r.ok && 'round' in r.value).toBe(false);
	});

	it('refuses a fourth unforced call', () => {
		const r = withEdit('close-facts.json', (f) => {
			const c = f.calls[0];
			f.calls.push({ ...c, question: 'A second?' }, { ...c, question: 'A third?' }, { ...c, question: 'A fourth?' });
		});
		expect(r.ok).toBe(false);
		expect(messages(r).join('\n')).toContain('4 unforced calls; at most 3');
	});

	it('accepts a fourth forced call', () => {
		const r = withEdit('close-facts.json', (f) => {
			const c = f.calls[1];
			f.calls.push({ ...c, question: 'A third?' }, { ...c, question: 'A fourth?' }, { ...c, question: 'A fifth?' });
		});
		expect(messages(r)).toEqual([]);
		expect(r.ok).toBe(true);
	});

	it('refuses a source that is not a path with a line, a URL, or a PR ref', () => {
		const r = withEdit('close-facts.json', (f) => (f.notChecked[0].source = 'somewhere'));
		expect(messages(r).join('\n')).toContain('needs a source');
	});

	it('refuses an applied label that names no option', () => {
		const r = withEdit('close-facts.json', (f) => (f.decidedForYou[0].applied = 'Neither'));
		expect(messages(r).join('\n')).toContain('applied must be the label');
	});

	it('refuses a design packet that names a pull request', () => {
		const r = withEdit('design-facts.json', (f) => (f.prs = ['aq-fixture/sample#1']));
		expect(messages(r).join('\n')).toContain('names no pull requests');
	});

	it('refuses a stop packet with no reason', () => {
		const r = withEdit('stop-facts.json', (f) => delete f.reason);
		expect(r.ok).toBe(false);
	});

	it('points each refusal at the approval-packet skill', () => {
		for (const line of messages(withEdit('close-facts.json', (f) => (f.kind = 'other')))) expect(line).toContain('approval-packet skill');
	});
});

describe('text', () => {
	it.each(['design', 'close', 'stop'])('accepts the %s fixture', (kind) => {
		const r = parseText(fixture(`${kind}-text.md`), facts(`${kind}-facts.json`));
		expect(messages(r)).toEqual([]);
		expect(r.ok).toBe(true);
	});

	it('reads the sections of the stop fixture', () => {
		const r = parseText(fixture('stop-text.md'), facts('stop-facts.json'));
		if (!r.ok) throw new Error(r.messages.join('\n'));
		expect(r.value.headline).toBe('Setup tooling overnight run');
		expect(r.value.opening).toHaveLength(6);
		expect(r.value.calls).toHaveLength(3);
		expect(r.value.calls[0].risk).toContain('npm publish secrets');
		expect(r.value.claims).toHaveLength(5);
		expect(r.value.claims[0]).toMatchObject({ pr: 'glw907/cairn-cms#214', path: '.github/workflows/publish.yml', from: 34, to: 43 });
	});

	it('refuses a claim with no citation', () => {
		const text = fixture('close-text.md').replace(' [aq-fixture/sample#1 lib/queue.test.ts:1-4]', '');
		const r = parseText(text, facts('close-facts.json'));
		expect(messages(r).join('\n')).toContain('ends with no citation');
	});

	it('refuses a text with no Your calls section when the fact file has calls', () => {
		const text = fixture('close-text.md').replace(/## Your calls[\s\S]*?(?=## Decided for you)/, '');
		const r = parseText(text, facts('close-facts.json'));
		expect(messages(r).join('\n')).toContain('`## Your calls` is missing');
	});

	it('refuses a call block missing its Risk paragraph', () => {
		const text = fixture('close-text.md').replace(/^Risk: A decided item.*\n\n/m, '');
		const r = parseText(text, facts('close-facts.json'));
		expect(messages(r).join('\n')).toContain('is missing `Risk:`');
	});

	it('refuses a claim that cites a pull request outside the fact file', () => {
		const text = fixture('close-text.md').replace('aq-fixture/sample#2 docs', 'aq-fixture/other#9 docs');
		const r = parseText(text, facts('close-facts.json'));
		expect(messages(r).join('\n')).toContain('not in the fact file');
	});

	it('refuses What changed on a design packet', () => {
		const text = `${fixture('design-text.md')}\n## What changed\n\nA lead.\n\n- A claim. [aq-fixture/sample#1 a.ts:1-2]\n`;
		const r = parseText(text, facts('design-facts.json'));
		expect(messages(r).join('\n')).toContain('does not belong here');
	});
});

describe('claim ranges', () => {
	const claims = (name: string) => {
		const r = parseText(fixture(`${name}-text.md`), facts(`${name}-facts.json`));
		if (!r.ok) throw new Error(r.messages.join('\n'));
		return r.value.claims;
	};

	it.each(['close', 'stop'])('accepts every claim of the %s fixture against its snapshot', (name) => {
		expect(checkClaimRanges(claims(name), snapshotDir)).toEqual([]);
	});

	it('refuses a claim citing line 40 of a hunk that ends at 14', () => {
		const list = claims('close');
		list[0] = { ...list[0], from: 40, to: 40 };
		const out = checkClaimRanges(list, snapshotDir);
		expect(out).toHaveLength(1);
		expect(out[0]).toContain('lib/queue.ts:40-40');
	});

	it('refuses a claim on a file the snapshot does not change', () => {
		const list = claims('close');
		list[0] = { ...list[0], path: 'lib/other.ts' };
		expect(checkClaimRanges(list, snapshotDir)[0]).toContain('does not change');
	});
});
