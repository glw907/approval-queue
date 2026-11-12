import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { APPROVAL_QUEUE_STATE } from '$app/env/private';
import { error, fail, redirect } from '@sveltejs/kit';
import { parseBrief, type Brief } from '#lib/brief.ts';
import { decideCards, fingerprint, readChoices, type Card } from '#lib/cards.ts';
import { render, renderDesign, renderInline, renderLabel, renderReport } from '#lib/markdown.ts';
import { reportBody } from '#lib/report.ts';
import { withoutBrief } from '#lib/pr-summary.ts';
import { deepDiveBody } from '#lib/packet-view.ts';
import { nextItem } from '#lib/queue.ts';
import { appendFold } from '#lib/server/folds.ts';
import { checkCurrent } from '#lib/server/heads.ts';
import { historyRow } from '#lib/server/history.ts';
import { landedInRound, waitingInRound } from '#lib/server/report.ts';
import { buildPacketDecision, parseNotes } from '#lib/server/packet-decision.ts';
import {
	listWaiting,
	readEarlier,
	readItem,
	writeDecision,
	writeDecisionOnce,
	writeNotes,
	type FactPacket,
	type Decision,
	type Disposition,
	type SubmittedRow
} from '#lib/server/items.ts';
import type { Actions, PageServerLoad } from './$types';

const DISPOSITIONS: readonly string[] = ['now', 'defer', 'drop'];

/** Reads an item still waiting for a decision; an unknown or decided id is a 404. */
async function readWaiting(id: string) {
	const item = await readItem(APPROVAL_QUEUE_STATE, id);
	if (!item || item.decided) error(404, 'Not found');
	return item;
}

/**
 * Writes the decision and names the item to open next. The next item is picked here, before the
 * write, because the page's own queue can be stale.
 */
async function decide(id: string, decision: Decision) {
	const next = nextItem(await listWaiting(APPROVAL_QUEUE_STATE), id);
	if (!(await writeDecision(APPROVAL_QUEUE_STATE, id, decision))) return withdrawn(false);
	return { next: next ? `/item/${next.id}` : null };
}

const ALREADY_DECIDED = { message: 'Already decided' };
const IS_REPORT = { message: 'A round report is only marked read' };

/** The answer for an item its session withdrew: a packet page is offered the board, any other post gets a 404. */
function withdrawn(packet: boolean) {
	if (!packet) error(404, 'Not found');
	return fail(410, { message: 'This item was withdrawn by its session; nothing was recorded', board: '/' });
}

/**
 * Answers a post whose item has gone. A post from a packet page carries its calls or its notes, so that
 * page learns its session withdrew the item and is offered the board; any other post is a 404.
 */
async function gone(request: Request) {
	const form = await request.formData().catch(() => null);
	return withdrawn(form?.has('calls') === true || form?.has('notes') === true);
}

/**
 * Records a packet's decision: refuses what the post or the pinned heads rule out, then writes
 * `notes.json` and `decision.json` with the same notes, so a note typed just before Ctrl+Enter is kept.
 */
async function decideFacts(id: string, packet: FactPacket, kind: 'approve' | 'reject', form: FormData) {
	const built = buildPacketDecision(kind, packet.facts, form);
	if (!built.ok) return fail(400, { message: built.message });
	const stale = kind === 'approve' ? await checkCurrent(packet) : undefined;
	if (stale) return fail(stale.status, { message: stale.message });
	const next = nextItem(await listWaiting(APPROVAL_QUEUE_STATE), id);
	const { notes } = built.decision;
	if (!(await writeNotes(APPROVAL_QUEUE_STATE, id, notes))) return withdrawn(true);
	const written = await writeDecisionOnce(APPROVAL_QUEUE_STATE, id, built.decision);
	if (written === 'gone') {
		await rm(join(APPROVAL_QUEUE_STATE, 'items', id, 'notes.json'), { force: true });
		return withdrawn(true);
	}
	if (written === 'exists') {
		// A racing post won the decision; put its notes back so notes.json and decision.json agree.
		const winner = (await readItem(APPROVAL_QUEUE_STATE, id))?.decision;
		if (winner && 'notes' in winner) await writeNotes(APPROVAL_QUEUE_STATE, id, winner.notes);
		return fail(409, ALREADY_DECIDED);
	}
	return { next: next ? `/item/${next.id}` : null };
}

