import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	StoreError,
	addVersion,
	appendRecord,
	createDocument,
	listDocuments,
	listMerged,
	readDecisions,
	readDocument,
	readNamed,
	readRecords,
	recordMerged,
	storeRoot,
	writeDecision,
	writeNamed
} from '#lib/store/store.ts';

const ID_FORM = /^\d{8}-\d{6}-[0-9a-f]{6}$/;
const SOURCE_1 = '---\nkind: report\n---\n# A report\n\nIt ran.\n';
const SOURCE_2 = '---\nkind: report\n---\n# A report\n\nIt ran twice.\n';

let root: string;

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'aq-store-test-'));
});

afterEach(() => {
	vi.restoreAllMocks();
	fs.rmSync(root, { recursive: true, force: true });
});

function dotFiles(dir: string): string[] {
	return fs.readdirSync(dir).filter((name) => name.startsWith('.'));
}

function storeError(fn: () => unknown): StoreError {
	try {
		fn();
	} catch (err) {
		expect(err).toBeInstanceOf(StoreError);
		return err as StoreError;
	}
	throw new Error('expected a StoreError, and nothing was thrown');
}

describe('storeRoot', () => {
	it('takes APPROVAL_QUEUE_STATE first', () => {
		expect(storeRoot({ APPROVAL_QUEUE_STATE: '/srv/aq', XDG_STATE_HOME: '/x' })).toBe(
			'/srv/aq/store'
		);
	});

	it('takes XDG_STATE_HOME next', () => {
		expect(storeRoot({ XDG_STATE_HOME: '/var/state' })).toBe('/var/state/approval-queue/store');
	});

	it('falls back to the home directory', () => {
		expect(storeRoot({ HOME: '/home/someone' })).toBe(
			'/home/someone/.local/state/approval-queue/store'
		);
		expect(storeRoot({})).toBe(path.join(os.homedir(), '.local/state/approval-queue/store'));
	});
});

describe('documents and versions', () => {
	it('creates, lists, and versions a document', () => {
		const meta = createDocument(root, SOURCE_1, { kind: 'report', title: 'A report' });
		expect(meta.id).toMatch(ID_FORM);
		const dir = path.join(root, meta.id);
		expect(dotFiles(dir)).toEqual([]);

		const first = readDocument(root, meta.id);
		expect(first.source).toBe(SOURCE_1);
		expect(first.meta).toMatchObject({ id: meta.id, kind: 'report', title: 'A report', versions: 1 });
		expect(Number.isNaN(Date.parse(first.meta.created))).toBe(false);

		const listed = listDocuments(root);
		expect(listed.documents.map((m) => m.id)).toEqual([meta.id]);
		expect(listed.unreadable).toEqual([]);

		const after = addVersion(root, meta.id, SOURCE_2);
		expect(after.versions).toBe(2);
		expect(dotFiles(dir)).toEqual([]);
		expect(readDocument(root, meta.id).source).toBe(SOURCE_2);
		expect(readDocument(root, meta.id).meta.versions).toBe(2);
		expect(readDocument(root, meta.id, 1).source).toBe(SOURCE_1);
		expect(fs.readdirSync(dir).sort()).toEqual(['meta.json', 'v1.md', 'v2.md']);
	});

	it('lists oldest first, skips stray names, and reports an unreadable meta apart', () => {
		createDocument(root, SOURCE_1, { kind: 'report', title: 'A' });
		// Let the clock move so the second document's created stamp is later.
		const t = Date.now();
		while (Date.now() === t) {
			// spin
		}
		createDocument(root, SOURCE_1, { kind: 'report', title: 'B' });
		fs.mkdirSync(path.join(root, 'stray'));
		fs.mkdirSync(path.join(root, '20261112-083300-abcdef'));
		const broken = path.join(root, '20261112-083301-abcdef');
		fs.mkdirSync(broken);
		fs.writeFileSync(path.join(broken, 'meta.json'), '{"id":');
		const listed = listDocuments(root);
		expect(listed.documents.map((m) => m.title)).toEqual(['A', 'B']);
		expect(listed.unreadable).toEqual([path.join(broken, 'meta.json')]);
	});

	it('lists nothing under a root that does not exist, and creates nothing', () => {
		const absent = path.join(root, 'absent');
		expect(listDocuments(absent)).toEqual({ documents: [], unreadable: [] });
		expect(listMerged(absent)).toEqual({ lines: [], unreadable: [] });
		expect(fs.existsSync(absent)).toBe(false);
	});
});

