import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../../../../scripts/page-checks.mjs';
import { DOC } from '#lib/strings.ts';
import { readDecisions, storeRoot } from '#lib/store/store.ts';
import { GET, POST } from './+server.ts';

let state: string;
let report: string;

beforeAll(async () => {
	state = mkdtempSync(join(tmpdir(), 'aq-api-'));
	process.env.APPROVAL_QUEUE_STATE = state;
	report = (await seed(state)).ids['30-round-report'];
}, 30_000);

afterAll(() => {
	delete process.env.APPROVAL_QUEUE_STATE;
	rmSync(state, { recursive: true, force: true });
});

const READ = JSON.stringify({ op: 'decide', action: 'read', answers: {} });

/** A request to the endpoint as a browser on `host` would send it, its Origin matching the host. */
function request(host: string, method = 'POST') {
	const headers = { host, origin: `http://${host}`, 'content-type': 'application/json' };
	// The handler reads the Host header, never the URL, so one URL serves every case.
	return new Request(`http://127.0.0.1:7955/api/${report}`, { method, headers, body: method === 'POST' ? READ : undefined });
}

const post = (host: string) => POST({ params: { id: report }, request: request(host) } as unknown as Parameters<typeof POST>[0]);
const get = (host: string) => GET({ params: { id: report }, request: request(host, 'GET') } as unknown as Parameters<typeof GET>[0]);

// A name rebound to this machine sends a Host and an Origin that match each other, so only the
// loopback check on the Host refuses it.
describe('the loopback Host check', () => {
	it.each(['evil.example:7955', '192.168.1.5:7955', '127.0.0.1:7955@evil.example'])('refuses a post with Host %s and writes nothing', async (host) => {
		const res = await post(host);
		expect(res.status).toBe(403);
		expect((await res.json()).message).toBe(DOC.badOrigin);
		expect(readDecisions(storeRoot(), report)).toEqual([]);
	});

	it('refuses a poll from a host that is not loopback', async () => {
		expect((await get('evil.example:7955')).status).toBe(403);
	});

	it.each(['127.0.0.1:7955', 'localhost:7955', '[::1]:7955'])('takes a post with Host %s', async (host) => {
		expect((await get(host)).status).toBe(200);
		const res = await post(host);
		expect(res.status).toBe(200);
		expect(readDecisions(storeRoot(), report).at(-1)?.action).toBe('read');
	});
});
