import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDocument } from '#lib/store/store.ts';
import { record, standingOf } from './decide.server.ts';

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
	root = mkdtempSync(join(tmpdir(), 'aq-view-'));
	id = createDocument(root, SOURCE, { kind: 'decide', title: 'Which way?' }).id;
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('the decision the page shows', () => {
	it('carries via and the whole message for a chat decision, and not the session', () => {
		record(root, id, 'approve', { q1: 0 }, { via: 'chat', message: 'Looks right.\napprove it', session: 'abc' });
		const { decision } = standingOf(root, id);
		expect(decision).toMatchObject({ action: 'approve', via: 'chat', message: 'Looks right.\napprove it' });
		expect(decision).not.toHaveProperty('session');
	});

	it('carries neither for a decision made on the page', () => {
		record(root, id, 'approve', { q1: 0 });
		const { decision } = standingOf(root, id);
		expect(decision).not.toHaveProperty('via');
		expect(decision).not.toHaveProperty('message');
	});
});
