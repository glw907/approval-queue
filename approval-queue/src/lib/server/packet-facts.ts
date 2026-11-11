import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Facts } from '#lib/facts.ts';

/** What the board and the rail show of a packet without opening it. */
export interface PacketFacts {
	asks: number;
	/** The rule ids of the asks, once each. */
	rules: string[];
	/** How many distinct repos the parts name. */
	repos: number;
	irreversible: boolean;
}

const cache = new Map<string, { mtimeMs: number; facts: PacketFacts }>();

/**
 * Reads a packet's facts, parsing `facts.json` again only when its mtime changes, since the board
 * and the rail ask on every 2-second poll. Returns null for a packet that is missing, damaged, or
 * stored before the fact file, so one bad item never takes the board down.
 */
export async function packetFacts(root: string, id: string): Promise<PacketFacts | null> {
	const file = join(root, 'items', id, 'facts.json');
	try {
		const { mtimeMs } = await stat(file);
		const hit = cache.get(file);
		if (hit?.mtimeMs === mtimeMs) return hit.facts;
		const facts = summarize(JSON.parse(await readFile(file, 'utf8')) as Facts);
		cache.set(file, { mtimeMs, facts });
		return facts;
	} catch {
		cache.delete(file);
		return null;
	}
}

/** A packet's asks are its calls; its fact file carries no step tags, so an irreversible call is the flag. */
function summarize(stored: Facts): PacketFacts {
	const repos = new Set([...stored.prs.map((ref) => ref.split('#')[0]), ...(stored.design ? [stored.design.repo] : [])]);
	return {
		asks: stored.calls.length,
		rules: [...new Set(stored.calls.map((call) => call.rule))],
		repos: repos.size,
		irreversible: stored.calls.some((call) => call.rule === 'irreversible')
	};
}
