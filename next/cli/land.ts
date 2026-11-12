import { parse } from '#lib/doc/parse.ts';
import { checkPullRequests, type PrView } from '#lib/doc/pr.ts';
import { StoreError, listDocuments, readDecisions, readDocument, recordMerged, storeRoot } from '#lib/store/store.ts';
import { gh, ghJson } from './pr.ts';
import { fold } from './state.ts';
import { USAGE } from './wait.ts';

const REF = /^([^/#\s]+\/[^/#\s]+)#([0-9]+)$/;
const BEFORE_MERGE = /^##\s+Before merge\s*$/im;

type LandView = PrView & { headRefOid: string; body?: string | null; baseRefName: string };

const refuse = (message: string): number => {
	process.stderr.write(`approval-queue: ${message}\n`);
	return 2;
};

/** The id of a stored merge document that holds `ref` and could still be decided or undone, or null. */
function waitingDocument(root: string, ref: string): string | null {
	const { documents, unreadable } = listDocuments(root);
	if (unreadable.length) throw new StoreError('unreadable', `${unreadable[0]} can't be read, so ${ref} can't be shown not to be waiting.`);
	for (const meta of documents) {
		if (meta.kind !== 'merge') continue;
		const { source } = readDocument(root, meta.id);
		const holds = parse(source).doc.prs.some((pr) => `${pr.repo}#${pr.number}` === ref);
		if (!holds) continue;
		const { state } = fold(readDecisions(root, meta.id));
		if (state === 'waiting' || state === 'decided') return meta.id;
	}
	return null;
}

/**
 * Merges a pull request that needs no decision at the head it read, then records the sentence for
 * the front page. Refuses with exit 2 a pull request in a waiting document, off the default
 * branch, with a `## Before merge` section, merged, closed, a draft, or with a failing check.
 *
 * @remarks A check still running is polled every `APPROVAL_QUEUE_POLL_S` seconds (30) for up to
 * `APPROVAL_QUEUE_POLL_MAX_S` seconds (900), then refused.
 */
export async function land(ref: string, sentence: string): Promise<number> {
	const match = REF.exec(ref);
	if (!match || !sentence.trim()) {
		process.stderr.write(`${USAGE}\n`);
		return 2;
	}
	const [, repo, number] = match;
	const root = storeRoot();
	try {
		const held = waitingDocument(root, ref);
		if (held) return refuse(`${ref} is in the waiting document ${held}; decide it first`);
	} catch (err) {
		if (!(err instanceof StoreError)) throw err;
		return refuse(err.message);
	}
	const repoView = ghJson<{ defaultBranchRef?: { name?: string } | null }>(['repo', 'view', repo, '--json', 'defaultBranchRef']);
	if (!repoView.ok) {
		process.stderr.write(`${repoView.error}\n`);
		return 1;
	}
	const base = repoView.value.defaultBranchRef?.name;
	if (!base) {
		process.stderr.write(`approval-queue: ${repo} has no default branch\n`);
		return 1;
	}
	const poll = Number(process.env.APPROVAL_QUEUE_POLL_S ?? 30);
	const cap = Number(process.env.APPROVAL_QUEUE_POLL_MAX_S ?? 900);
	let waited = 0;
	for (;;) {
		const read = ghJson<LandView>([
			'pr', 'view', number, '--repo', repo, '--json', 'state,isDraft,headRefOid,body,baseRefName,statusCheckRollup'
		]);
		if (!read.ok) {
			process.stderr.write(`${read.error}\n`);
			return 1;
		}
		const view = read.value;
		const found = checkPullRequests([{ repo, number: Number(number), words: sentence, line: 0 }], () => ({ ok: true, view }));
		if (found.faults.length) return refuse(found.faults[0].message);
		if (view.baseRefName !== base) {
			return refuse(`${ref} is based on ${view.baseRefName}, which is not the default branch ${base}`);
		}
		if (BEFORE_MERGE.test(view.body ?? '')) return refuse(`${ref} has a Before merge section; send it in a packet`);
		if (!found.pending.length) {
			const merged = gh(['pr', 'merge', number, '--repo', repo, '--merge', '--match-head-commit', view.headRefOid]);
			if (!merged.ok) {
				process.stderr.write(`${merged.error}\n`);
				return 1;
			}
			recordMerged(root, { repo, number: Number(number), sentence, at: new Date().toISOString() });
			return 0;
		}
		if (waited >= cap) return refuse(`${ref} still has checks pending after ${cap}s`);
		await new Promise((resolve) => setTimeout(resolve, poll * 1000));
		waited += poll;
	}
}
