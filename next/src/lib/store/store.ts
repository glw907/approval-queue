import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type StoreErrorCode = 'bad-id' | 'missing' | 'unreadable' | 'bad-name' | 'bad-record';

export class StoreError extends Error {
	code: StoreErrorCode;

	constructor(code: StoreErrorCode, message: string) {
		super(message);
		this.name = 'StoreError';
		this.code = code;
	}
}

export type Meta = {
	id: string;
	kind: string;
	title: string;
	/** ISO time the document was created. */
	created: string;
	/** The number of the newest version; versions run from 1 with no gap. */
	versions: number;
};

/** A decision record. Fields past `action` and `at` pass through untouched. */
export type Decision = { action: string; at: string; [field: string]: unknown };

export type Merged = { repo: string; number: number; sentence: string; at: string };

const ID = /^\d{8}-\d{6}-[0-9a-f]{6}$/;
const NAMED = /^[a-z][a-z-]*\.json$/;
const DECISION = /^decision-(\d+)\.json$/;
const NOTE = /^note-(\d+)\.json$/;

/**
 * Resolves the store's root the way the old command resolves its state directory:
 * `$APPROVAL_QUEUE_STATE/store`, else `${XDG_STATE_HOME:-~/.local/state}/approval-queue/store`.
 * Creates nothing.
 */
export function storeRoot(env: Record<string, string | undefined> = process.env): string {
	if (env.APPROVAL_QUEUE_STATE) return path.join(env.APPROVAL_QUEUE_STATE, 'store');
	const state = env.XDG_STATE_HOME || path.join(env.HOME || os.homedir(), '.local/state');
	return path.join(state, 'approval-queue', 'store');
}

/**
 * Writes `data` to a temporary file beside `target`, then renames it over `target`, so a reader
 * sees the old file or the new one and never a part.
 *
 * @throws The write's or the rename's error, after removing the temporary file.
 */
export function writeAtomic(target: string, data: string): void {
	const temp = path.join(
		path.dirname(target),
		`.${path.basename(target)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}`
	);
	try {
		fs.writeFileSync(temp, data);
		fs.renameSync(temp, target);
	} catch (err) {
		fs.rmSync(temp, { force: true });
		throw err;
	}
}

/** Makes a new document with `source` as its version 1, writing `meta.json` last. */
export function createDocument(
	root: string,
	source: string,
	{ kind, title }: { kind: string; title: string }
): Meta {
	fs.mkdirSync(root, { recursive: true });
	for (;;) {
		const now = new Date();
		const id = `${now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}-${crypto
			.randomBytes(3)
			.toString('hex')}`;
		const dir = path.join(root, id);
		try {
			fs.mkdirSync(dir);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue;
			throw err;
		}
		const meta: Meta = { id, kind, title, created: now.toISOString(), versions: 1 };
		writeAtomic(path.join(dir, 'v1.md'), source);
		writeJson(path.join(dir, 'meta.json'), meta);
		return meta;
	}
}

/** Adds the next version of document `id`, writing `meta.json` after the source. */
export function addVersion(root: string, id: string, source: string): Meta {
	const dir = documentDir(root, id);
	const meta = readMeta(dir);
	const next: Meta = { ...meta, versions: meta.versions + 1 };
	writeAtomic(path.join(dir, `v${next.versions}.md`), source);
	writeJson(path.join(dir, 'meta.json'), next);
	return next;
}

/** Reads one version of document `id`, the newest when `version` is left out. */
export function readDocument(
	root: string,
	id: string,
	version?: number
): { meta: Meta; source: string } {
	const dir = documentDir(root, id);
	const meta = readMeta(dir);
	const file = path.join(dir, `v${version ?? meta.versions}.md`);
	if (!fs.existsSync(file)) throw new StoreError('missing', `${file} doesn't exist.`);
	return { meta, source: fs.readFileSync(file, 'utf8') };
}