describe('decisions', () => {
	it('reads two decisions back in order', () => {
		const { id } = createDocument(root, SOURCE_1, { kind: 'report', title: 'A report' });
		const dir = path.join(root, id);
		expect(readDecisions(root, id)).toEqual([]);

		writeDecision(root, id, { action: 'approve', at: '2026-11-12T08:00:00Z', answers: { q1: 1 } });
		expect(dotFiles(dir)).toEqual([]);
		writeDecision(root, id, { action: 'undo', at: '2026-11-12T08:01:00Z' });
		expect(dotFiles(dir)).toEqual([]);

		expect(readDecisions(root, id)).toEqual([
			{ action: 'approve', at: '2026-11-12T08:00:00Z', answers: { q1: 1 } },
			{ action: 'undo', at: '2026-11-12T08:01:00Z' }
		]);
		expect(fs.existsSync(path.join(dir, 'decision-1.json'))).toBe(true);
		expect(fs.existsSync(path.join(dir, 'decision-2.json'))).toBe(true);
	});

	it('takes the next number when another writer holds the first', () => {
		const { id } = createDocument(root, SOURCE_1, { kind: 'report', title: 'A report' });
		const dir = path.join(root, id);
		const link = fs.linkSync.bind(fs);
		const spy = vi.spyOn(fs, 'linkSync').mockImplementationOnce((from, to) => {
			// Another writer publishes decision-1.json between our count and our link.
			fs.writeFileSync(path.join(dir, 'decision-1.json'), '{"action":"withdraw","at":"2026-11-12T07:59:00Z"}');
			link(from, to);
		});
		writeDecision(root, id, { action: 'approve', at: '2026-11-12T08:00:00Z' });
		expect(spy).toHaveBeenCalledTimes(2);
		expect(readDecisions(root, id).map((r) => r.action)).toEqual(['withdraw', 'approve']);
		expect(dotFiles(dir)).toEqual([]);
	});

	it('refuses a record with no action or at', () => {
		const { id } = createDocument(root, SOURCE_1, { kind: 'report', title: 'A report' });
		expect(() => writeDecision(root, id, { at: '2026-11-12T08:00:00Z' } as never)).toThrow(StoreError);
		expect(() => writeDecision(root, id, { action: 'approve', at: 'soon' })).toThrow(StoreError);
	});

	for (const [label, body] of [
		['truncated JSON', '{"action":'],
		['an empty object', '{}']
	]) {
		it(`reports a decision file holding ${label} by path`, () => {
			const { id } = createDocument(root, SOURCE_1, { kind: 'report', title: 'A report' });
			const file = path.join(root, id, 'decision-1.json');
			fs.writeFileSync(file, body);
			const err = storeError(() => readDecisions(root, id));
			expect(err.code).toBe('unreadable');
			expect(err.message).toContain(file);
		});
	}

	it('leaves no temporary file when a rename fails', () => {
		const { id } = createDocument(root, SOURCE_1, { kind: 'report', title: 'A report' });
		const dir = path.join(root, id);
		writeDecision(root, id, { action: 'approve', at: '2026-11-12T08:00:00Z' });
		vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
			throw new Error('disk full');
		});
		expect(() => writeDecision(root, id, { action: 'undo', at: '2026-11-12T08:01:00Z' })).toThrow(
			'disk full'
		);
		expect(readDecisions(root, id)).toEqual([{ action: 'approve', at: '2026-11-12T08:00:00Z' }]);
		expect(dotFiles(dir)).toEqual([]);
	});
});

describe('numbered records', () => {
	it('numbers notes apart from decisions and reads them back in order', () => {
		const { id } = createDocument(root, SOURCE_1, { kind: 'report', title: 'A report' });
		const dir = path.join(root, id);
		writeDecision(root, id, { action: 'approve', at: '2026-11-12T08:00:00Z' });
		expect(appendRecord(root, id, 'note', { op: 'open', text: 'one' })).toBe(1);
		expect(appendRecord(root, id, 'note', { op: 'reply', text: 'two' })).toBe(2);
		expect(dotFiles(dir)).toEqual([]);
		expect(readRecords(root, id, 'note').map((r) => [r.n, r.value])).toEqual([
			[1, { op: 'open', text: 'one' }],
			[2, { op: 'reply', text: 'two' }]
		]);
		expect(readDecisions(root, id)).toEqual([{ action: 'approve', at: '2026-11-12T08:00:00Z' }]);
	});

	it('takes the next note number when another writer holds the first', () => {
		const { id } = createDocument(root, SOURCE_1, { kind: 'report', title: 'A report' });
		const dir = path.join(root, id);
		const link = fs.linkSync.bind(fs);
		vi.spyOn(fs, 'linkSync').mockImplementationOnce((from, to) => {
			fs.writeFileSync(path.join(dir, 'note-1.json'), '{"op":"open"}');
			link(from, to);
		});
		expect(appendRecord(root, id, 'note', { op: 'reply' })).toBe(2);
		expect(readRecords(root, id, 'note').map((r) => r.value)).toEqual([{ op: 'open' }, { op: 'reply' }]);
		expect(dotFiles(dir)).toEqual([]);
	});

	it('reads a note file that is not JSON as a null value, with its path', () => {
		const { id } = createDocument(root, SOURCE_1, { kind: 'report', title: 'A report' });
		const file = path.join(root, id, 'note-1.json');
		fs.writeFileSync(file, '{"op":');
		expect(readRecords(root, id, 'note')).toEqual([{ n: 1, file, value: null }]);
	});

	it('refuses a note on a document that does not exist, and creates nothing', () => {
		const id = '20261112-083300-abcdef';
		expect(storeError(() => appendRecord(root, id, 'note', {})).code).toBe('missing');
		expect(storeError(() => readRecords(root, '../x', 'note')).code).toBe('bad-id');
		expect(fs.readdirSync(root)).toEqual([]);
	});
});

