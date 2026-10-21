import { createHash, randomUUID } from 'node:crypto';
import { link, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Proposed, Triage } from '#lib/brief.ts';
import type { Note } from '#lib/editor/notes.ts';
import type { Packet } from '#lib/packet.ts';
import { committed } from './blueprint.ts';

export type Disposition = Proposed;

/** One row of a submitted triage: the session's action, Geoff's call, and his own note. */
export interface SubmittedRow {
	action: string;
	disposition: Disposition;
	note: string;
}

export interface ItemMeta {
	id: string;
	kind: 'pr' | 'design' | 'triage' | 'packet' | 'blueprint';
	repo: string;
	title: string;
	/** The brief's headline, written by the command; absent on an item it wrote before briefs. */
	headline?: string;
	/** ISO 8601 UTC, so a string sort is a time sort. */
	created: string;
	/** The PR head commit the item was fetched at. */
	head?: string;
	/** A PR's number; absent on an item the old command wrote. */
	number?: number;
	/** A design's source file name, or a blueprint's path relative to its worktree. */
	file?: string;
	/** A blueprint's worktree, an absolute path; the app reads, saves, and commits the file there. */
	worktree?: string;
	/** A blueprint's blob at HEAD when it was queued. */
	blob?: string;
	/** A packet's initiative id, or `none`; the sidebar and the board group by it. */
	initiative?: string;
	/** The initiative record's title; empty for `none`. */
	initiativeTitle?: string;
}

/** The `pr.json` fields: what `gh pr view` returns besides the body and head commit. */
export interface PrMeta {
	number: number;
	url: string;
	headRefName: string;
	baseRefName: string;
	statusCheckRollup: Array<Record<string, string>>;
	/** The commit the command fetched the PR at; a packet part's `pr.json` carries it. */
	head?: string;
}

/** One part of a packet as the server rebuilds it from the item directory. */
export interface PacketPart {
	ref: string;
	kind: 'pr' | 'design' | 'step';
	lane: 'ask' | 'routine';
	/** The preselected verdict of a routine part; empty for a part an ask binds. */
	verdict: string;
	/** A PR's head commit. */
	head?: string;
	/** A design's `sha256` over the copy the reader saw. */
	sha256?: string;
	body?: string;
	diff?: string;
	doc?: string;
	pr?: PrMeta;
}

export type ItemContent =
	| { kind: 'pr'; body: string; diff: string; pr?: PrMeta }
	| { kind: 'design'; doc: string }
	| { kind: 'packet'; packet: Packet; parts: PacketPart[] }
	| {
			kind: 'blueprint';
			/** The file as committed at the worktree's HEAD now, with its blob and that commit. */
			doc: string;
			blob: string;
			commit: string;
			/** The file as it was queued, which the review marks changed lines against. */
			original: string;
			notes: Note[];
			worktree: string;
			file: string;
			/** The worktree or the file is gone, so the review shows the queued copy and takes no edits. */
			missing: boolean;
	  }
	| ({ kind: 'triage' } & Triage);

export type Decision =
	| {
			decision: 'approve';
			choices?: Array<{ title: string; choice: string }>;
			/** A packet's per-part verdicts and per-ask answers; the command joins the heads and hashes. */
			parts?: Array<{ ref: string; verdict: string }>;
			asks?: Array<{ index: number; choice: string }>;
			/** A blueprint's answered calls by note id, with the choice label. */
			calls?: Array<{ id: string; choice: string }>;
			/** A blueprint's disputed notes answered by keeping the author's text, with the reason. */
			waived?: Array<{ id: string; choice: string; reason: string }>;
			/** A blueprint's worktree HEAD at approval, and the file's blob there. */
			commit?: string;
			blob?: string;
	  }
	| { decision: 'reject'; note: string }
	| { decision: 'submit'; rows: SubmittedRow[] };