/** Answers an approve or a send-back on a packet. */
async function answer(id: string, decided: boolean, packet: FactPacket, request: Request, kind: 'approve' | 'reject') {
	if (decided) return fail(409, ALREADY_DECIDED);
	const form = await request.formData().catch(() => null);
	if (!form) return fail(400, { message: 'Not a form post' });
	return decideFacts(id, packet, kind, form);
}

/** Cards with the HTML the page shows. */
const withHtml = (cards: Card[]) => cards.map((card) => ({ ...card, html: renderInline(card.text) }));

/** The brief's detail sections as rendered rows; the open body drops the first sentence the closed row already shows. */
function detailRows(brief: Brief | null) {
	return (brief?.details ?? []).map((d) => ({
		label: d.label,
		summaryHtml: renderInline(d.summary),
		bodyHtml: render(d.body.startsWith(d.summary) ? d.body.slice(d.summary.length).trim() : d.body)
	}));
}

/**
 * Loads the item the page shows: a packet, a design, or a triage list. A decided item the queue can
 * no longer read in full (a retired kind, or a packet whose files no longer check) opens as the
 * record `history` lists, read-only; an unknown id, or an item still waiting, is a 404.
 */
export const load: PageServerLoad = async ({ params }) => {
	const item = await readItem(APPROVAL_QUEUE_STATE, params.id);
	if (!item) {
		const row = await historyRow(APPROVAL_QUEUE_STATE, params.id);
		if (!row) error(404, 'Not found');
		return { kind: 'retired' as const, id: row.id, title: row.title, itemKind: row.kind, decision: row.decision, date: row.date };
	}
	const { meta, decided, content, decision } = item;
	if (content.kind === 'design') {
		const words = content.doc.split(/\s+/).filter(Boolean).length;
		const parsed = parseBrief(content.doc);
		const brief = parsed.ok ? parsed.brief : null;
		return {
			meta,
			decided,
			kind: 'design' as const,
			headlineHtml: renderInline(brief?.headline ?? meta.headline ?? meta.title),
			ledeHtml: renderInline(brief?.lede ?? ''),
			whatChanges: (brief?.whatChanges ?? []).map(renderInline),
			ifYouApprove: (brief?.ifYouApprove ?? []).map(renderInline),
			worthKnowing: brief?.worthKnowing === undefined ? null : renderInline(brief.worthKnowing),
			details: detailRows(brief),
			cards: withHtml(decideCards(content.doc)),
			docHtml: render(withoutBrief(content.doc)),
			minutes: Math.ceil(words / 230)
		};
	}
	if (content.kind === 'facts') {
		const { packet } = content;
		return {
			meta,
			decided,
			kind: 'packet' as const,
			decision,
			packet,
			earlier: await readEarlier(APPROVAL_QUEUE_STATE, meta, packet.textMd),
			deepDiveHtml: render(deepDiveBody(packet.textMd)),
			designHtml: packet.design ? renderDesign(packet.design.md) : null
		};
	}
	if (content.kind === 'report') {
		return {
			meta,
			decided,
			kind: 'report' as const,
			read: decision?.decision === 'read',
			html: renderReport(reportBody(content.text)),
			waiting: await waitingInRound(APPROVAL_QUEUE_STATE, meta),
			landed: await landedInRound(APPROVAL_QUEUE_STATE, meta)
		};
	}
	if (content.kind === 'legacy') {
		const date = (await historyRow(APPROVAL_QUEUE_STATE, params.id))?.date;
		return { meta, decided, kind: 'legacy' as const, decision, text: content.text, date };
	}
	// A decided triage shows the calls that were sent, matched by action so a reordered file never
	// pairs a call with the wrong row.
	const sent = new Map(decision?.decision === 'submit' ? decision.rows.map((call) => [call.action, call]) : []);
	const rows = content.rows.map((row) => ({ ...row, disposition: sent.get(row.action)?.disposition ?? row.proposed }));
	return {
		meta,
		decided,
		kind: 'triage' as const,
		headlineHtml: renderInline(content.headline),
		ledeHtml: renderInline(content.lede),
		rows,
		// The text each row shows, rendered once here; `rows` keeps the file's own text for the post.
		html: content.rows.map((row) => ({
			action: renderInline(row.action),
			/** The action again without its links, for the pane row that links to it. */
			label: renderLabel(row.action),
			why: renderInline(row.why),
			detail: row.detail === undefined ? null : renderInline(row.detail)
		}))
	};
};

