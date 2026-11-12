import { createDocument, storeRoot } from '#lib/store/store.ts';
import { check } from './check.ts';
import { ghView } from './pr.ts';
import { storeFailure, waitForDecision } from './wait.ts';

/**
 * Checks a document as `check` does, stores it, and waits for the queue's decision. A fault, or a
 * check still running, stores nothing and exits 1. A report prints its id and exits at once.
 */
export async function send(path: string): Promise<number> {
	const checked = check(path, ghView);
	if (checked.code !== 0 || !checked.doc || checked.source === null) {
		process.stderr.write(checked.lines.map((l) => `${l}\n`).join(''));
		return checked.code || 1;
	}
	if (checked.pending.length) {
		process.stderr.write(checked.pending.map((l) => `${l}\n`).join(''));
		process.stderr.write('approval-queue: a check is still running; send it when the checks finish\n');
		return 1;
	}
	const root = storeRoot();
	let id: string;
	try {
		id = createDocument(root, checked.source, { kind: checked.doc.kind as string, title: checked.doc.title }).id;
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
