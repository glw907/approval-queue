import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** One decided item as the history lists it. */
export interface HistoryRow {
	id: string;
	title: string;
	/** The `kind` in `item.json`, whatever it is: an item of a retired kind still lists. */
	kind: string;
	decision: string;
	/** ISO 8601 UTC time `decision.json` was written. */
	date: string;
	/** How many notes the item holds and how many replies answer them; a damaged sidecar counts as none. */
	notes: number;
	replies: number;
}

async function readJson(path: string): Promise<unknown> {
	try {
		return JSON.parse(await readFile(path, 'utf8'));
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT' || err instanceof SyntaxError) return undefined;
		throw err;
	}
}

const count = async (path: string) => {
	const value = await readJson(path);
	return Array.isArray(value) ? value.length : 0;
};

/**
 * Every decided item, newest decision first, each from its `item.json` and `decision.json` alone, so
 * an item of an old shape lists. `query` keeps the titles that contain it, ignoring case. An item
 * whose `item.json` or `decision.json` is missing or damaged has no row; a damaged `notes.json` or
 * `replies.json` never costs one.
 */
export async function listHistory(root: string, query = ''): Promise<HistoryRow[]> {
	const ids = await readdir(join(root, 'items')).catch(() => [] as string[]);
	const rows: Array<HistoryRow & { at: number }> = [];
	const needle = query.trim().toLowerCase();
	for (const id of ids) {
		const dir = join(root, 'items', id);
		const meta = (await readJson(join(dir, 'item.json'))) as { kind?: string; title?: string } | undefined;
		const decision = (await readJson(join(dir, 'decision.json'))) as { decision?: string } | undefined;
		if (!meta || !decision) continue;
		const title = meta.title || id;
		if (needle && !title.toLowerCase().includes(needle)) continue;
		const at = (await stat(join(dir, 'decision.json'))).mtimeMs;
		rows.push({
			id,
			title,
			kind: meta.kind ?? '',
			decision: decision.decision ?? '',
			date: new Date(at).toISOString(),
			notes: await count(join(dir, 'notes.json')),
			replies: await count(join(dir, 'replies.json')),
			at
		});
	}
	return rows.sort((a, b) => b.at - a.at).map(({ at: _at, ...row }) => row);
}
