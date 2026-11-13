import { get, post } from '#lib/components/decide.server.ts';
import { storeRoot } from '#lib/store/store.ts';
import type { RequestHandler } from './$types';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * The origin of the pages this server serves. adapter-node reads a request as https unless
 * `ORIGIN` is set, and the queue serves plain http on a loopback address, so there the origin is
 * the http one. Any other host, such as a name rebound to this machine, keeps the stricter
 * `url.origin`, which no http page matches.
 */
const selfOf = (url: URL) => (LOOPBACK.has(url.hostname) ? `http://${url.host}` : url.origin);

/** Records an answer, a decision, or an Undo from the document page (`decide.server.ts`). */
export const POST: RequestHandler = async ({ params, request, url }) => {
	const reply = post(storeRoot(), params.id, {
		origin: request.headers.get('origin'),
		self: selfOf(url),
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
