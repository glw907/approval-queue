import type { Fault } from '#lib/doc/types.ts';

/** One `prs` line of a merge document, as the checks need it. */
export type PrLine = { repo: string; number: number; words: string; line: number };

/** One entry of `gh pr view --json statusCheckRollup`: a check run or a commit status. */
export type RollupEntry = {
	name?: string;
	context?: string;
	conclusion?: string | null;
	status?: string | null;
	state?: string | null;
};

export type PrView = { state: string; isDraft: boolean; statusCheckRollup?: RollupEntry[] | null };

/** What reading a pull request gives: its view, or the first line of the reader's error. */
export type ViewResult = { ok: true; view: PrView } | { ok: false; error: string };

export type PrFindings = { faults: Fault[]; pending: string[] };

type PrCheck = (pr: PrLine, view: PrView) => PrFindings;

const ref = (pr: PrLine) => `${pr.repo}#${pr.number}`;
const named = (pr: PrLine) => `${ref(pr)} (${pr.words})`;
const fault = (pr: PrLine, code: string, message: string): Fault => ({ code, message, lines: [pr.line] });

function stateCheck(pr: PrLine, view: PrView): PrFindings {
	const state = view.state.toUpperCase();
	if (state === 'MERGED') return { faults: [fault(pr, 'pr-merged', `${named(pr)} is merged.`)], pending: [] };
	if (state === 'CLOSED') return { faults: [fault(pr, 'pr-closed', `${named(pr)} is closed.`)], pending: [] };
	if (view.isDraft) return { faults: [fault(pr, 'pr-draft', `${named(pr)} is a draft.`)], pending: [] };
	return { faults: [], pending: [] };
}

const PASSED = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);

// The same reading of the rollup as the old command's rollup_failing and rollup_pending.
function failed(entry: RollupEntry): boolean {
	const conclusion = entry.conclusion ?? '';
	return (conclusion !== '' && !PASSED.has(conclusion)) || entry.state === 'FAILURE' || entry.state === 'ERROR';
}

function running(entry: RollupEntry): boolean {
	return (entry.status != null && entry.status !== 'COMPLETED') || entry.state === 'PENDING';
}

function checksCheck(pr: PrLine, view: PrView): PrFindings {
	const found: PrFindings = { faults: [], pending: [] };
	for (const entry of view.statusCheckRollup ?? []) {
		const name = entry.name || entry.context || 'unnamed';
		if (failed(entry)) found.faults.push(fault(pr, 'pr-check-failed', `${named(pr)}: the check "${name}" failed.`));
		else if (running(entry)) found.pending.push(`${named(pr)}: the check "${name}" is still running.`);
	}
	return found;
}

/**
 * The checks run on each pull request of a merge document, one entry per line so that each can be
 * removed alone to show its test fails.
 */
export const PR_CHECKS: PrCheck[] = [
	stateCheck,
	checksCheck,
];

/**
 * Reads each pull request through `view` and runs every check on it.
 *
 * @remarks A pull request that can't be read gives one fault and no other check. A check still
 * running is a pending line, never a fault, so `check` can exit 0 while `send` refuses.
 */
export function checkPullRequests(prs: PrLine[], view: (repo: string, number: number) => ViewResult): PrFindings {
	const found: PrFindings = { faults: [], pending: [] };
	for (const pr of prs) {
		const read = view(pr.repo, pr.number);
		if (!read.ok) {
			found.faults.push(fault(pr, 'pr-unreadable', `could not read ${ref(pr)} from GitHub: ${read.error}.`));
			continue;
		}
		for (const check of PR_CHECKS) {
			const { faults, pending } = check(pr, read.view);
			found.faults.push(...faults);
			found.pending.push(...pending);
		}
	}
	return found;
}
