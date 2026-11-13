import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from '#lib/doc/parse.ts';
import { createDocument, writeDecision } from '#lib/store/store.ts';
import { decidedToday, rows } from './queue.server.ts';

const CONTENT = fileURLToPath(new URL('../../../../docs/mockup/content/', import.meta.url));

let root: string;

function store(name: string): string {
	const source = readFileSync(join(CONTENT, name), 'utf8');
	const { doc } = parse(source);
	return createDocument(root, source, { kind: doc.kind as string, title: doc.title }).id;
}

/** A local-time instant on the same calendar day as `now`, at `hour`. */
const at = (now: Date, hour: number, dayShift = 0) =>
	new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayShift, hour).toISOString();

const NOW = new Date(2026, 10, 12, 18);

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'aq-queue-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('decidedToday', () => {
	it('lists documents decided or handed today, newest first, and leaves the rest out', () => {
		const early = store('40-queue-design.md');
		const late = store('10-merge-gaps.md');
		const handed = store('20-survey-edit.md');
		const yesterday = store('50-backlog.md');
		const waiting = store('30-round-report.md');
		writeDecision(root, early, { action: 'sendback', at: at(NOW, 9) });
		writeDecision(root, late, { action: 'approve', at: at(NOW, 15) });
		const n = writeDecision(root, handed, { action: 'approve', at: at(NOW, 12) });
		writeDecision(root, handed, { action: 'handed', at: at(NOW, 12), decision: n });
		writeDecision(root, yesterday, { action: 'approve', at: at(NOW, 15, -1) });

		const list = decidedToday(root, NOW);
		expect(list.map((r) => r.id)).toEqual([late, handed, early]);
		expect(list.map((r) => r.action)).toEqual(['approve', 'approve', 'sendback']);
		expect(list.some((r) => r.id === waiting)).toBe(false);
		expect(rows(root).map((r) => r.id)).toEqual([waiting]);
	});

	it('drops a document once its decision is undone, and rows lists it again', () => {
		const report = store('30-round-report.md');
		const n = writeDecision(root, report, { action: 'read', at: at(NOW, 10) });
		expect(decidedToday(root, NOW).map((r) => r.id)).toEqual([report]);
		expect(rows(root)).toEqual([]);
		writeDecision(root, report, { action: 'undo', at: at(NOW, 11), of: n });
		expect(decidedToday(root, NOW)).toEqual([]);
		expect(rows(root).map((r) => r.id)).toEqual([report]);
	});
});
