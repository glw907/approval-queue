import { storeRoot, writeDecision } from '#lib/store/store.ts';
import { decisionLine, readState, storeFailure } from './wait.ts';

/**
 * Takes back a document that nobody has decided. A decided or handed document refuses with exit 2
 * and its decision on stdout.
 *
 * @remarks Folds the records first, writes the `withdraw` record only while waiting, and folds
 * again, since a decision can land between the two reads.
 */
export function withdraw(id: string): number {
	const root = storeRoot();
	try {
		let state = readState(root, id);
		if (state.state === 'withdrawn') {
			process.stderr.write(`approval-queue: ${id} was already withdrawn\n`);
			return 0;
		}
		if (state.state === 'waiting') {
			writeDecision(root, id, { action: 'withdraw', at: new Date().toISOString() });
			state = readState(root, id);
			if (state.state === 'withdrawn') {
				process.stderr.write(`approval-queue: withdrew ${id}\n`);
				return 0;
			}
		}
		if (state.state === 'waiting') return 1;
		process.stdout.write(decisionLine(id, state.decision));
		process.stderr.write(`approval-queue: ${id} was decided before the withdraw; run collect ${id}\n`);
		if (state.state === 'decided') {
			process.stderr.write('approval-queue: the decision can still be undone; collect waits for the hand-off\n');
		}
		return 2;
	} catch (err) {
		return storeFailure(err);
	}
}
