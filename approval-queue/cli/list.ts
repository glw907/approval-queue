import { StoreError, listDocuments, readDecisions, storeRoot } from '#lib/store/store.ts';
import { USAGE, storeFailure } from './wait.ts';
import { fold } from './state.ts';

const POLL_MS = 1000;

/** One waiting document, as `list` prints it. */
interface Waiting {
	id: string;
	kind: string;
	title: string;
}

const line = (w: Waiting): string => `${w.id}\t${w.kind}\t${w.title}\n`;

/** One line of `s`, with each run of white space as one space. */
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * The documents that wait for Geoff, oldest first: every one that folds to waiting, a report
 * nobody has marked read included. A document whose files can't be read is skipped and named once
 * in `warned`, which the caller prints.
 */
function waiting(root: string, warned: Set<string>): Waiting[] {
	const { documents, unreadable } = listDocuments(root);
	const out: Waiting[] = [];
	const warn = (id: string, reason: string) => {
		if (warned.has(id)) return;
		warned.add(id);
		process.stderr.write(`approval-queue: ${id}: ${reason}\n`);
	};
	for (const file of unreadable) warn(file.split('/').at(-2) ?? file, "the document's meta.json can't be read");
	for (const meta of documents) {
		try {
			if (fold(readDecisions(root, meta.id)).state === 'waiting') {
				out.push({ id: meta.id, kind: meta.kind ? String(meta.kind) : '-', title: oneLine(String(meta.title ?? '')) });
			}
		} catch (err) {
			warn(meta.id, err instanceof Error ? err.message : String(err));
		}
	}
	return out;
}

/**
 * Prints the documents waiting for Geoff, one per line: the id, the kind (`-` for none), and the
 * title, separated by tabs. With `--wait`, prints nothing at first, then exits once a document
 * waits that wasn't waiting at the start, printing its line.
 *
 * @remarks Reads the store once a second and never asks the server. An id that leaves waiting
 * drops out of the baseline, so a returned revision, or an Undo, counts as new. Returns 0, 1 for
 * a store failure, or 2 for usage.
 */
export async function list(argv: string[]): Promise<number> {
	const wait = argv[0] === '--wait';
	if (argv.length > (wait ? 1 : 0)) {
		process.stderr.write(`${USAGE}\n`);
		return 2;
	}
	try {
		const root = storeRoot();
		const warned = new Set<string>();
		const now = waiting(root, warned);
		if (!wait) {
			process.stdout.write(now.map(line).join(''));
			return 0;
		}
		let baseline = new Set(now.map((w) => w.id));
		for (;;) {
			await new Promise((resolve) => setTimeout(resolve, POLL_MS));
			const current = waiting(root, warned);
			const ids = new Set(current.map((w) => w.id));
			baseline = new Set([...baseline].filter((id) => ids.has(id)));
			const fresh = current.filter((w) => !baseline.has(w.id));
			if (fresh.length) {
				process.stdout.write(fresh.map(line).join(''));
				return 0;
			}
		}
	} catch (err) {
		if (err instanceof StoreError) return storeFailure(err);
		process.stderr.write(`approval-queue: ${err instanceof Error ? err.message : String(err)}\n`);
		return 1;
	}
}
