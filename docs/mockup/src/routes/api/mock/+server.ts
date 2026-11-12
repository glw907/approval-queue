import { json } from '@sveltejs/kit';
import { read, reset, write } from '#lib/server/store';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as { down?: boolean; reset?: boolean };
	if (body.reset) reset();
	else {
		const state = read();
		state.down = !!body.down;
		write(state);
	}
	return json({ ok: true });
};
