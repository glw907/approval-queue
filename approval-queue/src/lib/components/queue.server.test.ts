import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from '#lib/doc/parse.ts';
import { addVersion, createDocument, writeDecision } from '#lib/store/store.ts';
import { decidedToday, rows, storedDoc } from './queue.server.ts';

const CONTENT = fileURLToPath(new URL('../../../../docs/mockup/content/', import.meta.url));

let root: string;

function store(name: string): string {
	const source = readFileSync(join(CONTENT, name), 'utf8');
	const { doc } = parse(source);
	return createDocument(root, source, { kind: doc.kind as string, title: doc.title }).id;
}

/** A local-time instant on the same calendar day as `now`, at `hour`. */
const at = (now: Date, hour: number, dayShift = 0) =>
	new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayShift, hour).toISOString();

const NOW = new Date(2026, 10, 12, 18);

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'aq-queue-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('decidedToday', () => {
	it('lists documents decided or handed today, newest first, and leaves the rest out', () => {
		const early = store('40-queue-design.md');
		const late = store('10-merge-gaps.md');
		const handed = store('20-survey-edit.md');
		const yesterday = store('50-backlog.md');
		const waiting = store('30-round-report.md');
		writeDecision(root, early, { action: 'sendback', at: at(NOW, 9) });
		writeDecision(root, late, { action: 'approve', at: at(NOW, 15) });
		const n = writeDecision(root, handed, { action: 'approve', at: at(NOW, 12) });
		writeDecision(root, handed, { action: 'handed', at: at(NOW, 12), decision: n });
		writeDecision(root, yesterday, { action: 'approve', at: at(NOW, 15, -1) });

		const list = decidedToday(root, NOW);
		expect(list.map((r) => r.id)).toEqual([late, handed, early]);
		expect(list.map((r) => r.action)).toEqual(['approve', 'approve', 'sendback']);
		expect(list.some((r) => r.id === waiting)).toBe(false);
		expect(rows(root).map((r) => r.id)).toEqual([waiting]);
	});

	it('drops a document once its decision is undone, and rows lists it again', () => {
		const report = store('30-round-report.md');
		const n = writeDecision(root, report, { action: 'read', at: at(NOW, 10) });
		expect(decidedToday(root, NOW).map((r) => r.id)).toEqual([report]);
		expect(rows(root)).toEqual([]);
		writeDecision(root, report, { action: 'undo', at: at(NOW, 11), of: n });
		expect(decidedToday(root, NOW)).toEqual([]);
		expect(rows(root).map((r) => r.id)).toEqual([report]);
	});
});

describe('storedDoc', () => {
	const count = (html: string, tag: string) => html.split(`<${tag}>`).length - 1;

	/** The survey edit as the seed stores it: the sent version, then the returned one. */
	function returned(): string {
		const sent = readFileSync(join(CONTENT, '../versions/20-survey-edit.sent.md'), 'utf8');
		const id = createDocument(root, sent, { kind: 'merge', title: parse(sent).doc.title }).id;
		addVersion(root, id, readFileSync(join(CONTENT, '20-survey-edit.md'), 'utf8'));
		return id;
	}

	it('marks each passage the returned version changed as a del and ins pair', () => {
		const doc = storedDoc(root, returned());
		expect(doc.whole).toBe(false);
		expect(doc.version).toBe(2);
		expect(doc.changes).toBe(3);
		const html = (s: (typeof doc.segments)[number]) =>
			s.type === 'html' ? s.html : s.type === 'question' ? s.options.map((o) => o.html).join('') : '';
		const places = [doc.titleHtml, ...doc.segments.map(html)].filter((h) => h.includes('<del>'));
		expect(places).toHaveLength(3);
		for (const place of places) expect([count(place, 'del'), count(place, 'ins')]).toEqual([1, 1]);
		expect(doc.titleHtml).toContain('<del>');
		expect(doc.segments.find((s) => s.type === 'html' && s.html.includes('<del>'))).toBeTruthy();
		expect(doc.segments.find((s) => s.type === 'question' && s.options.some((o) => o.html.includes('<del>')))).toBeTruthy();
	});

	it('draws no marks when the returned version shares nothing with the sent one', () => {
		const id = returned();
		addVersion(root, id, '---\nkind: merge\n---\n# Another thing entirely\n\nWholly new words here.\n');
		const doc = storedDoc(root, id);
		expect(doc.whole).toBe(true);
		expect(doc.version).toBe(3);
		expect(doc.changes).toBe(0);
		expect([doc.titleHtml, ...doc.segments.map((s) => (s.type === 'html' ? s.html : ''))].join('')).not.toContain('<del>');
	});

	it('leaves a document with one version unmarked', () => {
		const doc = storedDoc(root, store('10-merge-gaps.md'));
		expect([doc.returned, doc.whole, doc.version, doc.changes]).toEqual([undefined, false, 1, 0]);
	});
});
