import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WORDS, findInRecord, findWords, outsidePastes } from './words.ts';

const FIXTURE = fileURLToPath(new URL('./fixtures/desk-record.jsonl', import.meta.url));
const RAW = readFileSync(FIXTURE, 'utf8');
const ARRIVED = Date.parse('2026-01-01T10:05:00.000Z');
const SESSION = '00000000-0000-4000-8000-0000000000de';

const APPROVE = 'Read it through, looks right. approve it';

/** Rewrites the fixture line holding `text`, parsed, through `edit`. */
function edited(text: string, edit: (e: Record<string, unknown>) => void): string {
	return RAW.split('\n')
		.map((line) => {
			if (!line.includes(text)) return line;
			const e = JSON.parse(line) as Record<string, unknown>;
			edit(e);
			return JSON.stringify(e);
		})
		.join('\n');
}

describe('findInRecord', () => {
	it.each([
		['the launch prompt', 'Launch words approve'],
		['a tool result', 'Tool words approve'],
		['a peer message', 'Peer words approve'],
		['a compaction summary', 'Summary words approve'],
		['a task notification', 'Notice words approve'],
		['shell output', 'Shell words approve'],
		['a paste', 'Paste words approve']
	])('refuses words that only %s holds, as not entered by Geoff', (_name, words) => {
		expect(findInRecord(RAW, words, ARRIVED)).toEqual({ ok: false, reason: WORDS.notEntered });
	});

	it.each([
		['typed before the document arrived', 'Early words approve'],
		['queued before it and drained after', 'Queued words approve']
	])('refuses words %s, as before the latest version', (_name, words) => {
		expect(findInRecord(RAW, words, ARRIVED)).toEqual({ ok: false, reason: WORDS.tooEarly });
	});

	it('matches a suggestion accepted after arrival', () => {
		const found = findInRecord(RAW, 'Suggested words approve', ARRIVED, SESSION);
		expect(found).toMatchObject({ ok: true, message: 'Suggested words approve', enteredAt: '2026-01-01T10:11:00.000Z', session: SESSION });
	});

	it('matches approve it and keeps the whole message', () => {
		expect(findInRecord(RAW, 'approve it', ARRIVED)).toMatchObject({ ok: true, message: APPROVE, outside: APPROVE });
	});

	it('trims the words and matches case-sensitively', () => {
		expect(findInRecord(RAW, '  approve it ', ARRIVED).ok).toBe(true);
		expect(findInRecord(RAW, 'Approve it', ARRIVED)).toEqual({ ok: false, reason: WORDS.notEntered });
	});

	it('refuses empty words', () => {
		expect(findInRecord(RAW, '   ', ARRIVED)).toEqual({ ok: false, reason: WORDS.noWords });
	});

	it('moves the arrival past the suggestion and still matches the later message', () => {
		const late = Date.parse('2026-01-01T10:11:30.000Z');
		expect(findInRecord(RAW, 'Suggested words approve', late)).toEqual({ ok: false, reason: WORDS.tooEarly });
		expect(findInRecord(RAW, 'approve it', late).ok).toBe(true);
	});

	it('skips the time check for a null arrival, but never the launch prompt', () => {
		expect(findInRecord(RAW, 'Early words approve', null).ok).toBe(true);
		expect(findInRecord(RAW, 'Launch words approve', null)).toEqual({ ok: false, reason: WORDS.notEntered });
	});

	it('takes the newest message when two hold the words', () => {
		const found = findInRecord(RAW, 'words approve', ARRIVED);
		expect(found).toMatchObject({ ok: true, message: 'Suggested words approve' });
		const both = findInRecord(RAW, 'approve', ARRIVED);
		expect(both).toMatchObject({ ok: true, message: APPROVE });
	});

	it.each([
		['turnOrigin', (e: Record<string, unknown>) => (e.turnOrigin = 'peer')],
		['origin.kind', (e: Record<string, unknown>) => (e.origin = { kind: 'peer' })],
		['isMeta', (e: Record<string, unknown>) => (e.isMeta = true)],
		['isCompactSummary', (e: Record<string, unknown>) => (e.isCompactSummary = true)],
		['isSidechain', (e: Record<string, unknown>) => (e.isSidechain = true)],
		['promptSource', (e: Record<string, unknown>) => (e.promptSource = 'prompt')],
		['content', (e: Record<string, unknown>) => (e.message = { role: 'user', content: [{ type: 'text', text: APPROVE }] })]
	])('refuses a copy of the approve line with %s broken', (_mark, edit) => {
		const raw = edited(APPROVE, edit);
		expect(findInRecord(raw, 'approve it', ARRIVED)).toEqual({ ok: false, reason: WORDS.notEntered });
	});

	it('takes a queued message at its enqueue time, and refuses one with no enqueue record', () => {
		const moved = edited('"operation":"enqueue"', (e) => (e.timestamp = '2026-01-01T10:06:00.000Z'));
		expect(findInRecord(moved, 'Queued words approve', ARRIVED).ok).toBe(true);
		const removed = RAW.split('\n').filter((l) => !l.includes('"operation":"enqueue"')).join('\n');
		expect(findInRecord(removed, 'Queued words approve', ARRIVED)).toEqual({ ok: false, reason: WORDS.notEntered });
	});

	it('skips a line that is not JSON', () => {
		expect(findInRecord(`not json\n${RAW}`, 'approve it', ARRIVED).ok).toBe(true);
	});
});

