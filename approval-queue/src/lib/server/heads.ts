import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import type { FactPacket } from './items.ts';

const run = promisify(execFile);

/** Reads a PR's current head commit for `owner/repo#n`. */
export type HeadReader = (ref: string) => Promise<string>;

/** Finds `gh` on the PATH, as the command does, and gives each PR 10 seconds. */
const ghHead: HeadReader = async (ref) => {
	const [repo, n] = ref.split('#');
	const { stdout } = await run('gh', ['pr', 'view', n, '--repo', repo, '--json', 'headRefOid'], { timeout: 10_000 });
	return JSON.parse(stdout).headRefOid;
};

let reader: HeadReader = ghHead;

/** Replaces the head reader, for a test; no argument restores `gh`. */
export function setHeadReader(next?: HeadReader) {
	reader = next ?? ghHead;
}

/** Why an approve is refused before it writes anything. */
export interface Refusal {
	status: 409 | 503;
	message: string;
}

/**
 * Checks that what the packet pinned is still current: each PR's head against `heads.json`, or a
 * design's file hash against the hash the command pinned. A moved head is 409, a failed `gh` is 503,
 * and a moved head wins when both happen, since it is known.
 */
export async function checkCurrent(packet: FactPacket): Promise<Refusal | undefined> {
	if (packet.facts.kind === 'design') return checkDesign(packet);
	const results = await Promise.allSettled(packet.heads.map(({ ref }) => reader(ref)));
	const moved = packet.heads.filter(({ head }, i) => {
		const result = results[i];
		return result.status === 'fulfilled' && result.value !== head;
	});
	if (moved.length) return { status: 409, message: `Out of date: ${moved.map((h) => h.ref).join(', ')} moved since this packet was queued` };
	if (results.some((r) => r.status === 'rejected')) return { status: 503, message: 'Could not read the PR heads from GitHub; nothing was recorded' };
	return undefined;
}

/**
 * A design's hash is read from the path the command recorded, which never depends on the server's
 * environment. An item queued before the path was recorded has no `path` key and reads the repo
 * checkout the fact file names, under `APPROVAL_QUEUE_PROJECTS` or `~/Projects`. A `path` that is
 * not an absolute string counts as recorded and unreadable: the server can't say what moved.
 */
async function checkDesign({ facts, design }: FactPacket): Promise<Refusal | undefined> {
	if (!facts.design || !design) return undefined;
	const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
	if ('path' in design) {
		const recorded = design.path;
		const bytes = typeof recorded === 'string' && isAbsolute(recorded) ? await readFile(recorded).catch(() => undefined) : undefined;
		if (bytes === undefined) return { status: 503, message: `Could not read the design at ${String(recorded)}; nothing was recorded` };
		return hash(bytes) === design.sha256 ? undefined : outOfDate;
	}
	const projects = process.env.APPROVAL_QUEUE_PROJECTS ?? join(homedir(), 'Projects');
	const now = await readFile(join(projects, facts.design.repo, facts.design.path)).then(hash, () => '');
	return now === design.sha256 ? undefined : outOfDate;
}

const outOfDate: Refusal = { status: 409, message: 'Out of date: the design changed since this packet was queued' };
