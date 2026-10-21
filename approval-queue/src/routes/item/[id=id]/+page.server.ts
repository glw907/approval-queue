import { APPROVAL_QUEUE_STATE } from '$app/env/private';
import { error, fail } from '@sveltejs/kit';
import { parseBrief, type Brief } from '#lib/brief.ts';
import { cardsFor, decideCards, fingerprint, readChoices, type Card } from '#lib/cards.ts';
import { fileGroups } from '#lib/diff.ts';
import { render, renderInline } from '#lib/markdown.ts';
import { checksSummary, reviewSection, reviewVerdict, technicalNotes, withoutBrief } from '#lib/pr-summary.ts';
import { nextItem } from '#lib/queue.ts';
import { frontMatter, placeNotes } from '#lib/editor/notes.ts';
import { buildBlueprintApprove, isClean, saveFile } from '#lib/server/blueprint.ts';
import { buildApprove, isIrreversible, packetFingerprint } from '#lib/server/packet-decision.ts';
import {
	listWaiting,
	readItem,
	writeDecision,
	writeDecisionOnce,
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
	await writeDecision(APPROVAL_QUEUE_STATE, id, decision);
	return { next: next ? `/item/${next.id}` : null };
}

const ALREADY_DECIDED = { message: 'Already decided' };

/**
 * Answers a post whose item has gone. A post from a packet page carries its fingerprint, so that
 * page learns its session withdrew the item and is offered the board; any other post is a 404.
 */
async function gone(request: Request) {
	const form = await request.formData().catch(() => null);
	if (!form?.has('fingerprint')) error(404, 'Not found');
	return fail(410, { message: 'This item was withdrawn by its session; nothing was recorded', board: '/' });
}

/** Writes a packet's decision with `link`, so a second post answers 409 instead of replacing the first. */
async function decideOnce(id: string, decision: Decision) {
	const next = nextItem(await listWaiting(APPROVAL_QUEUE_STATE), id);
	if (!(await writeDecisionOnce(APPROVAL_QUEUE_STATE, id, decision))) return fail(409, ALREADY_DECIDED);
	return { next: next ? `/item/${next.id}` : null };
}

/** Cards with the HTML the page shows; a before-merge card holds the session's own Markdown steps. */
const withHtml = (cards: Card[]) =>
	cards.map((card) => ({ ...card, html: card.kind === 'before-merge' ? render(card.text) : renderInline(card.text) }));

/** The brief's detail sections as rendered rows; the open body drops the first sentence the closed row already shows. */
function detailRows(brief: Brief | null) {
	return (brief?.details ?? []).map((d) => ({
		label: d.label,
		summaryHtml: renderInline(d.summary),
		bodyHtml: render(d.body.startsWith(d.summary) ? d.body.slice(d.summary.length).trim() : d.body)
	}));
}

