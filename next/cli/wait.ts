import { StoreError, readDecisions, readDocument, writeDecision, type Decision } from '#lib/store/store.ts';
import { HANDOFF_MS, fold, type State } from './state.ts';

/** The usage line, printed on stderr with exit 2 for an unknown subcommand or a wrong argument. */
export const USAGE =
	'usage: approval-queue check|send <doc.md> | collect|withdraw <id> | land <owner/repo#n> <sentence> | restart';

const POLL_MS = 1000;

/** Prints the message a store error carries and returns the exit code: 2 for a bad id, else 1. */
export function storeFailure(err: unknown): number {
	if (!(err instanceof StoreError)) throw err;
	if (err.code === 'bad-id') {
		process.stderr.write(`${USAGE}\n`);
		return 2;
	}
	process.stderr.write(`approval-queue: ${err.message}\n`);
	return 1;
}

/** One printed line for a decision: the document id, then the decision record as stored. */
export function decisionLine(id: string, decision: Decision): string {
	return `${JSON.stringify({ id, ...decision })}\n`;
}

/** Reads a document's records and folds them. */
export function readState(root: string, id: string): State {
	return fold(readDecisions(root, id));
}

/**
 * Waits for the queue to hand document `id`'s decision over, printing it as one JSON line, and
 * returns the exit code. Reads the store's files once a second and never asks the server.
 *
 * @remarks Once a decision is 20 seconds old by its `at`, writes the `handed` record, reads the
 * records again, and prints only if the fold now says handed. An Undo that took the lower number
 * wins and the wait goes on.
 */
export async function waitForDecision(root: string, id: string): Promise<number> {
	try {
		if (readDocument(root, id).meta.kind === 'report') {
			process.stderr.write(`approval-queue: ${id} is a report; nothing to collect\n`);
			return 1;
		}
		for (;;) {
			let state = readState(root, id);
			if (state.state === 'decided' && Date.now() - Date.parse(state.decision.at) >= HANDOFF_MS) {
				writeDecision(root, id, { action: 'handed', at: new Date().toISOString(), decision: state.n });
				state = readState(root, id);
			}
			if (state.state === 'handed') {
				process.stdout.write(decisionLine(id, state.decision));
				return 0;
			}
			if (state.state === 'withdrawn') {
				process.stderr.write(`approval-queue: ${id} was withdrawn\n`);
				return 1;
			}
			await new Promise((resolve) => setTimeout(resolve, POLL_MS));
		}
	} catch (err) {
		return storeFailure(err);
	}
}
