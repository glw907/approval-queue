import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCS_NOTES, git, REPOT, seedDocsRepo, WATER, WATER_HEAD } from '#lib/fixtures/seed-docs.ts';
import type { Note } from '#lib/editor/notes.ts';
import { buildDocsApprove, committed, isClean, queued, saveFile, sentBackCalls } from './docs.ts';

const NOTES = JSON.parse(DOCS_NOTES) as Note[];

let repo: string;
let blobs: { water: string; repot: string };
beforeEach(async () => {
	repo = await mkdtemp(join(tmpdir(), 'approval-queue-docs-'));
	blobs = seedDocsRepo(repo);
});
afterEach(() => rm(repo, { recursive: true, force: true }));

describe('saveFile', () => {
	it('writes the text and commits that page alone with the review message', async () => {
		const text = WATER_HEAD.replace('top inch', 'top two inches');
		const saved = await saveFile(repo, WATER, text, blobs.water);
		expect(saved.ok).toBe(true);
		if (!saved.ok) return;
		expect(saved.blob).toBe(git(repo, 'rev-parse', `HEAD:${WATER}`));
		expect(saved.commit).toBe(git(repo, 'rev-parse', 'HEAD'));
		expect(git(repo, 'log', '-1', '--format=%s')).toBe(`Edit ${WATER} in review`);
		expect(git(repo, 'show', '--name-only', '--format=', 'HEAD')).toBe(WATER);
		expect(await readFile(join(repo, WATER), 'utf8')).toBe(text);
		expect(await isClean(repo, WATER)).toBe(true);
	});

	it('writes the file’s own line endings although a form post sends CRLF', async () => {
		const posted = `${WATER_HEAD}more\n`.replace(/\n/g, '\r\n');
		const saved = await saveFile(repo, WATER, posted, blobs.water);
		expect(saved.ok).toBe(true);
		expect(await readFile(join(repo, WATER), 'utf8')).toBe(`${WATER_HEAD}more\n`);
		const head = git(repo, 'rev-parse', 'HEAD');
		const again = await saveFile(repo, WATER, posted, saved.ok ? saved.blob : '');
		expect(again).toMatchObject({ ok: true, commit: head });
	});

	it('commits nothing for unchanged text', async () => {
		const head = git(repo, 'rev-parse', 'HEAD');
		const saved = await saveFile(repo, WATER, WATER_HEAD, blobs.water);
		expect(saved).toEqual({ ok: true, blob: blobs.water, commit: head });
		expect(git(repo, 'rev-parse', 'HEAD')).toBe(head);
	});

	it('refuses a save edited from a blob that is no longer at HEAD, and leaves the file alone', async () => {
		const first = await saveFile(repo, WATER, `${WATER_HEAD}one\n`, blobs.water);
		expect(first.ok).toBe(true);
		const stale = await saveFile(repo, WATER, `${WATER_HEAD}two\n`, blobs.water);
		expect(stale).toMatchObject({ ok: false, status: 409 });
		expect(await readFile(join(repo, WATER), 'utf8')).toBe(`${WATER_HEAD}one\n`);
	});

	it('runs two racing saves one at a time, so the second meets the first one’s commit and is refused', async () => {
		const [a, b] = await Promise.all([
			saveFile(repo, WATER, `${WATER_HEAD}a\n`, blobs.water),
			saveFile(repo, WATER, `${WATER_HEAD}b\n`, blobs.water)
		]);
		expect(a.ok).toBe(true);
		expect(b).toMatchObject({ ok: false, status: 409 });
		expect(git(repo, 'rev-list', '--count', 'HEAD')).toBe('3');
	});

	it('refuses a page that is no longer committed', async () => {
		expect(await saveFile(repo, 'docs/guide/missing.md', 'x', blobs.water)).toMatchObject({ ok: false, status: 500 });
	});
});

