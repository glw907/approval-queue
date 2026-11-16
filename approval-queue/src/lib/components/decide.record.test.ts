import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDocument, readDecisions } from '#lib/store/store.ts';
import { Refusal, record } from './decide.server.ts';

const SOURCE = `---
kind: decide
approve: I go ahead.
sendback: I stop.
---

# Which way?

:::question Direction
- **left**. Short. {recommended}
- **right**. Long.
:::
`;

let root: string;
let id: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'aq-record-'));
	id = createDocument(root, SOURCE, { kind: 'decide', title: 'Which way?' }).id;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('record', () => {
	it('writes once, then reports the same action as already recorded', () => {
		const first = record(root, id, 'approve', { q1: 0 });
		expect(first.wrote).toBe(true);
		expect(first.state.state).toBe('decided');
		const second = record(root, id, 'approve', { q1: 0 });
		expect(second.wrote).toBe(false);
		expect(readDecisions(root, id).filter((d) => d.action === 'approve')).toHaveLength(1);
	});

	it('stores the extra fields on the decision record', () => {
		const extra = { via: 'chat', message: 'approve it', session: 'abc' };
		record(root, id, 'approve', { q1: 1 }, extra);
		const d = readDecisions(root, id).find((r) => r.action === 'approve');
		expect(d).toMatchObject(extra);
		expect(d?.answers).toEqual({ q1: { pick: 1, label: 'right' } });
	});

	it('refuses an approve with a question unanswered, as a Refusal', () => {
		expect(() => record(root, id, 'approve', {})).toThrow(Refusal);
		expect(readDecisions(root, id).some((r) => r.action === 'approve')).toBe(false);
	});
});
