import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE } from '#lib/report-fixture.ts';

const state = vi.hoisted(() => ({ root: '' }));
vi.mock('$app/env/private', () => ({
	get APPROVAL_QUEUE_STATE() {
		return state.root;
	}
}));

import { actions, load } from './+page.server.ts';

const meta = { kind: 'report', title: 'Round ur-queue, written 2026-11-12', initiative: 'ur', round: 'ur-queue' };

async function write(id: string, item: object | null, files: Record<string, string> = {}) {
	const dir = join(state.root, 'items', id);
	await mkdir(dir, { recursive: true });
	if (item) await writeFile(join(dir, 'item.json'), JSON.stringify({ id, repo: 'r', created: '2026-11-12T06:00:00Z', ...item }));
	for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
}

const open = (id: string) => load({ params: { id } } as never) as Promise<Record<string, unknown>>;
const post = (action: keyof typeof actions, id: string) =>
	(actions[action] as (e: never) => Promise<unknown>)({ params: { id }, request: new Request('http://x/', { method: 'POST', body: new FormData() }) } as never);
const redirected = async (run: Promise<unknown>) => run.then(() => undefined, (e: { status?: number; location?: string }) => e);

beforeEach(async () => {
	state.root = await mkdtemp(join(tmpdir(), 'approval-queue-report-'));
});
afterEach(() => rm(state.root, { recursive: true, force: true }));

describe('a round report page', () => {
	it('loads its meta, the rendered body without its heading, and the packets and pull requests of its round', async () => {
		await write('r1', meta, { 'report.md': `# Heading\n${FIXTURE.split('\n').slice(1).join('\n')}` });
		await write('p1', { kind: 'packet', title: 'A packet', initiative: 'ur', round: 'ur-queue' });
		await writeFile(join(state.root, 'digest.jsonl'), JSON.stringify({ time: 't', ref: 'o/r#14', head: 'h', claim: 'landed', lane: 'l', round: 'ur-queue' }) + '\n');
		const data = await open('r1');
		expect(data).toMatchObject({ kind: 'report', read: false, waiting: [{ id: 'p1', title: 'A packet' }], landed: [{ ref: 'o/r#14', url: 'https://github.com/o/r/pull/14' }] });
		expect(String(data.html)).toContain('<table');
		expect(String(data.html)).not.toContain('Heading');
	});

	it('loads a read report as read', async () => {
		await write('r1', meta, { 'report.md': FIXTURE, 'decision.json': '{"decision":"read"}' });
		expect(await open('r1')).toMatchObject({ kind: 'report', read: true });
	});
});

describe('the read action', () => {
	it('writes {"decision":"read"} and no decisions.jsonl, then goes to the next waiting item', async () => {
		await write('r1', meta, { 'report.md': FIXTURE });
		await write('p1', { kind: 'packet', title: 'Next', created: '2026-11-12T07:00:00Z', initiative: 'ur', round: 'ur-queue' });
		const out = await redirected(post('read', 'r1'));
		expect(out).toMatchObject({ status: 303, location: '/item/p1' });
		expect(await readFile(join(state.root, 'items', 'r1', 'decision.json'), 'utf8')).toBe('{"decision":"read"}');
		expect(await readdir(state.root)).not.toContain('decisions.jsonl');
	});

	it('goes to the board when nothing else waits', async () => {
		await write('r1', meta, { 'report.md': FIXTURE });
		expect(await redirected(post('read', 'r1'))).toMatchObject({ status: 303, location: '/' });
	});

	it('writes nothing for a report already read, or one a newer report replaced', async () => {
		await write('r1', meta, { 'report.md': FIXTURE, 'decision.json': '{"decision":"read"}' });
		await write('gone', null, { 'report.md': FIXTURE });
		expect(await redirected(post('read', 'r1'))).toMatchObject({ status: 303 });
		expect(await redirected(post('read', 'gone'))).toMatchObject({ status: 303, location: '/' });
		await expect(readFile(join(state.root, 'items', 'gone', 'decision.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('answers 400 for an item that is not a report', async () => {
		await write('d1', { kind: 'design', title: 'D' }, { 'doc.md': '# d' });
		expect(await post('read', 'd1')).toMatchObject({ status: 400 });
	});
});

describe('every other action on a report', () => {
	it.each(['approve', 'reject', 'notes', 'submit'] as const)('answers 400 for %s', async (action) => {
		await write('r1', meta, { 'report.md': FIXTURE });
		expect(await post(action, 'r1')).toMatchObject({ status: 400 });
	});
});
