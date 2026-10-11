import { readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type Disposition = 'now' | 'defer' | 'drop';

export interface TriageRow {
	item: string;
	disposition: Disposition;
	reason: string;
}

export interface ItemMeta {
	id: string;
	kind: 'pr' | 'design' | 'triage';
	repo: string;
	title: string;
	/** ISO 8601 UTC, so a string sort is a time sort. */
	created: string;
	/** The PR head commit the item was fetched at. */
	head?: string;
}

export type ItemContent =
	| { kind: 'pr'; body: string; diff: string }
	| { kind: 'design'; doc: string }
	| { kind: 'triage'; rows: TriageRow[] };

export type Decision =
	| { decision: 'approve' }
	| { decision: 'reject'; note: string }
	| { decision: 'submit'; rows: TriageRow[] };

export interface Item {
	meta: ItemMeta;
	content: ItemContent;
	decided: boolean;
}

async function readJson<T>(path: string): Promise<T | undefined> {
	try {
		return JSON.parse(await readFile(path, 'utf8')) as T;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
		throw err;
	}
}

/** Items with an `item.json` and no `decision.json`, newest first. */
export async function listWaiting(root: string): Promise<ItemMeta[]> {
	let ids: string[];
	try {
		ids = await readdir(join(root, 'items'));
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw err;
	}
	const waiting: ItemMeta[] = [];
	for (const id of ids) {
		const dir = join(root, 'items', id);
		if (await readJson(join(dir, 'decision.json'))) continue;
		const meta = await readJson<ItemMeta>(join(dir, 'item.json'));
		if (meta) waiting.push(meta);
	}
	return waiting.sort((a, b) => b.created.localeCompare(a.created));
}

/** Reads one item, or returns undefined when `item.json` is absent. The id must already have passed the `id` matcher. */
export async function readItem(root: string, id: string): Promise<Item | undefined> {
	const dir = join(root, 'items', id);
	const meta = await readJson<ItemMeta>(join(dir, 'item.json'));
	if (!meta) return undefined;
	const decided = (await readJson(join(dir, 'decision.json'))) !== undefined;
	let content: ItemContent;
	if (meta.kind === 'pr') {
		content = {
			kind: 'pr',
			body: await readFile(join(dir, 'body.md'), 'utf8'),
			diff: await readFile(join(dir, 'diff.patch'), 'utf8')
		};
	} else if (meta.kind === 'design') {
		content = { kind: 'design', doc: await readFile(join(dir, 'doc.md'), 'utf8') };
	} else {
		content = { kind: 'triage', rows: (await readJson<TriageRow[]>(join(dir, 'triage.json'))) ?? [] };
	}
	return { meta, content, decided };
}

/** Writes `decision.json` through a temp file in the item directory, so the waiting command never reads a partial file. */
export async function writeDecision(root: string, id: string, decision: Decision): Promise<void> {
	const dir = join(root, 'items', id);
	const tmp = join(dir, 'decision.json.tmp');
	await writeFile(tmp, JSON.stringify(decision));
	await rename(tmp, join(dir, 'decision.json'));
}