export interface Item {
	meta: ItemMeta;
	content: ItemContent;
	decided: boolean;
	/** The `decision.json` the page wrote; absent while the item waits. */
	decision?: Decision;
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

/** Items with an `item.json` and no `decision.json`, oldest first by `created`, then `id`. An item whose JSON does not parse is skipped. */
export async function listWaiting(root: string): Promise<ItemMeta[]> {
	const waiting: ItemMeta[] = [];
	for (const id of await itemIds(root)) {
		const dir = join(root, 'items', id);
		try {
			if (await readJson(join(dir, 'decision.json'))) continue;
			const meta = await readJson<ItemMeta>(join(dir, 'item.json'));
			if (meta) waiting.push(meta);
		} catch (err) {
			if (!(err instanceof SyntaxError)) throw err;
		}
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
		try {
			const decision = await readJson<Decision>(join(dir, 'decision.json'));
			const meta = await readJson<ItemMeta>(join(dir, 'item.json'));
			if (!decision || !meta) continue;
			const at = (await stat(join(dir, 'decision.json'))).mtimeMs;
			if (at >= since) decided.push({ meta, decision: decision.decision, at });
		} catch (err) {
			if (!(err instanceof SyntaxError)) throw err;
		}
	}
	return decided.sort((a, b) => b.at - a.at).map(({ meta, decision }) => ({ meta, decision }));
}

/** Reads one item, or returns undefined when `item.json` is absent. The id must already have passed the `id` matcher. */
export async function readItem(root: string, id: string): Promise<Item | undefined> {
	const dir = join(root, 'items', id);
	const meta = await readJson<ItemMeta>(join(dir, 'item.json'));
	if (!meta) return undefined;
	const decision = await readJson<Decision>(join(dir, 'decision.json'));
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
	} else if (meta.kind === 'packet') {
		content = await readPacket(dir);
	} else if (meta.kind === 'blueprint') {
		content = await readBlueprint(dir, meta);
	} else if (meta.kind === 'triage') {
		const triage = await readJson<Triage>(join(dir, 'triage.json'));
		// The command validates the file before writing it; a missing or old-shape file renders as empty.
		content = { kind: 'triage', headline: '', lede: '', rows: [], ...(triage && !Array.isArray(triage) && triage) };
	} else {
		return undefined;
	}
	return { meta, content, decided: decision !== undefined, ...(decision && { decision }) };
}

/**
 * Rebuilds a packet's parts from its item directory, never from a post. Part `k` is the index in
 * `packet.parts`, so a step, which has no directory, still holds its slot.
 */
async function readPacket(dir: string): Promise<ItemContent> {
	const raw = await readFile(join(dir, 'packet.json'), 'utf8');
	const packet = JSON.parse(raw) as Packet;
	const preselected = new Map(packet.routine.map((row) => [row.part.ref, row.verdict]));
	const parts: PacketPart[] = [];
	for (const [k, { part, in: lane }] of packet.parts.entries()) {
		const base = { ref: part.ref, kind: part.kind, lane, verdict: preselected.get(part.ref) ?? '' };
		const partDir = join(dir, 'parts', String(k));
		if (part.kind === 'pr') {
			const pr = await readJson<PrMeta>(join(partDir, 'pr.json'));
			parts.push({
				...base,
				head: pr?.head ?? '',
				body: await readFile(join(partDir, 'body.md'), 'utf8'),
				diff: await readFile(join(partDir, 'diff.patch'), 'utf8'),
				...(pr && { pr })
			});
		} else if (part.kind === 'design') {
			const doc = await readFile(join(partDir, 'doc.md'));
			parts.push({ ...base, sha256: createHash('sha256').update(doc).digest('hex'), doc: doc.toString() });
		} else parts.push(base);
	}
	return { kind: 'packet', packet, parts };
}

/** Reads a blueprint item: the stored notes and queued copy, and the file as its worktree now commits it. */
async function readBlueprint(dir: string, meta: ItemMeta): Promise<ItemContent> {
	// The editor works in LF, so the anchors are resolved and the lines compared in LF too.
	const lf = (text: string) => text.replace(/\r\n/g, '\n');
	const original = lf(await readFile(join(dir, 'doc.md'), 'utf8'));
	const notes = (await readJson<Note[]>(join(dir, 'notes.json'))) ?? [];
	const worktree = meta.worktree ?? '';
	const file = meta.file ?? '';
	try {
		const now = await committed(worktree, file);
		return { kind: 'blueprint', doc: lf(now.text), blob: now.blob, commit: now.commit, original, notes, worktree, file, missing: false };
	} catch {
		return { kind: 'blueprint', doc: original, blob: meta.blob ?? '', commit: '', original, notes, worktree, file, missing: true };
	}
}

/** Writes `decision.json` through a temp file in the item directory, so the waiting command never reads a partial file. */
export async function writeDecision(root: string, id: string, decision: Decision): Promise<void> {
	const dir = join(root, 'items', id);
	const tmp = join(dir, 'decision.json.tmp');
	await writeFile(tmp, JSON.stringify(decision));
	await rename(tmp, join(dir, 'decision.json'));
}

/**
 * Writes `decision.json` through a temp file named for this request, synced to disk, then `link`ed
 * into place. Returns false when a decision already exists, since `link` fails with `EEXIST` rather
 * than replace it, so two posts never both win.
 */
export async function writeDecisionOnce(root: string, id: string, decision: Decision): Promise<boolean> {
	const dir = join(root, 'items', id);
	const tmp = join(dir, `decision.json.${randomUUID()}.tmp`);
	const file = await open(tmp, 'wx');
	try {
		await file.writeFile(JSON.stringify(decision));
		await file.sync();
	} finally {
		await file.close();
	}
	try {
		await link(tmp, join(dir, 'decision.json'));
		return true;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
		throw err;
	} finally {
		await unlink(tmp);
	}
}