describe('queued', () => {
	it('commits two pages saved at once, without meeting the index lock', async () => {
		const water = `${WATER_HEAD}w\n`;
		const repot = `${await readFile(join(repo, REPOT), 'utf8')}r\n`;
		const [a, b] = await Promise.all([
			saveFile(repo, WATER, water, blobs.water),
			saveFile(repo, REPOT, repot, blobs.repot)
		]);
		expect(a.ok).toBe(true);
		expect(b.ok).toBe(true);
		expect(git(repo, 'log', '-2', '--format=%s').split('\n').sort()).toEqual([`Edit ${REPOT} in review`, `Edit ${WATER} in review`]);
	});

	it('holds the worktree’s queue, so a save on any page waits for the step', async () => {
		const order: string[] = [];
		let open!: () => void;
		const gate = new Promise<void>((resolve) => (open = resolve));
		const step = queued(repo, async () => {
			order.push('start');
			await gate;
			order.push('end');
		});
		await vi.waitFor(() => expect(order).toEqual(['start']));
		const text = `${await readFile(join(repo, REPOT), 'utf8')}more\n`;
		const save = saveFile(repo, REPOT, text, blobs.repot).then(() => order.push('save'));
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(order).toEqual(['start']);
		open();
		await Promise.all([step, save]);
		expect(order).toEqual(['start', 'end', 'save']);
	});
});

describe('buildDocsApprove', () => {
	const form = (fields: Record<string, string>) => new URLSearchParams(fields);
	const answers = { 'call:N2': 'Keep the text', 'call:N3': 'Leave it out' };
	const head = async () => {
		const water = await committed(repo, WATER);
		const repot = await committed(repo, REPOT);
		return {
			commit: water.commit,
			pages: [
				{ path: WATER, blob: water.blob, clean: true },
				{ path: REPOT, blob: repot.blob, clean: true }
			]
		};
	};
	const posted = (h: Awaited<ReturnType<typeof head>>) => ({
		...answers,
		[`blob:${WATER}`]: h.pages[0].blob,
		[`blob:${REPOT}`]: h.pages[1].blob
	});

	it('records each call’s label and the HEAD commit', async () => {
		const h = await head();
		expect(buildDocsApprove(NOTES, form(posted(h)), h)).toEqual({
			ok: true,
			decision: {
				decision: 'approve',
				commit: h.commit,
				calls: [
					{ id: 'N2', choice: 'Keep the text' },
					{ id: 'N3', choice: 'Leave it out' }
				]
			}
		});
	});

	it('refuses an open call, a label the note does not offer, and an unknown call', async () => {
		const h = await head();
		const { 'call:N3': _open, ...open } = posted(h);
		expect(buildDocsApprove(NOTES, form(open), h)).toEqual({ ok: false, message: 'Make the call “Name a pot material?” first' });
		expect(buildDocsApprove(NOTES, form({ ...posted(h), 'call:N3': 'Maybe' }), h).ok).toBe(false);
		expect(buildDocsApprove(NOTES, form({ ...posted(h), 'call:N1': 'x' }), h)).toEqual({ ok: false, message: 'Unknown call N1' });
	});

	it('names the HEAD commit although the post forges one', async () => {
		const h = await head();
		const forged = form({ ...posted(h), commit: 'e'.repeat(40) });
		expect(buildDocsApprove(NOTES, forged, h)).toMatchObject({ ok: true, decision: { commit: h.commit } });
	});

	it('refuses a post whose blob for any page is not that page at HEAD', async () => {
		const h = await head();
		expect(buildDocsApprove(NOTES, form({ ...posted(h), [`blob:${REPOT}`]: 'f'.repeat(40) }), h)).toEqual({
			ok: false,
			message: `${REPOT} changed since your last save; reload the page`
		});
		const { [`blob:${WATER}`]: _blob, ...missing } = posted(h);
		expect(buildDocsApprove(NOTES, form(missing), h).ok).toBe(false);
	});

	it('refuses a page with uncommitted changes', async () => {
		const h = await head();
		await writeFile(join(repo, REPOT), 'dirty');
		const dirty = { ...h, pages: [h.pages[0], { ...h.pages[1], clean: await isClean(repo, REPOT) }] };
		expect(dirty.pages[1].clean).toBe(false);
		expect(buildDocsApprove(NOTES, form(posted(h)), dirty)).toEqual({
			ok: false,
			message: `${REPOT} has changes that are not committed; wait for the save`
		});
	});
});

describe('sentBackCalls', () => {
	it('keeps the calls answered with one of their own labels and leaves the rest', () => {
		const calls = sentBackCalls(NOTES, new URLSearchParams({ 'call:N2': 'Apply the fix', 'call:N3': 'Maybe', 'call:N1': 'x' }));
		expect(calls).toEqual([{ id: 'N2', choice: 'Apply the fix' }]);
	});
});
