import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Reply } from './items.ts';

/** A note on a digest line: `id` is `D<n>`, `line` the line's number in `digest.jsonl`, counting from 1. */
export interface DigestNote {
	id: string;
	line: number;
	text: string;
}

/** One digest line as the command wrote it, with its number and what Geoff and the session said of it. */
export interface DigestLine {
	line: number;
	time: string;
	ref: string;
	head: string;
	claim: string;
	lane: string;
	notes: DigestNote[];
	replies: Reply[];
}

/** The lines of one repo, newest first. */
export interface DigestGroup {
	repo: string;
	lines: DigestLine[];
}

async function readText(path: string): Promise<string> {
	return readFile(path, 'utf8').catch((err) => {
		if (err.code === 'ENOENT') return '';
		throw err;
	});
}

/** A list sidecar; a damaged file reads as empty, so one bad file never hides the digest. */
async function readList<T>(path: string): Promise<T[]> {
	try {
		const value: unknown = JSON.parse((await readText(path)) || '[]');
		return Array.isArray(value) ? (value as T[]) : [];
	} catch (err) {
		if (err instanceof SyntaxError) return [];
		throw err;
	}
}

export const readDigestNotes = (root: string) => readList<DigestNote>(join(root, 'digest-notes.json'));
export const readDigestReplies = (root: string) => readList<Reply>(join(root, 'digest-replies.json'));

/**
 * Reads `digest.jsonl` grouped by repo, repos in name order and each repo's lines newest first, each
 * with its notes from `digest-notes.json` and the replies `reply digest` stored. A line that does not
 * parse is skipped but still takes its number.
 */
export async function readDigest(root: string): Promise<DigestGroup[]> {
	const notes = await readDigestNotes(root);
	const replies = await readList<Reply>(join(root, 'digest-replies.json'));
	const groups = new Map<string, DigestLine[]>();
	for (const [i, text] of (await readText(join(root, 'digest.jsonl'))).split('\n').entries()) {
		let stored: Omit<DigestLine, 'line' | 'notes' | 'replies'>;
		try {
			stored = JSON.parse(text);
		} catch {
			continue;
		}
		const mine = notes.filter((n) => n.line === i + 1);
		const line: DigestLine = {
			line: i + 1,
			...stored,
			notes: mine,
			replies: replies.filter((r) => mine.some((n) => n.id === r.note))
		};
		const repo = String(stored.ref).split('#')[0];
		groups.set(repo, [line, ...(groups.get(repo) ?? [])]);
	}
	return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([repo, lines]) => ({ repo, lines }));
}

/** Writes `digest-notes.json` through a temp file and a rename, so a reader never sees half of it. */
export async function writeDigestNotes(root: string, notes: DigestNote[]): Promise<void> {
	const tmp = join(root, `digest-notes.json.${randomUUID()}.tmp`);
	await writeFile(tmp, JSON.stringify(notes));
	await rename(tmp, join(root, 'digest-notes.json'));
}
