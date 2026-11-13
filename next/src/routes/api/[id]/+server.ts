import { get, post } from '#lib/components/decide.server.ts';
import { storeRoot } from '#lib/store/store.ts';
import type { RequestHandler } from './$types';

/** Records an answer, a decision, or an Undo from the document page (`decide.server.ts`). */
export const POST: RequestHandler = async ({ params, request, url }) => {
	const reply = post(storeRoot(), params.id, {
		origin: request.headers.get('origin'),
		self: url.origin,
		contentType: request.headers.get('content-type'),
		body: await request.text()
	});
	return Response.json(reply.body, { status: reply.status });
};

/** Where the document stands, which the page polls while a decision waits for the hand-off. */
export const GET: RequestHandler = ({ params }) => {
	const reply = get(storeRoot(), params.id);
	return Response.json(reply.body, { status: reply.status, headers: { 'cache-control': 'no-store' } });
};
