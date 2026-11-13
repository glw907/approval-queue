import { error } from '@sveltejs/kit';
import { pageDoc, storedDoc } from '#lib/components/queue.server.ts';
import { parse } from '#lib/doc/parse.ts';
import { storeRoot, StoreError } from '#lib/store/store.ts';
import { DOC } from '#lib/strings.ts';
import markdown from './markdown.md?raw';
import long from './long.md?raw';
import type { PageServerLoad } from './$types';

/** The specimens have addresses no store id can take, and no list shows them. */
const SPECIMENS: Record<string, string> = { markdown, long };

/** A specimen was never sent, so its meta line gives the time the server started. */
const STARTED = new Date().toISOString();

export const load: PageServerLoad = ({ params }) => {
	const specimen = Object.hasOwn(SPECIMENS, params.id) ? SPECIMENS[params.id] : undefined;
	if (specimen !== undefined) return { doc: pageDoc(params.id, parse(specimen).doc, STARTED) };
	try {
		return { doc: storedDoc(storeRoot(), params.id) };
	} catch (e) {
		if (e instanceof StoreError && (e.code === 'bad-id' || e.code === 'missing')) error(404, DOC.missing);
		throw e;
	}
};
