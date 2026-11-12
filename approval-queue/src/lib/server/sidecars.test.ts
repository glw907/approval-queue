import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readDigest, writeDigestNotes } from './digest.ts';
import { appendFold } from './folds.ts';
import { listHistory } from './history.ts';
import { readItem, writeDecisionOnce, writeNotes, type Note } from './items.ts';
import { packetFacts } from './packet-facts.ts';
import { seedFacts } from './seed-facts.ts';

let root = '';
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'approval-queue-sidecars-'));
});
afterEach(() => rm(root, { recursive: true, force: true }));

const NOTE: Note = { id: 'n1', text: 'A note', anchor: null };
const dir = (id: string) => join(root, 'items', id);

describe('writeNotes', () => {
	it('writes through a temp file and leaves none behind', async () => {
		await seedFacts(root, 'p', 'close');
		expect(await writeNotes(root, 'p', [NOTE])).toBe(true);
		expect(JSON.parse(await readFile(join(dir('p'), 'notes.json'), 'utf8'))).toEqual([NOTE]);
		expect((await readdir(dir('p'))).filter((f) => f.endsWith('.tmp'))).toEqual([]);
	});

	it('is never partial: a reader polling through many rewrites always parses what it finds', async () => {
		await seedFacts(root, 'p', 'close');
		const big = Array.from({ length: 400 }, (_, i): Note => ({ id: `n${i}`, text: 'x'.repeat(200), anchor: null }));
		await writeNotes(root, 'p', big);
		let writing = true;
		const writes = (async () => {
			for (let i = 0; i < 60; i++) await writeNotes(root, 'p', i % 2 ? big : [NOTE]);
			writing = false;
		})();
		let reads = 0;
		while (writing) {
			expect(Array.isArray(JSON.parse(await readFile(join(dir('p'), 'notes.json'), 'utf8')))).toBe(true);
			reads++;
		}
		await writes;
		expect(reads).toBeGreaterThan(0);
	});

	it('takes the file back and reports false when the item was withdrawn', async () => {
		await seedFacts(root, 'p', 'close');
		await rm(join(dir('p'), 'item.json'));
		expect(await writeNotes(root, 'p', [NOTE])).toBe(false);
		await expect(readFile(join(dir('p'), 'notes.json'), 'utf8')).rejects.toThrow();
	});
});

describe('a decision that carries notes', () => {
	it('is never partial: it links whole into place, and a second is refused whole', async () => {
		await seedFacts(root, 'p', 'close');
		const decision = { decision: 'reject' as const, calls: [], decidedForYou: [], notes: [NOTE] };
		expect(await writeDecisionOnce(root, 'p', decision)).toBe('written');
		expect(await writeDecisionOnce(root, 'p', { ...decision, notes: [] })).toBe('exists');
		expect(JSON.parse(await readFile(join(dir('p'), 'decision.json'), 'utf8'))).toEqual(decision);
		expect((await readdir(dir('p'))).filter((f) => f.endsWith('.tmp'))).toEqual([]);
	});
});

describe('readItem on a new-shape packet', () => {
	it('reads as a withdrawn item when its fact file no longer checks', async () => {
		await seedFacts(root, 'p', 'close');
		await writeFile(join(dir('p'), 'facts.json'), '{"kind":"close"}');
		expect(await readItem(root, 'p')).toBeUndefined();
	});
});

describe('packetFacts on a new-shape packet', () => {
	it('counts the calls, their rules, and the repos the PRs name', async () => {
		await seedFacts(root, 'p', 'close');
		expect(await packetFacts(root, 'p')).toEqual({ kind: 'close', asks: 2, rules: ['owner-call', 'public-surface'], repos: 1, repoNames: ['sample'], irreversible: false });
	});
});

