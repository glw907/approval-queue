import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDocument, readDecisions, readRecords, writeDecision } from '#lib/store/store.ts';

const CLI = fileURLToPath(new URL('./index.js', import.meta.url));
const FIXTURE = fileURLToPath(new URL('./fixtures/desk-record.jsonl', import.meta.url));
const SESSION = '00000000-0000-4000-8000-0000000000de';
const MERGE = fileURLToPath(new URL('../../docs/mockup/content/10-merge-gaps.md', import.meta.url));

const DECIDE = `---
kind: decide
approve: I go ahead.
sendback: I answer each note.
---

# Which way?

A short question about direction.

:::question Direction
- **left**. Short. {recommended}
- **right**. Long.
:::
`;

const TITLE = 'Which way?';
const APPROVE = 'Read it through, looks right. approve it';

let dir: string;
let state: string;
let root: string;
let env: Record<string, string>;

/** Stores `source` as a document that arrived at 10:05 on the fixture's day. */
function store(source = DECIDE): string {
	const { id } = createDocument(root, source, { kind: 'decide', title: TITLE });
	const meta = join(root, id, 'meta.json');
	const parsed = JSON.parse(readFileSync(meta, 'utf8')) as Record<string, unknown>;
	writeFileSync(meta, JSON.stringify({ ...parsed, created: '2026-01-01T10:05:00.000Z' }));
	return id;
}

function stub(rows: unknown): void {
	const file = join(dir, 'bin', 'claude');
	writeFileSync(file, `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify(rows)}\nEOF\n`);
	chmodSync(file, 0o755);
}

function run(args: string[]) {
	const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env, timeout: 10000 });
	return { code: r.status, out: r.stdout, err: r.stderr };
}

const answer = (id: string, action: string, ...rest: string[]) => run(['answer', id, action, ...rest]);
const files = (id: string) => readdirSync(join(root, id)).sort();
const decisions = (id: string) => readDecisions(root, id);
const notes = (id: string) => readRecords(root, id, 'note');

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'aq-answer-'));
	state = join(dir, 'state');
	root = join(state, 'store');
	mkdirSync(join(dir, 'bin'));
	mkdirSync(state);
	mkdirSync(join(dir, 'projects', '-fixture'), { recursive: true });
	copyFileSync(FIXTURE, join(dir, 'projects', '-fixture', `${SESSION}.jsonl`));
	env = {
		PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
		APPROVAL_QUEUE_STATE: state,
		CLAUDE_CONFIG_DIR: dir,
		CLAUDE_CODE_SESSION_ID: SESSION
	};
	stub([{ sessionId: SESSION, name: 'desk' }]);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('answer approve', () => {
	it('records the approve with the whole message, the session, and each pick', () => {
		const id = store();
		const r = answer(id, 'approve', '--words', 'approve it', '--pick', 'Direction=2');
		expect(r).toMatchObject({ code: 0, out: `recorded approve on ${id}\n` });
		const d = decisions(id).find((x) => x.action === 'approve');
		expect(d).toMatchObject({
			via: 'chat',
			message: APPROVE,
			session: SESSION,
			answers: { q1: { pick: 1, label: 'right' } }
		});
	});

	it('refuses a session not named desk', () => {
		const id = store();
		stub([{ sessionId: SESSION, name: 'pennant' }]);
		const before = files(id);
		const r = answer(id, 'approve', '--words', 'approve it', '--pick', 'Direction=1');
		expect(r.code).toBe(1);
		expect(r.err).toMatch(/^approval-queue: answer runs only in the session named desk/);
		expect(files(id)).toEqual(before);
	});

	it.each([
		['words in no entry', 'approve this', 'no message Geoff entered'],
		['words only in a peer message', 'Peer words approve', 'no message Geoff entered'],
		['words only in a tool result', 'Tool words approve', 'no message Geoff entered'],
		['words only in a compaction summary', 'Summary words approve', 'no message Geoff entered'],
		['words entered before the latest version arrived', 'Early words approve', 'before the document']
	])('refuses %s', (_name, words, sentence) => {
		const id = store();
		const before = files(id);
		const r = answer(id, 'approve', '--words', words, '--pick', 'Direction=1');
		expect(r.code).toBe(1);
		expect(r.err).toContain(sentence);
		expect(files(id)).toEqual(before);
	});

	it('refuses while a question is unanswered', () => {
		const id = store();
		const before = files(id);
		const r = answer(id, 'approve', '--words', 'approve it');
		expect(r.code).toBe(1);
		expect(r.err).toContain('Answer Direction first.');
		expect(files(id)).toEqual(before);
	});

	it('refuses an unknown label and an option out of range', () => {
		const id = store();
		const before = files(id);
		expect(answer(id, 'approve', '--words', 'approve it', '--pick', 'Nope=1').code).toBe(1);
		expect(answer(id, 'approve', '--words', 'approve it', '--pick', 'Direction=3').code).toBe(1);
		expect(answer(id, 'approve', '--words', 'approve it', '--pick', 'Direction=0').code).toBe(1);
		expect(files(id)).toEqual(before);
	});

	it('refuses a document already decided, the same action or the other one', () => {
		const id = store();
		writeDecision(root, id, { action: 'approve', at: new Date().toISOString(), answers: {} });
		const before = files(id);
		expect(answer(id, 'approve', '--words', 'approve it', '--pick', 'Direction=1').code).toBe(1);
		const other = answer(id, 'sendback', '--words', 'Send the theme design back', '--note', 'The palette question is the wrong question.');
		expect(other.code).toBe(1);
		expect(files(id)).toEqual(before);
		expect(notes(id)).toHaveLength(0);
	});

	it('refuses a usage error with exit 2', () => {
		expect(run(['answer', 'x']).code).toBe(2);
		expect(run(['answer', 'x', 'approve']).code).toBe(2);
		expect(run(['answer', 'x', 'read', '--words', 'a']).code).toBe(2);
	});
});

