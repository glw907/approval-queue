import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedPacket } from '#lib/fixtures/seed-packet.ts';
import { packetFacts } from './packet-facts.ts';

const PACKET = readFileSync(new URL('../../../../tests/fixtures/e2e-packet.md', import.meta.url), 'utf8');

let root = '';
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'approval-queue-facts-'));
	await seedPacket(root, 'p1', PACKET);
});
afterEach(() => rm(root, { recursive: true, force: true }));

describe('packetFacts', () => {
	it('reads the asks, rules, repos, and irreversible flag', async () => {
		expect(await packetFacts(root, 'p1')).toMatchObject({ asks: 2, repos: 1, irreversible: false });
	});

	it('returns the cached facts while the mtime holds, even if the text changed', async () => {
		const file = join(root, 'items', 'p1', 'packet.json');
		// A whole-second mtime restores exactly; a fresh file's carries a sub-millisecond part.
		const mtime = new Date(1_700_000_000_000);
		await utimes(file, mtime, mtime);
		const first = await packetFacts(root, 'p1');
		const packet = JSON.parse(await readFile(file, 'utf8'));
		packet.asks = [];
		await writeFile(file, JSON.stringify(packet));
		await utimes(file, mtime, mtime);
		expect(await packetFacts(root, 'p1')).toEqual(first);
	});

	it('reads again once the mtime changes', async () => {
		const file = join(root, 'items', 'p1', 'packet.json');
		await packetFacts(root, 'p1');
		const packet = JSON.parse(await readFile(file, 'utf8'));
		packet.asks = [];
		await writeFile(file, JSON.stringify(packet));
		const later = new Date(Date.now() + 5000);
		await utimes(file, later, later);
		expect(await packetFacts(root, 'p1')).toMatchObject({ asks: 0, rules: [] });
	});

	it('returns null for a missing or damaged packet', async () => {
		expect(await packetFacts(root, 'nope')).toBeNull();
		const file = join(root, 'items', 'p1', 'packet.json');
		await writeFile(file, '{nope');
		const later = new Date(Date.now() + 9000);
		await utimes(file, later, later);
		expect(await packetFacts(root, 'p1')).toBeNull();
	});
});
