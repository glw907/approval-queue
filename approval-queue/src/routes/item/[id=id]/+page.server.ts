import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { APPROVAL_QUEUE_STATE } from '$app/env/private';
import { error, fail } from '@sveltejs/kit';
import { parseBrief, type Brief } from '#lib/brief.ts';
import { decideCards, fingerprint, readChoices, type Card } from '#lib/cards.ts';
import { fileGroups } from '#lib/diff.ts';
import { render, renderInline, renderLabel } from '#lib/markdown.ts';
import { checksSummary, reviewVerdict, withoutBrief } from '#lib/pr-summary.ts';
import { nextItem } from '#lib/queue.ts';
import { appendFold } from '#lib/server/folds.ts';
import { checkCurrent } from '#lib/server/heads.ts';
import { buildApprove, buildPacketDecision, buildSentBackCalls, isIrreversible, packetFingerprint, parseNotes } from '#lib/server/packet-decision.ts';
import {
	listWaiting,
	readItem,
	readSentBack,
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

/** The answer for an item its session withdrew: a packet page is offered the board, any other post gets a 404. */
function withdrawn(packet: boolean) {
	if (!packet) error(404, 'Not found');
	return fail(410, { message: 'This item was withdrawn by its session; nothing was recorded', board: '/' });
}

/**
 * Answers a post whose item has gone. A post from a packet page carries its fingerprint or its notes, so that
 * page learns its session withdrew the item and is offered the board; any other post is a 404.
 */
async function gone(request: Request) {
	const form = await request.formData().catch(() => null);
	return withdrawn(form?.has('fingerprint') === true || form?.has('notes') === true);
}

/**
 * Writes a decision with `link`, so a second post answers 409 instead of replacing the first. `packet`
 * is whether the post came from a packet page, which the withdrawn answer depends on.
 */
async function decideOnce(id: string, decision: Decision, packet = false) {
	const next = nextItem(await listWaiting(APPROVAL_QUEUE_STATE), id);
	const written = await writeDecisionOnce(APPROVAL_QUEUE_STATE, id, decision);
	if (written === 'exists') return fail(409, ALREADY_DECIDED);
	if (written === 'gone') return withdrawn(packet);
	return { next: next ? `/item/${next.id}` : null };
}

/**
 * Records a new-shape packet's decision: refuses what the post or the pinned heads rule out, then writes
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

/** Answers an approve or a send-back on a new-shape packet. */
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

/** Loads the item the page shows: a packet, a design, or a triage list. Any other kind is a 404, as an unknown id is. */
export const load: PageServerLoad = async ({ params }) => {
	const item = await readItem(APPROVAL_QUEUE_STATE, params.id);
	if (!item) error(404, 'Not found');
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
		// The old fields stay, empty, until the packet page reads `packet2` alone.
		return {
			meta,
			decided,
			kind: 'packet' as const,
			headline: packet.facts.title,
			background: '',
			summary: [] as string[],
			steps: [],
			notChecked: '',
			asks: [],
			routine: [],
			parts: [],
			fingerprint: '',
			irreversible: false,
			irreversibleSteps: [] as number[],
			decision,
			packet2: packet
		};
	}
	if (content.kind === 'packet') {
		const { packet, parts } = content;
		const sentBack = meta.revises && (await readSentBack(APPROVAL_QUEUE_STATE, meta.revises.item));
		return {
			meta,
			decided,
			kind: 'packet' as const,
			headline: packet.headline,
			background: packet.background,
			summary: packet.summary,
			...(packet.whatChanged && { whatChanged: packet.whatChanged }),
			...(meta.revises && { revision: meta.revises.revision }),
			...(sentBack && { sentBack }),
			steps: packet.steps,
			notChecked: packet.notChecked,
			asks: packet.asks.map((ask, i) => ({ index: i + 1, ...ask, part: ask.part?.ref ?? null })),
			routine: packet.routine.map((row) => ({ ref: row.part.ref, kind: row.part.kind, verdict: row.verdict, fact: row.fact, why: row.why })),
			parts: parts.map((part) => {
				const groups = part.kind === 'pr' ? fileGroups(part.diff ?? '') : [];
				const files = groups.flatMap((g) => g.files);
				return {
					ref: part.ref,
					kind: part.kind,
					lane: part.lane,
					verdict: part.verdict,
					head: part.head,
					sha256: part.sha256,
					...(part.kind === 'pr' && {
						checks: checksSummary(part.pr?.statusCheckRollup),
						review: reviewVerdict(part.body ?? ''),
						groups,
						totals: {
							files: files.length,
							adds: files.reduce((n, f) => n + f.adds, 0),
							dels: files.reduce((n, f) => n + f.dels, 0)
						},
						link: part.pr ? { url: part.pr.url, head: part.pr.headRefName, base: part.pr.baseRefName } : null,
						...(part.since && { since: 'patch' in part.since ? { groups: fileGroups(part.since.patch) } : part.since })
					}),
					...(part.kind === 'design' && { docHtml: render(withoutBrief(part.doc ?? '')) })
				};
			}),
			fingerprint: packetFingerprint(parts, packet.asks),
			irreversible: isIrreversible(packet),
			irreversibleSteps: packet.steps.filter((s) => s.tag === 'irreversible').map((s) => s.n),
			decision,
			packet2: null
		};
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
		if (found.content.kind === 'facts') return answer(params.id, found.decided, found.content.packet, request, 'approve');
		if (found.content.kind === 'packet') {
			if (found.decided) return fail(409, ALREADY_DECIDED);
			const form = await request.formData().catch(() => null);
			if (!form) return fail(400, { message: 'Not a form post' });
			// The server rebuilt the parts and asks from the item's files; the post only answers them.
			const built = buildApprove(found.content, form);
			return built.ok ? decideOnce(params.id, built.decision, form.has('fingerprint')) : fail(400, { message: built.message });
		}
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
		if (found.content.kind === 'facts') return answer(params.id, found.decided, found.content.packet, request, 'reject');
		if (found.content.kind === 'packet') {
			if (found.decided) return fail(409, ALREADY_DECIDED);
			const form = await request.formData().catch(() => null);
			if (!form) return fail(400, { message: 'Not a form post' });
			const note = form.get('note');
			return decideOnce(
				params.id,
				{
					decision: 'reject',
					note: typeof note === 'string' ? note : '',
					calls: buildSentBackCalls(found.content, form)
				},
				form.has('fingerprint')
			);
		}
		const item = await readWaiting(params.id);
		if (item.content.kind === 'triage') return fail(400, { message: 'Nothing to reject' });
		const form = await request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Not a form post' });
		const note = form.get('note');
		return decide(params.id, { decision: 'reject', note: typeof note === 'string' ? note : '' });
	},
	/** Saves a new-shape packet's notes as typed: the post is the whole list. */
	notes: async ({ params, request }) => {
		const found = await readItem(APPROVAL_QUEUE_STATE, params.id);
		if (!found) return gone(request);
		if (found.content.kind !== 'facts') return fail(400, { message: 'Not a packet with notes' });
		if (found.decided) return fail(409, ALREADY_DECIDED);
		const form = await request.formData().catch(() => null);
		const notes = parseNotes(form?.get('notes'));
		if (!notes) return fail(400, { message: 'The notes are not a list of notes' });
		if (!(await writeNotes(APPROVAL_QUEUE_STATE, params.id, notes))) return withdrawn(true);
		return { saved: true };
	},
	/** Logs that a fold opened on the item. */
	fold: async ({ params, request }) => {
		if (!(await readItem(APPROVAL_QUEUE_STATE, params.id))) error(404, 'Not found');
		const fold = (await request.formData().catch(() => null))?.get('fold');
		if (typeof fold !== 'string' || !fold.trim()) return fail(400, { message: 'Name the fold' });
		await appendFold(APPROVAL_QUEUE_STATE, params.id, fold.trim());
		return { ok: true };
	},
	submit: async ({ params, request }) => {
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
