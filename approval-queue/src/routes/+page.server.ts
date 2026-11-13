import { merged } from '#lib/components/queue.server.ts';
import { storeRoot } from '#lib/store/store.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ merged: merged(storeRoot()) });
