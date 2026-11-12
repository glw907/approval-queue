import { describe, expect, it } from 'vitest';
import { checkPullRequests, type PrView, type RollupEntry, type ViewResult } from '#lib/doc/pr.ts';

const pr = { repo: 'glw907/workstation', number: 231, words: 'the planning-miss count', line: 5 };

const open = (rollup: RollupEntry[] = [{ name: 'gate', status: 'COMPLETED', conclusion: 'SUCCESS' }]): PrView => ({
	state: 'OPEN',
	isDraft: false,
	statusCheckRollup: rollup
});
const serve = (view: PrView) => (): ViewResult => ({ ok: true, view });

describe('checkPullRequests', () => {
	it('finds nothing in an open pull request whose checks passed', () => {
		expect(checkPullRequests([pr], serve(open()))).toEqual({ faults: [], pending: [] });
	});

	it('faults a merged pull request on its line, naming it and its words', () => {
		const { faults } = checkPullRequests([pr], serve({ ...open(), state: 'MERGED' }));
		expect(faults).toHaveLength(1);
		expect(faults[0].lines).toEqual([5]);
		expect(faults[0].message).toBe('glw907/workstation#231 (the planning-miss count) is merged.');
	});

	it('faults a closed pull request', () => {
		const { faults } = checkPullRequests([pr], serve({ ...open(), state: 'CLOSED' }));
		expect(faults.map((f) => f.message)).toEqual(['glw907/workstation#231 (the planning-miss count) is closed.']);
	});

	it('faults a draft', () => {
		const { faults } = checkPullRequests([pr], serve({ ...open(), isDraft: true }));
		expect(faults.map((f) => f.message)).toEqual(['glw907/workstation#231 (the planning-miss count) is a draft.']);
	});

	it('faults a failing check by name', () => {
		const { faults, pending } = checkPullRequests(
			[pr],
			serve(open([{ name: 'gate', status: 'COMPLETED', conclusion: 'FAILURE' }]))
		);
		expect(faults.map((f) => f.message)).toEqual([
			'glw907/workstation#231 (the planning-miss count): the check "gate" failed.'
		]);
		expect(pending).toEqual([]);
	});

	it('faults a commit status in the error state', () => {
		const { faults } = checkPullRequests([pr], serve(open([{ context: 'ci/legacy', state: 'ERROR' }])));
		expect(faults.map((f) => f.message)).toEqual([
			'glw907/workstation#231 (the planning-miss count): the check "ci/legacy" failed.'
		]);
	});

	it('lists a check still running as pending, never as a fault', () => {
		const { faults, pending } = checkPullRequests([pr], serve(open([{ name: 'gate', status: 'IN_PROGRESS' }])));
		expect(faults).toEqual([]);
		expect(pending).toEqual(['glw907/workstation#231 (the planning-miss count): the check "gate" is still running.']);
	});

	it('passes neutral and skipped checks', () => {
		const rollup = [
			{ name: 'a', status: 'COMPLETED', conclusion: 'NEUTRAL' },
			{ name: 'b', status: 'COMPLETED', conclusion: 'SKIPPED' }
		];
		expect(checkPullRequests([pr], serve(open(rollup)))).toEqual({ faults: [], pending: [] });
	});

	it('faults a pull request that cannot be read, with the reader error', () => {
		const { faults } = checkPullRequests([pr], () => ({ ok: false, error: 'no pull requests found' }));
		expect(faults.map((f) => f.message)).toEqual([
			'could not read glw907/workstation#231 from GitHub: no pull requests found.'
		]);
		expect(faults[0].lines).toEqual([5]);
	});
});
