import { REVIEW_DESK_STATE } from '$app/env/private';
import { listWaiting } from '#lib/server/items.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ items: await listWaiting(REVIEW_DESK_STATE) });
