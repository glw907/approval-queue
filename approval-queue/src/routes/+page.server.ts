import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APPROVAL_QUEUE_STATE } from '$app/env/private';
import { SINGLES, SORT_COOKIE, type BoardRow, type Sort } from '#lib/board.ts';
import type { Packet } from '#lib/packet.ts';
import { listWaiting, type ItemMeta } from '#lib/server/items.ts';
import { isIrreversible } from '#lib/server/packet-decision.ts';
import type { PageServerLoad } from './$types';

const KINDS = { pr: 'PR', design: 'Design', triage: 'Triage' };

async function toRow(meta: ItemMeta): Promise<BoardRow> {
	const base = { id: meta.id, headline: meta.headline ?? meta.title, created: meta.created };
	if (meta.kind !== 'packet') {
		return { ...base, group: SINGLES, asks: 0, rules: [], repos: 1, irreversible: false, single: KINDS[meta.kind] };
	}
	const packet = JSON.parse(await readFile(join(APPROVAL_QUEUE_STATE, 'items', meta.id, 'packet.json'), 'utf8')) as Packet;
	const repos = new Set(packet.parts.flatMap(({ part }) => (part.owner ? [`${part.owner}/${part.repo}`] : [])));
	return {
		...base,
		group: meta.initiativeTitle || (meta.initiative && meta.initiative !== 'none' ? meta.initiative : 'No initiative'),
		asks: packet.asks.length,
		rules: [...new Set(packet.asks.map((ask) => ask.rule))],
		repos: repos.size,
		irreversible: isIrreversible(packet)
	};
}

/**
 * Loads the board, or the empty state when nothing waits. The sort comes from the cookie here, so
 * the server render is already in the chosen order and hydration never reorders it.
 */
export const load: PageServerLoad = async ({ cookies, depends }) => {
	depends('desk:queue');
	const queue = await listWaiting(APPROVAL_QUEUE_STATE);
	if (!queue.length) return { empty: true as const };
	const sort: Sort = cookies.get(SORT_COOKIE) === 'oldest' ? 'oldest' : 'asks';
	return { empty: false as const, sort, rows: await Promise.all(queue.map(toRow)) };
};
