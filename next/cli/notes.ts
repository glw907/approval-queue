import { storeRoot } from '#lib/store/store.ts';
import { readThreads } from '#lib/components/notes.server.ts';
import { storeFailure } from './wait.ts';

/**
 * Prints document `id`'s note threads as `{ id, threads }` on stdout and returns 0. Each record the
 * fold skipped gets a line on stderr; an unknown id returns 1 with the store's message.
 */
export function notes(id: string): number {
	try {
		const { threads, bad } = readThreads(storeRoot(), id);
		for (const line of bad) process.stderr.write(`approval-queue: ${line}\n`);
		process.stdout.write(`${JSON.stringify({ id, threads })}\n`);
		return 0;
	} catch (err) {
		return storeFailure(err);
	}
}
