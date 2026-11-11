import { createHash, randomUUID } from 'node:crypto';
import { link, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Proposed, Triage } from '#lib/brief.ts';
import type { Packet } from '#lib/packet.ts';

export type Disposition = Proposed;

/** The kinds the queue reads; an item of any other kind stays on disk unlisted and unserved. */
const KINDS: readonly string[] = ['design', 'triage', 'packet'];

/** One row of a submitted triage: the session's action and Geoff's call. */
export interface SubmittedRow {
	action: string;
	disposition: Disposition;
}

export interface ItemMeta {
	id: string;
	kind: 'design' | 'triage' | 'packet';
	repo: string;
	title: string;
	/** The brief's headline, written by the command; absent on an item it wrote before briefs. */
	headline?: string;
	/** ISO 8601 UTC, so a string sort is a time sort. */
	created: string;
	/** The PR head commit the item was fetched at. */
	head?: string;
	/** A design's source file name. */
	file?: string;
	/** A packet's initiative id, or `none`; the sidebar and the board group by it. */
	initiative?: string;
	/** The initiative record's title; empty for `none`. */
	initiativeTitle?: string;
	/**
	 * Set when the item resends what Geoff sent back: the earlier item, this item's round (2 for the
	 * first resend), and the head or hash of each part he sent back.
	 */
	revises?: { item: string; revision: number; parts?: Array<{ ref: string; head?: string; sha256?: string }> };
	/** The queuing command's pid and its start time in clock ticks since boot; absent on an item queued before withdraw. */
	pid?: number;
	pidStart?: number;
	/** A pid is recorded and that process is gone, so no session waits for the decision. */
	orphaned: boolean;
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
	/** A PR the item resends: the diff since the head Geoff sent back, or a marker that head is gone. */
	since?: StoredPatch;
}

/** A stored patch the item compares against: the diff itself, or a marker that its commit is no longer an ancestor. */
export type StoredPatch = { patch: string } | { gone: true };

export type ItemContent =
	| { kind: 'design'; doc: string }
	| { kind: 'packet'; packet: Packet; parts: PacketPart[] }
	| ({ kind: 'triage' } & Triage);

/** One entry of a packet send-back's `calls`; `null` is a field the post lacked or a value the packet does not hold. */
export type PacketCall =
	| { ref: string; verdict: string | null }
	| { ask: number; question: string; choice: string | null };

export type Decision =
	| {
			decision: 'approve';
			choices?: Array<{ title: string; choice: string }>;
			/** A packet's per-part verdicts and per-ask answers; the command joins the heads and hashes. */
			parts?: Array<{ ref: string; verdict: string }>;
			asks?: Array<{ index: number; choice: string }>;
	  }
	| {
			decision: 'reject';
			note: string;
			/** A packet's parts' verdicts and its asks' picks as the screen held them. */
			calls?: PacketCall[];
	  }
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

/** The state letter and start time (clock ticks since boot) of a process, or undefined when it is gone. */
export async function procStat(pid: number): Promise<{ state: string; start: number } | undefined> {
	const text = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => undefined);
	if (text === undefined) return undefined;
	// The command name in field 2 can hold spaces and parentheses, so split after the last `)`.
	const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
	return { state: fields[0], start: Number(fields[19]) };
}

/** Whether the process is the one that started at `start`: a reused pid has another start time, and a zombie is gone. */
async function isWaiter(pid: number, start: number | undefined): Promise<boolean> {
	const found = await procStat(pid);
	return found !== undefined && found.state !== 'Z' && found.start === start;
}

/** Reads `item.json` and adds the flag the board shows, which the file never holds. An item of a retired kind reads as none. */
async function readMeta(dir: string): Promise<ItemMeta | undefined> {
	const stored = await readJson<Omit<ItemMeta, 'orphaned'>>(join(dir, 'item.json'));
	if (!stored || !KINDS.includes(stored.kind)) return undefined;
	const orphaned = stored.pid !== undefined && !(await isWaiter(stored.pid, stored.pidStart));
	return { ...stored, orphaned };
}

