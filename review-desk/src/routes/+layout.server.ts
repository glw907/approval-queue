import { REVIEW_DESK_STATE } from '$app/env/private';
import { listDecided, listWaiting } from '#lib/server/items.ts';
import type { LayoutServerLoad } from './$types';

/** "Decided this session" lists decisions written since the app started. */
const startedAt = Date.now();

export const load: LayoutServerLoad = async () => ({
	queue: await listWaiting(REVIEW_DESK_STATE),
	decided: await listDecided(REVIEW_DESK_STATE, startedAt)
});