export const load: PageServerLoad = async ({ params }) => {
	const item = await readItem(APPROVAL_QUEUE_STATE, params.id);
	if (!item) error(404, 'Not found');
	const { meta, decided, content, decision } = item;
	if (content.kind === 'pr') {
		const review = reviewSection(content.body);
		const notes = technicalNotes(content.body);
		const groups = fileGroups(content.diff);
		const files = groups.flatMap((g) => g.files);
		// A body with no brief (an item queued before briefs) falls back to the title and no panel.
		const parsed = parseBrief(content.body);
		const brief = parsed.ok ? parsed.brief : null;
		return {
			meta,
			decided,
			kind: 'pr' as const,
			verdict: reviewVerdict(content.body),
			checks: checksSummary(content.pr?.statusCheckRollup),
			link: content.pr
				? { url: content.pr.url, head: content.pr.headRefName, base: content.pr.baseRefName }
				: null,
			headlineHtml: renderInline(brief?.headline ?? meta.headline ?? meta.title),
			ledeHtml: renderInline(brief?.lede ?? ''),
			whatChanges: (brief?.whatChanges ?? []).map(renderInline),
			ifYouApprove: (brief?.ifYouApprove ?? []).map(renderInline),
			worthKnowing: brief?.worthKnowing === undefined ? null : renderInline(brief.worthKnowing),
			details: detailRows(brief),
			cards: withHtml(cardsFor(content.body, content.pr?.statusCheckRollup)),
			reviewHtml: review === null ? null : render(review),
			technicalHtml: notes === '' ? null : render(notes),
			groups,
			totals: {
				files: files.length,
				adds: files.reduce((n, f) => n + f.adds, 0),
				dels: files.reduce((n, f) => n + f.dels, 0)
			}
		};
	}
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
	if (content.kind === 'blueprint') {
		const front = frontMatter(content.original);
		return {
			meta,
			decided,
			kind: 'blueprint' as const,
			doc: content.doc,
			original: content.original,
			blob: content.blob,
			file: content.file,
			missing: content.missing,
			page: front.page || content.file.split('/').pop() || meta.title,
			pageType: front.type ?? '',
			track: front.track ?? '',
			// Anchors resolve against the file as it is now, so a note follows a line an earlier save moved.
			notes: placeNotes(content.doc, content.notes),
			decision
		};
	}
	if (content.kind === 'packet') {
		const { packet, parts } = content;
		return {
			meta,
			decided,
			kind: 'packet' as const,
			headline: packet.headline,
			lede: packet.lede,
			background: packet.background,
			steps: packet.steps,
			notChecked: packet.notChecked,
			asks: packet.asks.map((ask, i) => ({ index: i + 1, ...ask, part: ask.part?.ref ?? null })),
			routine: packet.routine.map((row) => ({ ref: row.part.ref, kind: row.part.kind, verdict: row.verdict, fact: row.fact, why: row.why })),
			parts: parts.map((part) => ({
				ref: part.ref,
				kind: part.kind,
				lane: part.lane,
				verdict: part.verdict,
				head: part.head,
				sha256: part.sha256,
				...(part.kind === 'pr' && {
					checks: checksSummary(part.pr?.statusCheckRollup),
					review: reviewVerdict(part.body ?? ''),
					groups: fileGroups(part.diff ?? ''),
					link: part.pr ? { url: part.pr.url, head: part.pr.headRefName, base: part.pr.baseRefName } : null
				}),
				...(part.kind === 'design' && { doc: part.doc })
			})),
			fingerprint: packetFingerprint(parts, packet.asks),
			irreversible: isIrreversible(packet),
			irreversibleSteps: packet.steps.filter((s) => s.tag === 'irreversible').map((s) => s.n),
			decision
		};
	}
	// A decided triage shows the calls that were sent, matched by action so a reordered file never
	// pairs a call with the wrong row.
	const sent = new Map(decision?.decision === 'submit' ? decision.rows.map((call) => [call.action, call]) : []);
	const rows = content.rows.map((row) => {
		const call = sent.get(row.action);
		return { ...row, disposition: call?.disposition ?? row.proposed, note: call?.note ?? '' };
	});
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
			why: renderInline(row.why),
			detail: row.detail === undefined ? null : renderInline(row.detail)
		}))
	};
};