async function itemIds(root: string): Promise<string[]> {
	try {
		return await readdir(join(root, 'items'));
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw err;
	}
}

/**
 * Items with an `item.json` and no `decision.json`, oldest first by `created`, then `id`, each with
 * whether its session is gone. An item whose JSON does not parse is skipped.
 */
export async function listWaiting(root: string): Promise<ItemMeta[]> {
	const waiting: ItemMeta[] = [];
	for (const id of await itemIds(root)) {
		const dir = join(root, 'items', id);
		try {
			if (await readJson(join(dir, 'decision.json'))) continue;
			const meta = await readMeta(dir);
			if (meta) waiting.push(meta);
		} catch (err) {
			if (!(err instanceof SyntaxError)) throw err;
		}
	}
	return waiting.sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id));
}

/**
 * Items whose `decision.json` was written at or after `since` (epoch ms, by mtime), newest first. A
 * `refused.json` the waiting command wrote beside the decision adds `refused`, its reason; it does
 * not move the item in the order, since the order keys on the decision's mtime.
 */
export async function listDecided(
	root: string,
	since: number
): Promise<Array<{ meta: ItemMeta; decision: Decision['decision']; refused?: string }>> {
	const decided: Array<{ meta: ItemMeta; decision: Decision['decision']; refused?: string; at: number }> = [];
	for (const id of await itemIds(root)) {
		const dir = join(root, 'items', id);
		try {
			const decision = await readJson<Decision>(join(dir, 'decision.json'));
			const meta = await readMeta(dir);
			if (!decision || !meta) continue;
			const at = (await stat(join(dir, 'decision.json'))).mtimeMs;
			if (at < since) continue;
			const refused = await readJson<{ reason: string }>(join(dir, 'refused.json'));
			decided.push({ meta, decision: decision.decision, ...(refused && { refused: refused.reason ?? '' }), at });
		} catch (err) {
			if (!(err instanceof SyntaxError)) throw err;
		}
	}
	return decided.sort((a, b) => b.at - a.at).map(({ at: _at, ...row }) => row);
}

/**
 * Reads one item, or returns undefined when `item.json` is absent or a packet's `packet.json` does not
 * parse, as for a withdrawn item. The id must already have passed the `id` matcher.
 */
export async function readItem(root: string, id: string): Promise<Item | undefined> {
	const dir = join(root, 'items', id);
	const meta = await readMeta(dir);
	if (!meta) return undefined;
	const decision = await readJson<Decision>(join(dir, 'decision.json'));
	let content: ItemContent;
	if (meta.kind === 'design') {
		content = { kind: 'design', doc: await readFile(join(dir, 'doc.md'), 'utf8') };
	} else if (meta.kind === 'packet') {
		try {
			content = await readPacket(dir);
		} catch (err) {
			if (err instanceof SyntaxError) return undefined;
			throw err;
		}
	} else {
		const triage = await readJson<Triage>(join(dir, 'triage.json'));
		// The command validates the file before writing it; a missing or old-shape file renders as empty.
		content = { kind: 'triage', headline: '', lede: '', rows: [], ...(triage && !Array.isArray(triage) && triage) };
	}
	return { meta, content, decided: decision !== undefined, ...(decision && { decision }) };
}

/** A packet stored before the title and description, with a one-sentence lede and a Background section. */
type OldPacket = Omit<Packet, 'background' | 'summary'> & { lede: string; background: { text: string } };

/** Reads a stored packet, mapping the old shape's Background to the background and its lede to the summary. */
function upgradePacket(stored: Packet | OldPacket): Packet {
	if (!('lede' in stored)) return stored;
	const { lede, background, ...rest } = stored;
	return { ...rest, background: background.text, summary: [lede] };
}

/**
 * Rebuilds a packet's parts from its item directory, never from a post. Part `k` is the index in
 * `packet.parts`, so a step, which has no directory, still holds its slot.
 */
