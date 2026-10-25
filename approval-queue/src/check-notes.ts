/**
 * Entry point for the queueing check on a notes file: finds quote anchors that match more than one place.
 *
 * Run as `node check-notes.ts <file> <notes.json>`. It prints one defect per ambiguous note on stderr
 * and exits 2; it prints nothing and exits 0 when every quote is settled, and exits 1 when it cannot
 * read a file. A string anchor is not checked here. It imports only `comments.ts` at run time (the
 * `Note` type is erased), so it runs under plain `node` with no `node_modules`.
 */
import { readFileSync } from 'node:fs';
import { ambiguousQuote } from '#lib/editor/comments.ts';
import type { Note } from '#lib/editor/notes.ts';

/** One defect line per note whose quote anchor `place()` would have to guess at; empty when none. */
export function noteDefects(doc: string, notes: readonly Pick<Note, 'id' | 'anchor'>[]): string[] {
	const lines: string[] = [];
	for (const { id, anchor } of notes) {
		if (typeof anchor === 'string') continue;
		const count = ambiguousQuote(doc, anchor.quote, anchor.prefix, anchor.suffix);
		if (count) lines.push(`note ${id}: the quote "${anchor.quote}" occurs ${count} times; add a prefix or suffix that occurs once`);
	}
	return lines;
}

if (import.meta.main) {
	const [file, notesFile] = process.argv.slice(2);
	if (!file || !notesFile) {
		console.error('usage: check-notes.ts <file> <notes.json>');
		process.exit(1);
	}
	let doc: string;
	let notes: Note[];
	try {
		// Anchors are offsets into LF text, so a CRLF file is read as the page reads it.
		doc = readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
		notes = JSON.parse(readFileSync(notesFile, 'utf8')) as Note[];
	} catch (error) {
		console.error(`check-notes: cannot read ${(error as Error).message}`);
		process.exit(1);
	}
	const defects = noteDefects(doc, notes);
	if (defects.length) {
		console.error(defects.join('\n'));
		process.exit(2);
	}
}
