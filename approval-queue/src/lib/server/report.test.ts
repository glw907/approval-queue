import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FIXTURE } from '../report-fixture.ts';
import { landedInRound, storedHeadline, waitingInRound } from './report.ts';
import type { ItemMeta } from './items.ts';

let root: string;

async function seed(id: string, meta: object, files: Record<string, string> = {}) {
	const dir = join(root, 'items', id);
	await mkdir(dir, { recursive: true });
	for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
	await writeFile(join(dir, 'item.json'), JSON.stringify({ id, repo: 'r', ...meta }));
}

const report = { id: 'r1', kind: 'report', title: 'T', initiative: 'ur', round: 'ur-queue', created: '2026-11-12T06:00:00Z' } as ItemMeta;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'approval-queue-test-'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('storedHeadline', () => {
	it('reads the headline from report.md, and gives nothing when the file is missing', async () => {
		await seed('r1', report, { 'report.md': FIXTURE });
		await seed('r2', report);
		expect(await storedHeadline(root, 'r1')).toBe('3 of 4 passes merged, 1 parked');
		expect(await storedHeadline(root, 'r2')).toBe('');
	});
});

describe('waitingInRound', () => {
	it('lists the waiting packets of the same initiative and round, oldest first', async () => {
		const packet = { kind: 'packet', initiative: 'ur', round: 'ur-queue' };
		await seed('p2', { ...packet, title: 'second', created: '2026-11-12T08:00:00Z' });
		await seed('p1', { ...packet, title: 'first', created: '2026-11-12T07:00:00Z' });
		await seed('p3', { ...packet, round: 'other', title: 'other round', created: '2026-11-12T07:00:00Z' });
		await seed('p4', { ...packet, initiative: 'x', title: 'other initiative', created: '2026-11-12T07:00:00Z' });
		await seed('d1', { kind: 'design', title: 'design', created: '2026-11-12T07:00:00Z' });
		await seed('p5', { ...packet, title: 'decided', created: '2026-11-12T07:00:00Z' }, { 'decision.json': '{"decision":"approve"}' });
		await seed('r9', { ...report, title: 'another report', created: '2026-11-12T07:00:00Z' });
		expect((await waitingInRound(root, report)).map((l) => l.title)).toEqual(['first', 'second']);
	});
});

describe('landedInRound', () => {
	it('lists the round digest lines newest first with GitHub pull request addresses', async () => {
		const line = (ref: string, round?: string) =>
			JSON.stringify({ time: 't', ref, head: 'h', claim: `claim ${ref}`, lane: 'l', ...(round && { round }) });
		await writeFile(join(root, 'digest.jsonl'), [line('o/r#14', 'ur-queue'), line('o/r#9', 'other'), line('o/r#15', 'ur-queue'), line('o/r#3')].join('\n') + '\n');
		expect(await landedInRound(root, report)).toEqual([
			{ ref: 'o/r#15', claim: 'claim o/r#15', url: 'https://github.com/o/r/pull/15' },
			{ ref: 'o/r#14', claim: 'claim o/r#14', url: 'https://github.com/o/r/pull/14' }
		]);
	});

	it('gives nothing for a report with no round', async () => {
		expect(await landedInRound(root, { ...report, round: undefined })).toEqual([]);
	});
});