/**
 * Lists every document's meta, oldest first. A directory not named as an id, or with no
 * `meta.json` yet, is skipped; a `meta.json` that can't be read is reported in `unreadable`.
 */
export function listDocuments(root: string): { documents: Meta[]; unreadable: string[] } {
	const documents: Meta[] = [];
	const unreadable: string[] = [];
	for (const name of entries(root)) {
		if (!ID.test(name)) continue;
		const dir = path.join(root, name);
		if (!fs.existsSync(path.join(dir, 'meta.json'))) continue;
		try {
			documents.push(readMeta(dir));
		} catch (err) {
			if (!(err instanceof StoreError)) throw err;
			unreadable.push(path.join(dir, 'meta.json'));
		}
	}
	documents.sort((x, y) => x.created.localeCompare(y.created) || x.id.localeCompare(y.id));
	return { documents, unreadable };
}

/**
 * Adds a decision record to document `id` as `decision-<n>.json`, the next number, and returns
 * that number. A record is never replaced: when another writer takes the number first, the next
 * one is tried.
 */
export function writeDecision(root: string, id: string, record: Decision): number {
	readMeta(documentDir(root, id));
	if (!validDecision(record)) {
		throw new StoreError('bad-record', 'a decision record needs a string "action" and an ISO "at".');
	}
	return appendRecord(root, id, 'decision', record);
}

/** The prefixes of the numbered records a document holds. */
export type RecordPrefix = 'decision' | 'note';

/**
 * Adds `record` to document `id` as `<prefix>-<n>.json`, the next free number, and returns that
 * number. The record is staged in full and then hard-linked to its name, so it is never replaced
 * and never read in part: when another writer takes the number first, the next one is tried.
 */
export function appendRecord(root: string, id: string, prefix: RecordPrefix, record: unknown): number {
	const dir = documentDir(root, id);
	readMeta(dir);
	const staged = path.join(dir, `.${prefix}.${process.pid}.${crypto.randomBytes(6).toString('hex')}`);
	writeJson(staged, record);
	try {
		let n = recordNumbers(dir, prefix).at(-1) ?? 0;
		for (;;) {
			n++;
			try {
				fs.linkSync(staged, path.join(dir, `${prefix}-${n}.json`));
				return n;
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
			}
		}
	} finally {
		fs.rmSync(staged, { force: true });
	}
}

/**
 * Lists document `id`'s `<prefix>-<n>.json` records in number order, each with its file and its
 * parsed value, or `null` in place of the value when the file isn't JSON. Checking a record's
 * fields is the caller's.
 */
export function readRecords(root: string, id: string, prefix: RecordPrefix): { n: number; file: string; value: unknown }[] {
	const dir = documentDir(root, id);
	return recordNumbers(dir, prefix).map((n) => {
		const file = path.join(dir, `${prefix}-${n}.json`);
		try {
			return { n, file, value: parseFile(file) };
		} catch (err) {
			if (!(err instanceof StoreError)) throw err;
			return { n, file, value: null };
		}
	});
}

/**
 * Reads document `id`'s decision records in the order written, an empty list only when it has
 * no decision file.
 *
 * @throws `StoreError` with code `unreadable`, naming the file, when a decision file isn't JSON
 * or lacks a string `action` or `at`.
 */
export function readDecisions(root: string, id: string): Decision[] {
	const dir = documentDir(root, id);
	return recordNumbers(dir, 'decision').map((n) => {
		const file = path.join(dir, `decision-${n}.json`);
		const record = parseFile(file);
		if (!validDecision(record)) {
			throw new StoreError('unreadable', `${file} has no string "action" or ISO "at".`);
		}
		return record;
	});
}

/**
 * Writes a named JSON file in document `id`'s directory. The name is lowercase letters and
 * hyphens ending `.json`, never `meta.json` or a `decision-` or `note-` name.
 */
export function writeNamed(root: string, id: string, name: string, value: unknown): void {
	checkName(name);
	const dir = documentDir(root, id);
	writeJson(path.join(dir, name), value);
}

