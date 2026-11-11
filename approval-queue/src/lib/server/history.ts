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
 * One decided item's row, from its `item.json` and `decision.json` alone, so an item of an old shape
 * or a retired kind has one. Undefined when either file is missing or damaged; a damaged `notes.json`
 * or `replies.json` never costs the row.
 */
export async function historyRow(root: string, id: string): Promise<(HistoryRow & { at: number }) | undefined> {
	const dir = join(root, 'items', id);
	const meta = (await readJson(join(dir, 'item.json'))) as { kind?: string; title?: string } | undefined;
	const decision = (await readJson(join(dir, 'decision.json'))) as { decision?: string } | undefined;
	if (!meta || !decision) return undefined;
	const at = (await stat(join(dir, 'decision.json'))).mtimeMs;
	return {
		id,
		title: meta.title || id,
		kind: meta.kind ?? '',
		decision: decision.decision ?? '',
		date: new Date(at).toISOString(),
		notes: await count(join(dir, 'notes.json')),
		replies: await count(join(dir, 'replies.json')),
		at
	};
}

/** Every decided item, newest decision first. `query` keeps the titles that contain it, ignoring case. */
export async function listHistory(root: string, query = ''): Promise<HistoryRow[]> {
	const ids = await readdir(join(root, 'items')).catch(() => [] as string[]);
	const rows: Array<HistoryRow & { at: number }> = [];
	const needle = query.trim().toLowerCase();
	for (const id of ids) {
		const row = await historyRow(root, id);
		if (row && (!needle || row.title.toLowerCase().includes(needle))) rows.push(row);
	}
	return rows.sort((a, b) => b.at - a.at).map(({ at: _at, ...row }) => row);
}
