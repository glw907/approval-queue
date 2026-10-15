import type { Handle } from '@sveltejs/kit/hooks';

/** Refuses any request whose `Host` is not the loopback address, which stops DNS rebinding. */
export const handle: Handle = async ({ event, resolve }) => {
	// paths.origin pins url.host, so the raw header is the only honest signal.
	if (event.request.headers.get('host') !== '127.0.0.1:7907') {
		return new Response('Forbidden', { status: 403 });
	}
	return resolve(event);
};
