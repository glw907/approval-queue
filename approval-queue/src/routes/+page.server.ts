import { APPROVAL_QUEUE_STATE } from '$app/env/private';
import { redirect } from '@sveltejs/kit';
import { groupTitle, openingRow, SINGLES, SORT_COOKIE, type BoardRow, type Sort } from '#lib/board.ts';
import { listWaiting, type ItemMeta } from '#lib/server/items.ts';
import { packetFacts } from '#lib/server/packet-facts.ts';
import type { PageServerLoad } from './$types';

const KINDS = { design: 'Design', triage: 'Triage' };

async function toRow(meta: ItemMeta): Promise<BoardRow> {
	const base = { id: meta.id, headline: meta.headline ?? meta.title, created: meta.created, orphaned: meta.orphaned };
	if (meta.kind !== 'packet') {
		return { ...base, group: SINGLES, asks: 0, rules: [], repos: 1, irreversible: false, single: KINDS[meta.kind] };
	}
	const facts = await packetFacts(APPROVAL_QUEUE_STATE, meta.id);
	// A withdrawn or damaged packet must not take the board down; it shows by id so it can be found.
	if (!facts) return { ...base, headline: meta.id, group: SINGLES, asks: 0, rules: [], repos: 1, irreversible: false, single: 'Unreadable' };
	return {
		...base,
		group: groupTitle(meta),
		...(meta.round && { round: meta.round }),
		...facts
	};
}

/**
 * Opens the app on the oldest waiting packet, or loads the board, or the empty state when nothing
 * waits. Only a page load redirects: a navigation inside the app (the board key, or a decision that
 * leaves the queue empty while its own item is still held) must be able to reach the board. The sort
 * comes from the cookie here, so the server render is already in the chosen order and hydration never
 * reorders it.
 */
export const load: PageServerLoad = async ({ cookies, depends, isDataRequest }) => {
	depends('desk:queue');
	const queue = await listWaiting(APPROVAL_QUEUE_STATE);
	if (!queue.length) return { empty: true as const };
	const rows = await Promise.all(queue.map(toRow));
	const opening = openingRow(rows);
	if (opening && !isDataRequest) redirect(302, `/item/${encodeURIComponent(opening.id)}`);
	const sort: Sort = cookies.get(SORT_COOKIE) === 'oldest' ? 'oldest' : 'asks';
	return { empty: false as const, sort, rows };
};
