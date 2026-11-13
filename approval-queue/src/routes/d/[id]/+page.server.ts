import { error } from '@sveltejs/kit';
import { answersOf, standingOf } from '#lib/components/decide.server.ts';
import { readThreads } from '#lib/components/notes.server.ts';
import { pageDoc, storedDoc } from '#lib/components/queue.server.ts';
import type { DocStanding, Thread } from '#lib/components/types.ts';
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

const WAITING: DocStanding = { state: 'waiting', n: null, seq: 0, decision: null };

export const load: PageServerLoad = ({ params }) => {
	const specimen = Object.hasOwn(SPECIMENS, params.id) ? SPECIMENS[params.id] : undefined;
	if (specimen !== undefined) return { doc: pageDoc(params.id, parse(specimen).doc, STARTED), standing: WAITING, answers: {} as Record<string, number>, threads: [] as Thread[] };
	try {
		const root = storeRoot();
		return { doc: storedDoc(root, params.id), standing: standingOf(root, params.id), answers: answersOf(root, params.id), threads: readThreads(root, params.id).threads };
	} catch (e) {
		if (e instanceof StoreError && (e.code === 'bad-id' || e.code === 'missing')) error(404, DOC.missing);
		throw e;
	}
};
