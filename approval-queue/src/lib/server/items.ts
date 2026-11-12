import { randomUUID } from 'node:crypto';
import { link, open, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Proposed, Triage } from '#lib/brief.ts';
import { parseFacts, parseText, patchName, type Facts, type Text } from '#lib/facts.ts';

export type Disposition = Proposed;

/** The kinds the queue reads; an item of any other kind stays on disk unlisted and unserved. */
const KINDS: readonly string[] = ['design', 'triage', 'packet', 'report'];

/** One row of a submitted triage: the session's action and Geoff's call. */
export interface SubmittedRow {
	action: string;
	disposition: Disposition;
}

export interface ItemMeta {
	id: string;
	kind: 'design' | 'triage' | 'packet' | 'report';
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
	/** The unattended round a packet belongs to, written by the command from the fact file; absent outside a round. */
	round?: string;
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

/** A note's anchor in the packet's prose: a section's `textContent` with LF endings, end exclusive. */
export interface ProseAnchor {
	section: string;
	quote: string;
	prefix: string;
	suffix: string;
	from: number;
	to: number;
}

/** A note's anchor on a diff line at the pinned head. */
export interface DiffAnchor {
	pr: string;
	file: string;
	side: string;
	line: number;
	text: string;
}

/** A note: `anchor` is null for a note on the whole packet. */
export interface Note {
	id: string;
	text: string;
	anchor: ProseAnchor | DiffAnchor | null;
}

/** One call's answer in a packet decision, `call` counting from 1 in fact-file order. */
export interface CallPick {
	call: number;
	choice: string;
	changed: boolean;
}

/** A reply the command stored beside a note of a decided item. */
export interface Reply {
	note: string;
	outcome: 'fixed' | 'filed' | 'answered';
	text: string;
	ref?: string;
}

/** `prs/<k>.json`: what the command fetched of one PR. */
export interface PrData {
	ref: string;
	title: string;
	body: string;
	checks: Array<{ name: string; bucket: string }>;
	files: Array<{ path: string; additions: number; deletions: number; rank: number }>;
}

/** A pinned head, from `heads.json`. */
export interface Head {
	ref: string;
	head: string;
}

/** `stale.json`: the command saw a head move while the item waited. */
export interface Stale {
	ref: string;
	queued: string;
	now: string;
}

/** A new-shape packet as the server rebuilds it from the item directory. */
export interface FactPacket {
	facts: Facts;
	text: Text;
	/** `text.md` as written: the parse keeps only the deep dive's closed line, and the page shows the rest of it. */
	textMd: string;
	/** The snapshot's patch for each PR, keyed by `owner/repo#n`. */
	patches: Record<string, string>;
	prs: PrData[];
	heads: Head[];
	notes: Note[];
	replies: Reply[];
	stale?: Stale;
	/**
	 * A design packet's copied design and the hash the command pinned. `path` is the file the command
	 * copied it from; an item queued before the path was recorded has none, and a `path` key that is
	 * not a string is kept as found for the approve check to refuse.
	 */
	design?: { md: string; sha256: string; path?: unknown };
}

/** What a resend carries from the item it revises: that item's notes with their replies, and the paragraphs of the new `text.md` that differ from its text. */
export interface Earlier {
	item: string;
	revision: number;
	notes: Note[];
	replies: Reply[];
	changed: string[];
}

export type ItemContent =
	| { kind: 'design'; doc: string }
	/** A round report: the text of its `report.md`, empty when the file is missing. */
	| { kind: 'report'; text: string }
	| { kind: 'facts'; packet: FactPacket }
	/** A packet stored before the fact file: its `packet.md`, shown read-only. */
	| { kind: 'legacy'; text: string }
	| ({ kind: 'triage' } & Triage);

export type Decision =
	| { decision: 'approve'; choices?: Array<{ title: string; choice: string }> }
	| { decision: 'reject'; note: string }
	| { decision: 'submit'; rows: SubmittedRow[] }
	/** A round report's only decision: Geoff marked it read. */
	| { decision: 'read' }
	/** A packet's decision: the calls as answered and the notes the post carried. */
	| { decision: 'approve' | 'reject'; calls: CallPick[]; decidedForYou: CallPick[]; notes: Note[] };

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
	// A packet's `item.json` names no repo (its PRs and design do), so the rail groups it under none.
	return { ...stored, repo: stored.repo ?? '', orphaned };
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
	} else if (meta.kind === 'report') {
		content = { kind: 'report', text: await readFile(join(dir, 'report.md'), 'utf8').catch(() => '') };
	} else if (meta.kind === 'packet') {
		try {
			content = (await exists(join(dir, 'facts.json')))
				? await readFactPacket(dir)
				: { kind: 'legacy', text: await readFile(join(dir, 'packet.md'), 'utf8').catch(() => '') };
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

const exists = (path: string) => stat(path).then(() => true, () => false);

/** A sidecar the page and the history can live without: a missing or damaged list reads as empty. */
async function readList<T>(path: string): Promise<T[]> {
	try {
		const value = await readJson<unknown>(path);
		return Array.isArray(value) ? (value as T[]) : [];
	} catch (err) {
		if (err instanceof SyntaxError) return [];
		throw err;
	}
}

/** Reads a new-shape packet's item directory. A fact or text file that no longer checks is a `SyntaxError`, as a damaged `packet.json` is. */
async function readFactPacket(dir: string): Promise<ItemContent> {
	const facts = parseFacts(await readFile(join(dir, 'facts.json'), 'utf8'));
	if (!facts.ok) throw new SyntaxError(facts.messages.join('; '));
	const textMd = await readFile(join(dir, 'text.md'), 'utf8');
	const text = parseText(textMd, facts.value);
	if (!text.ok) throw new SyntaxError(text.messages.join('; '));
	const patches: Record<string, string> = {};
	const prs: PrData[] = [];
	for (const [k, ref] of facts.value.prs.entries()) {
		const patch = await readFile(join(dir, 'snapshot', patchName(ref)), 'utf8').catch(() => undefined);
		if (patch !== undefined) patches[ref] = patch;
		const pr = await readJson<PrData>(join(dir, 'prs', `${k}.json`));
		if (pr) prs.push(pr);
	}
	const design = await readFile(join(dir, 'design.md'), 'utf8').catch(() => undefined);
	const pinned = await readJson<{ sha256: string; path?: unknown }>(join(dir, 'design.json'));
	const stale = await readJson<Stale>(join(dir, 'stale.json')).catch(() => undefined);
	return {
		kind: 'facts',
		packet: {
			facts: facts.value,
			text: text.value,
			textMd,
			patches,
			prs,
			heads: (await readJson<Head[]>(join(dir, 'heads.json'))) ?? [],
			notes: await readList<Note>(join(dir, 'notes.json')),
			replies: await readList<Reply>(join(dir, 'replies.json')),
			...(stale && { stale }),
			...(design !== undefined && pinned && { design: { md: design, sha256: pinned.sha256, ...('path' in pinned && { path: pinned.path }) } })
		}
	};
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

/**
 * Writes `notes.json` through a temp file and a rename, so a reader never sees half of it. Returns
 * false when the item was withdrawn, taking the file back as `writeDecision` does.
 */
export async function writeNotes(root: string, id: string, notes: Note[]): Promise<boolean> {
	const dir = join(root, 'items', id);
	const tmp = join(dir, `notes.json.${randomUUID()}.tmp`);
	await writeFile(tmp, JSON.stringify(notes));
	await rename(tmp, join(dir, 'notes.json'));
	if (await stillListed(dir)) return true;
	await unlink(join(dir, 'notes.json')).catch(() => undefined);
	return false;
}

const blocks = (md: string) => md.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
const squash = (block: string) => block.replace(/\s+/g, ' ');

/** The paragraphs of `now` that `before` does not hold, as written; whitespace differences do not count. */
export function changedParagraphs(now: string, before: string): string[] {
	const had = new Set(blocks(before).map(squash));
	return blocks(now).filter((b) => !had.has(squash(b)));
}

/**
 * What the item `meta.revises` names holds for the page: its notes, the replies the resend stored on
 * it, and the paragraphs of `textMd` that changed since its text. Undefined for an item that revises
 * nothing or whose earlier item is gone.
 */
export async function readEarlier(root: string, meta: ItemMeta, textMd: string): Promise<Earlier | undefined> {
	if (!meta.revises) return undefined;
	const { item, revision } = meta.revises;
	const dir = join(root, 'items', item);
	const before = await readFile(join(dir, 'text.md'), 'utf8').catch(() => undefined);
	if (before === undefined) return undefined;
	return {
		item,
		revision,
		notes: await readList<Note>(join(dir, 'notes.json')),
		replies: await readList<Reply>(join(dir, 'replies.json')),
		changed: changedParagraphs(textMd, before)
	};
}
