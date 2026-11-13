import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ARCHIVE, archiveExists, archiveOld, oldEntries, strangers, undecided } from './archive.ts';

let state: string;

function put(rel: string, text = '{}') {
	const file = join(state, rel);
	mkdirSync(join(file, '..'), { recursive: true });
	writeFileSync(file, text);
}

beforeEach(() => {
	state = mkdtempSync(join(tmpdir(), 'aq-archive-'));
	put('items/done/item.json', '{"title":"Done"}');
	put('items/done/decision.json');
	put('items/waiting/item.json', '{"title":"Waiting one"}');
	mkdirSync(join(state, 'items/retired'));
	put('decisions.jsonl');
	put('fetch-7.json');
	put('check-a.md');
	put('check-a.err');
	put('claim.token', 'secret');
	put('store/doc/version-1.md', 'keep');
	put('server.log');
	put('restart.lock');
	put('start.lock');
	put('stray.txt');
});
afterEach(() => rmSync(state, { recursive: true, force: true }));

describe('undecided', () => {
	it('names an item with item.json and no decision.json, and skips one with neither', () => {
		expect(undecided(state)).toEqual([{ id: 'waiting', title: 'Waiting one' }]);
	});

	it('lists nothing when every item is decided', () => {
		put('items/waiting/decision.json');
		expect(undecided(state)).toEqual([]);
	});
});

describe('the sets of names', () => {
	it('takes the old queue, leaves the new one, and flags the rest', () => {
		expect(oldEntries(state)).toEqual(['check-a.err', 'check-a.md', 'claim.token', 'decisions.jsonl', 'fetch-7.json', 'items']);
		expect(strangers(state)).toEqual(['stray.txt']);
	});
});

describe('archiveOld', () => {
	it('packs the old entries, removes them, and keeps the rest', () => {
		const packed = archiveOld(state);
		expect(packed).toContain('items');
		const listing = spawnSync('tar', ['-tzf', join(state, ARCHIVE)], { encoding: 'utf8' }).stdout;
		expect(listing).toContain('items/done/decision.json');
		expect(listing).toContain('decisions.jsonl');
		expect(listing).toContain('claim.token');
		expect(oldEntries(state)).toEqual([]);
		expect(readdirSync(state).sort()).toEqual([ARCHIVE, 'restart.lock', 'server.log', 'start.lock', 'store', 'stray.txt']);
		expect(archiveExists(state)).toBe(true);
	});

	it('refuses when the archive exists and changes nothing', () => {
		put(ARCHIVE, 'older');
		expect(() => archiveOld(state)).toThrow(/exists already/);
		expect(oldEntries(state)).toHaveLength(6);
	});

	it('does nothing when no old entry is left', () => {
		archiveOld(state);
		expect(archiveOld(state)).toEqual([]);
	});

	it('leaves every entry and no temporary file when tar fails', () => {
		const bin = mkdtempSync(join(tmpdir(), 'aq-tar-'));
		const tar = join(bin, 'tar');
		writeFileSync(tar, '#!/bin/sh\necho broken >&2\nexit 1\n');
		chmodSync(tar, 0o755);
		const was = process.env.PATH;
		process.env.PATH = `${bin}:${was}`;
		try {
			expect(() => archiveOld(state)).toThrow(/tar failed/);
		} finally {
			process.env.PATH = was;
			rmSync(bin, { recursive: true, force: true });
		}
		expect(oldEntries(state)).toHaveLength(6);
		expect(existsSync(join(state, `${ARCHIVE}.tmp`))).toBe(false);
		expect(archiveExists(state)).toBe(false);
	});
});
