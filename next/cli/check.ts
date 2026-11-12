import { readFileSync } from 'node:fs';
import { parse } from '#lib/doc/parse.ts';
import { checkPullRequests, type ViewResult } from '#lib/doc/pr.ts';
import type { Doc, Fault } from '#lib/doc/types.ts';

/** What checking a file gives: the lines to print, the exit code, and the parts `send` stores from. */
export type Checked = {
	lines: string[];
	code: number;
	/** Pending-check lines apart from the rest; they print before the closing line and never fail `check`. */
	pending: string[];
	/** The file's text and parse, or null when the file couldn't be read. */
	source: string | null;
	doc: Doc | null;
};

const PR_FAULTS = new Set(['bad-pr', 'no-header', 'bad-kind']);

function where(path: string, fault: Fault): string {
	return fault.lines.length ? `${path}:${fault.lines.join(' and ')}` : path;
}

/**
 * Checks one document file and returns the lines to print and the exit code: 1 when it has a
 * fault, else 0, with any pending check listed before the closing line.
 */
export function check(path: string, view: (repo: string, number: number) => ViewResult): Checked {
	let source: string;
	try {
		source = readFileSync(path, 'utf8');
	} catch (err) {
		const reason = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'no such file' : (err as Error).message;
		return { lines: [`${path}: cannot read the file: ${reason}`], code: 1, pending: [], source: null, doc: null };
	}
	const { doc, faults } = parse(source);
	const pending: string[] = [];
	// A pull request line that didn't parse would be read as the wrong pull request, so none is read.
	if (doc.kind === 'merge' && doc.prs.length && !faults.some((f) => PR_FAULTS.has(f.code))) {
		const found = checkPullRequests(doc.prs, view);
		faults.push(...found.faults);
		pending.push(...found.pending);
	}
	if (faults.length) return { lines: faults.map((f) => `${where(path, f)}: ${f.message}`), code: 1, pending, source, doc };
	return { lines: [...pending, `${path}: no faults`], code: 0, pending, source, doc };
}
