/**
 * Entry point for the queueing check on a notes file: finds quote anchors that match more than one place.
 *
 * Run as `node check-notes.ts <dir> <notes.json>`, where each note's `file` resolves under `<dir>`.
 * It prints one defect per ambiguous note on stderr and exits 2; it prints nothing and exits 0 when
 * every quote is settled, and exits 1 when it cannot read a file. It imports only `comments.ts` at
 * run time (the `Note` type is erased), so it runs under plain `node` with no `node_modules`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ambiguousQuote } from '#lib/editor/comments.ts';
import type { Note } from '#lib/editor/notes.ts';

/** One defect line per note whose quote `place()` would have to guess at; empty when none. */
export function noteDefects(notes: readonly Pick<Note, 'id' | 'file' | 'anchor'>[], pageText: (file: string) => string): string[] {
	const lines: string[] = [];
	for (const { id, file, anchor } of notes) {
		const count = ambiguousQuote(pageText(file), anchor.quote, anchor.prefix, anchor.suffix);
		if (count) lines.push(`note ${id} (${file}): the quote "${anchor.quote}" occurs ${count} times`);
	}
	return lines;
}

if (import.meta.main) {
	const [dir, notesFile] = process.argv.slice(2);
	if (!dir || !notesFile) {
		console.error('usage: check-notes.ts <dir> <notes.json>');
		process.exit(1);
	}
	let defects: string[];
	try {
		const notes = JSON.parse(readFileSync(notesFile, 'utf8')) as Note[];
		// Anchors are offsets into LF text, so a CRLF page is read as the screen reads it.
		defects = noteDefects(notes, (file) => readFileSync(join(dir, file), 'utf8').replaceAll('\r\n', '\n'));
	} catch (error) {
		console.error(`check-notes: cannot read ${(error as Error).message}`);
		process.exit(1);
	}
	if (defects.length) {
		console.error(defects.join('\n'));
		process.exit(2);
	}
}
