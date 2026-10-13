import { describe, expect, it } from 'vitest';
import { checksSummary, reviewSection, reviewVerdict, technicalNotes } from './pr-summary.ts';

describe('technicalNotes', () => {
	it('keeps what follows the brief and leaves out Before merge and Review', () => {
		const body =
			'# Title\n\n## Brief\n\nHeadline.\n\n## What landed\n\nThings\n\n## Review\n\n`accept`\n\n## Before merge\n\nDo it\n\n## Score\n\n6 h';
		expect(technicalNotes(body)).toBe('## What landed\n\nThings\n\n## Score\n\n6 h');
	});

	it('keeps the lead of a body that has no brief', () => {
		expect(technicalNotes('Lead text\n\n## What landed\n\nThings')).toBe('Lead text\n\n## What landed\n\nThings');
	});
});

describe('reviewSection', () => {
	it('returns the markdown under "## Review" up to the next heading', () => {
		expect(reviewSection('lead\n\n## Review\n\nFirst: `fix`.\n\n## Score\n\n6 h')).toBe('First: `fix`.');
	});
	it('is null with no Review section', () => {
		expect(reviewSection('lead\n\n## Score\n\n6 h')).toBeNull();
	});
});

describe('reviewVerdict', () => {
	it('reads the last backticked verdict in the Review section', () => {
		const body =
			'## Review\n\nFirst review: `fix`. Second whole-branch review after the fix: `accept`.\n\n## Other\n\n`fix`';
		expect(reviewVerdict(body)).toBe('accept');
	});

	it('stays accept when prose "fix chain" follows', () => {
		expect(reviewVerdict('## Review\n\n`accept`, with one batched fix chain.')).toBe('accept');
	});

	it('returns fix when a backticked fix comes last', () => {
		expect(reviewVerdict('## Review\n\n`accept` then `fix`')).toBe('fix');
	});

	it('returns null with no Review section or no token', () => {
		expect(reviewVerdict('## Other\n\n`accept`')).toBeNull();
		expect(reviewVerdict('## Review\n\nall good')).toBeNull();
	});
});

describe('checksSummary', () => {
	const run = (name: string, conclusion: string, status = 'COMPLETED') => ({
		__typename: 'CheckRun',
		name,
		workflowName: 'CI',
		status,
		conclusion
	});

	it('counts successes and skips', () => {
		const rollup = [...Array.from({ length: 11 }, (_, i) => run(`j${i}`, 'SUCCESS')), run('s', 'SKIPPED')];
		const s = checksSummary(rollup);
		expect(s).toMatchObject({ passed: 11, failed: 0, skipped: 1, pending: 0, text: '11 passed, 1 skipped' });
		expect(s.rows[0]).toEqual({ name: 'CI / j0', state: 'pass' });
		expect(s.rows[11]).toEqual({ name: 'CI / s', state: 'skip' });
	});

	it('counts NEUTRAL as a pass and FAILURE as failed', () => {
		const s = checksSummary([run('a', 'NEUTRAL'), run('b', 'FAILURE')]);
		expect(s).toMatchObject({ passed: 1, failed: 1, text: '1 passed, 1 failed' });
	});

	it('counts an incomplete run as pending', () => {
		const s = checksSummary([run('a', '', 'IN_PROGRESS')]);
		expect(s).toMatchObject({ pending: 1, text: '1 pending' });
		expect(s.rows[0].state).toBe('pending');
	});

	it('reads a StatusContext by its state', () => {
		const ctx = (state: string) => ({ __typename: 'StatusContext', context: 'ci/x', state });
		const s = checksSummary([ctx('FAILURE'), ctx('SUCCESS'), ctx('PENDING'), ctx('EXPECTED')]);
		expect(s).toMatchObject({ passed: 1, failed: 1, pending: 2 });
		expect(s.rows[0]).toEqual({ name: 'ci/x', state: 'fail' });
	});

	it.each([[[]], [undefined], [null]])('gives "No checks" for %j', (rollup) => {
		expect(checksSummary(rollup)).toMatchObject({ text: 'No checks', rows: [] });
	});
});
