import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { git, SAMPLE_DOC, SAMPLE_FILE, SAMPLE_NOTES, seedRepo } from '#lib/fixtures/seed-blueprint.ts';
import type { Note } from '#lib/editor/notes.ts';
import { buildBlueprintApprove, committed, isClean, saveFile } from './blueprint.ts';

const NOTES = JSON.parse(SAMPLE_NOTES) as Note[];

let repo: string;
let base: string;
beforeEach(async () => {
	repo = await mkdtemp(join(tmpdir(), 'approval-queue-blueprint-'));
	base = await seedRepo(repo);
});
afterEach(() => rm(repo, { recursive: true, force: true }));

describe('saveFile', () => {
	it('writes the text and commits it with the review message', async () => {
		const text = SAMPLE_DOC.replace('a minute', 'two minutes');
		const saved = await saveFile(repo, SAMPLE_FILE, text, base);
		expect(saved.ok).toBe(true);
		if (!saved.ok) return;
		expect(saved.blob).toBe(git(repo, 'rev-parse', `HEAD:${SAMPLE_FILE}`));
		expect(saved.commit).toBe(git(repo, 'rev-parse', 'HEAD'));
		expect(git(repo, 'log', '-1', '--format=%s')).toBe(`Edit ${SAMPLE_FILE} in review`);
		expect(await readFile(join(repo, SAMPLE_FILE), 'utf8')).toBe(text);
		expect(await isClean(repo, SAMPLE_FILE)).toBe(true);
	});

	it('writes the file’s own line endings although a form post sends CRLF', async () => {
		const posted = `${SAMPLE_DOC}more\n`.replace(/\n/g, '\r\n');
		const saved = await saveFile(repo, SAMPLE_FILE, posted, base);
		expect(saved.ok).toBe(true);
		expect(await readFile(join(repo, SAMPLE_FILE), 'utf8')).toBe(`${SAMPLE_DOC}more\n`);
		const head = git(repo, 'rev-parse', 'HEAD');
		const again = await saveFile(repo, SAMPLE_FILE, posted, saved.ok ? saved.blob : '');
		expect(again).toMatchObject({ ok: true, commit: head });
	});

	it('commits nothing for unchanged text', async () => {
		const head = git(repo, 'rev-parse', 'HEAD');
		const saved = await saveFile(repo, SAMPLE_FILE, SAMPLE_DOC, base);
		expect(saved).toEqual({ ok: true, blob: base, commit: head });
		expect(git(repo, 'rev-parse', 'HEAD')).toBe(head);
	});

	it('refuses a save edited from a blob that is no longer at HEAD, and leaves the file alone', async () => {
		const first = await saveFile(repo, SAMPLE_FILE, `${SAMPLE_DOC}one\n`, base);
		expect(first.ok).toBe(true);
		const stale = await saveFile(repo, SAMPLE_FILE, `${SAMPLE_DOC}two\n`, base);
		expect(stale).toMatchObject({ ok: false, status: 409 });
		expect(await readFile(join(repo, SAMPLE_FILE), 'utf8')).toBe(`${SAMPLE_DOC}one\n`);
	});

	it('runs two racing saves one at a time, so the second meets the first one’s commit and is refused', async () => {
		const [a, b] = await Promise.all([
			saveFile(repo, SAMPLE_FILE, `${SAMPLE_DOC}a\n`, base),
			saveFile(repo, SAMPLE_FILE, `${SAMPLE_DOC}b\n`, base)
		]);
		expect(a.ok).toBe(true);
		expect(b).toMatchObject({ ok: false, status: 409 });
		expect(git(repo, 'rev-list', '--count', 'HEAD')).toBe('2');
	});
});

describe('buildBlueprintApprove', () => {
	const form = (fields: Record<string, string>) => new URLSearchParams(fields);
	const answers = { 'call:D1': "Keep the author's wording", 'call:Q1': 'Keep it' };
	const head = async () => ({ ...(await committed(repo, SAMPLE_FILE)), clean: true });

	it('records each call’s label, the HEAD commit and blob, and a waived dispute with its reason', async () => {
		const h = await head();
		const built = buildBlueprintApprove(NOTES, form({ ...answers, blob: h.blob }), h);
		expect(built).toEqual({
			ok: true,
			decision: {
				decision: 'approve',
				calls: [
					{ id: 'D1', choice: "Keep the author's wording" },
					{ id: 'Q1', choice: 'Keep it' }
				],
				waived: [{ id: 'D1', choice: "Keep the author's wording", reason: "Kept the author's wording" }],
				commit: h.commit,
				blob: h.blob
			}
		});
	});

	it.each([
		["Use the code's cause", 'a choice that rewrites the line'],
		['Write it myself', 'a choice the reader rewrites']
	])('waives nothing for %s (%s)', async (choice) => {
		const h = await head();
		const built = buildBlueprintApprove(NOTES, form({ ...answers, 'call:D1': choice, blob: h.blob }), h);
		expect(built.ok && built.decision.decision === 'approve' && built.decision.waived).toEqual([]);
	});

	it('refuses an open call, a label the note does not offer, and an unknown call', async () => {
		const h = await head();
		expect(buildBlueprintApprove(NOTES, form({ 'call:Q1': 'Keep it', blob: h.blob }), h)).toEqual({
			ok: false,
			message: 'Make the call “Why the images resize” first'
		});
		expect(buildBlueprintApprove(NOTES, form({ ...answers, 'call:Q1': 'Maybe', blob: h.blob }), h).ok).toBe(false);
		expect(buildBlueprintApprove(NOTES, form({ ...answers, 'call:C1': 'x', blob: h.blob }), h)).toEqual({
			ok: false,
			message: 'Unknown call C1'
		});
	});

	it('names the HEAD commit and blob although the post forges a commit and a second blob', async () => {
		const h = await head();
		const forged = new URLSearchParams([
			...Object.entries(answers),
			['blob', h.blob],
			['blob', 'f'.repeat(40)],
			['commit', 'e'.repeat(40)]
		]);
		expect(buildBlueprintApprove(NOTES, forged, h)).toMatchObject({ ok: true, decision: { commit: h.commit, blob: h.blob } });
		const first = new URLSearchParams([...Object.entries(answers), ['blob', 'f'.repeat(40)], ['blob', h.blob]]);
		expect(buildBlueprintApprove(NOTES, first, h).ok).toBe(false);
	});

	it('refuses a post whose blob is not the file at HEAD, or a file with uncommitted changes', async () => {
		const h = await head();
		expect(buildBlueprintApprove(NOTES, form({ ...answers, blob: 'f'.repeat(40) }), h).ok).toBe(false);
		await writeFile(join(repo, SAMPLE_FILE), 'dirty');
		const dirty = { ...h, clean: await isClean(repo, SAMPLE_FILE) };
		expect(dirty.clean).toBe(false);
		expect(buildBlueprintApprove(NOTES, form({ ...answers, blob: h.blob }), dirty).ok).toBe(false);
	});
});