export const actions: Actions = {
	approve: async ({ params, request }) => {
		const found = await readItem(APPROVAL_QUEUE_STATE, params.id);
		if (!found) return gone(request);
		if (found.content.kind === 'report') return fail(400, IS_REPORT);
		if (found.content.kind === 'facts') return answer(params.id, found.decided, found.content.packet, request, 'approve');
		const item = await readWaiting(params.id);
		const { content } = item;
		if (content.kind !== 'design') return fail(400, { message: 'Nothing to approve' });
		// The page disables Approve, but a post can still arrive without it; the server rebuilds the
		// cards from the document and checks every pick itself.
		const form = await request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Not a form post' });
		const cards = decideCards(content.doc);
		// Picks are indexes into this list, so a list that changed since the page loaded must not be matched by position.
		if ((form.get('cards') ?? '') !== fingerprint(cards)) return fail(400, { message: 'The decisions changed; reload the page' });
		const picked = readChoices(cards, (field) => form.get(field));
		if (!picked.ok) return fail(400, { message: picked.message });
		return decide(params.id, { decision: 'approve', choices: picked.choices });
	},
	reject: async ({ params, request }) => {
		const found = await readItem(APPROVAL_QUEUE_STATE, params.id);
		if (!found) return gone(request);
		if (found.content.kind === 'report') return fail(400, IS_REPORT);
		if (found.content.kind === 'facts') return answer(params.id, found.decided, found.content.packet, request, 'reject');
		const item = await readWaiting(params.id);
		if (item.content.kind !== 'design') return fail(400, { message: 'Nothing to reject' });
		const form = await request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Not a form post' });
		const note = form.get('note');
		return decide(params.id, { decision: 'reject', note: typeof note === 'string' ? note : '' });
	},
	/** Saves a packet's notes as typed: the post is the whole list. */
	notes: async ({ params, request }) => {
		const found = await readItem(APPROVAL_QUEUE_STATE, params.id);
		if (!found) return gone(request);
		if (found.content.kind === 'report') return fail(400, IS_REPORT);
		if (found.content.kind !== 'facts') return fail(400, { message: 'Not a packet with notes' });
		if (found.decided) return fail(409, ALREADY_DECIDED);
		const form = await request.formData().catch(() => null);
		const notes = parseNotes(form?.get('notes'));
		if (!notes) return fail(400, { message: 'The notes are not a list of notes' });
		if (!(await writeNotes(APPROVAL_QUEUE_STATE, params.id, notes))) return withdrawn(true);
		return { saved: true };
	},
	/**
	 * Marks a round report read. A report already read, or one a newer report replaced, writes nothing
	 * and leaves the page for the next waiting item, or the board, as a fresh mark does.
	 */
	read: async ({ params }) => {
		const found = await readItem(APPROVAL_QUEUE_STATE, params.id);
		if (!found) redirect(303, '/');
		if (found.content.kind !== 'report') return fail(400, { message: 'Not a round report' });
		const next = nextItem(await listWaiting(APPROVAL_QUEUE_STATE), params.id);
		if (!found.decided) await writeDecision(APPROVAL_QUEUE_STATE, params.id, { decision: 'read' });
		redirect(303, next ? `/item/${next.id}` : '/');
	},
	/** Logs that a fold opened on the item. */
	fold: async ({ params, request }) => {
		const item = await readItem(APPROVAL_QUEUE_STATE, params.id);
		if (!item) error(404, 'Not found');
		if (item.content.kind === 'report') return fail(400, IS_REPORT);
		const fold = (await request.formData().catch(() => null))?.get('fold');
		if (typeof fold !== 'string' || !fold.trim()) return fail(400, { message: 'Name the fold' });
		await appendFold(APPROVAL_QUEUE_STATE, params.id, fold.trim());
		return { ok: true };
	},
	submit: async ({ params, request }) => {
		const found = await readItem(APPROVAL_QUEUE_STATE, params.id);
		if (found?.content.kind === 'report') return fail(400, IS_REPORT);
		const item = await readWaiting(params.id);
		if (item.content.kind !== 'triage') return fail(400, { message: 'Not a triage item' });
		const form = await request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Not a form post' });
		const dispositions = form.getAll('disposition');
		const source = item.content.rows;
		if (dispositions.length !== source.length) return fail(400, { message: 'Row count does not match' });
		const rows: SubmittedRow[] = [];
		for (const [i, row] of source.entries()) {
			const disposition = dispositions[i];
			if (typeof disposition !== 'string' || !DISPOSITIONS.includes(disposition)) return fail(400, { message: 'Invalid disposition' });
			rows.push({ action: row.action, disposition: disposition as Disposition });
		}
		return decide(params.id, { decision: 'submit', rows });
	}
};
