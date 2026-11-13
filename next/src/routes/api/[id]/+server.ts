import { get, post } from '#lib/components/decide.server.ts';
import { storeRoot } from '#lib/store/store.ts';
import { DOC } from '#lib/strings.ts';
import type { RequestHandler } from './$types';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * The origin of the pages this server serves, read from the request's raw Host header, or null
 * when that host isn't a loopback address. The queue serves plain http on loopback only, so a
 * name rebound to this machine, or any other host, gets no origin and every request from it is
 * refused. The Host header is read directly, never through adapter-node's `url.origin`, which
 * defaults to https and follows `ORIGIN`, `PROTOCOL_HEADER`, and `HOST_HEADER` when they are set.
 */
function selfOf(request: Request): string | null {
	const host = request.headers.get('host');
	if (!host) return null;
	let hostname: string;
	try {
		hostname = new URL(`http://${host}`).hostname;
	} catch {
		return null;
	}
	return LOOPBACK.has(hostname) ? `http://${host}` : null;
}

const foreign = () => Response.json({ standing: null, message: DOC.badOrigin }, { status: 403 });

/** Records an answer, a decision, or an Undo from the document page (`decide.server.ts`). */
export const POST: RequestHandler = async ({ params, request }) => {
	const self = selfOf(request);
	if (!self) return foreign();
	const reply = post(storeRoot(), params.id, {
		origin: request.headers.get('origin'),
		self,
		contentType: request.headers.get('content-type'),
		body: await request.text()
	});
	return Response.json(reply.body, { status: reply.status });
};

/** Where the document stands, which the page polls while a decision waits for the hand-off. */
export const GET: RequestHandler = ({ params, request }) => {
	if (!selfOf(request)) return foreign();
	const reply = get(storeRoot(), params.id);
	return Response.json(reply.body, { status: reply.status, headers: { 'cache-control': 'no-store' } });
};
