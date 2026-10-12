import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REVIEW_DESK_STATE } from '$app/env/private';
import { listDecided, listWaiting } from '#lib/server/items.ts';
import type { LayoutServerLoad } from './$types';

/** "Decided this session" lists decisions written since the app started. */
const startedAt = Date.now();

/**
 * Loads the queue the open tab polls through `desk:queue`. A poll, or any other request from a
 * running page, touches `tab.seen`, which tells the command a live tab will pick up a new item.
 */
export const load: LayoutServerLoad = async ({ depends, isDataRequest }) => {
	depends('desk:queue');
	if (isDataRequest) await writeFile(join(REVIEW_DESK_STATE, 'tab.seen'), '');
	return {
		queue: await listWaiting(REVIEW_DESK_STATE),
		decided: await listDecided(REVIEW_DESK_STATE, startedAt)
	};
};