describe('listHistory', () => {
	async function decided(id: string, meta: object, decision: object, at: number, files: Record<string, string> = {}) {
		await mkdir(dir(id), { recursive: true });
		await writeFile(join(dir(id), 'item.json'), JSON.stringify({ id, ...meta }));
		await writeFile(join(dir(id), 'decision.json'), JSON.stringify(decision));
		for (const [name, text] of Object.entries(files)) await writeFile(join(dir(id), name), text);
		const when = new Date(at);
		await utimes(join(dir(id), 'decision.json'), when, when);
	}

	it('lists every decided item newest first, with title, kind, decision, and date', async () => {
		await decided('a', { kind: 'packet', title: 'Alpha' }, { decision: 'approve' }, 1_700_000_000_000);
		await decided('b', { kind: 'design', title: 'Beta' }, { decision: 'reject', note: 'n' }, 1_700_000_100_000);
		await decided('c', { kind: 'triage', title: 'Gamma' }, { decision: 'submit', rows: [] }, 1_700_000_050_000);
		await mkdir(dir('waiting'), { recursive: true });
		await writeFile(join(dir('waiting'), 'item.json'), JSON.stringify({ id: 'waiting', kind: 'design', title: 'Waiting' }));
		const rows = await listHistory(root);
		expect(rows.map((r) => [r.id, r.title, r.kind, r.decision])).toEqual([
			['b', 'Beta', 'design', 'reject'],
			['c', 'Gamma', 'triage', 'submit'],
			['a', 'Alpha', 'packet', 'approve']
		]);
		expect(rows[0].date).toBe('2023-11-14T22:15:00.000Z');
	});

	it('searches by title, ignoring case', async () => {
		await decided('a', { kind: 'packet', title: 'Merge the Alpha PR' }, { decision: 'approve' }, 1_700_000_000_000);
		await decided('b', { kind: 'packet', title: 'Beta' }, { decision: 'approve' }, 1_700_000_100_000);
		expect((await listHistory(root, 'alpha')).map((r) => r.id)).toEqual(['a']);
		expect(await listHistory(root, 'zzz')).toEqual([]);
	});

	it('lists an item of a retired kind and an old-shape item', async () => {
		await decided('d', { kind: 'docs', title: 'Old docs' }, { decision: 'approve' }, 1_700_000_000_000);
		await decided('e', { kind: 'packet', title: 'Old packet' }, { decision: 'approve', parts: [] }, 1_700_000_100_000, { 'packet.json': '{}' });
		expect((await listHistory(root)).map((r) => [r.id, r.kind])).toEqual([['e', 'packet'], ['d', 'docs']]);
	});

	it('keeps a row whose replies.json or notes.json is malformed, counting its damaged sidecar as none', async () => {
		await decided('a', { kind: 'packet', title: 'Alpha' }, { decision: 'approve' }, 1_700_000_000_000, {
			'notes.json': JSON.stringify([NOTE]),
			'replies.json': '{nope'
		});
		await decided('b', { kind: 'packet', title: 'Beta' }, { decision: 'approve' }, 1_700_000_100_000, { 'notes.json': '{nope', 'replies.json': '[]' });
		expect((await listHistory(root)).map((r) => [r.id, r.notes, r.replies])).toEqual([['b', 0, 0], ['a', 1, 0]]);
	});

	it('is empty when the queue has no items directory', async () => {
		expect(await listHistory(root)).toEqual([]);
	});
});

describe('readDigest', () => {
	const line = (ref: string, claim: string) => JSON.stringify({ time: '2026-11-10T10:00:00Z', ref, head: 'abc', claim, lane: 'land' });

	it('groups lines by repo, one claim each, newest first', async () => {
		await writeFile(join(root, 'digest.jsonl'), [line('o/b#1', 'first b'), line('o/a#2', 'only a'), line('o/b#3', 'second b')].join('\n') + '\n');
		const groups = await readDigest(root);
		expect(groups.map((g) => [g.repo, g.lines.map((l) => l.claim)])).toEqual([
			['o/a', ['only a']],
			['o/b', ['second b', 'first b']]
		]);
	});

	it('is empty with no digest', async () => {
		expect(await readDigest(root)).toEqual([]);
	});

	it('attaches the notes on a line, and the replies that answer them', async () => {
		await writeFile(join(root, 'digest.jsonl'), `${line('o/a#1', 'one')}\n${line('o/a#2', 'two')}\n`);
		await writeDigestNotes(root, [{ id: 'D1', line: 2, text: 'why?' }]);
		await writeFile(join(root, 'digest-replies.json'), JSON.stringify([{ note: 'D1', outcome: 'answered', text: 'because' }]));
		const [group] = await readDigest(root);
		expect(group.lines.map((l) => [l.line, l.notes.length, l.replies.length])).toEqual([[2, 1, 1], [1, 0, 0]]);
		expect(await readdir(root)).not.toContain(expect.stringMatching(/\.tmp$/));
	});

	it('skips a line that does not parse and still numbers the next one, and ignores a damaged notes file', async () => {
		await writeFile(join(root, 'digest.jsonl'), `{nope\n${line('o/a#1', 'one')}\n`);
		await writeFile(join(root, 'digest-notes.json'), '{nope');
		expect((await readDigest(root))[0].lines.map((l) => [l.line, l.notes])).toEqual([[2, []]]);
	});
});

describe('appendFold', () => {
	it('appends one JSON line per call', async () => {
		await appendFold(root, 'p', 'Reference');
		await appendFold(root, 'p', 'Not checked');
		const lines = (await readFile(join(root, 'folds.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
		expect(lines.map((l) => [l.item, l.fold])).toEqual([['p', 'Reference'], ['p', 'Not checked']]);
	});
});
