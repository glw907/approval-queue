/**
 * Entry point for `approval-queue anchors <file>`: prints the heading anchors a note can name.
 *
 * Run as `node anchors.ts <file>`. It prints one line per heading, `<slug>.heading`, a tab, and the
 * heading's text, with the slug the page gives it. A file ending in `.blueprint.md` is slugged as a
 * blueprint, which counts its `page` title first; any other file is slugged as a page. It exits 1 on
 * a file it cannot read. Unlike `check-brief.ts` it needs the app's `node_modules`, since the slug
 * rule comes from `github-slugger`.
 */
import { readFileSync } from 'node:fs';
import { headingList, type DocKind } from '#lib/editor/notes.ts';

/** The anchor lines of a document's headings, each ending in a newline; empty for a document with none. */
export function anchorLines(doc: string, kind: DocKind): string {
	return headingList(doc, kind)
		.map((h) => `${h.slug}.heading\t${h.text}\n`)
		.join('');
}

if (import.meta.main) {
	const file = process.argv[2];
	if (!file) {
		console.error('usage: anchors.ts <file>');
		process.exit(1);
	}
	let doc: string;
	try {
		doc = readFileSync(file, 'utf8');
	} catch (error) {
		console.error(`anchors: cannot read ${file}: ${(error as Error).message}`);
		process.exit(1);
	}
	// Anchors are offsets into LF text, so a CRLF file is read as the page reads it.
	process.stdout.write(anchorLines(doc.replaceAll('\r\n', '\n'), file.endsWith('.blueprint.md') ? 'blueprint' : 'page'));
}
