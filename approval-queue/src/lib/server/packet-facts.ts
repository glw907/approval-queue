import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Packet } from '#lib/packet.ts';
import { isIrreversible } from './packet-decision.ts';

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
 * Reads a packet's facts, parsing `packet.json` again only when its mtime changes, since the board
 * and the rail ask on every 2-second poll. Returns null for a packet that is missing or damaged,
 * so one bad item never takes the board down.
 */
export async function packetFacts(root: string, id: string): Promise<PacketFacts | null> {
	const file = join(root, 'items', id, 'packet.json');
	try {
		const { mtimeMs } = await stat(file);
		const hit = cache.get(file);
		if (hit?.mtimeMs === mtimeMs) return hit.facts;
		const packet = JSON.parse(await readFile(file, 'utf8')) as Packet;
		const repos = new Set(packet.parts.flatMap(({ part }) => (part.owner ? [`${part.owner}/${part.repo}`] : [])));
		const facts = {
			asks: packet.asks.length,
			rules: [...new Set(packet.asks.map((ask) => ask.rule))],
			repos: repos.size,
			irreversible: isIrreversible(packet)
		};
		cache.set(file, { mtimeMs, facts });
		return facts;
	} catch {
		cache.delete(file);
		return null;
	}
}