async function readPacket(dir: string): Promise<ItemContent> {
	const raw = await readFile(join(dir, 'packet.json'), 'utf8');
	const packet = upgradePacket(JSON.parse(raw));
	const preselected = new Map(packet.routine.map((row) => [row.part.ref, row.verdict]));
	const parts: PacketPart[] = [];
	for (const [k, { part, in: lane }] of packet.parts.entries()) {
		const base = { ref: part.ref, kind: part.kind, lane, verdict: preselected.get(part.ref) ?? '' };
		const partDir = join(dir, 'parts', String(k));
		if (part.kind === 'pr') {
			const pr = await readJson<PrMeta>(join(partDir, 'pr.json'));
			const since = await readStoredPatch(partDir, 'since');
			parts.push({
				...base,
				head: pr?.head ?? '',
				body: await readFile(join(partDir, 'body.md'), 'utf8'),
				diff: await readFile(join(partDir, 'diff.patch'), 'utf8'),
				...(pr && { pr }),
				...(since && { since })
			});
		} else if (part.kind === 'design') {
			const doc = await readFile(join(partDir, 'doc.md'));
			parts.push({ ...base, sha256: createHash('sha256').update(doc).digest('hex'), doc: doc.toString() });
		} else parts.push(base);
	}
	return { kind: 'packet', packet, parts };
}

/** Reads the `<name>.patch` or `<name>.json` gone marker a resent item stores, or neither. */
async function readStoredPatch(dir: string, name: 'since'): Promise<StoredPatch | undefined> {
	const patch = await readFile(join(dir, `${name}.patch`), 'utf8').catch((err) => {
		if (err.code === 'ENOENT') return undefined;
		throw err;
	});
	if (patch !== undefined) return { patch };
	return (await readJson<{ gone: true }>(join(dir, `${name}.json`))) ?? undefined;
}

/** The note and calls of the send-back an earlier item ended in; absent when that item has no reject on disk. */
export async function readSentBack(root: string, id: string): Promise<{ note: string; calls: NonNullable<Extract<Decision, { decision: 'reject' }>['calls']> } | undefined> {
	const decision = await readJson<Decision>(join(root, 'items', id, 'decision.json'));
	if (decision?.decision !== 'reject') return undefined;
	return { note: decision.note, calls: decision.calls ?? [] };
}

/** Whether the item still has its `item.json`, which a withdraw renames away before it checks for a decision. */
const stillListed = (dir: string) => stat(join(dir, 'item.json')).then(() => true, () => false);

/**
 * Writes `decision.json` through a temp file in the item directory, so the waiting command never reads a partial file.
 * Returns false when the item was withdrawn: the command's `retire_item` renames `item.json` away, then looks for a
 * decision, so a decision written after that rename is taken back here and nothing is left beside a removed item.
 */
export async function writeDecision(root: string, id: string, decision: Decision): Promise<boolean> {
	const dir = join(root, 'items', id);
	const tmp = join(dir, 'decision.json.tmp');
	await writeFile(tmp, JSON.stringify(decision));
	await rename(tmp, join(dir, 'decision.json'));
	if (await stillListed(dir)) return true;
	await unlink(join(dir, 'decision.json')).catch(() => undefined);
	return false;
}

/**
 * Writes `decision.json` through a temp file named for this request, synced to disk, then `link`ed
 * into place. Answers `exists` when a decision already exists, since `link` fails with `EEXIST` rather
 * than replace it, so two posts never both win, and `gone` when the item was withdrawn (see `writeDecision`).
 */
export async function writeDecisionOnce(root: string, id: string, decision: Decision): Promise<'written' | 'exists' | 'gone'> {
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
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'EEXIST') return 'exists';
		throw err;
	} finally {
		await unlink(tmp);
	}
	if (await stillListed(dir)) return 'written';
	await unlink(join(dir, 'decision.json')).catch(() => undefined);
	return 'gone';
}
