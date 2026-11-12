import { readFileSync } from 'node:fs';
import { parse } from '#lib/doc/parse.ts';
import { checkPullRequests, type ViewResult } from '#lib/doc/pr.ts';
import type { Fault } from '#lib/doc/types.ts';

const PR_FAULTS = new Set(['bad-pr', 'no-header', 'bad-kind']);

function where(path: string, fault: Fault): string {
	return fault.lines.length ? `${path}:${fault.lines.join(' and ')}` : path;
}

/**
 * Checks one document file and returns the lines to print and the exit code: 1 when it has a
 * fault, else 0, with any pending check listed before the closing line.
 */
export function check(path: string, view: (repo: string, number: number) => ViewResult): { lines: string[]; code: number } {
	let source: string;
	try {
		source = readFileSync(path, 'utf8');
	} catch (err) {
		const reason = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'no such file' : (err as Error).message;
		return { lines: [`${path}: cannot read the file: ${reason}`], code: 1 };
	}
	const { doc, faults } = parse(source);
	const pending: string[] = [];
	// A pull request line that didn't parse would be read as the wrong pull request, so none is read.
	if (doc.kind === 'merge' && doc.prs.length && !faults.some((f) => PR_FAULTS.has(f.code))) {
		const found = checkPullRequests(doc.prs, view);
		faults.push(...found.faults);
		pending.push(...found.pending);
	}
	if (faults.length) return { lines: faults.map((f) => `${where(path, f)}: ${f.message}`), code: 1 };
	return { lines: [...pending, `${path}: no faults`], code: 0 };
}