describe('answer sendback', () => {
	const WORDS = 'Send the theme design back. The palette question is the wrong question.';

	it('refuses a report before it writes a note or a decision', () => {
		const { id } = createDocument(root, '---\nkind: report\n---\n\n# A report\n\nText.\n', { kind: 'report', title: 'A report' });
		const meta = join(root, id, 'meta.json');
		const parsed = JSON.parse(readFileSync(meta, 'utf8')) as Record<string, unknown>;
		writeFileSync(meta, JSON.stringify({ ...parsed, created: '2026-01-01T10:05:00.000Z' }));
		const r = answer(id, 'sendback', '--words', 'Send the theme design back', '--note', 'The palette question is the wrong question.');
		expect(r.code).toBe(1);
		expect(r.err).toBe("approval-queue: The page asked for a decision this document can't take.\n");
		expect(notes(id)).toEqual([]);
		expect(decisions(id)).toEqual([]);
	});

	it('refuses a document whose arrival time is unreadable, recording nothing', () => {
		const id = store();
		const meta = join(root, id, 'meta.json');
		const parsed = JSON.parse(readFileSync(meta, 'utf8')) as Record<string, unknown>;
		writeFileSync(meta, JSON.stringify({ ...parsed, created: 'soon' }));
		const r = answer(id, 'approve', '--words', 'Early words approve', '--pick', 'Direction=1');
		expect(r.code).toBe(1);
		expect(r.err).toMatch(/^approval-queue: /);
		expect(decisions(id)).toEqual([]);
	});

	it('takes no --pick on a send-back, as usage', () => {
		const id = store();
		expect(answer(id, 'sendback', '--words', 'Send the theme design back', '--note', 'The palette question is the wrong question.', '--pick', 'Direction=1').code).toBe(2);
	});

	it("stores the note as Geoff's from chat, then records the send-back", () => {
		const id = store();
		const r = answer(id, 'sendback', '--words', 'Send the theme design back', '--note', 'The palette question is the wrong question.');
		expect(r).toMatchObject({ code: 0, out: `recorded sendback on ${id}\n` });
		const [note] = notes(id);
		expect(note.value).toMatchObject({
			op: 'open',
			who: 'geoff',
			via: 'chat',
			quote: TITLE,
			version: 1,
			text: 'The palette question is the wrong question.'
		});
		expect(decisions(id).find((x) => x.action === 'sendback')).toMatchObject({ via: 'chat', message: WORDS, session: SESSION });
	});

	it('quotes the passage when it is in the document', () => {
		const id = store();
		const r = answer(id, 'sendback', '--words', 'Send the theme design back', '--note', 'The palette question is the wrong question.', '--passage', 'A short question about direction.');
		expect(r.code).toBe(0);
		expect(notes(id)[0].value).toMatchObject({ quote: 'A short question about direction.' });
	});

	it('refuses a passage the document lacks, storing nothing', () => {
		const id = store();
		const r = answer(id, 'sendback', '--words', 'Send the theme design back', '--note', 'The palette question is the wrong question.', '--passage', 'not in it');
		expect(r.code).toBe(1);
		expect(notes(id)).toHaveLength(0);
		expect(decisions(id)).toHaveLength(0);
	});

	it('refuses a note outside the message', () => {
		const id = store();
		const r = answer(id, 'sendback', '--words', 'Send the theme design back', '--note', 'A different note.');
		expect(r.code).toBe(1);
		expect(notes(id)).toHaveLength(0);
		expect(decisions(id)).toHaveLength(0);
	});

	it('refuses a note that only sits inside a paste', () => {
		const id = store();
		const r = answer(id, 'sendback', '--words', 'Here is the log.', '--note', 'Paste words approve');
		expect(r.code).toBe(1);
		expect(notes(id)).toHaveLength(0);
	});

	it('refuses a send-back with no note, as usage', () => {
		const id = store();
		expect(answer(id, 'sendback', '--words', 'Send the theme design back').code).toBe(2);
	});
});

