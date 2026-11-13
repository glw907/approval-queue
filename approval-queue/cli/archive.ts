import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** The archive of the old queue's state, kept at the root of the state directory. */
export const ARCHIVE = 'archive-2026-11.tar.gz';

// The names the old command and app wrote into the state directory.
const OLD_NAMES = new Set([
	'items',
	'findings',
	'decisions.jsonl',
	'digest.jsonl',
	'digest-notes.json',
	'digest-replies.json',
	'refusals.jsonl',
	'claim.token',
	'tab.seen',
	'queue.lock',
]);
const OLD_PATTERNS = [/^fetch-/, /^check-.*\.md$/, /^check-.*\.err$/];
// The names the new queue writes, which an archive never takes.
const NEW_NAMES = new Set(['store', 'server.log', 'restart.lock', 'start.lock']);

function isOld(name: string): boolean {
	return OLD_NAMES.has(name) || OLD_PATTERNS.some((p) => p.test(name));
}

function entries(state: string): string[] {
	try {
		return fs.readdirSync(state).sort();
	} catch {
		return [];
	}
}

/** The old queue's entries in `state`, by name. */
export function oldEntries(state: string): string[] {
	return entries(state).filter(isOld);
}

/** Entries in `state` that are neither the old queue's nor the new queue's, by name. */
export function strangers(state: string): string[] {
	return entries(state).filter((n) => !isOld(n) && !NEW_NAMES.has(n) && !n.startsWith('archive-'));
}

/** Whether the archive file is already in `state`. */
export function archiveExists(state: string): boolean {
	return fs.existsSync(path.join(state, ARCHIVE));
}

/**
 * The old items still waiting for a decision: each has an `item.json` and no `decision.json`,
 * which is the old app's own rule for what waits.
 */
export function undecided(state: string): { id: string; title: string }[] {
	const dir = path.join(state, 'items');
	const waiting: { id: string; title: string }[] = [];
	for (const id of entries(dir)) {
		const item = path.join(dir, id, 'item.json');
		if (!fs.existsSync(item) || fs.existsSync(path.join(dir, id, 'decision.json'))) continue;
		let title = '';
		try {
			title = String(JSON.parse(fs.readFileSync(item, 'utf8')).title ?? '');
		} catch {}
		waiting.push({ id, title });
	}
	return waiting;
}

/**
 * Packs the old entries of `state` into `archive-2026-11.tar.gz`, then removes them.
 *
 * @remarks The archive is written under a temporary name and listed back before it takes its final
 * name, so a failure before the rename leaves every entry and no temporary file. Entries sit at
 * the archive's root as they sat in `state`. Returns the names packed.
 * @throws Error when the archive exists already, or when `tar` fails or lists less than was packed.
 */
export function archiveOld(state: string): string[] {
	const names = oldEntries(state);
	if (!names.length) return [];
	if (archiveExists(state)) throw new Error(`${path.join(state, ARCHIVE)} exists already`);
	const tmp = path.join(state, `${ARCHIVE}.tmp`);
	try {
		const made = spawnSync('tar', ['-czf', tmp, '-C', state, '--', ...names], { encoding: 'utf8' });
		if (made.status !== 0) throw new Error(`tar failed: ${(made.stderr || made.error?.message || '').trim()}`);
		const listed = spawnSync('tar', ['-tzf', tmp], { encoding: 'utf8', maxBuffer: 1 << 28 });
		if (listed.status !== 0) throw new Error(`tar could not read the archive back: ${listed.stderr.trim()}`);
		const roots = new Set(listed.stdout.split('\n').filter(Boolean).map((l) => l.replace(/^\.\//, '').split('/')[0]));
		const missing = names.filter((n) => !roots.has(n));
		if (missing.length) throw new Error(`the archive lacks ${missing.join(', ')}`);
		fs.renameSync(tmp, path.join(state, ARCHIVE));
	} catch (err) {
		fs.rmSync(tmp, { force: true });
		throw err;
	}
	for (const name of names) fs.rmSync(path.join(state, name), { recursive: true, force: true });
	return names;
}
