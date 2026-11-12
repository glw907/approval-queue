import { error } from '@sveltejs/kit';
import { oneDoc } from '#lib/server/docs';
import { docState, read } from '#lib/server/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const doc = oneDoc(params.id);
	if (!doc) error(404, 'The queue has no document at this address.');
	return { doc, state: docState(read(), params.id) };
};