describe('answer --new', () => {
	function doc(source = DECIDE): string {
		const file = join(dir, 'doc.md');
		writeFileSync(file, source);
		return file;
	}
	const stored = () => (existsSync(root) ? readdirSync(root) : []);

	it('stores a decide document and records the approve, skipping only the launch prompt', () => {
		const r = run(['answer', '--new', doc(), 'approve', '--words', 'Early words approve', '--pick', 'Direction=1']);
		expect(r.code).toBe(0);
		const [id] = stored();
		expect(r.out).toBe(`recorded approve on ${id}\n`);
		expect(decisions(id).find((x) => x.action === 'approve')).toMatchObject({ via: 'chat', message: 'Early words approve' });
		const launch = run(['answer', '--new', doc(), 'approve', '--words', 'Launch words approve', '--pick', 'Direction=1']);
		expect(launch.code).toBe(1);
		expect(stored()).toHaveLength(1);
	});

	it('refuses a document that fails its check with one prefixed line, storing nothing', () => {
		const r = run(['answer', '--new', MERGE, 'approve', '--words', 'approve it']);
		expect(r.code).toBe(1);
		expect(r.err).toMatch(/^approval-queue: [^\n]+\n$/);
		expect(stored()).toEqual([]);
	});

	it('refuses a document that passes its check but is not a decide document, storing nothing', () => {
		const r = run(['answer', '--new', doc('---\nkind: report\n---\n\n# A report\n\nText.\n'), 'approve', '--words', 'approve it']);
		expect(r.code).toBe(1);
		expect(r.err).toBe('approval-queue: --new stores a decide document only.\n');
		expect(stored()).toEqual([]);
	});

	it('refuses a bad pick or an unanswered question, storing nothing', () => {
		expect(run(['answer', '--new', doc(), 'approve', '--words', 'approve it', '--pick', 'Direction=9']).code).toBe(1);
		const open = run(['answer', '--new', doc(), 'approve', '--words', 'approve it']);
		expect(open.code).toBe(1);
		expect(open.err).toContain('Answer Direction first.');
		expect(stored()).toEqual([]);
	});

	it('refuses words that no entry holds, storing nothing', () => {
		const r = run(['answer', '--new', doc(), 'approve', '--words', 'approve this', '--pick', 'Direction=1']);
		expect(r.code).toBe(1);
		expect(stored()).toEqual([]);
	});

	it('refuses sendback', () => {
		expect(run(['answer', '--new', doc(), 'sendback', '--words', 'a', '--note', 'b']).code).toBe(2);
	});
});
