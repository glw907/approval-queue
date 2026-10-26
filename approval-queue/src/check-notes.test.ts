import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { noteDefects } from './check-notes.ts';

const PAGES: Record<string, string> = {
	'docs/a.md': 'Water the plant. Then water the plant again.\n',
	'docs/b.md': 'Water the plant once.\n'
};
const text = (file: string) => PAGES[file];

describe('noteDefects', () => {
	it('passes a quote that occurs once', () => {
		expect(noteDefects([{ id: 'N1', file: 'docs/a.md', anchor: { quote: 'again' } }], text)).toEqual([]);
	});

	it('names the note, its page, the quote, and the count for a repeated quote', () => {
		expect(noteDefects([{ id: 'N2', file: 'docs/a.md', anchor: { quote: 'the plant' } }], text)).toEqual([
			'note N2 (docs/a.md): the quote "the plant" occurs 2 times'
		]);
	});

	it('reads each note against its own page', () => {
		expect(noteDefects([{ id: 'N3', file: 'docs/b.md', anchor: { quote: 'the plant' } }], text)).toEqual([]);
	});

	it('passes a repeated quote whose context occurs once', () => {
		expect(noteDefects([{ id: 'N4', file: 'docs/a.md', anchor: { quote: 'the plant', prefix: 'Then water ' } }], text)).toEqual([]);
	});
});

describe('check-notes.ts', () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), 'approval-queue-check-notes-'));
		await mkdir(join(dir, 'docs'));
		for (const [file, body] of Object.entries(PAGES)) await writeFile(join(dir, file), body);
	});
	afterEach(() => rm(dir, { recursive: true, force: true }));

	const run = async (notes: unknown) => {
		await writeFile(join(dir, 'notes.json'), JSON.stringify(notes));
		return spawnSync('node', [new URL('./check-notes.ts', import.meta.url).pathname, dir, join(dir, 'notes.json')], { encoding: 'utf8' });
	};

	it('exits 0 with no output when every quote is unambiguous', async () => {
		const out = await run([{ id: 'N1', file: 'docs/a.md', anchor: { quote: 'again' } }]);
		expect(out).toMatchObject({ status: 0, stdout: '', stderr: '' });
	});

	it('exits 2 with one line per defect', async () => {
		const out = await run([
			{ id: 'N1', file: 'docs/a.md', anchor: { quote: 'the plant' } },
			{ id: 'N2', file: 'docs/a.md', anchor: { quote: 'plant' } }
		]);
		expect(out.status).toBe(2);
		expect(out.stderr.trim().split('\n')).toEqual([
			'note N1 (docs/a.md): the quote "the plant" occurs 2 times',
			'note N2 (docs/a.md): the quote "plant" occurs 2 times'
		]);
	});

	it('exits 1 when a page cannot be read', async () => {
		const out = await run([{ id: 'N1', file: 'docs/missing.md', anchor: { quote: 'x' } }]);
		expect(out.status).toBe(1);
		expect(out.stderr).toContain('check-notes: cannot read');
	});
});
