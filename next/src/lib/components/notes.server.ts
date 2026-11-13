/**
 * Note threads: the `note-<n>.json` records a document holds, and their fold into threads.
 *
 * @remarks
 * Every note operation is a numbered record, written once and never replaced, so the page and a
 * session's `reply` can write at the same moment and neither is lost. The fold reads the records in
 * number order. A thread's id is the number of the record that opened it. The `notes` and `reply`
 * commands load this module under Node's type stripping, so it holds erasable TypeScript only and
 * never imports `decide.server.ts`.
 */
import { compare } from '#lib/doc/compare.ts';
import { parse } from '#lib/doc/parse.ts';
import { plain, renderInline } from '#lib/doc/render.ts';
import { appendRecord, readDocument, readRecords } from '#lib/store/store.ts';
import type { Entry, Thread, Who } from './types.ts';
import { curly } from './typeset.ts';

export { NOTE_LIMIT, noteLength } from './types.ts';

export type { Entry, Thread, Who };

/** A note operation as it is stored. */
export type NoteRecord =
	| { op: 'open'; who: Who; quote: string; start?: number; version: number; text: string; at: string }
	| { op: 'reply'; thread: number; who: Who; text: string; at: string }
	| { op: 'resolve'; thread: number; resolved: boolean; who: Who; at: string }
	| { op: 'delete'; thread: number; at: string };

/** The threads a document holds, the ids of its deleted ones, and a line per record skipped. */
export type Notes = { threads: Thread[]; deleted: number[]; bad: string[] };

/**
 * Folds a document's note records into its threads, then sets each older thread's `was` or
 * `orphan` against the newest version.
 *
 * @remarks
 * A record that isn't JSON or lacks its operation's fields is skipped and named in `bad`. A record
 * naming a thread the fold doesn't hold, or one already deleted, is dropped. Throws the store's
 * `StoreError` for an unknown id.
 */
export function readThreads(root: string, id: string): Notes {
	const bad: string[] = [];
	const open = new Map<number, Thread & { version: number }>();
	const gone = new Set<number>();
	for (const { n, file, value } of readRecords(root, id, 'note')) {
		const record = noteRecord(value);
		if (!record) {
			bad.push(`${file} isn't a note record the queue can read, so it was skipped.`);
			continue;
		}
		if (record.op === 'open') {
			const { who, quote, start, version, text, at } = record;
			open.set(n, { id: n, quote, start, version, resolved: false, entries: [{ who, text, at }] });
			continue;
		}
		const thread = open.get(record.thread);
		if (!thread || gone.has(record.thread)) continue;
		if (record.op === 'reply') thread.entries.push({ who: record.who, text: record.text, at: record.at });
		else if (record.op === 'resolve') thread.resolved = record.resolved;
		else {
			gone.add(record.thread);
			open.delete(record.thread);
		}
	}

	const { meta, source } = readDocument(root, id);
	const sources = new Map<number, string>();
	const threads = [...open.values()].map(({ version, ...thread }): Thread => {
		if (version >= meta.versions) return thread;
		let old = sources.get(version);
		if (old === undefined) {
			old = readDocument(root, id, version).source;
			sources.set(version, old);
		}
		return moved(thread, old, source);
	});
	return { threads, deleted: [...gone], bad };
}

/**
 * Places a thread written on an older version against the newest one. A quote inside a changed
 * passage's removed words keeps its words when the added words still hold them. Otherwise it takes
 * the added words, with the old ones as `was`, or is an orphan when nothing was added. A quote in no
 * changed passage keeps its words while the newest text holds them, and is otherwise an orphan.
 * A moved thread loses its `start`, because offsets shift between versions.
 */
function moved(thread: Thread, older: string, newest: string): Thread {
	const { start: _start, ...placed } = thread;
	const comparison = compare(older, newest);
	if (comparison.whole) return { ...placed, orphan: true };
	const quote = normalize(thread.quote);
	for (const passage of comparison.passages) {
		if (!normalize(inlineText(passage.removed)).includes(quote)) continue;
		const added = inlineText(passage.added);
		// A changed passage is a whole sentence, so the quoted words can survive inside one.
		if (normalize(added).includes(quote)) return placed;
		if (!added) return { ...placed, orphan: true };
		return { ...placed, quote: added, was: thread.quote };
	}
	if (normalize(documentText(newest)).includes(quote)) return placed;
	return { ...placed, orphan: true };
}

/** The plain text the page draws for a run of inline Markdown. */
export const inlineText = (markdown: string) => plain(curly(renderInline(markdown)));

/** Every piece of text a document draws, joined by spaces. */
function documentText(source: string): string {
	const { doc } = parse(source);
	const parts = [doc.titleHtml];
	for (const seg of doc.segments) {
		if (seg.type === 'html') parts.push(seg.html);
		else if (seg.type === 'question') parts.push(...seg.options.map((o) => o.html));
	}
	return parts.map((html) => plain(curly(html))).join(' ');
}

/** Curly quotes to straight ones, and each run of white space to one space. */
export function normalize(text: string): string {
	return text
		.replace(/[‘’]/g, "'")
		.replace(/[“”]/g, '"')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Stores one note operation and returns its record number, which is a new thread's id. */
export function writeNote(root: string, id: string, record: NoteRecord): number {
	return appendRecord(root, id, 'note', record);
}

const WHO = new Set(['geoff', 'claude']);
const isText = (v: unknown): v is string => typeof v === 'string';
const isCount = (v: unknown, least: number): v is number => Number.isInteger(v) && (v as number) >= least;

/** The record `value` holds, or undefined when it lacks its operation's fields. */
function noteRecord(value: unknown): NoteRecord | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const r = value as Record<string, unknown>;
	if (!isText(r.at)) return undefined;
	if (r.op === 'delete') return isCount(r.thread, 1) ? (r as NoteRecord) : undefined;
	if (!WHO.has(r.who as string)) return undefined;
	if (r.op === 'open') {
		const fine = isText(r.quote) && r.quote !== '' && isText(r.text) && isCount(r.version, 1);
		return fine && (r.start === undefined || isCount(r.start, 0)) ? (r as NoteRecord) : undefined;
	}
	if (!isCount(r.thread, 1)) return undefined;
	if (r.op === 'reply') return isText(r.text) ? (r as NoteRecord) : undefined;
	if (r.op === 'resolve') return typeof r.resolved === 'boolean' ? (r as NoteRecord) : undefined;
	return undefined;
}
