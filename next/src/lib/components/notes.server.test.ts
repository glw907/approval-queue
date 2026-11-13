import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addVersion, createDocument, StoreError } from '#lib/store/store.ts';
import { NOTE_LIMIT, noteLength, normalize, readThreads, writeNote } from './notes.server.ts';

const MOCKUP = fileURLToPath(new URL('../../../../docs/mockup/', import.meta.url));
const SENT = fs.readFileSync(path.join(MOCKUP, 'versions/20-survey-edit.sent.md'), 'utf8');
const RETURNED = fs.readFileSync(path.join(MOCKUP, 'content/20-survey-edit.md'), 'utf8');
const AT = '2026-11-12T09:40:00.000Z';
const REPORT = (body: string) => `---\nkind: report\n---\n# A report\n\n${body}\n`;

let root: string;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'aq-notes-test-'));
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

function report(body: string): string {
	return createDocument(root, REPORT(body), { kind: 'report', title: 'A report' }).id;
}

const open = (quote: string, text = 'A note.', version = 1, start?: number) =>
	({ op: 'open', who: 'geoff', quote, start, version, text, at: AT }) as const;

describe('readThreads', () => {
	it('folds open, reply, resolve, and delete records into threads', () => {
		const id = report('It ran. It ran twice.');
		expect(writeNote(root, id, open('It ran.', 'First.', 1, 0))).toBe(1);
		writeNote(root, id, open('It ran twice.', 'Second.'));
		writeNote(root, id, { op: 'reply', thread: 1, who: 'claude', text: 'Fixed.', at: AT });
		writeNote(root, id, { op: 'resolve', thread: 1, resolved: true, who: 'geoff', at: AT });
		writeNote(root, id, { op: 'delete', thread: 2, at: AT });
		writeNote(root, id, { op: 'reply', thread: 2, who: 'geoff', text: 'Too late.', at: AT });
		writeNote(root, id, { op: 'reply', thread: 9, who: 'geoff', text: 'Nowhere.', at: AT });

		expect(readThreads(root, id)).toEqual({
			threads: [
				{
					id: 1,
					quote: 'It ran.',
					start: 0,
					resolved: true,
					entries: [
						{ who: 'geoff', text: 'First.', at: AT },
						{ who: 'claude', text: 'Fixed.', at: AT }
					]
				}
			],
			deleted: [2],
			bad: []
		});
	});

	it('skips a malformed record, names it in bad, and folds the rest', () => {
		const id = report('It ran.');
		writeNote(root, id, open('It ran.'));
		fs.writeFileSync(path.join(root, id, 'note-2.json'), '{"op":');
		fs.writeFileSync(path.join(root, id, 'note-3.json'), '{"op":"reply","thread":1,"who":"someone","text":"x","at":"now"}');
		const { threads, bad } = readThreads(root, id);
		expect(threads.map((t) => t.id)).toEqual([1]);
		expect(threads[0].entries).toHaveLength(1);
		expect(bad).toHaveLength(2);
		expect(bad[0]).toContain(path.join(root, id, 'note-2.json'));
		expect(bad[1]).toContain(path.join(root, id, 'note-3.json'));
	});

	it('gives a thread on a changed passage its new words, with the old ones as was', () => {
		const { id } = createDocument(root, SENT, { kind: 'merge', title: 'Sent' });
		addVersion(root, id, RETURNED);
		writeNote(root, id, open('because its branch is cut from #233’s', 'What does "cut from" mean?', 1, 412));
		writeNote(root, id, open('Two answers needed before workstation #233 and #234 merge'));
		const [cut, title] = readThreads(root, id).threads;
		expect(cut).toEqual({
			id: 1,
			quote: 'because #234 was built on top of #233 and can’t merge before it',
			was: 'because its branch is cut from #233’s',
			resolved: false,
			entries: [{ who: 'geoff', text: 'What does "cut from" mean?', at: AT }]
		});
		expect(title.quote).toBe('Keep an edit to a file Survey owns, and accept a test with ten findings?');
		expect(title.was).toBe('Two answers needed before workstation #233 and #234 merge');
	});

	it('gives a short quote inside a changed passage the new words, though the newest text repeats it', () => {
		const { id } = createDocument(root, SENT, { kind: 'merge', title: 'Sent' });
		addVersion(root, id, RETURNED);
		writeNote(root, id, open('#233', 'Which one?', 1, 33));
		const [thread] = readThreads(root, id).threads;
		expect(thread.quote).toBe('Keep an edit to a file Survey owns, and accept a test with ten findings?');
		expect(thread.was).toBe('#233');
		expect(thread.orphan).toBeUndefined();
	});

	it('keeps the quote of a thread on an unchanged paragraph, without its start', () => {
		const id = report('It ran.\n\nThen it stopped.');
		addVersion(root, id, REPORT('It ran.\n\nThen it stopped for good.'));
		writeNote(root, id, open('It ran.', 'Fine.', 1, 9));
		expect(readThreads(root, id).threads[0]).toEqual({
			id: 1,
			quote: 'It ran.',
			resolved: false,
			entries: [{ who: 'geoff', text: 'Fine.', at: AT }]
		});
	});

	it('keeps the quote of words that survive inside a changed passage', () => {
		const { id } = createDocument(root, SENT, { kind: 'merge', title: 'Sent' });
		addVersion(root, id, RETURNED);
		writeNote(root, id, open('I recommend the first option in each', 'Fine.', 1, 80));
		const [thread] = readThreads(root, id).threads;
		expect(thread.quote).toBe('I recommend the first option in each');
		expect(thread.start).toBeUndefined();
		expect(thread.was).toBeUndefined();
		expect(thread.orphan).toBeUndefined();
	});

	it('makes an orphan of a thread whose passage was only removed', () => {
		const id = report('It ran. Then it stopped for good.');
		addVersion(root, id, REPORT('It ran.'));
		writeNote(root, id, open('stopped for good'));
		const [thread] = readThreads(root, id).threads;
		expect(thread.orphan).toBe(true);
		expect(thread.quote).toBe('stopped for good');
		expect(thread.was).toBeUndefined();
	});

	it('makes an orphan of a quote that straddles a changed passage’s edge', () => {
		const { id } = createDocument(root, SENT, { kind: 'merge', title: 'Sent' });
		addVersion(root, id, RETURNED);
		writeNote(root, id, open('I recommend the first option in each. Answer'));
		expect(readThreads(root, id).threads[0].orphan).toBe(true);
	});

	it('makes every older thread an orphan when the whole document changed', () => {
		const id = report('It ran.');
		addVersion(root, id, '---\nkind: report\n---\n# Something else\n\nA different text entirely, with nothing kept.\n');
		writeNote(root, id, open('It ran.'));
		writeNote(root, id, open('A different text', 'On the newest.', 2));
		const [old, current] = readThreads(root, id).threads;
		expect(old).toMatchObject({ quote: 'It ran.', orphan: true });
		expect(current.orphan).toBeUndefined();
	});

	it('reports an unknown document as the store does', () => {
		expect(() => readThreads(root, '20261112-083300-abcdef')).toThrow(StoreError);
	});
});

describe('note text', () => {
	it('counts code points and normalizes quotes and white space', () => {
		expect(NOTE_LIMIT).toBe(4000);
		expect(noteLength('a😀b')).toBe(3);
		expect(normalize('  can’t\n  “merge”  ')).toBe('can\'t "merge"');
	});
});
