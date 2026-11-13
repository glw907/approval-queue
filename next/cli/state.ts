import type { Decision } from '#lib/store/store.ts';

/** Milliseconds between recording a decision and handing it to the waiting session. */
export const HANDOFF_MS = 20_000;

/** The actions that move a fold without being a decision themselves. */
const NOT_DECISIONS = new Set(['undo', 'handed', 'returned']);

export type State =
	| { state: 'waiting' }
	| { state: 'decided'; decision: Decision; n: number }
	| { state: 'handed'; decision: Decision; n: number }
	| { state: 'withdrawn' };

/**
 * Folds a document's records, in number order, into its state: waiting, decided, handed, or
 * withdrawn.
 *
 * @remarks A `withdraw` counts only while waiting. An `undo` returns decided to waiting. A
 * `handed` record names the decision it hands as `decision: <n>`, the record's 1-based
 * position, which is its file number while `writeDecision` numbers files without gaps, and counts only when `n` is the current decision. A `returned` record, which
 * `send --returns` writes with the new version, opens a handed send-back again as waiting and
 * counts in no other state. Any other action is a decision and counts only while waiting. A handed
 * approve or read and a withdrawal are final.
 *
 * For the server (pass A4): import this function and never write a second fold. After writing an
 * Undo or a decision, read the records and fold again, and tell Geoff the Undo or decision lost
 * when the fold says handed or withdrawn. Only the command writes `handed` and `withdraw`, so the
 * server refuses either from the page.
 */
export function fold(records: Decision[]): State {
	let current: State = { state: 'waiting' };
	records.forEach((record, index) => {
		const n = index + 1;
		if (current.state === 'handed') {
			if (record.action === 'returned' && current.decision.action === 'sendback') current = { state: 'waiting' };
			return;
		}
		if (current.state === 'withdrawn') return;
		if (current.state === 'waiting') {
			if (record.action === 'withdraw') current = { state: 'withdrawn' };
			else if (!NOT_DECISIONS.has(record.action)) current = { state: 'decided', decision: record, n };
			return;
		}
		if (record.action === 'undo') current = { state: 'waiting' };
		else if (record.action === 'handed' && record.decision === current.n) {
			current = { state: 'handed', decision: current.decision, n: current.n };
		}
	});
	return current;
}
