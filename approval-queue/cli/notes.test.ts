import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readThreads, writeNote } from '#lib/components/notes.server.ts';
import { createDocument, readRecords, writeDecision } from '#lib/store/store.ts';
import { USAGE } from './wait.ts';

const CLI = fileURLToPath(new URL('./index.js', import.meta.url));
const MOCKUP = fileURLToPath(new URL('../../docs/mockup/', import.meta.url));
const SURVEY = readFileSync(join(MOCKUP, 'content/20-survey-edit.md'), 'utf8');
const AT = '2026-11-12T09:40:00.000Z';

let state: string;
let root: string;
let id: string;

beforeEach(() => {
	state = mkdtempSync(join(tmpdir(), 'aq-notes-cli-'));
	root = join(state, 'store');
	id = createDocument(root, SURVEY, { kind: 'merge', title: 'Survey' }).id;
	writeNote(root, id, { op: 'open', who: 'geoff', quote: 'the four rules', version: 1, text: 'Why later?', at: AT });
});

afterEach(() => rmSync(state, { recursive: true, force: true }));

function run(...args: string[]) {
	const result = spawnSync(process.execPath, [CLI, ...args], {
		encoding: 'utf8',
		env: { ...process.env, APPROVAL_QUEUE_STATE: state }
	});
	return { code: result.status, out: result.stdout, err: result.stderr };
}

function file(name: string, text: string): string {
	const path = join(state, name);
	writeFileSync(path, text);
	return path;
}

const noteCount = () => readRecords(root, id, 'note').length;

describe('notes', () => {
	it('prints the threads as JSON', () => {
		const { code, out } = run('notes', id);
		expect(code).toBe(0);
		const printed = JSON.parse(out);
		expect(printed.id).toBe(id);
		expect(printed.threads).toEqual([
			{ id: 1, quote: 'the four rules', resolved: false, entries: [{ who: 'geoff', text: 'Why later?', at: AT }] }
		]);
	});

	it('names a malformed record on stderr and still exits 0', () => {
		writeFileSync(join(root, id, 'note-2.json'), '{"op":');
		const { code, out, err } = run('notes', id);
		expect(code).toBe(0);
		expect(JSON.parse(out).threads).toHaveLength(1);
		expect(err).toContain('note-2.json');
	});

	it('exits 1 for an unknown id', () => {
		const { code, err } = run('notes', '20261112-083300-abcdef');
		expect(code).toBe(1);
		expect(err).toContain('no document');
	});
});

describe('reply', () => {
	it('adds a claude entry to a thread', () => {
		const { code, out } = run('reply', id, '1', file('r.md', 'Because round.md is an earlier pass’s.\n'));
		expect(code).toBe(0);
		expect(JSON.parse(out).thread.entries.at(-1)).toMatchObject({ who: 'claude', text: 'Because round.md is an earlier pass’s.' });
		expect(readThreads(root, id).threads[0].entries.map((e) => e.who)).toEqual(['geoff', 'claude']);
	});

	it('starts a claude thread from a blockquote, stored as the page’s plain text', () => {
		const text = '> fix the four rules in `round.md`\n> as backlog #81\n\nWhy I recommend this: it\'s an earlier pass\'s file.\n';
		const { code, out } = run('reply', id, file('new.md', text));
		expect(code).toBe(0);
		const { thread } = JSON.parse(out);
		expect(thread).toMatchObject({
			id: 2,
			quote: 'fix the four rules in round.md as backlog #81',
			resolved: false,
			entries: [{ who: 'claude', text: "Why I recommend this: it's an earlier pass's file." }]
		});
		expect(thread.start).toBeUndefined();
		expect(readRecords(root, id, 'note')[1].value).toMatchObject({ op: 'open', version: 1, who: 'claude' });
	});

	it('takes a curly quote from a session’s straight one', () => {
		const { out } = run('reply', id, file('q.md', "> #234 can't merge before it\n\nNote.\n"));
		expect(JSON.parse(out).thread.quote).toBe('#234 can’t merge before it');
	});

	const refusals: [string, () => string[], string][] = [
		['an unknown id', () => ['20261112-083300-abcdef', '1', file('a.md', 'x')], 'no document'],
		['an unknown thread', () => [id, '7', file('a.md', 'x')], 'has no thread 7'],
		['a thread number that is not a plain number', () => [id, '1.0', file('a.md', 'x')], 'has no thread 1.0'],
		['a missing file', () => [id, '1', join(state, 'absent.md')], "can't read"],
		['a new thread with no blockquote', () => [id, file('a.md', 'Just a note.')], 'blockquote'],
		['an empty reply', () => [id, '1', file('a.md', '  \n')], 'holds no note'],
		['an empty new note', () => [id, file('a.md', '> the four rules\n\n')], 'holds no note'],
		['a reply over 4,000 characters', () => [id, '1', file('a.md', 'x'.repeat(4001))], 'the note is 4,001 characters']
	];
	for (const [label, args, words] of refusals) {
		it(`refuses ${label} with exit 1`, () => {
			const before = noteCount();
			const { code, err } = run('reply', ...args());
			expect(code).toBe(1);
			expect(err).toContain(words);
			expect(noteCount()).toBe(before);
		});
	}

	it('refuses a deleted thread and a resolved one', () => {
		writeNote(root, id, { op: 'open', who: 'geoff', quote: 'Survey', version: 1, text: 'Gone.', at: AT });
		writeNote(root, id, { op: 'delete', thread: 2, at: AT });
		writeNote(root, id, { op: 'resolve', thread: 1, resolved: true, who: 'geoff', at: AT });
		const deleted = run('reply', id, '2', file('a.md', 'x'));
		expect([deleted.code, deleted.err]).toEqual([1, expect.stringContaining('was deleted')]);
		const resolved = run('reply', id, '1', file('a.md', 'x'));
		expect([resolved.code, resolved.err]).toEqual([1, expect.stringContaining('is resolved')]);
	});

	it('refuses a withdrawn document', () => {
		writeDecision(root, id, { action: 'withdraw', at: AT });
		const { code, err } = run('reply', id, '1', file('a.md', 'x'));
		expect(code).toBe(1);
		expect(err).toContain('withdrawn');
	});

	it('takes two or three arguments, and the usage line names both commands', () => {
		expect(run('reply', id).code).toBe(2);
		expect(run('reply', id, '1', file('a.md', 'x'), 'extra').code).toBe(2);
		expect(USAGE.startsWith('usage: approval-queue check|send <doc.md>')).toBe(true);
		for (const words of ['notes <id>', 'reply <id> [thread] <text.md>', 'send --returns <id> <doc.md>']) {
			expect(USAGE).toContain(words);
		}
	});
});
