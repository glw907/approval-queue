import { APPROVAL_QUEUE_STATE } from '$app/env/private';
import { ensureClaimToken, setClaimCookie } from '#lib/server/claim.ts';
import type { PageServerLoad } from './$types';

/**
 * Makes this browser the one the queue opens new items in: reads the state root's claim token, making
 * it on the first visit, and sets the claim cookie to it. Only a poll that carries the cookie counts
 * as a live tab, so a browser an agent drives never takes a new item's tab.
 */
export const load: PageServerLoad = async ({ cookies }) => {
	setClaimCookie(cookies, await ensureClaimToken(APPROVAL_QUEUE_STATE));
	return {};
};
