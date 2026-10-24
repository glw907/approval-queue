import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APPROVAL_QUEUE_STATE } from '$app/env/private';
import { CLAIM_COOKIE, readClaimToken, setClaimCookie } from '#lib/server/claim.ts';
import { listDecided, listWaiting } from '#lib/server/items.ts';
import type { LayoutServerLoad } from './$types';

/** "Decided this session" lists decisions written since the app started. */
const startedAt = Date.now();

/**
 * Loads the queue the open tab polls through `desk:queue`. A poll from the claimed browser (the one
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
	return {
		queue: await listWaiting(APPROVAL_QUEUE_STATE),
		decided: await listDecided(APPROVAL_QUEUE_STATE, startedAt)
	};
};