describe('outsidePastes', () => {
	it('removes a paste by its id and keeps the rest', () => {
		expect(outsidePastes('a <pasted_content id="2">x</pasted_content id="2"> b')).toBe('a  b');
	});
});

describe('findWords', () => {
	let dir: string;
	let env: NodeJS.ProcessEnv;

	/** Writes a stub `claude` whose `agents --json` prints `rows`. */
	function stub(rows: unknown): void {
		const bin = join(dir, 'bin');
		mkdirSync(bin, { recursive: true });
		const file = join(bin, 'claude');
		writeFileSync(file, `#!/bin/sh\ncat <<'EOF'\n${JSON.stringify(rows)}\nEOF\n`);
		chmodSync(file, 0o755);
	}

	function record(project: string): void {
		mkdirSync(join(dir, 'projects', project), { recursive: true });
		copyFileSync(FIXTURE, join(dir, 'projects', project, `${SESSION}.jsonl`));
	}

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'aq-words-'));
		env = { PATH: `${join(dir, 'bin')}:${process.env.PATH}`, CLAUDE_CONFIG_DIR: dir, CLAUDE_CODE_SESSION_ID: SESSION };
		stub([{ sessionId: SESSION, name: 'desk' }, { sessionId: 'other', name: 'pennant' }]);
		record('-fixture');
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it('finds the words in the desk session', () => {
		expect(findWords('approve it', ARRIVED, env)).toMatchObject({ ok: true, message: APPROVE, session: SESSION });
	});

	it('refuses empty words', () => {
		expect(findWords('', ARRIVED, env)).toEqual({ ok: false, reason: WORDS.noWords });
	});

	it('refuses with no session id', () => {
		expect(findWords('approve it', ARRIVED, { ...env, CLAUDE_CODE_SESSION_ID: '' })).toEqual({ ok: false, reason: WORDS.noSessionId });
	});

	it('refuses when no row has the session id', () => {
		stub([{ sessionId: 'other', name: 'desk' }]);
		expect(findWords('approve it', ARRIVED, env)).toEqual({ ok: false, reason: WORDS.notNamed });
	});

	it('refuses a session named desk-2', () => {
		stub([{ sessionId: SESSION, name: 'desk-2' }]);
		expect(findWords('approve it', ARRIVED, env)).toEqual({ ok: false, reason: WORDS.notNamed });
	});

	it('refuses when claude fails', () => {
		const file = join(dir, 'bin', 'claude');
		writeFileSync(file, '#!/bin/sh\nexit 1\n');
		expect(findWords('approve it', ARRIVED, env)).toEqual({ ok: false, reason: WORDS.notNamed });
	});

	it('refuses with no record file', () => {
		rmSync(join(dir, 'projects'), { recursive: true });
		expect(findWords('approve it', ARRIVED, env)).toEqual({ ok: false, reason: WORDS.noRecord });
	});

	it('refuses with two record files', () => {
		record('-second');
		expect(findWords('approve it', ARRIVED, env)).toEqual({ ok: false, reason: WORDS.manyRecords });
	});
});
