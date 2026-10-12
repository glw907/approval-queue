import { REVIEW_DESK_STATE } from '$app/env/private';
import { redirect } from '@sveltejs/kit';
import { listWaiting } from '#lib/server/items.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [oldest] = await listWaiting(REVIEW_DESK_STATE);
	if (oldest) redirect(307, `/item/${oldest.id}`);
	return { empty: true as const };
};