describe('ids', () => {
	for (const bad of ['../x', 'merged', '20261112-083300-ABCDEF']) {
		it(`refuses the id ${bad}`, () => {
			expect(storeError(() => readDocument(root, bad)).code).toBe('bad-id');
			expect(storeError(() => readDecisions(root, bad)).code).toBe('bad-id');
		});
	}

	it('reports a well-formed id with no directory as missing, and creates nothing', () => {
		const id = '20261112-083300-abcdef';
		expect(storeError(() => readDocument(root, id)).code).toBe('missing');
		expect(storeError(() => addVersion(root, id, SOURCE_1)).code).toBe('missing');
		expect(storeError(() => writeDecision(root, id, { action: 'approve', at: '2026-11-12T08:00:00Z' })).code).toBe('missing');
		expect(fs.readdirSync(root)).toEqual([]);
	});

	it('reports a version that does not exist as missing', () => {
		const { id } = createDocument(root, SOURCE_1, { kind: 'report', title: 'A report' });
		expect(storeError(() => readDocument(root, id, 2)).code).toBe('missing');
	});
});

describe('named files', () => {
	it('refuses the store’s own names', () => {
		const { id } = createDocument(root, SOURCE_1, { kind: 'report', title: 'A report' });
		expect(() => writeNamed(root, id, 'meta.json', {})).toThrow(StoreError);
		expect(() => writeNamed(root, id, 'decision-1.json', {})).toThrow(StoreError);
		expect(() => writeNamed(root, id, 'decision-notes.json', {})).toThrow(StoreError);
		expect(() => writeNamed(root, id, 'note-1.json', {})).toThrow(StoreError);
		expect(() => writeNamed(root, id, 'note-threads.json', {})).toThrow(StoreError);
		expect(() => writeNamed(root, id, '../notes.json', {})).toThrow(StoreError);
	});

	it('writes and reads a named file, and reads an absent one as undefined', () => {
		const { id } = createDocument(root, SOURCE_1, { kind: 'report', title: 'A report' });
		expect(readNamed(root, id, 'notes.json')).toBeUndefined();
		writeNamed(root, id, 'notes.json', { threads: [1, 2] });
		expect(readNamed(root, id, 'notes.json')).toEqual({ threads: [1, 2] });
		expect(dotFiles(path.join(root, id))).toEqual([]);
	});

	it('reports a malformed named file as unreadable', () => {
		const { id } = createDocument(root, SOURCE_1, { kind: 'report', title: 'A report' });
		const file = path.join(root, id, 'notes.json');
		fs.writeFileSync(file, '{"threads": [');
		const err = storeError(() => readNamed(root, id, 'notes.json'));
		expect(err.code).toBe('unreadable');
		expect(err.message).toContain(file);
	});
});

describe('merged lines', () => {
	it('reads lines newest first and reports a malformed one by path', () => {
		recordMerged(root, {
			repo: 'glw907/workstation',
			number: 233,
			sentence: 'The packet skill now covers rounds.',
			at: '2026-11-12T08:00:00Z'
		});
		recordMerged(root, {
			repo: 'glw907/workstation',
			number: 234,
			sentence: 'The launch guard is stricter.',
			at: '2026-11-12T09:00:00Z'
		});
		const dir = path.join(root, 'merged');
		const broken = path.join(dir, 'broken.json');
		fs.writeFileSync(broken, 'not json');
		expect(dotFiles(dir)).toEqual([]);

		const result = listMerged(root);
		expect(result.lines.map((l) => l.number)).toEqual([234, 233]);
		expect(result.lines[0]).toEqual({
			repo: 'glw907/workstation',
			number: 234,
			sentence: 'The launch guard is stricter.',
			at: '2026-11-12T09:00:00Z'
		});
		expect(result.unreadable).toEqual([broken]);
	});
});
