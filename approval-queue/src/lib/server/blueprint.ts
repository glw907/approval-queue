import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { isCall, type Note } from '#lib/editor/notes.ts';
import type { Decision } from './items.ts';
import type { Fields } from './packet-decision.ts';

const exec = promisify(execFile);

/** Runs git in the worktree and returns its trimmed stdout; a non-zero exit rejects. */
async function git(worktree: string, args: string[]): Promise<string> {
	const { stdout } = await exec('git', ['-C', worktree, ...args], { maxBuffer: 64 * 1024 * 1024 });
	return stdout;
}

/** Where a blueprint stands in its worktree: the HEAD commit, the file's blob there, and its text. */
export interface Committed {
	commit: string;
	blob: string;
	text: string;
}

export async function committed(worktree: string, file: string): Promise<Committed> {
	const commit = (await git(worktree, ['rev-parse', 'HEAD'])).trim();
	const blob = (await git(worktree, ['rev-parse', `${commit}:${file}`])).trim();
	const text = await git(worktree, ['cat-file', 'blob', blob]);
	return { commit, blob, text };
}

/** Whether the file in the worktree matches HEAD, staged and unstaged alike. */
export async function isClean(worktree: string, file: string): Promise<boolean> {
	try {
		await git(worktree, ['diff', '--quiet', 'HEAD', '--', file]);
		return true;
	} catch {
		return false;
	}
}

export type Saved = { ok: true; blob: string; commit: string } | { ok: false; status: 409 | 500; message: string };

// One save at a time per file, so two quick saves never race on the worktree's index lock.
const queues = new Map<string, Promise<unknown>>();

/**
 * Writes the text to the file and commits it, when the file at HEAD is still the blob the text was
 * edited from. A different blob means the file changed outside the review, so the save is refused
 * (409) rather than overwriting it. Text that matches HEAD commits nothing.
 */
export function saveFile(worktree: string, file: string, text: string, base: string): Promise<Saved> {
	const key = join(worktree, file);
	const run = (queues.get(key) ?? Promise.resolve()).then(async (): Promise<Saved> => {
		let now: Committed;
		try {
			now = await committed(worktree, file);
		} catch {
			return { ok: false, status: 500, message: `${file} is no longer committed in its worktree` };
		}
		if (now.blob !== base) return { ok: false, status: 409, message: 'the file changed outside this review; reload the page' };
		// A form post sends every line break as CRLF and the editor reads LF, so the text takes the file's own endings.
		const lf = text.replace(/\r\n/g, '\n');
		text = now.text.includes('\r\n') ? lf.replace(/\n/g, '\r\n') : lf;
		if (text === now.text && (await isClean(worktree, file))) return { ok: true, blob: now.blob, commit: now.commit };
		try {
			await writeFile(key, text);
			await git(worktree, ['commit', '-m', `Edit ${file} in review`, '--', file]);
		} catch (err) {
			const detail = (err as { stderr?: string }).stderr?.trim().split('\n').at(-1) ?? (err as Error).message;
			return { ok: false, status: 500, message: `the commit failed: ${detail}` };
		}
		const after = await committed(worktree, file);
		return { ok: true, blob: after.blob, commit: after.commit };
	});
	queues.set(
		key,
		run.catch(() => undefined)
	);
	return run;
}

/** A disputed note answered by keeping the author's text, which leaves the fact check's finding unapplied. */
export interface Waived {
	id: string;
	choice: string;
	reason: string;
}

export type BlueprintApprove = { ok: true; decision: Decision } | { ok: false; message: string };

/**
 * Builds the approve decision from the stored notes and the post. Every call (a `decide` or
 * `question` note) must carry one of its own choice labels under `call:<id>`, and nothing else
 * may be posted as a call. The commit and blob come from the worktree, never from the post: the
 * posted `blob`, what the page last saved, must still be the file's blob at HEAD, so what the
 * reader approved is exactly what the decision names.
 *
 * A `decide` note answered with a choice that neither rewrites the line (`text`) nor opens it for
 * the reader's own wording (`edit`) waives the fact check's finding; the choice's outcome line is
 * logged as the reason.
 */
export function buildBlueprintApprove(notes: readonly Note[], form: Fields, head: Committed & { clean: boolean }): BlueprintApprove {
	const calls = notes.filter(isCall);
	for (const key of form.keys()) {
		if (key.startsWith('call:') && !calls.some((n) => key === `call:${n.id}`)) {
			return { ok: false, message: `Unknown call ${key.slice('call:'.length)}` };
		}
	}
	const out: Array<{ id: string; choice: string }> = [];
	const waived: Waived[] = [];
	for (const note of calls) {
		const label = form.get(`call:${note.id}`);
		const picked = typeof label === 'string' ? note.choices?.find((c) => c.label === label) : undefined;
		if (!picked) return { ok: false, message: `Make the call “${note.title}” first` };
		out.push({ id: note.id, choice: picked.label });
		if (note.kind === 'decide' && picked.text === undefined && !picked.edit) {
			waived.push({ id: note.id, choice: picked.label, reason: picked.done });
		}
	}
	if (!head.clean) return { ok: false, message: 'The file has changes that are not committed; wait for the save' };
	if (form.get('blob') !== head.blob) return { ok: false, message: 'The file changed since your last save; reload the page' };
	return { ok: true, decision: { decision: 'approve', calls: out, waived, commit: head.commit, blob: head.blob } };
}
