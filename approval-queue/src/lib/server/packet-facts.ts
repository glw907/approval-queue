import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Facts } from '#lib/facts.ts';
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
	const dir = join(root, 'items', id);
	const file = await stat(join(dir, 'facts.json')).then(() => join(dir, 'facts.json'), () => join(dir, 'packet.json'));
	try {
		const { mtimeMs } = await stat(file);
		const hit = cache.get(file);
		if (hit?.mtimeMs === mtimeMs) return hit.facts;
		const stored = JSON.parse(await readFile(file, 'utf8'));
		const facts = file.endsWith('facts.json') ? newFacts(stored as Facts) : oldFacts(stored as Packet);
		cache.set(file, { mtimeMs, facts });
		return facts;
	} catch {
		cache.delete(file);
		return null;
	}
}

/** A new-shape packet's asks are its calls; its fact file carries no step tags, so an irreversible call is the flag. */
function newFacts(stored: Facts): PacketFacts {
	const repos = new Set([...stored.prs.map((ref) => ref.split('#')[0]), ...(stored.design ? [stored.design.repo] : [])]);
	return {
		asks: stored.calls.length,
		rules: [...new Set(stored.calls.map((call) => call.rule))],
		repos: repos.size,
		irreversible: stored.calls.some((call) => call.rule === 'irreversible')
	};
}

function oldFacts(packet: Packet): PacketFacts {
	const repos = new Set(packet.parts.flatMap(({ part }) => (part.owner ? [`${part.owner}/${part.repo}`] : [])));
	return {
		asks: packet.asks.length,
		rules: [...new Set(packet.asks.map((ask) => ask.rule))],
		repos: repos.size,
		irreversible: isIrreversible(packet)
	};
}
