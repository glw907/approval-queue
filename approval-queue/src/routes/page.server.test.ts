import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../../scripts/page-checks.mjs';
import { createDocument, listMerged, recordMerged, writeDecision } from '#lib/store/store.ts';
import type { MergedGroup, Row } from '#lib/components/types.ts';
import { load as layoutLoad } from './+layout.server.ts';
import { load as pageLoad } from './+page.server.ts';

let state: string;
let ids: Record<string, string>;
let decided: string;
let rows: Row[];
let merged: MergedGroup[];

beforeAll(async () => {
	state = mkdtempSync(join(tmpdir(), 'aq-front-'));
	process.env.APPROVAL_QUEUE_STATE = state;
	const seeded = await seed(state);
	ids = seeded.ids;
	const old = new Date(Date.now() - 8 * 86_400_000).toISOString();
	recordMerged(seeded.root, { repo: 'glw907/old-tool', number: 9, sentence: 'An old line.', at: old });
	decided = createDocument(seeded.root, readFileSync(join(seeded.root, ids['50-backlog'], 'v1.md'), 'utf8'), {
		kind: 'decide',
		title: 'Decided'
	}).id;
	writeDecision(seeded.root, decided, { action: 'approve', at: new Date().toISOString() });
	const event = {} as Parameters<typeof layoutLoad>[0] & Parameters<typeof pageLoad>[0];
	rows = ((await layoutLoad(event)) as { rows: Row[] }).rows;
	merged = ((await pageLoad(event)) as { merged: MergedGroup[] }).merged;
}, 30_000);

afterAll(() => {
	delete process.env.APPROVAL_QUEUE_STATE;
	rmSync(state, { recursive: true, force: true });
});

describe('the front page', () => {
	it('lists the outstanding decisions oldest first', () => {
		const names = ['10-merge-gaps', '20-survey-edit', '40-queue-design', '50-backlog'];
		expect(rows.filter((r) => r.kind !== 'report').map((r) => r.id)).toEqual(names.map((n) => ids[n]));
	});

	it('lists the report apart', () => {
		expect(rows.filter((r) => r.kind === 'report').map((r) => r.id)).toEqual([ids['30-round-report']]);
	});

	it('leaves a decided document out of every list', () => {
		expect(rows.map((r) => r.id)).not.toContain(decided);
	});

	it('marks the returned document with the time it came back', () => {
		expect(rows.find((r) => r.id === ids['20-survey-edit'])?.returned).toBeTruthy();
		expect(rows.find((r) => r.id === ids['10-merge-gaps'])?.returned).toBeUndefined();
	});

	it('groups the merged lines by tool, newest group first', () => {
		expect(merged.map((g) => [g.tool, g.lines.length])).toEqual([
			['Approval Queue', 4],
			['Standards', 2],
			['Workstation', 1]
		]);
	});

	it("shows each group's lines newest first, each sentence the one land recorded", () => {
		expect(merged[0].lines.map((l) => l.number)).toEqual([18, 17, 16, 15]);
		expect(merged[1].lines.map((l) => l.number)).toEqual([20, 19]);
		for (const g of merged) {
			const times = g.lines.map((l) => Date.parse(l.at));
			expect(times).toEqual([...times].sort((a, b) => b - a));
		}
		const landed = listMerged(join(state, 'store')).lines.find((l) => l.number === 16);
		expect(landed?.sentence).toContain('"Answer and resume"');
		expect(merged[0].lines[2].html).toContain('“Answer and resume”');
		expect(merged[0].lines[2].html).toContain('<code>merge</code>');
	});

	it('drops a line older than seven days', () => {
		expect(merged.map((g) => g.repo)).not.toContain('glw907/old-tool');
	});
});
