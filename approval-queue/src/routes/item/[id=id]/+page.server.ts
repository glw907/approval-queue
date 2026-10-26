import { join } from 'node:path';
import { APPROVAL_QUEUE_STATE } from '$app/env/private';
import { error, fail } from '@sveltejs/kit';
import { parseBrief, type Brief } from '#lib/brief.ts';
import { cardsFor, decideCards, fingerprint, readChoices, type Card } from '#lib/cards.ts';
import { fileGroups } from '#lib/diff.ts';
import { render, renderInline, renderLabel } from '#lib/markdown.ts';
import { checksSummary, reviewSection, reviewVerdict, technicalNotes, withoutBrief } from '#lib/pr-summary.ts';
import { nextItem } from '#lib/queue.ts';
import { anchorAt, place, type Anchor, type Comment, type Thread } from '#lib/editor/comments.ts';
import { placeNotes } from '#lib/editor/notes.ts';
import { buildDocsApprove, commitText, isClean, queued, queuedItem, sentBackCalls } from '#lib/server/docs.ts';
import { buildApprove, buildSentBackCalls, isIrreversible, packetFingerprint } from '#lib/server/packet-decision.ts';
import {
	carried,
	listWaiting,
	readComments,
	readItem,
	readSentBack,
	writeComments,
	writeDecision,
	writeDecisionOnce,
	writeDeferred,
	type CommentStore,
	type Decision,
	type Disposition,
	type Item,
	type ItemContent,
	type StoredPatch,
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
 * Answers a post whose item has gone. A post from a packet page carries its fingerprint, so that
 * page learns its session withdrew the item and is offered the board; any other post is a 404.
 */
async function gone(request: Request) {
	const form = await request.formData().catch(() => null);
	return withdrawn(form?.has('fingerprint') === true);
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

const itemDir = (id: string) => join(APPROVAL_QUEUE_STATE, 'items', id);

/** Each comment with where its anchor falls in the document now, or null when its text is gone. */
const placeComments = (doc: string, comments: readonly Comment[]) =>
	comments.map((c) => ({ ...c, placed: place(doc, c.anchor) }));

/** Each of the author's replies, placed, with Geoff's own reply to it (empty for none) and whether he resolved it. */
function placeThreads(doc: string, threads: readonly Thread[], store: CommentStore) {
	const mine = new Map(store.threads.map((t) => [t.id, t]));
	return threads.map((t) => ({
		...t,
		placed: place(doc, t.anchor),
		reply: mine.get(t.id)?.reply ?? '',
		resolved: mine.get(t.id)?.resolved === true
	}));
}

const OPS = ['add', 'edit', 'delete', 'reply', 'resolve', 'reopen'] as const;
type Op = (typeof OPS)[number];

type Built = { ok: true; anchor: Anchor } | { ok: false; status: 400 | 409; message: string };

/**
 * Builds a new comment's anchor from the item as the server reads it now, never from posted text.
 * The anchor falls in the named page as committed at HEAD, which must still be the posted blob.
 */
function commentAnchor(item: Item, form: FormData): Built {
	const from = form.get('from');
	const to = form.get('to');
	const { content } = item;
	if (content.kind !== 'docs') return { ok: false, status: 400, message: 'Not a docs item' };
	const page = content.pages.find((p) => p.path === form.get('file'));
	if (!page) return { ok: false, status: 400, message: 'Name a page this review carries' };
	if (page.missing) return { ok: false, status: 409, message: `${page.path} is no longer committed in its worktree` };
	if (form.get('blob') !== page.blob) return { ok: false, status: 409, message: 'The page changed since your last save; reload the page' };
	if (typeof from !== 'string' || typeof to !== 'string' || !/^\d+$/.test(from) || !/^\d+$/.test(to)) {
		return { ok: false, status: 400, message: 'Not a range' };
	}
	const [a, b] = [Number(from), Number(to)];
	if (a >= b || b > page.doc.length) return { ok: false, status: 400, message: 'The range is outside the page' };
	return { ok: true, anchor: anchorAt(page.doc, a, b, page.commit, page.path) };
}

type Applied = { ok: true; id: string; store: CommentStore } | { ok: false; message: string };

/**
 * Applies one comment op to a copy of the store. `add` takes the next id; `edit` and `delete` act on
 * Geoff's comments, and `reply`, `resolve`, and `reopen` on the author's threads. An empty reply
 * removes Geoff's reply, and a thread entry left with neither a reply nor a resolution is dropped.
 */
function applyOp(store: CommentStore, replies: readonly Thread[], op: Op, id: string, text: string, anchor?: Anchor): Applied {
	const comments = [...store.comments];
	const threads = store.threads.map((t) => ({ ...t }));
	let next = store.next;
	const at = comments.findIndex((c) => c.id === id);
	if (op === 'add' || op === 'edit') {
		if (!text.trim()) return { ok: false, message: 'Write the comment first' };
		if (op === 'add') {
			if (!anchor) return { ok: false, message: 'Not a range' };
			id = `C${next++}`;
			comments.push({ id, text, anchor });
		} else if (at === -1) return { ok: false, message: `Unknown comment ${id}` };
		else comments[at] = { ...comments[at], text };
	} else if (op === 'delete') {
		if (at === -1) return { ok: false, message: `Unknown comment ${id}` };
		comments.splice(at, 1);
	} else {
		if (!replies.some((t) => t.id === id)) return { ok: false, message: `Unknown thread ${id}` };
		let entry = threads.find((t) => t.id === id);
		if (!entry) threads.push((entry = { id }));
		if (op === 'reply') {
			if (text.trim()) entry.reply = text;
			else delete entry.reply;
		} else if (op === 'resolve') entry.resolved = true;
		else delete entry.resolved;
	}
	const kept = threads.filter((t) => t.reply !== undefined || t.resolved);
	return { ok: true, id, store: { comments, threads: kept, next } };
}

/**
 * Loads the item and adds `canDefer`: false for a triage (it has no session to wait on it), a decided
 * item, and one already deferred.
 */
export const load: PageServerLoad = async (event) => {
	const data = await loadItem(event.params);
	return { ...data, canDefer: data.kind !== 'triage' && !data.decided && !data.meta.deferred };
};

async function loadItem(params: { id: string }) {
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
	if (content.kind === 'docs') {
		const groups = fileGroups(content.diff);
		const files = groups.flatMap((g) => g.files);
		const store = await readComments(APPROVAL_QUEUE_STATE, params.id);
		const compare = (patch: StoredPatch | undefined) => patch && ('patch' in patch ? { groups: fileGroups(patch.patch) } : patch);
		const since = compare(content.since);
		const approved = compare(content.approved);
		return {
			meta,
			decided,
			kind: 'docs' as const,
			ref: `${meta.repo}#${meta.number ?? ''}`,
			head: meta.head ?? '',
			description: content.description,
			bodyHtml: render(content.body),
			checks: checksSummary(content.pr.statusCheckRollup),
			link: { url: content.pr.url, head: content.pr.headRefName, base: content.pr.baseRefName },
			groups,
			totals: {
				files: files.length,
				adds: files.reduce((n, f) => n + f.adds, 0),
				dels: files.reduce((n, f) => n + f.dels, 0)
			},
			...(meta.revises && { revision: meta.revises.revision }),
			...(since && { since }),
			...(approved && { approved }),
			pages: content.pages.map((page) => ({
				path: page.path,
				...(page.from && { from: page.from }),
				doc: page.doc,
				base: page.base,
				queued: page.queued,
				blob: page.blob,
				missing: page.missing,
				// Anchors resolve against the page as it is now, so a note follows a line an earlier save moved.
				notes: placeNotes(
					page.doc,
					content.notes.filter((n) => n.file === page.path)
				),
				comments: placeComments(
					page.doc,
					store.comments.filter((c) => c.anchor.file === page.path)
				),
				threads: placeThreads(
					page.doc,
					content.replies.filter((t) => t.anchor.file === page.path),
					store
				)
			})),
			decision
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
			/** The action again without its links, for the pane row that links to it. */
			label: renderLabel(row.action),
			why: renderInline(row.why),
			detail: row.detail === undefined ? null : renderInline(row.detail)
		}))
	};
}

