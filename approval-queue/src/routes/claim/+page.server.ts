import { APPROVAL_QUEUE_STATE } from '$app/env/private';
import { CLAIM_COOKIE, ensureClaimToken, readClaimToken, setClaimCookie } from '#lib/server/claim.ts';
import type { Actions, PageServerLoad } from './$types';

/**
 * Whether this request already carries the state root's claim token. A load changes nothing, so a link
 * preload or an agent's page load never claims a browser.
 */
export const load: PageServerLoad = async ({ cookies }) => {
	const token = await readClaimToken(APPROVAL_QUEUE_STATE);
	return { claimed: token !== undefined && cookies.get(CLAIM_COOKIE) === token };
};

export const actions: Actions = {
	/**
	 * Makes this browser the one the queue opens new items in: reads the state root's claim token, making
	 * it on the first press, and sets the claim cookie to it. Only a poll that carries the cookie counts
	 * as a live tab, so a browser an agent drives never takes a new item's tab.
	 */
	default: async ({ cookies }) => {
		setClaimCookie(cookies, await ensureClaimToken(APPROVAL_QUEUE_STATE));
		return { claimed: true };
	}
};