/** Reads a named JSON file, or `undefined` when it is absent. */
export function readNamed(root: string, id: string, name: string): unknown {
	checkName(name);
	const file = path.join(documentDir(root, id), name);
	if (!fs.existsSync(file)) return undefined;
	return parseFile(file);
}

/** Records one merged line, one file under `<root>/merged/`. */
export function recordMerged(root: string, line: Merged): void {
	const dir = path.join(root, 'merged');
	fs.mkdirSync(dir, { recursive: true });
	const stamp = line.at.replace(/[^0-9]/g, '');
	writeJson(path.join(dir, `${stamp}-${crypto.randomBytes(3).toString('hex')}.json`), line);
}

/** Lists the merged lines newest first, with the paths of unreadable files apart. */
export function listMerged(root: string): { lines: Merged[]; unreadable: string[] } {
	const dir = path.join(root, 'merged');
	const lines: Merged[] = [];
	const unreadable: string[] = [];
	for (const name of entries(dir)) {
		if (name.startsWith('.') || !name.endsWith('.json')) continue;
		const file = path.join(dir, name);
		try {
			const line = parseFile(file);
			if (!validMerged(line)) throw new StoreError('unreadable', file);
			lines.push(line);
		} catch (err) {
			if (!(err instanceof StoreError)) throw err;
			unreadable.push(file);
		}
	}
	lines.sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
	return { lines, unreadable };
}

function documentDir(root: string, id: string): string {
	if (!ID.test(id)) {
		throw new StoreError('bad-id', `"${id}" isn't a document id, which is YYYYMMDD-HHMMSS-xxxxxx.`);
	}
	const dir = path.join(root, id);
	if (!fs.existsSync(path.join(dir, 'meta.json'))) {
		throw new StoreError('missing', `no document ${id} in ${root}.`);
	}
	return dir;
}

function readMeta(dir: string): Meta {
	const file = path.join(dir, 'meta.json');
	const meta = parseFile(file);
	if (!validMeta(meta)) throw new StoreError('unreadable', `${file} isn't a document's meta.`);
	return meta;
}

function recordNumbers(dir: string, prefix: RecordPrefix): number[] {
	const form = prefix === 'decision' ? DECISION : NOTE;
	return entries(dir)
		.map((name) => form.exec(name))
		.filter((m) => m !== null)
		.map((m) => Number(m[1]))
		.sort((x, y) => x - y);
}

function checkName(name: string): void {
	if (!NAMED.test(name) || name === 'meta.json' || name.startsWith('decision-') || name.startsWith('note-')) {
		throw new StoreError(
			'bad-name',
			`"${name}" can't be a named file. Use lowercase letters and hyphens ending .json, not meta.json or a decision- or note- name.`
		);
	}
}

// Missing directory reads as empty, so a listing never creates the root.
function entries(dir: string): string[] {
	try {
		return fs.readdirSync(dir);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw err;
	}
}

function writeJson(file: string, value: unknown): void {
	writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

function parseFile(file: string): unknown {
	const text = fs.readFileSync(file, 'utf8');
	try {
		return JSON.parse(text);
	} catch (err) {
		throw new StoreError('unreadable', `${file} isn't JSON: ${(err as Error).message}`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isIso(value: unknown): value is string {
	return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function validDecision(value: unknown): value is Decision {
	return isRecord(value) && typeof value.action === 'string' && isIso(value.at);
}

function validMeta(value: unknown): value is Meta {
	return (
		isRecord(value) &&
		typeof value.id === 'string' &&
		typeof value.kind === 'string' &&
		typeof value.title === 'string' &&
		typeof value.created === 'string' &&
		Number.isInteger(value.versions)
	);
}

function validMerged(value: unknown): value is Merged {
	return (
		isRecord(value) &&
		typeof value.repo === 'string' &&
		Number.isInteger(value.number) &&
		typeof value.sentence === 'string' &&
		isIso(value.at)
	);
}