type Docs = Extract<ItemContent, { kind: 'docs' }>;

/**
 * Runs `step` on a docs item read again behind every save and comment already queued, on the item's
 * queue and its worktree's, so the HEAD it reads is the one a decision names and the comments it reads
 * are all of them: a later save or comment answers 404.
 */
function decidingDocs<T>(id: string, found: Docs, step: (content: Docs) => Promise<T>) {
	return queuedItem(itemDir(id), () =>
		queued(found.worktree, async () => {
			const now = await readItem(APPROVAL_QUEUE_STATE, id);
			if (!now) error(404, 'Not found');
			if (now.decided) return fail(409, ALREADY_DECIDED);
			if (now.content.kind !== 'docs') return fail(400, { message: 'Not a docs item' });
			return step(now.content);
		})
	);
}

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
			return built.ok ? decideOnce(params.id, built.decision, form.has('fingerprint')) : fail(400, { message: built.message });
		}
		if (found.content.kind === 'docs') {
			if (found.decided) return fail(409, ALREADY_DECIDED);
			const form = await request.formData().catch(() => null);
			if (!form) return fail(400, { message: 'Not a form post' });
			return decidingDocs(params.id, found.content, async (content) => {
				const gone = content.pages.find((page) => page.missing);
				if (gone) return fail(409, { message: `${gone.path} is no longer committed in its worktree` });
				const clean = await Promise.all(content.pages.map((page) => isClean(content.worktree, page.path)));
				const pages = content.pages.map(({ path, blob }, i) => ({ path, blob, clean: clean[i] }));
				const built = buildDocsApprove(content.notes, form, { commit: content.pages[0].commit, pages });
				if (!built.ok) return fail(400, { message: built.message });
				return decideOnce(params.id, { ...built.decision, ...carried(await readComments(APPROVAL_QUEUE_STATE, params.id)) });
			});
		}
		const item = await readWaiting(params.id);
		const { content } = item;
		if (content.kind !== 'pr' && content.kind !== 'design') return fail(400, { message: 'Nothing to approve' });
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
		if (found.content.kind === 'docs') {
			if (found.decided) return fail(409, ALREADY_DECIDED);
			const form = await request.formData().catch(() => null);
			const note = form?.get('note');
			// With the worktree gone nothing was edited since the queue, so the queued head stands in for its HEAD.
			const head = found.meta.head ?? '';
			return decidingDocs(params.id, found.content, async (content) => {
				const calls = form ? sentBackCalls(content.notes, form) : [];
				return decideOnce(params.id, {
					decision: 'reject',
					note: typeof note === 'string' ? note : '',
					commit: content.pages.find((page) => !page.missing)?.commit ?? head,
					...(calls.length && { calls }),
					...carried(await readComments(APPROVAL_QUEUE_STATE, params.id))
				});
			});
		}
		const item = await readWaiting(params.id);
		if (item.content.kind === 'triage') return fail(400, { message: 'Nothing to reject' });
		const form = await request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Not a form post' });
		const note = form.get('note');
		return decide(params.id, { decision: 'reject', note: typeof note === 'string' ? note : '' });
	},
	/**
	 * Sets an item aside: the waiting command prints the defer line and exits, and the item stays on the
	 * board under Deferred. A triage has no session to free, and a decided or deferred item has nothing to defer.
	 */
	defer: async ({ params }) => {
		const item = await readItem(APPROVAL_QUEUE_STATE, params.id);
		if (!item) error(404, 'Not found');
		if (item.content.kind === 'triage') return fail(400, { message: 'A triage cannot be deferred' });
		if (item.decided) return fail(409, ALREADY_DECIDED);
		if (item.meta.deferred) return fail(409, { message: 'Already deferred' });
		const next = nextItem(await listWaiting(APPROVAL_QUEUE_STATE), params.id);
		await writeDeferred(APPROVAL_QUEUE_STATE, params.id);
		return { next: next ? `/item/${next.id}` : null };
	},
	/** Writes a page's text and commits it in its worktree, checked against the blob the page last saved. */
	save: async ({ params, request }) => {
		const item = await readWaiting(params.id);
		const { content } = item;
		if (content.kind !== 'docs') return fail(400, { message: 'Not a docs item' });
		const form = await request.formData().catch(() => null);
		const [file, blob, text] = ['file', 'blob', 'text'].map((name) => form?.get(name));
		if (typeof file !== 'string' || typeof blob !== 'string' || typeof text !== 'string') return fail(400, { message: 'Not a save' });
		const page = content.pages.find((p) => p.path === file);
		if (!page) return fail(400, { message: 'Name a page this review carries' });
		if (page.missing) return fail(409, { message: `${file} is no longer committed in its worktree` });
		const { worktree } = content;
		const saved = await queued(worktree, async () => {
			// An approve queued ahead of this save has decided the item, and the page stays as it approved it.
			await readWaiting(params.id);
			return commitText(worktree, file, text, blob);
		});
		return saved.ok ? { blob: saved.blob, commit: saved.commit } : fail(saved.status, { message: saved.message });
	},
	/**
	 * Adds, edits, or deletes one of Geoff's comments on a page, or replies to, resolves, or reopens
	 * one of the author's threads, and answers the stored comments and threads. Runs on the item's
	 * queue, and on the named page's queue too for an add, so a decision either carries the comment
	 * or was written first and the comment answers 404.
	 */
	comment: async ({ params, request }) => {
		const { content } = await readWaiting(params.id);
		if (content.kind !== 'docs') return fail(400, { message: 'Not a docs item' });
		const form = await request.formData().catch(() => null);
		const op = form?.get('op');
		if (!form || typeof op !== 'string' || !(OPS as readonly string[]).includes(op)) return fail(400, { message: 'Not a comment op' });
		const field = (name: string) => {
			const value = form.get(name);
			// A form post sends every line break as CRLF; the stored text keeps LF, as the editor does.
			return typeof value === 'string' ? value.replace(/\r\n/g, '\n') : '';
		};
		const step = async () => {
			const now = await readWaiting(params.id);
			if (now.content.kind !== 'docs') return fail(400, { message: 'Not a docs item' });
			let anchor: Anchor | undefined;
			if (op === 'add') {
				const built = commentAnchor(now, form);
				if (!built.ok) return fail(built.status, { message: built.message });
				anchor = built.anchor;
			}
			const store = await readComments(APPROVAL_QUEUE_STATE, params.id);
			const applied = applyOp(store, now.content.replies, op as Op, field('id'), field('text'), anchor);
			if (!applied.ok) return fail(400, { message: applied.message });
			await writeComments(APPROVAL_QUEUE_STATE, params.id, applied.store);
			return { id: applied.id, comments: applied.store.comments, threads: applied.store.threads };
		};
		return queuedItem(itemDir(params.id), () => (op === 'add' ? queued(content.worktree, step) : step()));
	},
	submit: async ({ params, request }) => {
		const item = await readWaiting(params.id);
		if (item.content.kind !== 'triage') return fail(400, { message: 'Not a triage item' });
		const form = await request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Not a form post' });
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
