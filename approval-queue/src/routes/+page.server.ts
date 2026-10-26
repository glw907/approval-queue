import { APPROVAL_QUEUE_STATE } from '$app/env/private';
import { SINGLES, SORT_COOKIE, type BoardRow, type Sort } from '#lib/board.ts';
import { listWaiting, type ItemMeta } from '#lib/server/items.ts';
import { packetFacts } from '#lib/server/packet-facts.ts';
import type { PageServerLoad } from './$types';

const KINDS = { pr: 'PR', design: 'Design', triage: 'Triage', docs: 'Docs' };

async function toRow(meta: ItemMeta): Promise<BoardRow> {
	const base = { id: meta.id, headline: meta.headline ?? meta.title, created: meta.created, deferred: meta.deferred, orphaned: meta.orphaned };
	if (meta.kind !== 'packet') {
		return { ...base, group: SINGLES, asks: 0, rules: [], repos: 1, irreversible: false, single: KINDS[meta.kind] };
	}
	const facts = await packetFacts(APPROVAL_QUEUE_STATE, meta.id);
	// A withdrawn or damaged packet must not take the board down; it shows by id so it can be found.
	if (!facts) return { ...base, headline: meta.id, group: SINGLES, asks: 0, rules: [], repos: 1, irreversible: false, single: 'Unreadable' };
	return {
		...base,
		group: meta.initiativeTitle || (meta.initiative && meta.initiative !== 'none' ? meta.initiative : 'No initiative'),
		...facts
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
