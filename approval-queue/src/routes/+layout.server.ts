import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APPROVAL_QUEUE_STATE } from '$app/env/private';
import { CLAIM_COOKIE, readClaimToken, setClaimCookie } from '#lib/server/claim.ts';
import { digestDay } from '#lib/board.ts';
import { readDigest } from '#lib/server/digest.ts';
import { listWaiting } from '#lib/server/items.ts';
import { packetFacts } from '#lib/server/packet-facts.ts';
import type { LayoutServerLoad } from './$types';

/**
 * Loads the queue and the digest's newest day, which the open tab polls through `desk:queue`. A poll from the claimed browser (the one
 * that visited `/claim`) touches `tab.seen`, which tells the command a live tab will pick up a new
 * item, and sets the claim cookie again. A poll from any other client, an agent's browser included,
 * touches nothing.
 */
export const load: LayoutServerLoad = async ({ depends, isDataRequest, cookies }) => {
	depends('desk:queue');
	if (isDataRequest) {
		const token = await readClaimToken(APPROVAL_QUEUE_STATE);
		if (token && cookies.get(CLAIM_COOKIE) === token) {
			await writeFile(join(APPROVAL_QUEUE_STATE, 'tab.seen'), '');
			setClaimCookie(cookies, token);
		}
	}
	const waiting = await listWaiting(APPROVAL_QUEUE_STATE);
	// The rail words a packet by its kind and its calls; every other kind has neither.
	const queue = await Promise.all(
		waiting.map(async (item) => {
			const facts = item.kind === 'packet' ? await packetFacts(APPROVAL_QUEUE_STATE, item.id) : null;
			return { ...item, asks: facts?.asks ?? 0, packetKind: facts?.kind };
		})
	);
	const lines = (await readDigest(APPROVAL_QUEUE_STATE)).flatMap((group) => group.lines);
	return { queue, digest: digestDay(lines) };
};
