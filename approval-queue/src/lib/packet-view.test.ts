import { describe, expect, it } from 'vitest';
import type { Claim, Facts } from './facts.ts';
import { claimFor, claimHunks, deepDiveBody, patchFiles, primaryLabel, prLabel, ruleLabel, statusLine, stopSentence } from './packet-view.ts';

const claim = (pr: string, path: string, from: number, to: number): Claim => ({ text: 't', pr, path, from, to });
const facts = (over: Partial<Facts>): Facts => ({ kind: 'stop', title: 't', prs: [], held: [], calls: [], decidedForYou: [], steps: [], notChecked: [], reviews: [], ...over });

describe('packet-view', () => {
	it('labels a pull request and a rule', () => {
		expect(prLabel('glw907/cairn-cms#214')).toBe('cairn-cms #214');
		expect(ruleLabel('public-surface')).toBe('Public surface');
	});

	it('builds the status line from the kind, the initiative, and the repos', () => {
		const stop = facts({ prs: ['o/a#1', 'o/b#2', 'o/a#3'] });
		expect(statusLine(stop, 'Setup tooling')).toEqual({ lead: 'Pass parked until you answer.', rest: 'Setup tooling in a and b.' });
		expect(statusLine(facts({ kind: 'design', design: { repo: 'sample', path: 'd.md' } }), '')).toEqual({ lead: 'A design for your approval.', rest: 'in sample.' });
	});

	it('opens the second part of the status line with the round', () => {
		const stop = facts({ prs: ['o/a#1', 'o/b#2'] });
		expect(statusLine(stop, 'Setup tooling', 'ur-queue')).toEqual({ lead: 'Pass parked until you answer.', rest: 'Round ur-queue of Setup tooling in a and b.' });
		expect(statusLine(facts({ prs: ['o/sample#1'] }), '', 'ur-queue').rest).toBe('Round ur-queue in sample.');
	});

	it('words the primary button and the stop sentence by kind', () => {
		expect(primaryLabel('stop')).toBe('Answer and resume');
		expect(primaryLabel('close')).toBe('Approve');
		expect(primaryLabel('design')).toBe('Approve');
		expect(stopSentence('stop')).toBe('Answering merges nothing. The session runs the steps below, then relaunches the pass.');
		expect(stopSentence('close')).toBeUndefined();
		expect(stopSentence('design')).toBeUndefined();
	});

	it('takes the deep dive body past its closed line', () => {
		const md = '# H\n\nOpen.\n\n## Deep dive\n\nThe closed line.\n\n### Part\n\nBody text.\n\n## Your calls\n\nx\n';
		expect(deepDiveBody(md)).toBe('### Part\n\nBody text.');
		expect(deepDiveBody('# H\n\nOpen.\n\n## Deep dive\n\nOnly a line.\n')).toBe('');
	});

	it('finds the claim an evidence source points at', () => {
		const claims = [claim('o/r#1', '.github/a.yml', 10, 20), claim('o/r#1', '.github/a.yml', 40, 50), claim('o/r#2', 'b.md', 1, 3)];
		expect(claimFor('.github/a.yml:42-45', claims)).toBe(1);
		expect(claimFor('.github/a.yml:30', claims)).toBe(0);
		expect(claimFor('o/r#2', claims)).toBe(2);
		expect(claimFor('https://example.com/x', claims)).toBe(-1);
	});

	it('keeps the hunks a claim reaches', () => {
		const patch = ['diff --git a/f b/f', '--- a/f', '+++ b/f', '@@ -1,2 +1,2 @@', ' a', '-b', '+c', '@@ -50,1 +50,2 @@', ' x', '+y', ''].join('\n');
		const file = patchFiles(patch).get('f')!;
		expect(claimHunks(file, 50, 51).rows.map((r) => r.text)).toEqual(['@@ -50,1 +50,2 @@', 'x', 'y']);
		expect(claimHunks(file, 900, 901).rows[0].text).toBe('@@ -1,2 +1,2 @@');
	});
});
