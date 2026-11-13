import { parse } from '#lib/doc/parse.ts';
import { checkPullRequests, type PrView } from '#lib/doc/pr.ts';
import { StoreError, readDecisions, readDocument, recordMerged, storeRoot } from '#lib/store/store.ts';
import { gh, ghJson } from './pr.ts';
import { fold } from './state.ts';
import { storeFailure } from './wait.ts';

type Head = { repo: string; number: number; head: string };
type MergeView = PrView & { headRefOid: string; baseRefName: string };

const refuse = (message: string): number => {
	process.stderr.write(`approval-queue: ${message}\n`);
	return 2;
};

const isHead = (v: unknown): v is Head => {
	const h = v as Head;
	return !!h && typeof h.repo === 'string' && Number.isInteger(h.number) && typeof h.head === 'string' && h.head !== '';
};

/**
 * Merges each pull request of the approved merge document `id` at the commit Geoff read, in the
 * document's order, and records each for the front page. Before it merges anything it reads every
 * pull request, and it refuses with exit 2, naming the pull request, a head other than the one in
 * the approve record, a base other than the repo's default branch, or a check that failed or is
 * still running.
 *
 * @remarks A pull request already merged at its recorded head is skipped, so a rerun after a
 * part-way failure goes on from there. A `gh pr merge` that fails exits 2: the earlier pull
 * requests stay merged and the later ones untouched.
 */
export function merge(id: string): number {
	const root = storeRoot();
	let source: string;
	let records;
	try {
		source = readDocument(root, id).source;
		records = readDecisions(root, id);
	} catch (err) {
		if (err instanceof StoreError) return storeFailure(err);
		throw err;
	}
	const { doc } = parse(source);
	if (doc.kind !== 'merge') return refuse(`${id} is not a merge document`);
	const state = fold(records);
	if (state.state !== 'handed') return refuse(`${id} is ${state.state}, not handed to the session yet`);
	if (state.decision.action !== 'approve') {
		const what = state.decision.action === 'sendback' ? 'sent back' : state.decision.action;
		return refuse(`${id} was ${what}, not approved`);
	}
	const heads = state.decision.heads;
	if (!Array.isArray(heads) || !heads.length || !heads.every(isHead)) {
		return refuse(`the approve of ${id} names no commits to merge at`);
	}

	const bases = new Map<string, string>();
	const todo: Head[] = [];
	for (const pr of heads) {
		const ref = `${pr.repo}#${pr.number}`;
		if (!bases.has(pr.repo)) {
			const repoView = ghJson<{ defaultBranchRef?: { name?: string } | null }>(['repo', 'view', pr.repo, '--json', 'defaultBranchRef']);
			if (!repoView.ok) {
				process.stderr.write(`${repoView.error}\n`);
				return 1;
			}
			const name = repoView.value.defaultBranchRef?.name;
			if (!name) return refuse(`${pr.repo} has no default branch`);
			bases.set(pr.repo, name);
		}
		const read = ghJson<MergeView>([
			'pr', 'view', String(pr.number), '--repo', pr.repo, '--json', 'state,isDraft,headRefOid,baseRefName,statusCheckRollup'
		]);
		if (!read.ok) return refuse(`could not read ${ref} from GitHub: ${read.error}`);
		const view = read.value;
		if (view.headRefOid !== pr.head) {
			return refuse(`${ref} is at ${view.headRefOid}, not ${pr.head}, the commit Geoff read; nothing was merged`);
		}
		if (view.state === 'MERGED') continue;
		if (view.baseRefName !== bases.get(pr.repo)) {
			return refuse(`${ref} is based on ${view.baseRefName}, which is not the default branch ${bases.get(pr.repo)}; nothing was merged`);
		}
		const found = checkPullRequests([{ ...pr, words: '', line: 0 }], () => ({ ok: true, view }));
		if (found.faults.length) return refuse(`${found.faults[0].message} Nothing was merged.`);
		if (found.pending.length) return refuse(`${found.pending[0]} Nothing was merged.`);
		todo.push(pr);
	}

	const words = new Map(doc.prs.map((p) => [`${p.repo}#${p.number}`, p.words]));
	for (const pr of todo) {
		const ref = `${pr.repo}#${pr.number}`;
		const merged = gh(['pr', 'merge', String(pr.number), '--repo', pr.repo, '--merge', '--match-head-commit', pr.head]);
		if (!merged.ok) return refuse(`GitHub refused to merge ${ref}: ${merged.error}`);
		process.stdout.write(`merged ${ref} at ${pr.head}\n`);
		try {
			recordMerged(root, { repo: pr.repo, number: pr.number, sentence: words.get(ref) ?? '', at: new Date().toISOString() });
		} catch (err) {
			if (!(err instanceof StoreError)) throw err;
			// A rerun skips a merged pull request, so the front page would never list this one.
			process.stderr.write(`approval-queue: ${ref} is merged, but the queue couldn't record it: ${err.message}\n`);
			return 1;
		}
	}
	return 0;
}
