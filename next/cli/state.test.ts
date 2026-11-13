import { describe, expect, it } from 'vitest';
import { fold } from './state.ts';

const at = '2026-11-13T00:00:00.000Z';
const approve = { action: 'approve', at };
const undo = { action: 'undo', at };
const withdraw = { action: 'withdraw', at };
const handed = (decision: number) => ({ action: 'handed', at, decision });
const sendback = { action: 'sendback', at };
const returned = { action: 'returned', at, version: 2 };

describe('fold', () => {
	const cases: [string, Parameters<typeof fold>[0], string, number?][] = [
		['none', [], 'waiting'],
		['a decision', [approve], 'decided', 1],
		['decision, undo', [approve, undo], 'waiting'],
		['decision, handed', [approve, handed(1)], 'handed', 1],
		['decision, undo, handed', [approve, undo, handed(1)], 'waiting'],
		['withdraw', [withdraw], 'withdrawn'],
		['decision, withdraw', [approve, withdraw], 'decided', 1],
		['withdraw, decision', [withdraw, approve], 'withdrawn'],
		['decision, undo, decision, handed naming the second', [approve, undo, approve, handed(3)], 'handed', 3],
		['decision, undo, decision, stale handed', [approve, undo, approve, handed(1)], 'decided', 3],
		['decision, handed, undo', [approve, handed(1), undo], 'handed', 1],
		['decision, handed, withdraw', [approve, handed(1), withdraw], 'handed', 1],
		['withdraw, undo', [withdraw, undo], 'withdrawn'],
		['send-back, handed, returned', [sendback, handed(1), returned], 'waiting'],
		['send-back, handed, returned, decision', [sendback, handed(1), returned, approve], 'decided', 4],
		['send-back, handed, returned, decision, handed', [sendback, handed(1), returned, approve, handed(4)], 'handed', 4],
		['returned while waiting', [returned], 'waiting'],
		['send-back, returned before the hand-off', [sendback, returned], 'decided', 1],
		['approve, handed, returned', [approve, handed(1), returned], 'handed', 1],
		['withdraw, returned', [withdraw, returned], 'withdrawn']
	];
	for (const [label, records, state, n] of cases) {
		it(`reads ${label} as ${state}`, () => {
			const result = fold(records);
			expect(result.state).toBe(state);
			if (n !== undefined && 'n' in result) expect(result.n).toBe(n);
		});
	}
});
