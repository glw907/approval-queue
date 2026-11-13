import type { PrView, ViewResult } from '#lib/doc/pr.ts';
import { createDocument, storeRoot, writeNamed } from '#lib/store/store.ts';
import { check } from './check.ts';
import { ghView } from './pr.ts';
import { storeFailure, waitForDecision } from './wait.ts';

/** `ghView`'s view, which carries the head commit the pull request had when it was checked. */
type HeadView = PrView & { headRefOid?: string };

/** A pull request's head as `send` read it, one entry of `heads.json`. */
export type Head = { repo: string; number: number; head: string };

/**
 * Wraps `ghView` so each pull request's head is kept from the same read that was checked, in the
 * order `check` reads them, which is the document's.
 */
function headKeeper() {
	const heads: Head[] = [];
	const headless: string[] = [];
	const view = (repo: string, number: number): ViewResult => {
		const read = ghView(repo, number);
		if (read.ok) {
			const head = (read.view as HeadView).headRefOid;
			if (typeof head === 'string' && head) heads.push({ repo, number, head });
			else headless.push(`${repo}#${number}`);
		}
		return read;
	};
	return { view, heads, headless };
}

/**
 * Checks a document as `check` does, stores it, and waits for the queue's decision. A fault, or a
 * check still running, stores nothing and exits 1. A report prints its id and exits at once.
 *
 * @remarks A merge document also stores `heads.json`, each pull request's head commit as it was
 * checked, which an approve copies so `merge` merges only what Geoff read. A pull request GitHub
 * gives no head for stores nothing and exits 1.
 */
export async function send(path: string): Promise<number> {
	const kept = headKeeper();
	const checked = check(path, kept.view);
	if (checked.code !== 0 || !checked.doc || checked.source === null) {
		process.stderr.write(checked.lines.map((l) => `${l}\n`).join(''));
		return checked.code || 1;
	}
	if (checked.pending.length) {
		process.stderr.write(checked.pending.map((l) => `${l}\n`).join(''));
		process.stderr.write('approval-queue: a check is still running; send it when the checks finish\n');
		return 1;
	}
	const merge = checked.doc.kind === 'merge';
	if (merge && kept.headless.length) {
		const names = kept.headless.join(', ');
		process.stderr.write(`approval-queue: GitHub gave no head commit for ${names}, so nothing was stored\n`);
		return 1;
	}
	const root = storeRoot();
	let id: string;
	try {
		id = createDocument(root, checked.source, { kind: checked.doc.kind as string, title: checked.doc.title }).id;
		if (merge) writeNamed(root, id, 'heads.json', kept.heads);
	} catch (err) {
		return storeFailure(err);
	}
	if (checked.doc.kind === 'report') {
		process.stdout.write(`${id}\n`);
		return 0;
	}
	process.stderr.write(`approval-queue: stored ${id}; waiting for a decision\n`);
	return waitForDecision(root, id);
}
