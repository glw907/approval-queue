/**
 * Finds the words Geoff typed in the desk session, for the `answer` command. The command trusts
 * a decision only when the session is named `desk` and the words sit in a message Geoff entered
 * after the document's latest version arrived.
 *
 * @remarks The checks guard against a session's mistake, such as a paraphrase or another
 * session's "Geoff approved". They can't stop a session set on faking a record. Claude Code's
 * marks on a record's entries are undocumented, so every mark is required and an entry that
 * lacks one is refused.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The `promptSource` values that mark a message a person entered. */
const ENTERED = new Set(['typed', 'suggestion_accepted', 'queued']);

/** The session a command runs in, named by the one name this command serves. */
const DESK = 'desk';

const PASTE = /<pasted_content id="([^"]*)">[\s\S]*?<\/pasted_content id="\1">/g;

/** Every refusal sentence the checks print, each starting `approval-queue: `. */
export const WORDS = {
	noWords: 'approval-queue: --words needs at least one character.',
	noSessionId: 'approval-queue: answer runs only in the desk session, and no session id is set.',
	notNamed: 'approval-queue: answer runs only in the session named desk, and this session is not.',
	noRecord: "approval-queue: this session's record file isn't there, so no words can be checked.",
	manyRecords: 'approval-queue: more than one record file matches this session, so no words can be checked.',
	notEntered: 'approval-queue: no message Geoff entered in this session holds those words.',
	tooEarly: "approval-queue: Geoff entered those words before the document's latest version arrived."
} as const;

/** A message Geoff entered that holds the words. */
export interface Found {
	ok: true;
	/** The whole message, pastes included. */
	message: string;
	/** The message with every paste removed. */
	outside: string;
	/** When Geoff entered it, as an ISO time. */
	enteredAt: string;
	/** The session id. */
	session: string;
}

export interface NotFound {
	ok: false;
	/** One line that starts `approval-queue: `. */
	reason: string;
}

/** Removes each `<pasted_content>` block from `text`. */
export function outsidePastes(text: string): string {
	return text.replace(PASTE, '');
}

type Entry = Record<string, unknown>;

function parseLines(raw: string): Entry[] {
	const out: Entry[] = [];
	for (const line of raw.split('\n')) {
		if (!line.trim()) continue;
		try {
			const v: unknown = JSON.parse(line);
			if (v && typeof v === 'object' && !Array.isArray(v)) out.push(v as Entry);
		} catch {
			// A line that isn't JSON carries nothing to check.
		}
	}
	return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** True when `e` carries every mark of a message a person entered, whatever its time. */
function entered(e: Entry): boolean {
	if (e.type !== 'user' || typeof e.promptSource !== 'string' || !ENTERED.has(e.promptSource)) return false;
	if (e.turnOrigin !== 'human' || !isRecord(e.origin) || e.origin.kind !== 'human') return false;
	if (e.isMeta === true || e.isCompactSummary === true || e.isSidechain === true) return false;
	return isRecord(e.message) && typeof e.message.content === 'string';
}

const textOf = (e: Entry): string => (e.message as { content: string }).content;

/**
 * When Geoff entered `e`: its own time, or for a queued message the time of the latest enqueue
 * record before it with the same text. `NaN` when a queued message has no such record.
 */
function enteredAt(entries: Entry[], at: number): number {
	const e = entries[at];
	if (e.promptSource !== 'queued') return Date.parse(String(e.timestamp));
	for (let i = at - 1; i >= 0; i--) {
		const q = entries[i];
		if (q.type === 'queue-operation' && q.operation === 'enqueue' && q.content === textOf(e)) {
			return Date.parse(String(q.timestamp));
		}
	}
	return NaN;
}

/**
 * Finds the newest message Geoff entered after `arrived` whose text, with pastes removed, holds
 * `words` exactly. A null `arrived` skips the time check, for a document that didn't exist when
 * he spoke.
 *
 * @param raw - The session record, one JSON entry per line.
 * @param words - The words to find. Trimmed, and refused when empty.
 * @param arrived - When the document's latest version reached the queue, in milliseconds.
 * @remarks The first message in the record that carries an entered mark is never accepted: a
 * `claude --bg` launch prompt, which another session writes, carries the same marks.
 */
export function findInRecord(raw: string, words: string, arrived: number | null, session = ''): Found | NotFound {
	const needle = words.trim();
	if (!needle) return { ok: false, reason: WORDS.noWords };
	const entries = parseLines(raw);
	const launch = entries.findIndex((e) => e.type === 'user' && typeof e.promptSource === 'string' && ENTERED.has(e.promptSource));
	let early = false;
	let hit: { at: number; i: number } | null = null;
	for (let i = 0; i < entries.length; i++) {
		if (i === launch || !entered(entries[i])) continue;
		if (!outsidePastes(textOf(entries[i])).includes(needle)) continue;
		const at = enteredAt(entries, i);
		if (Number.isNaN(at)) continue;
		if (arrived !== null && at <= arrived) {
			early = true;
			continue;
		}
		if (!hit || at >= hit.at) hit = { at, i };
	}
	if (!hit) return { ok: false, reason: early ? WORDS.tooEarly : WORDS.notEntered };
	const message = textOf(entries[hit.i]);
	return { ok: true, message, outside: outsidePastes(message), enteredAt: new Date(hit.at).toISOString(), session };
}

/** The session id and the one record file for it, or the refusal. */
function sessionRecord(env: NodeJS.ProcessEnv): { id: string; file: string } | NotFound {
	const id = env.CLAUDE_CODE_SESSION_ID ?? '';
	if (!/^[A-Za-z0-9-]+$/.test(id)) return { ok: false, reason: WORDS.noSessionId };
	let rows: unknown;
	try {
		rows = JSON.parse(execFileSync('claude', ['agents', '--json'], { env, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'ignore'] }));
	} catch {
		return { ok: false, reason: WORDS.notNamed };
	}
	const row = Array.isArray(rows) ? rows.find((r) => isRecord(r) && r.sessionId === id) : undefined;
	if (!isRecord(row) || row.name !== DESK) return { ok: false, reason: WORDS.notNamed };
	const projects = join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
	const files: string[] = [];
	if (existsSync(projects)) {
		for (const dir of readdirSync(projects)) {
			const file = join(projects, dir, `${id}.jsonl`);
			if (existsSync(file)) files.push(file);
		}
	}
	if (files.length === 0) return { ok: false, reason: WORDS.noRecord };
	if (files.length > 1) return { ok: false, reason: WORDS.manyRecords };
	return { id, file: files[0] };
}

/**
 * Runs the session checks and finds `words`. Reads `CLAUDE_CODE_SESSION_ID` and
 * `CLAUDE_CONFIG_DIR` from `env`, and asks `claude agents --json` for the session's name.
 *
 * @param arrived - See {@link findInRecord}.
 */
export function findWords(words: string, arrived: number | null, env: NodeJS.ProcessEnv = process.env): Found | NotFound {
	if (!words.trim()) return { ok: false, reason: WORDS.noWords };
	const found = sessionRecord(env);
	if ('ok' in found) return found;
	return findInRecord(readFileSync(found.file, 'utf8'), words, arrived, found.id);
}