export const actions: Actions = {
	approve: async ({ params, request }) => {
		const found = await readItem(APPROVAL_QUEUE_STATE, params.id);
		if (!found) return gone(request);
		if (found.content.kind === 'packet') {
			if (found.decided) return fail(409, ALREADY_DECIDED);
			const form = await request.formData().catch(() => null);
			if (!form) return fail(400, { message: 'Not a form post' });
			// The server rebuilt the parts and asks from the item's files; the post only answers them.
			const built = buildApprove(found.content, form);
			return built.ok ? decideOnce(params.id, built.decision) : fail(400, { message: built.message });
		}
		if (found.content.kind === 'blueprint') {
			const { content } = found;
			if (found.decided) return fail(409, ALREADY_DECIDED);
			if (content.missing) return fail(409, { message: `${content.file} is no longer committed in its worktree` });
			const form = await request.formData().catch(() => null);
			if (!form) return fail(400, { message: 'Not a form post' });
			const clean = await isClean(content.worktree, content.file);
			const built = buildBlueprintApprove(content.notes, form, { ...content, text: content.doc, clean });
			return built.ok ? decideOnce(params.id, built.decision) : fail(400, { message: built.message });
		}
		const item = await readWaiting(params.id);
		const { content } = item;
		if (content.kind === 'triage' || content.kind === 'packet' || content.kind === 'blueprint') return fail(400, { message: 'Nothing to approve' });
		// The page disables Approve, but a post can still arrive without it; the server rebuilds the
		// cards from the body and checks every pick itself.
		const form = await request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Not a form post' });
		const cards =
			content.kind === 'design' ? decideCards(content.doc) : cardsFor(content.body, content.pr?.statusCheckRollup);
		// Picks are indexes into this list, so a list that changed since the page loaded must not be matched by position.
		if ((form.get('cards') ?? '') !== fingerprint(cards)) return fail(400, { message: 'The decisions changed; reload the page' });
		const picked = readChoices(cards, (field) => form.get(field));
		if (!picked.ok) return fail(400, { message: picked.message });
		return decide(params.id, { decision: 'approve', choices: picked.choices });
	},
	reject: async ({ params, request }) => {
		const found = await readItem(APPROVAL_QUEUE_STATE, params.id);
		if (!found) return gone(request);
		if (found.content.kind === 'packet') {
			if (found.decided) return fail(409, ALREADY_DECIDED);
			const form = await request.formData().catch(() => null);
			if (!form) return fail(400, { message: 'Not a form post' });
			const note = form.get('note');
			return decideOnce(params.id, { decision: 'reject', note: typeof note === 'string' ? note : '' });
		}
		if (found.content.kind === 'blueprint') {
			if (found.decided) return fail(409, ALREADY_DECIDED);
			const note = (await request.formData().catch(() => null))?.get('note');
			return decideOnce(params.id, { decision: 'reject', note: typeof note === 'string' ? note : '' });
		}
		const item = await readWaiting(params.id);
		if (item.content.kind === 'triage') return fail(400, { message: 'Nothing to reject' });
		const note = (await request.formData()).get('note');
		return decide(params.id, { decision: 'reject', note: typeof note === 'string' ? note : '' });
	},
	/** Writes a blueprint's text and commits it in its worktree, checked against the blob the page last saved. */
	save: async ({ params, request }) => {
		const item = await readWaiting(params.id);
		if (item.content.kind !== 'blueprint') return fail(400, { message: 'Not a blueprint item' });
		if (item.content.missing) return fail(409, { message: `${item.content.file} is no longer committed in its worktree` });
		const form = await request.formData().catch(() => null);
		const text = form?.get('text');
		const base = form?.get('base');
		if (typeof text !== 'string' || typeof base !== 'string') return fail(400, { message: 'Not a save' });
		const saved = await saveFile(item.content.worktree, item.content.file, text, base);
		return saved.ok ? { blob: saved.blob, commit: saved.commit } : fail(saved.status, { message: saved.message });
	},
	submit: async ({ params, request }) => {
		const item = await readWaiting(params.id);
		if (item.content.kind !== 'triage') return fail(400, { message: 'Not a triage item' });
		const form = await request.formData();
		const dispositions = form.getAll('disposition');
		const notes = form.getAll('note');
		const source = item.content.rows;
		if (dispositions.length !== source.length || notes.length !== source.length) {
			return fail(400, { message: 'Row count does not match' });
		}
		const rows: SubmittedRow[] = [];
		for (const [i, row] of source.entries()) {
			const disposition = dispositions[i];
			const note = notes[i];
			if (typeof disposition !== 'string' || !DISPOSITIONS.includes(disposition) || typeof note !== 'string') {
				return fail(400, { message: 'Invalid disposition' });
			}
			rows.push({ action: row.action, disposition: disposition as Disposition, note });
		}
		return decide(params.id, { decision: 'submit', rows });
	}
};
