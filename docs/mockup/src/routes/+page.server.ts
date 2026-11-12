import { merged } from '#lib/server/docs';
import { docState, read } from '#lib/server/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ merged: merged(), state: docState(read(), 'merged') });
