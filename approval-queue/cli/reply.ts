import { readFileSync } from 'node:fs';
import { readDocument, storeRoot } from '#lib/store/store.ts';
import { NOTE_LIMIT, inlineText, noteLength, readThreads, writeNote } from '#lib/components/notes.server.ts';
import { readState, storeFailure } from './wait.ts';

/** A refusal: its sentence goes on stderr and the command exits 1. */
const refuse = (sentence: string) => {
	process.stderr.write(`approval-queue: ${sentence}\n`);
	return 1;
};

/**
 * Adds a session's note to document `id`, printing the thread it lands in as JSON and returning 0.
 *
 * @remarks
 * With `thread`, the text of `file` becomes a reply in that thread. Without one, `file` opens with
 * a Markdown blockquote of the passage the note is about, and the rest is the note: the quote is
 * stored as the plain text the page draws, signed `claude`, on the newest version, with no start.
 * Refuses with 1 an unknown, deleted, or resolved thread, a withdrawn document, a file it can't
 * read, a new thread with no blockquote, and an empty note or one over the limit.
 */
export function reply(id: string, thread: string | undefined, file: string): number {
	const root = storeRoot();
	try {
		const { threads, deleted } = readThreads(root, id);
		if (readState(root, id).state === 'withdrawn') return refuse(`${id} was withdrawn, so it takes no notes`);
		let source: string;
		try {
			source = readFileSync(file, 'utf8');
		} catch (err) {
			return refuse(`can't read ${file}: ${(err as Error).message}`);
		}

		let n: number;
		if (thread !== undefined) {
			n = /^\d+$/.test(thread) ? Number(thread) : NaN;
			const found = threads.find((t) => t.id === n);
			if (deleted.includes(n)) return refuse(`thread ${thread} of ${id} was deleted`);
			if (!found) return refuse(`${id} has no thread ${thread}`);
			if (found.resolved) return refuse(`thread ${thread} of ${id} is resolved, so it takes no reply`);
			const text = source.trim();
			const fault = textFault(text, file);
			if (fault) return refuse(fault);
			writeNote(root, id, { op: 'reply', thread: n, who: 'claude', text, at: new Date().toISOString() });
		} else {
			const { quote, text } = split(source);
			if (!quote) return refuse(`${file} names no thread, so it must open with a blockquote of the passage`);
			const fault = textFault(text, file);
			if (fault) return refuse(fault);
			const version = readDocument(root, id).meta.versions;
			const at = new Date().toISOString();
			n = writeNote(root, id, { op: 'open', who: 'claude', quote: inlineText(quote), version, text, at });
		}
		const landed = readThreads(root, id).threads.find((t) => t.id === n);
		process.stdout.write(`${JSON.stringify({ id, thread: landed })}\n`);
		return 0;
	} catch (err) {
		return storeFailure(err);
	}
}

/** The sentence refusing an empty note or one over the limit, or undefined for a fine one. */
function textFault(text: string, file: string): string | undefined {
	if (!text) return `${file} holds no note`;
	const length = noteLength(text);
	if (length > NOTE_LIMIT) return `the note is ${length.toLocaleString('en-US')} characters; notes can be up to 4,000`;
	return undefined;
}

/** Splits a new thread's file into the blockquote it opens with, its lines joined, and the note after. */
function split(source: string): { quote: string; text: string } {
	const lines = source.replace(/^\s*\n/, '').split('\n');
	let i = 0;
	while (i < lines.length && lines[i].startsWith('>')) i++;
	const quote = lines
		.slice(0, i)
		.map((l) => l.replace(/^> ?/, '').trim())
		.filter(Boolean)
		.join(' ');
	return { quote, text: lines.slice(i).join('\n').trim() };
}
