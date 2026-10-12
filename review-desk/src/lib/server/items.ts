import { readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
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
	/** A PR's number; absent on an item the old command wrote. */
	number?: number;
	/** A design's source file name; absent on an item the old command wrote. */
	file?: string;
}

/** The `pr.json` fields: what `gh pr view` returns besides the body and head commit. */
export interface PrMeta {
	number: number;
	url: string;
	headRefName: string;
	baseRefName: string;
	statusCheckRollup: Array<Record<string, string>>;
}

export type ItemContent =
	| { kind: 'pr'; body: string; diff: string; pr?: PrMeta }
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

async function itemIds(root: string): Promise<string[]> {
	try {
		return await readdir(join(root, 'items'));
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw err;
	}
}

/** Items with an `item.json` and no `decision.json`, oldest first by `created`, then `id`. */
export async function listWaiting(root: string): Promise<ItemMeta[]> {
	const waiting: ItemMeta[] = [];
	for (const id of await itemIds(root)) {
		const dir = join(root, 'items', id);
		if (await readJson(join(dir, 'decision.json'))) continue;
		const meta = await readJson<ItemMeta>(join(dir, 'item.json'));
		if (meta) waiting.push(meta);
	}
	return waiting.sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
}

/** Items whose `decision.json` was written at or after `since` (epoch ms, by mtime), newest first. */
export async function listDecided(
	root: string,
	since: number
): Promise<Array<{ meta: ItemMeta; decision: Decision['decision'] }>> {
	const decided: Array<{ meta: ItemMeta; decision: Decision['decision']; at: number }> = [];
	for (const id of await itemIds(root)) {
		const dir = join(root, 'items', id);
		const decision = await readJson<Decision>(join(dir, 'decision.json'));
		const meta = await readJson<ItemMeta>(join(dir, 'item.json'));
		if (!decision || !meta) continue;
		const at = (await stat(join(dir, 'decision.json'))).mtimeMs;
		if (at >= since) decided.push({ meta, decision: decision.decision, at });
	}
	return decided.sort((a, b) => b.at - a.at).map(({ meta, decision }) => ({ meta, decision }));
}

/** Reads one item, or returns undefined when `item.json` is absent. The id must already have passed the `id` matcher. */
export async function readItem(root: string, id: string): Promise<Item | undefined> {
	const dir = join(root, 'items', id);
	const meta = await readJson<ItemMeta>(join(dir, 'item.json'));
	if (!meta) return undefined;
	const decided = (await readJson(join(dir, 'decision.json'))) !== undefined;
	let content: ItemContent;
	if (meta.kind === 'pr') {
		const pr = await readJson<PrMeta>(join(dir, 'pr.json'));
		content = {
			kind: 'pr',
			body: await readFile(join(dir, 'body.md'), 'utf8'),
			diff: await readFile(join(dir, 'diff.patch'), 'utf8'),
			...(pr && { pr })
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
