/**
 * Reads the store into what the pages draw. Every function takes the store's root, so a test can
 * point it at a scratch store.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fold } from '../../../cli/state.ts';
import { compare } from '#lib/doc/compare.ts';
import { parse } from '#lib/doc/parse.ts';
import { renderInline } from '#lib/doc/render.ts';
import type { Doc } from '#lib/doc/types.ts';
import { listDocuments, listMerged, readDecisions, readDocument, type Meta } from '#lib/store/store.ts';
import { toolName } from '#lib/strings.ts';
import { curly, typeset } from '#lib/components/typeset.ts';
import type { DecidedRow, MergedGroup, PageDoc, Row } from '#lib/components/types.ts';

/** How long a merged line stays on the front page, a week by Geoff's choice in the round design. */
export const MERGED_DAYS = 7;

const waiting = (root: string, id: string) => fold(readDecisions(root, id)).state === 'waiting';

/** The tool a document comes from: its first pull request's, or none. */
const toolOf = (doc: Doc) => (doc.prs[0] ? toolName(doc.prs[0].repo) : null);

/** The time the session sent the newest version, for a document it returned with changes. */
function returnedAt(root: string, meta: Meta): string | undefined {
	if (meta.versions < 2) return undefined;
	return fs.statSync(path.join(root, meta.id, `v${meta.versions}.md`)).mtime.toISOString();
}

/** The row the rail and the front page draw for a stored document. */
function rowOf(root: string, meta: Meta): Row {
	const { doc } = parse(readDocument(root, meta.id).source);
	return {
		id: meta.id,
		kind: doc.kind,
		title: curly(doc.title),
		summary: curly(doc.summary),
		tool: toolOf(doc),
		sent: meta.created,
		returned: returnedAt(root, meta),
		questions: doc.questions
	};
}

/** The waiting documents, oldest first. A document with any other state is left out. */
export function rows(root: string): Row[] {
	return listDocuments(root)
		.documents.filter((meta) => waiting(root, meta.id))
		.map((meta) => rowOf(root, meta));
}

/**
 * The documents whose decision, decided or handed, was recorded today in the server's local time,
 * newest first, so a decided document can be reached again for its Undo.
 */
export function decidedToday(root: string, now = new Date()): DecidedRow[] {
	const today = now.toDateString();
	const found: DecidedRow[] = [];
	for (const meta of listDocuments(root).documents) {
		const state = fold(readDecisions(root, meta.id));
		if (state.state !== 'decided' && state.state !== 'handed') continue;
		const { action, at } = state.decision;
		if (new Date(at).toDateString() !== today) continue;
		found.push({ ...rowOf(root, meta), action: action as DecidedRow['action'], at });
	}
	return found.sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * The merged lines of the last `MERGED_DAYS` days, grouped by tool. Each group's lines run newest
 * first, and the group with the newest line comes first.
 */
export function merged(root: string, now = Date.now()): MergedGroup[] {
	const since = now - MERGED_DAYS * 86_400_000;
	const groups = new Map<string, MergedGroup>();
	for (const line of listMerged(root).lines) {
		if (Date.parse(line.at) < since) continue;
		let group = groups.get(line.repo);
		if (!group) groups.set(line.repo, (group = { tool: toolName(line.repo), repo: line.repo, lines: [] }));
		group.lines.push({ number: line.number, html: typeset(renderInline(line.sentence)), at: line.at });
	}
	return [...groups.values()];
}

/** Prepares a parsed document for its page, running `typeset` over every HTML string. */
export function pageDoc(id: string, doc: Doc, sent: string, returned?: { at: string; changes: number }): PageDoc {
	return {
		id,
		kind: doc.kind,
		tool: toolOf(doc),
		sent,
		returned: returned?.at,
		changes: returned?.changes ?? 0,
		prs: doc.prs.map((pr) => ({
			number: pr.number,
			words: curly(pr.words),
			url: `https://github.com/${pr.repo}/pull/${pr.number}`
		})),
		approve: doc.approve ? typeset(doc.approve.html) : null,
		sendback: doc.sendback ? typeset(doc.sendback.html) : null,
		title: curly(doc.title),
		titleHtml: typeset(doc.titleHtml),
		segments: doc.segments.map((s) => {
			if (s.type === 'html') return { ...s, html: typeset(s.html) };
			if (s.type === 'question') return { ...s, options: s.options.map((o) => ({ ...o, html: typeset(o.html) })) };
			return s;
		}),
		outline: doc.headings.flatMap((h) => (h.level === 2 || h.level === 3 ? [{ id: h.id, level: h.level, text: curly(h.text) }] : [])),
		questions: doc.questions
	};
}

/** Reads stored document `id` for its page. A returned document carries its passage count. */
export function storedDoc(root: string, id: string): PageDoc {
	const { meta, source } = readDocument(root, id);
	const { doc } = parse(source);
	const at = returnedAt(root, meta);
	const returned = at
		? { at, changes: compare(readDocument(root, id, meta.versions - 1).source, source).passages.length }
		: undefined;
	return pageDoc(id, doc, meta.created, returned);
}
