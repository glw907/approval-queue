import { APPROVAL_QUEUE_STATE } from '$app/env/private';
import { listHistory } from '#lib/server/history.ts';
import type { PageServerLoad } from './$types';

/** Loads the decided items, newest first; `?q=` keeps the titles that contain it. */
export const load: PageServerLoad = async ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	return { q, rows: await listHistory(APPROVAL_QUEUE_STATE, q) };
};
