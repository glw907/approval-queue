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

/** Where a page stands in its worktree: the HEAD commit, the file's blob there, and its text. */
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

// One writer at a time per worktree: every save runs `git commit`, which takes the worktree's single
// index lock and fails rather than waits, so saves to two pages of one worktree must not overlap. It
// also keeps an approve from reading HEAD between a save's write and its commit.
const fileQueues = new Map<string, Promise<unknown>>();
// One writer at a time per item, so a comment never lands in `comments.json` after a decision has read it.
const itemQueues = new Map<string, Promise<unknown>>();

/** Runs `step` after every earlier step under `key` has finished; a failed step never blocks the next. */
function serial<T>(queues: Map<string, Promise<unknown>>, key: string, step: () => Promise<T>): Promise<T> {
	const run = (queues.get(key) ?? Promise.resolve()).then(step);
	queues.set(
		key,
		run.catch(() => undefined)
	);
	return run;
}

/** Runs `step` after every earlier step on the same worktree has finished. */
export const queued = <T>(worktree: string, step: () => Promise<T>): Promise<T> => serial(fileQueues, worktree, step);

/**
 * Runs `step` after every earlier step on the same item directory has finished. A step that also
 * needs the worktree's queue takes it inside this one, never the other way round, so the two never
 * wait on each other.
 */
export const queuedItem = <T>(dir: string, step: () => Promise<T>): Promise<T> => serial(itemQueues, dir, step);

/**
 * Writes the text to the file and commits it, when the file at HEAD is still the blob the text was
 * edited from. A different blob means the file changed outside the review, so the save is refused
 * (409) rather than overwriting it. Text that matches HEAD commits nothing. The caller holds the
 * worktree's queue, through `queued`.
 */
export async function commitText(worktree: string, file: string, text: string, base: string): Promise<Saved> {
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
		await writeFile(join(worktree, file), text);
		await git(worktree, ['commit', '-m', `Edit ${file} in review`, '--', file]);
	} catch (err) {
		const detail = (err as { stderr?: string }).stderr?.trim().split('\n').at(-1) ?? (err as Error).message;
		return { ok: false, status: 500, message: `the commit failed: ${detail}` };
	}
	const after = await committed(worktree, file);
	return { ok: true, blob: after.blob, commit: after.commit };
}

/** Saves one edit on the worktree's queue. */
export const saveFile = (worktree: string, file: string, text: string, base: string): Promise<Saved> =>
	queued(worktree, () => commitText(worktree, file, text, base));

export type DocsApprove = { ok: true; decision: Decision } | { ok: false; message: string };

type Answered = { ok: true; calls: Array<{ id: string; choice: string }> } | { ok: false; message: string };

/**
 * Reads the answers to a review's calls from the post. Every call (a `decide` or `question` note)
 * must carry one of its own choice labels under `call:<id>`, and nothing else may be posted as a call.
 */
function answerCalls(notes: readonly Note[], form: Fields): Answered {
	const calls = notes.filter(isCall);
	for (const key of form.keys()) {
		if (key.startsWith('call:') && !calls.some((n) => key === `call:${n.id}`)) {
			return { ok: false, message: `Unknown call ${key.slice('call:'.length)}` };
		}
	}
	const out: Array<{ id: string; choice: string }> = [];
	for (const note of calls) {
		const label = form.get(`call:${note.id}`);
		const picked = typeof label === 'string' ? note.choices?.find((c) => c.label === label) : undefined;
		if (!picked) return { ok: false, message: `Make the call “${note.title}” first` };
		out.push({ id: note.id, choice: picked.label });
	}
	return { ok: true, calls: out };
}

/**
 * Builds the approve decision of a docs review from the stored notes and the post. The commit comes
 * from the worktree, never from the post: each page must be clean, and the `blob:<path>` the post
 * carries, what the page last saved, must still be the page's blob at HEAD, so what the reader
 * approved is exactly what the decision names.
 */
export function buildDocsApprove(
	notes: readonly Note[],
	form: Fields,
	head: { commit: string; pages: Array<{ path: string; blob: string; clean: boolean }> }
): DocsApprove {
	const answered = answerCalls(notes, form);
	if (!answered.ok) return answered;
	for (const page of head.pages) {
		if (!page.clean) return { ok: false, message: `${page.path} has changes that are not committed; wait for the save` };
		if (form.get(`blob:${page.path}`) !== page.blob) {
			return { ok: false, message: `${page.path} changed since your last save; reload the page` };
		}
	}
	return { ok: true, decision: { decision: 'approve', commit: head.commit, calls: answered.calls } };
}

/**
 * The calls a send-back posted with one of their own choice labels, so the sent-back item shows
 * them as made. Open calls and unknown ids are left out rather than refused: a send-back needs none.
 */
export function sentBackCalls(notes: readonly Note[], form: Fields): Array<{ id: string; choice: string }> {
	return notes.filter(isCall).flatMap((note) => {
		const label = form.get(`call:${note.id}`);
		const picked = typeof label === 'string' ? note.choices?.find((c) => c.label === label) : undefined;
		return picked ? [{ id: note.id, choice: picked.label }] : [];
	});
}
