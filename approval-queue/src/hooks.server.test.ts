import { describe, expect, it, vi } from 'vitest';
import { handle } from './hooks.server.ts';

function run(host?: string) {
	const headers = new Headers();
	if (host) headers.set('host', host);
	const resolve = vi.fn(async () => new Response('ok'));
	const event = { request: new Request('http://127.0.0.1:7907/', { headers }) };
	// @ts-expect-error the hook reads only request.headers
	return handle({ event, resolve }).then((res: Response) => ({ res, resolve }));
}

describe('handle', () => {
	it('passes the loopback host to resolve', async () => {
		const { res, resolve } = await run(`127.0.0.1:${__QUEUE_PORT__}`);
		expect(res.status).toBe(200);
		expect(resolve).toHaveBeenCalledOnce();
	});

	// A build made without APPROVAL_QUEUE_PORT bakes in 7907, as it did before the setting existed.
	it.skipIf(process.env.APPROVAL_QUEUE_PORT)('serves 7907 when the variable is unset', () => {
		expect(__QUEUE_PORT__).toBe(7907);
	});

	it.each([
		'evil.example:7907',
		'localhost:7907',
		`127.0.0.1:${__QUEUE_PORT__ + 1}`,
		'127.0.0.1',
		undefined
	])('refuses host %s', async (host) => {
		const { res, resolve } = await run(host);
		expect(res.status).toBe(403);
		expect(resolve).not.toHaveBeenCalled();
	});
});
