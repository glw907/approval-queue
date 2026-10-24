<!-- @component
One open item in the three-pane frame: a switch on the item's kind picks its header, its work, its
review pane, and the decision bar's labels, and the frame supplies the rest. The page renders it
inside a `{#key}` on the item's id, so per-item state here (the note, a failed post) starts fresh
when the next item loads. Triage calls are the exception: unsent ones are kept in `desk.drafts`, so
opening another item and coming back keeps them.

A decision never posts from here. The submit function flushes any pending save, cancels the form's
own post, and hands its form data to the layout's `held` store, then opens the next waiting item at
once (or the board when none is left), replacing the history entry so the tab stays
script-closable. The store posts after five seconds unless Undo opens this item again; the new
panel then takes the decision back and seeds its note, a packet's answers and verdicts, a PR's or
design's picks, and triage rows from the held form data, so the item returns as it was left.

Every Approve uses `aria-disabled` rather than `disabled` while calls are open, so a locked press
still arrives and moves focus to the first open ask, card, or call. A packet whose steps cannot be
undone asks for one confirmation first, which posts as `irreversible=yes`.

A document review saves as the reader types. Opening another item while an edit is unsaved waits
for that save first, and closing the tab then asks before leaving.
-->
<script lang="ts">
	import { deserialize, enhance, type SubmitFunction } from '$app/forms';
	import { beforeNavigate, goto } from '$app/navigation';
	import { tick, untrack } from 'svelte';
	import { fingerprint, gate } from '#lib/cards.ts';
	import { setDrawer } from '#lib/components/frame/drawers.ts';
	import { desk, type OutlineEntry } from '#lib/desk.svelte.ts';
	import { held, seedFrom, UNDONE } from '#lib/held.svelte.ts';
	import { nextItem } from '#lib/queue.ts';
	import { changedCount, seedRows, type Row } from '#lib/triage.ts';
	import { VERDICT_LOOK } from '#lib/packet-view.ts';
	import type { PlacedNote } from '#lib/editor/notes.ts';
	import { boxes, DocReview, heldBySave, noteStart, refuseOpenBox, sendBackDraft, type CommentAnswer, type SaveResult } from '#lib/editor/review.svelte.ts';
	import type { PageData } from '../../routes/item/[id=id]/$types';
	import BlueprintView from './BlueprintView.svelte';
	import BriefBlock from './BriefBlock.svelte';
	import ChangeView from './ChangeView.svelte';
	import DecideCards from './DecideCards.svelte';
	import DesignView from './DesignView.svelte';
	import DetailRows from './DetailRows.svelte';
	import DecisionBar from './frame/DecisionBar.svelte';
	import Frame from './frame/Frame.svelte';
	import FrameHeader from './frame/FrameHeader.svelte';
	import PaneList, { type PaneItem } from './frame/PaneList.svelte';
	import PaneSection from './frame/PaneSection.svelte';
	import PacketAsks from './PacketAsks.svelte';
	import PageView from './PageView.svelte';
	import PacketBrief from './PacketBrief.svelte';
	import PacketIcon from './PacketIcon.svelte';
	import PacketRoutine from './PacketRoutine.svelte';
	import PrView from './PrView.svelte';
	import Prose from './Prose.svelte';
	import TriageView from './TriageView.svelte';

	let { data }: { data: PageData } = $props();

	let form = $state<HTMLFormElement>();
	let noteField = $state<HTMLTextAreaElement>();
	let noteText = $state('');
	let approveButton = $state<HTMLButtonElement>();
	let rejectButton = $state<HTMLButtonElement>();
	let sendButton = $state<HTMLButtonElement>();
	let submitButton = $state<HTMLButtonElement>();
	let confirmDialog = $state<HTMLDialogElement>();
	// The page keys this component on the item id, so a decision Undo handed back is taken once.
	// svelte-ignore state_referenced_locally
	const restored = held.take(data.meta.id);
	// svelte-ignore state_referenced_locally
	const seed = restored ? seedFrom(restored.form, data.kind) : null;
	noteText = seed?.note ?? '';

	// The poll hands the panel a new `data` every two seconds, so effects read these instead: a
	// derived that keeps its value does not re-run them.
	const kind = $derived(data.kind);
	const isDecided = $derived(data.decided);

	// The page keys this component on the item id, so the rows are read once per item.
	// svelte-ignore state_referenced_locally
	let rows = $state<Row[]>(
		data.kind === 'triage'
			? data.decided
				? data.rows
				: seed?.rows.length === data.rows.length
					? data.rows.map((row, i) => ({ ...row, ...(seed.rows[i] as Pick<Row, 'disposition' | 'note'>) }))
					: seedRows(data.rows, desk.drafts.get(data.meta.id))
			: []
	);
	const changed = $derived(changedCount(rows));

	$effect(() => {
		if (data.kind !== 'triage' || data.decided) return;
		const edited = changedCount(rows) > 0 || rows.some((row) => row.note !== '');
		if (edited) desk.drafts.set(data.meta.id, $state.snapshot(rows));
		else desk.drafts.delete(data.meta.id);
	});

	// A card's pick is its choice's index; Approve unlocks once every card has one and none sends back.
	let picks = $state<Array<number | undefined>>(seed?.picks ?? []);
	const cards = $derived(data.kind === 'pr' || data.kind === 'design' ? data.cards : []);
	const decided = $derived(gate(cards, picks));
	const readySub = $derived.by(() => {
		if (cards.length > 0) return 'Every decision is made.';
		if (data.kind !== 'pr') return '';
		const { passed, failed, pending, rows } = data.checks;
		return rows.length > 0 && failed === 0 && pending === 0
			? `All ${passed} checks passed. Nothing to decide first.`
			: 'Nothing to decide first.';
	});

	// A packet's asks are answered by label and its routine verdicts start at the session's; the page
	// keys this component on the item id, so both are read once per item.
	// A decided packet starts from what was decided, not from the session's defaults.
	// svelte-ignore state_referenced_locally
	let answers = $state<Record<number, string | undefined>>(
		data.kind === 'packet' && data.decision?.decision === 'approve'
			? Object.fromEntries((data.decision.asks ?? []).map((ask) => [ask.index, ask.choice]))
			: (seed?.answers ?? {})
	);
	// svelte-ignore state_referenced_locally
	let verdicts = $state<Record<string, string>>(
		data.kind === 'packet'
			? {
					...Object.fromEntries(data.routine.map((row) => [row.ref, row.verdict])),
					...(data.decision?.decision === 'approve' &&
						Object.fromEntries((data.decision.parts ?? []).map((part) => [part.ref, part.verdict]))),
					...seed?.verdicts
				}
			: {}
	);
	const asks = $derived(data.kind === 'packet' ? data.asks : []);
	const openAsks = $derived(asks.filter((ask) => answers[ask.index] === undefined));
	const packetChanged = $derived(
		data.kind === 'packet' ? data.routine.filter((row) => verdicts[row.ref] !== row.verdict).length : 0
	);
	const packetLock = $derived(
		openAsks.length
			? `Answer ${openAsks.length} more ${openAsks.length === 1 ? 'ask' : 'asks'}`
			: 'Ready to approve'
	);
	const packetSub = $derived.by(() => {
		if (openAsks.length) return 'to unlock Approve';
		return packetChanged === 0 ? 'No verdicts changed' : `${packetChanged} ${packetChanged === 1 ? 'verdict' : 'verdicts'} changed`;
	});

	/** The decisions the screen asks for, in page order: what the pane lists and F8 walks. */
	const calls = $derived.by((): Array<{ id: string; label: string; what: string; open: boolean }> => {
		if (data.kind === 'packet') {
			return data.asks.map((ask) => {
				const picked = answers[ask.index];
				return {
					id: `ask-${ask.index}`,
					label: ask.question,
					what: picked === undefined ? 'Open, pick one' : `Answered: ${picked}`,
					open: picked === undefined
				};
			});
		}
		return cards.map((card, i) => ({
			id: `card-${i}`,
			label: card.title,
			what: picks[i] === undefined ? 'Open' : 'Decided',
			open: picks[i] === undefined
		}));
	});
	const callItems = $derived<PaneItem[]>(
		calls.map((c) => ({ href: `#${c.id}`, label: c.label, what: c.what, dot: c.open ? 'call' : 'done' }))
	);
	const verdictWord = (ref: string, session: string) =>
		verdicts[ref] === session ? `${VERDICT_LOOK[session].label}, the session’s verdict` : `${VERDICT_LOOK[verdicts[ref]].label}, your change`;
	/** The packet's routine parts that are not plan steps; a step's verdict sits on its step. */
	const partRows = $derived(data.kind === 'packet' ? data.routine.filter((row) => row.kind !== 'step') : []);
	const partId = (ref: string) => `part-${ref.replace(/[^\w-]+/g, '-')}`;
	const TRIAGE_WORD = { now: 'Do now', defer: 'Do later', drop: 'Don’t do' };
	const partItems = $derived<PaneItem[]>(
		partRows.map((row) => ({
			href: `#${partId(row.ref)}`,
			label: row.ref,
			what: verdictWord(row.ref, row.verdict),
			dot: verdicts[row.ref] === row.verdict ? 'done' : 'call'
		}))
	);
	const yourSteps = $derived<PaneItem[]>(
		data.kind === 'packet'
			? data.steps.filter((s) => s.tag === 'you').map((s) => ({ href: `#step-${s.n}`, label: `${s.n}. ${s.label ?? s.text}`, dot: 'call' as const }))
			: []
	);
	/** The screen's sections in page order, numbered; a section holding an open call carries a dot. */
	const outline = $derived.by((): PaneItem[] => {
		const sections: Array<Omit<PaneItem, 'n'>> = [];
		if (data.kind === 'packet') {
			sections.push({ href: '#if-you-approve', label: 'If you approve' }, { href: '#not-checked', label: 'Not checked' });
			if (data.asks.length) sections.push({ href: '#asks', label: 'Asks', mark: openAsks.length ? 'call' : undefined });
			if (partRows.length) sections.push({ href: '#parts', label: 'Parts' });
		} else if (data.kind === 'pr' || data.kind === 'design') {
			if (data.whatChanges.length) sections.push({ href: '#what-changes', label: 'What changes' });
			if (data.ifYouApprove.length) sections.push({ href: '#if-you-approve', label: 'If you approve' });
			if (cards.length) sections.push({ href: '#decide-first', label: 'Decide first', mark: decided.open.length ? 'call' : undefined });
			if (data.details.length) sections.push({ href: '#details', label: 'Details' });
			sections.push(data.kind === 'pr' ? { href: '#evidence', label: 'Evidence' } : { href: '#design', label: 'The design' });
		} else if (data.kind === 'triage') {
			sections.push({ href: '#group-now', label: 'Do now' }, { href: '#group-defer', label: 'Do later' }, { href: '#group-drop', label: 'Don’t do' });
		}
		return sections.map((s, i) => ({ ...s, n: i + 1 }));
	});
	const packet = $derived(data.kind === 'packet' ? data : null);

	// The page keys this component on the item id, so the save's address is fixed once per item: a
	// save that lands after the reader has moved on still reaches this item, never the next one.
	// svelte-ignore state_referenced_locally
	const saveUrl = `/item/${encodeURIComponent(data.meta.id)}?/save`;

	/** Posts a blueprint's text to the save action, which commits it in the worktree. */
	async function saveBlueprint(text: string, base: string): Promise<SaveResult> {
		const body = new FormData();
		body.set('text', text);
		body.set('base', base);
		const res = await fetch(saveUrl, { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
		const result = deserialize(await res.text());
		if (result.type === 'success') return { ok: true, blob: String(result.data?.blob ?? '') };
		if (result.type === 'failure') return { ok: false, message: String(result.data?.message ?? 'refused') };
		return { ok: false, message: result.type === 'error' ? result.error.message : 'unexpected answer' };
	}

	// svelte-ignore state_referenced_locally
	const commentUrl = `/item/${encodeURIComponent(data.meta.id)}?/comment`;

	/** Posts one comment op to the comment action, which answers the whole stored state after it. */
	async function postComment(fields: Record<string, string>): Promise<CommentAnswer> {
		const body = new FormData();
		for (const [k, v] of Object.entries(fields)) body.set(k, v);
		const res = await fetch(commentUrl, { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
		const result = deserialize(await res.text());
		if (result.type === 'success') return { ok: true, ...(result.data as Omit<Extract<CommentAnswer, { ok: true }>, 'ok'>) };
		if (result.type === 'failure') return { ok: false, message: String(result.data?.message ?? 'refused') };
		return { ok: false, message: result.type === 'error' ? result.error.message : 'unexpected answer' };
	}

	/** A decided item's calls as choice indexes, approved or sent back, so its notes show what was chosen. */
	function answeredCalls(notes: PlacedNote[]): Record<string, number> {
		const decision = 'decision' in data ? data.decision : undefined;
		if (decision?.decision !== 'approve' && decision?.decision !== 'reject') return {};
		const out: Record<string, number> = {};
		for (const call of decision.calls ?? []) {
			const at = notes.find((n) => n.id === call.id)?.choices?.findIndex((c) => c.label === call.choice) ?? -1;
			if (at >= 0) out[call.id] = at;
		}
		return out;
	}
	// The page keys this component on the item id, so each review is built once per item.
	// svelte-ignore state_referenced_locally
	const remember = data.decided ? undefined : `desk.calls.${data.meta.id}`;
	// svelte-ignore state_referenced_locally
	const review =
		data.kind === 'blueprint' || data.kind === 'page'
			? new DocReview({
					doc: data.doc,
					original: data.original,
					blob: data.blob,
					notes: data.notes,
					save: saveBlueprint,
					decided: data.decided ? answeredCalls(data.notes) : undefined,
					remember,
					comments: data.comments,
					threads: data.threads,
					comment: data.decided ? undefined : postComment
				})
			: null;
	// A change review shows each changed document read-only, with the lines the change edited marked.
	// svelte-ignore state_referenced_locally
	const changeReviews =
		data.kind === 'change'
			? data.docs.map((d, i) => {
					const r = new DocReview({
						doc: d.doc,
						original: d.original,
						blob: '',
						notes: d.notes,
						save: async () => ({ ok: false, message: 'a change review takes no edits' }),
						decided: data.decided ? answeredCalls(d.notes) : undefined,
						remember: remember && `${remember}.${i}`,
						readonly: true,
						comments: d.comments,
						threads: d.threads,
						comment: data.decided ? undefined : postComment,
						file: d.path,
						margin: `margin-${i}`
					});
					r.markChanges = true;
					r.saveStatus = 'Read only';
					return r;
				})
			: [];
	const docReviews = review ? [review] : changeReviews;
	const openCalls = $derived(docReviews.flatMap((r) => r.openCalls));
	const decidedCount = $derived(docReviews.reduce((n, r) => n + Object.keys(r.decided).length, 0));
	const blueprint = $derived(data.kind === 'blueprint' || data.kind === 'page' ? data : null);
	const change = $derived(data.kind === 'change' ? data : null);
	const frozen = $derived(isDecided);
	const missing = $derived(data.kind === 'blueprint' || data.kind === 'page' ? data.missing : false);

	// A held or decided review takes no choices, and no text edits either while the file is gone.
	$effect(() => {
		for (const r of docReviews) {
			r.locked = frozen;
			r.commentable = !frozen && !missing;
		}
		review?.setReadonly(frozen || missing);
	});
	// A box left open on the item being left must not refuse decisions on the next one, and a toast's
	// Undo, such as a deleted comment's, must not act on this item from the next.
	$effect(() => () => {
		if (boxes.open && docReviews.includes(boxes.open)) boxes.open = null;
		desk.commentOpen = false;
		if (desk.toastUndo) desk.toast = null;
	});

	/** Geoff's comments and replies across the screen's documents, which go to the author with the decision. */
	const commentCount = $derived(docReviews.reduce((n, r) => n + r.comments.length, 0));
	const replyCount = $derived(docReviews.reduce((n, r) => n + r.replied, 0));
	const unreadCount = $derived(docReviews.reduce((n, r) => n + r.unread, 0));
	const threadCount = $derived(docReviews.reduce((n, r) => n + r.threads.length, 0));
	const cardCount = $derived(docReviews.reduce((n, r) => n + r.cardCount, 0));
	/** Geoff's own words to the author: new comments plus replies to the author's threads. */
	const yourWords = $derived(commentCount + replyCount);

	const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
	const word = (n: number) => WORDS[n] ?? String(n);
	const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
	const plural = (n: number, one: string, many = `${one}s`) => `${word(n)} ${n === 1 ? one : many}`;
	/** The lede's first sentence: how many calls still need a choice. */
	const callsLine = $derived(
		openCalls.length === 0
			? 'No calls are open.'
			: `${capital(plural(openCalls.length, 'call'))} ${openCalls.length === 1 ? 'is' : 'are'} open.`
	);
	/**
	 * After a send-back, what the author did with Geoff's comments: "You sent it back with four
	 * comments. The author made two changes, answered one comment, and explained why one passage stays."
	 */
	const repliesLine = $derived.by(() => {
		const threads = docReviews.flatMap((r) => r.threads);
		if (!threads.length) return '';
		const count = (s: string) => threads.filter((t) => t.status === s).length;
		const [done, answered, kept] = [count('done'), count('answered'), count('kept')];
		const parts = [
			done ? `made ${plural(done, 'change')}` : '',
			answered ? `answered ${plural(answered, 'comment')}` : '',
			kept ? `explained why ${plural(kept, 'passage')} ${kept === 1 ? 'stays' : 'stay'}` : ''
		].filter(Boolean);
		const list = parts.length < 3 ? parts.join(' and ') : `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`;
		return `You sent it back with ${plural(threads.length, 'comment')}. The author ${list}.`;
	});
	/**
	 * The lede of a blueprint or page: the open calls, what the file describes, then what the author did
	 * with the fact check. A blueprint's type name is hyphenated as a modifier ("symptom-row page").
	 */
	const docLede = $derived.by(() => {
		if (!blueprint || !review) return '';
		const type = blueprint.pageType ? `${/^[aeiou]/i.test(blueprint.pageType) ? 'an' : 'a'} ${blueprint.pageType.replaceAll(' ', '-')} page` : 'a docs page';
		const what = `${blueprint.kind === 'page' ? 'This draft is' : 'This blueprint describes'} ${type}${blueprint.track ? ` on the ${blueprint.track} track` : ''}.`;
		const fixed = review.notes.filter((n) => n.kind === 'info').length;
		const disputed = review.notes.filter((n) => n.kind === 'decide').length;
		const asked = review.notes.filter((n) => n.kind === 'question').length;
		const found = fixed + disputed;
		const check =
			found === 0
				? ''
				: disputed === 0
					? `The author fixed ${found === 1 ? 'the one finding' : `all ${word(found)} findings`} from the fact check.`
					: fixed === 0
						? `The author disputed ${found === 1 ? 'the one finding' : `all ${word(found)} findings`} from the fact check.`
						: `Of the fact check’s ${word(found)} findings, the author fixed ${word(fixed)} and disputed ${word(disputed)}.`;
		const question = asked ? `The author ${check ? 'also ' : ''}has ${asked === 1 ? 'a question' : `${word(asked)} questions`} for you.` : '';
		return [what, repliesLine, check, question, callsLine].filter(Boolean).join(' ');
	});
	/** The change's lede: the open calls, then what the change edits. */
	const changeLede = $derived.by(() => {
		if (!change) return '';
		const docs = plural(change.docs.length, 'document');
		const code = change.totals.files ? ` and ${plural(change.totals.files, 'code file')}` : '';
		return `“${change.meta.title}” edits ${docs}${code}. ${callsLine}`;
	});

	/** Moves focus to the next open call after the one holding focus, wrapping to the first. */
	let lastDoc = -1;
	function nextCall() {
		if (review) {
			review.nextCall();
			return;
		}
		if (changeReviews.length) {
			// One document at a time, starting after the last one visited.
			for (let step = 1; step <= changeReviews.length; step++) {
				const at = (lastDoc + step) % changeReviews.length;
				if (changeReviews[at].openCalls.length) {
					lastDoc = at;
					changeReviews[at].nextCall();
					return;
				}
			}
			return;
		}
		const open = calls.filter((c) => c.open);
		if (!open.length) return;
		const at = open.findIndex((c) => document.getElementById(c.id)?.contains(document.activeElement));
		const target = document.getElementById(open[(at + 1) % open.length].id);
		target?.scrollIntoView({ block: 'center', behavior: jump() });
		(target?.querySelector<HTMLElement>('input, button, a, textarea') ?? target)?.focus({ preventScroll: true });
	}
	/** The document a comment key acts on: the one whose editor has focus, else one holding a selection, else the first. */
	function activeReview(): DocReview | undefined {
		return docReviews.find((r) => r.focused) ?? docReviews.find((r) => !r.selectionEmpty) ?? docReviews[0];
	}

	/** Moves to the next or previous comment; a change walks on through its documents, wrapping at the ends. */
	function moveComment(dir: 1 | -1) {
		const start = activeReview();
		if (!start || refuseOpenBox()) return;
		if (docReviews.length === 1) {
			start.nextComment(dir);
			return;
		}
		if (start.nextComment(dir, false)) return;
		const at = docReviews.indexOf(start);
		const n = docReviews.length;
		for (let step = 1; step <= n; step++) {
			if (docReviews[(((at + dir * step) % n) + n) % n].edgeComment(dir)) return;
		}
	}

	/** Motion rule 5: a jump scrolls smoothly, unless the reader asked for reduced motion. */
	const jump = (): ScrollBehavior => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');
	// An item Undo opened again says so, once: a send-back reopens its note as it was, and any other
	// decision puts focus in the item, as opening it after a decision does. Nothing here is tracked,
	// so typing in the note never runs it again.
	$effect(() => {
		if (!restored) return;
		untrack(() => {
			desk.toast = UNDONE;
			desk.announce(UNDONE);
			if (restored.outcome === 'reject') void openNote();
			else {
				const main = document.getElementById('main');
				if (main && !main.contains(document.activeElement)) main.focus();
			}
		});
		const clear = setTimeout(() => {
			if (desk.toast === UNDONE) desk.toast = null;
		}, 3200);
		return () => {
			clearTimeout(clear);
			if (desk.toast === UNDONE) desk.toast = null;
		};
	});
	// A failed post links here, so opening the item ends the toast that named it.
	$effect(() => {
		if (held.failure?.href === `/item/${encodeURIComponent(data.meta.id)}`) held.failure = null;
	});

	$effect(() => {
		desk.page = kind;
		return () => (desk.page = 'design');
	});

	$effect(() => {
		if (isDecided) return;
		return desk.register({
			approve: kind === 'packet' ? approvePacket : docReviews.length ? approveDoc : approveCards,
			'next-call': nextCall,
			'open-note': openNote,
			'close-note': closeNote,
			'send-rejection': () => form?.requestSubmit(sendButton),
			submit: () => form?.requestSubmit(submitButton),
			...(docReviews.length && {
				comment: () => void activeReview()?.openBox(),
				'next-comment': () => moveComment(1),
				'prev-comment': () => moveComment(-1),
				'save-comment': () => void boxes.open?.saveBox(),
				'cancel-comment': () => void boxes.open?.cancelBox()
			})
		});
	});

	/** The section the reader has scrolled to on a change: a document's index, or null above the first. */
	let currentDoc = $state<number | null>(null);
	$effect(() => {
		if (!change) return;
		const track = () => {
			let cur: number | null = null;
			for (let i = 0; i < docReviews.length; i++) {
				const top = document.getElementById(`doc-${i}`)?.getBoundingClientRect().top;
				if (top !== undefined && top < 130) cur = i;
			}
			currentDoc = cur;
		};
		window.addEventListener('scroll', track, { passive: true });
		track();
		return () => window.removeEventListener('scroll', track);
	});

	/** Scrolls a section of the change into view, as the outline's links do. */
	function goSection(id: string) {
		const el = document.getElementById(id);
		el?.scrollIntoView({ block: 'start', behavior: jump() });
		const h = el?.querySelector<HTMLElement>('h2');
		if (h) {
			h.tabIndex = -1;
			h.focus({ preventScroll: true });
		}
	}

	/**
	 * The open item's outline, which the rail shows under the item: a blueprint's or page's headings,
	 * numbered, each marked when it holds an open call or correction; a change's documents and its code.
	 */
	const outlineEntries = $derived.by((): OutlineEntry[] => {
		if (review) {
			let x = 0;
			let y = 0;
			const hs = review.headings;
			return hs.map((h, i) => {
				if (h.level === 2) {
					x++;
					y = 0;
				} else y++;
				const end = hs[i + 1]?.pos ?? Infinity;
				const open = review.notes.filter((n) => {
					const at = review.starts[n.id];
					return at !== null && at !== undefined && at >= h.pos && at < end && review.decided[n.id] === undefined && !review.resolved.includes(n.id);
				});
				const n = h.level === 2 || x === 0 ? String(x) : `${x}.${y}`;
				return {
					key: `h${h.pos}`,
					n,
					text: h.text.replaceAll('`', ''),
					level: h.level,
					href: `#section-${n}`,
					cur: review.current === h.pos,
					mark: open.some((o) => o.kind !== 'info') ? 'call' : open.length ? 'fix' : null,
					go: () => review.jumpToPos(h.pos)
				};
			});
		}
		if (change) {
			const docs = change.docs.map((d, i): OutlineEntry => ({
				key: d.path,
				n: String(i + 1),
				text: d.path.split('/').pop() ?? d.path,
				level: 2,
				href: `#doc-${i}`,
				cur: currentDoc === i,
				mark: docReviews[i].openCalls.length ? 'call' : null,
				go: () => goSection(`doc-${i}`)
			}));
			return [...docs, { key: 'code', n: String(docs.length + 1), text: 'Code changes', level: 2, href: '#code', cur: false, mark: null, go: () => goSection('code') }];
		}
		return [];
	});
	$effect(() => {
		desk.outline = docReviews.length ? outlineEntries : null;
	});
	$effect(() => () => (desk.outline = null));

	/** What the place bar names: the heading or document the reader is in, else the item. */
	const placeWhere = $derived.by(() => {
		if (review && review.current !== null) return review.headings.find((h) => h.pos === review.current)?.text.replaceAll('`', '') ?? '';
		if (change && currentDoc !== null) return change.docs[currentDoc].path.split('/').pop() ?? '';
		return data.meta.headline ?? data.meta.title;
	});
	const hasCalls = $derived(docReviews.some((r) => r.calls.length > 0));

	let tocOpen = $state(false);
	let tocButton = $state<HTMLButtonElement>();
	async function toggleToc() {
		tocOpen = !tocOpen;
		if (!tocOpen) return;
		await tick();
		document.querySelector<HTMLElement>('#toc a')?.focus();
	}
	function closeToc(e: MouseEvent) {
		if (tocOpen && e.target instanceof Element && !e.target.closest('.toc-wrap')) tocOpen = false;
	}
	function tocKey(e: KeyboardEvent) {
		if (e.key !== 'Escape') return;
		e.preventDefault();
		tocOpen = false;
		tocButton?.focus();
	}
	/** Opens the comment drawer of the document the reader is in. */
	function openComments(from: HTMLElement) {
		const r = docReviews[currentDoc ?? 0] ?? docReviews[0];
		void setDrawer('pane', true, from, r.margin);
	}

	// Only the panel going, on opening another item, closes the note.
	$effect(() => () => (desk.noteOpen = false));

	// Its own effect: a pick must not re-run the handler registration.
	$effect(() => {
		desk.approveLocked = data.kind === 'packet' ? openAsks.length > 0 : docReviews.length ? openCalls.length > 0 : decided.locked;
		return () => (desk.approveLocked = false);
	});

	// Keep a focused control clear of the bar and the toast above it.
	$effect(() => {
		const bar = document.getElementById('decision');
		if (!bar) return;
		const setPad = () => document.documentElement.style.setProperty('--desk-bar-pad', `${bar.offsetHeight + 72}px`);
		setPad();
		const observer = new ResizeObserver(setPad);
		observer.observe(bar);
		return () => {
			observer.disconnect();
			document.documentElement.style.removeProperty('--desk-bar-pad');
		};
	});

	const STILL_SAVING = 'Your edits are still saving, so this item stays open until they land.';
	/** Where the reader goes once the save that held a navigation lands; null while none is held. */
	let leaveAfterSave: (() => void) | null = null;

	beforeNavigate((navigation) => {
		// A comment box holding text would be dropped unsaved, so leaving waits until it is saved or cancelled.
		if (boxes.open && docReviews.includes(boxes.open) && boxes.open.box?.text.trim()) {
			navigation.cancel();
			if (!navigation.willUnload) refuseOpenBox();
			return;
		}
		if (!review?.pending) return;
		// A closing tab cannot wait for the save, so the browser asks first.
		navigation.cancel();
		if (navigation.willUnload || !navigation.to) return;
		const to = navigation.to.url;
		// The cancel put a Back or Forward back in place, so the same step is taken again, not a new entry.
		const delta = navigation.type === 'popstate' ? navigation.delta : 0;
		const waiting = leaveAfterSave !== null;
		// A second press while the save runs only changes where the reader goes once it lands.
		leaveAfterSave = () => (delta ? history.go(delta) : void goto(to));
		if (waiting) return;
		const stalled = setTimeout(() => {
			desk.toast = STILL_SAVING;
			desk.announce(STILL_SAVING);
		}, 3000);
		void review.flush().then(() => {
			clearTimeout(stalled);
			if (desk.toast === STILL_SAVING) desk.toast = null;
			const leave = leaveAfterSave;
			leaveAfterSave = null;
			if (review.saveFailed) desk.announce(`${review.saveStatus}. You are still on this item.`);
			else leave?.();
		});
	});

	/** Approve on a packet: a locked press moves to the first open ask, an irreversible packet asks once more. */
	async function approvePacket() {
		if (confirmDialog?.open) return;
		if (openAsks.length) {
			document.querySelector<HTMLElement>(`#ask-${openAsks[0].index} input[type="radio"]`)?.focus();
			return;
		}
		if (data.kind === 'packet' && data.irreversible) confirmDialog?.showModal();
		else form?.requestSubmit(approveButton);
	}

	/** Approve on a PR or design: a locked press moves to the first open card. */
	function approveCards() {
		if (decided.sendBack) return;
		if (decided.open.length) {
			const card = document.getElementById(`card-${cards.indexOf(decided.open[0])}`);
			card?.scrollIntoView({ block: 'center' });
			card?.querySelector<HTMLElement>('input[type="radio"]')?.focus();
			return;
		}
		form?.requestSubmit(approveButton);
	}

	/** Approve on a document review: a locked press moves to the next open call; otherwise the last edit saves first. */
	async function approveDoc() {
		if (refuseOpenBox()) return;
		if (openCalls.length) {
			nextCall();
			return;
		}
		for (const r of docReviews) await r.settled();
		if (review) {
			await review.flush();
			const held = heldBySave(review, 'approve');
			if (held) {
				desk.announce(held);
				return;
			}
		}
		form?.requestSubmit(approveButton);
	}

	// The last draft the note was given, so reopening it can tell an untouched one from the reader's text.
	let drafted = '';

	async function openNote() {
		if (refuseOpenBox()) return;
		if (docReviews.length) {
			const fresh = sendBackDraft(openCalls, review?.changedLines ?? 0, data.kind === 'page' ? 'page' : 'plan');
			noteText = noteStart(noteText, drafted, fresh);
			drafted = fresh;
		}
		desk.noteOpen = true;
		await tick();
		// The bar is sticky, so the note is in view as soon as it renders and focusing it needs no scroll.
		noteField?.focus({ preventScroll: true });
		noteField?.setSelectionRange(noteText.length, noteText.length);
	}

	async function closeNote() {
		desk.noteOpen = false;
		await tick();
		rejectButton?.focus();
	}

	/** The repo's name with the item's number when it has one; a design reads as its title. */
	function subject() {
		const name = data.meta.repo.split('/').pop();
		if (data.kind === 'design') return `the design ${data.meta.title}`;
		if (data.kind === 'packet') return 'the packet';
		if (data.kind === 'blueprint') return `the blueprint for ${data.page}`;
		if (data.kind === 'page') return `the page ${data.page}`;
		return data.meta.number === undefined ? name : `${name} #${data.meta.number}`;
	}

	/** "your comment" or "your three comments": Geoff's comments and replies, which go to the author. */
	const yours = (n: number) => (n === 1 ? 'your comment' : `your ${word(n)} comments`);
	const docWord = $derived(data.kind === 'page' ? 'page' : data.kind === 'change' ? 'change' : 'blueprint');

	function decisionText(action: URL) {
		const n = yourWords;
		if (action.search === '?/approve') {
			if (!n) return `Approved ${subject()}.`;
			if (data.kind === 'blueprint') return `Approved. The author applies ${yours(n)}, and then the page is drafted. The replies appear on the page review.`;
			return `Approved. ${capital(yours(n))} ${n === 1 ? 'goes' : 'go'} to the ${data.kind === 'change' ? 'change’s author' : 'author'} with your approval.`;
		}
		if (action.search === '?/reject') {
			if (n) return `Sent back with ${plural(n, 'comment')}. The author will answer ${n === 1 ? 'it' : 'them'} and queue the ${docWord} again.`;
			return noteText.trim() ? `Sent ${subject()} back with a note.` : `Sent ${subject()} back.`;
		}
		return `Submitted ${rows.length} calls.`;
	}

	// Set from a decision until the next item opens, so a second press during the flush or the
	// navigation can't hold the same item twice.
	let deciding = false;

	const decide: SubmitFunction = async ({ cancel, action, formData }) => {
		cancel();
		if (deciding || refuseOpenBox()) return;
		deciding = true;
		try {
			// A comment op on its way lands before the decision, so the decision reads it.
			for (const r of docReviews) await r.settled();
			// A send-back carries the edits too, so the last one is committed first, and the post names
			// the blob that save returned rather than the one the form rendered with.
			if (review) {
				await review.flush();
				const held = heldBySave(review, action.search === '?/reject' ? 'reject' : 'approve');
				if (held) {
					desk.announce(held);
					return;
				}
				formData.set('blob', review.blob);
			}
			const outcome = action.search === '?/approve' ? 'approve' : action.search === '?/reject' ? 'reject' : 'submit';
			// Every held item is left out, so the next one is never an item whose decision is still counting.
			const waiting = data.queue.filter((item) => item.id === data.meta.id || !held.ids.has(item.id));
			const upNext = nextItem(waiting, data.meta.id);
			const text = decisionText(action);
			held.hold({
				id: data.meta.id,
				title: data.meta.headline ?? data.meta.title,
				kind: data.kind,
				subject: subject() ?? data.meta.repo,
				href: action.href,
				form: formData,
				outcome,
				toast: text
			});
			desk.announce(`${text} ${desk.singleKeys ? 'Press z or the Undo button' : 'Press the Undo button'} to undo.`);
			await goto(upNext ? `/item/${encodeURIComponent(upNext.id)}` : '/', { replace: true });
		} finally {
			deciding = false;
		}
		// The empty state puts focus on Keep itself, so only a main that holds no focus gets it.
		const main = document.getElementById('main');
		if (main && !main.contains(document.activeElement)) main.focus();
	};
</script>

{#snippet docPlace()}
	<div class="place">
		<span class="where"><b>{placeWhere}</b></span>
		{#if openCalls.length}
			<span class="open"><button type="button" class="linkbtn next-call" onclick={nextCall}>Next call for you <kbd>F8</kbd></button></span>
		{:else if hasCalls}
			<span class="open"><span class="nothing-open">Every call made</span></span>
		{/if}
		<span class="tools">
			<span class="toc-wrap">
				<button type="button" class="linkbtn" bind:this={tocButton} aria-expanded={tocOpen} aria-controls="toc" onclick={toggleToc}>Contents</button>
				{#if tocOpen}
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions: Escape on the list closes it, as on a menu -->
					<ol class="toc" id="toc" aria-label="Contents" onkeydown={tocKey}>
						{#each outlineEntries as e (e.key)}
							<li>
								<a
									href={e.href}
									class={[e.level === 3 && 'l3', e.cur && 'cur']}
									aria-current={e.cur ? 'location' : undefined}
									onclick={(ev) => {
										ev.preventDefault();
										tocOpen = false;
										e.go();
									}}
									><span class="n">{e.n}</span><span class="t">{e.text}</span>{#if e.mark}<span
											class="mk {e.mark}"
											aria-hidden="true"
											title={e.mark === 'call' ? 'A call for you' : 'Corrected'}
										></span><span class="sr-only">{e.mark === 'call' ? ', a call for you' : ', corrected'}</span>{/if}</a
								>
							</li>
						{/each}
					</ol>
				{/if}
			</span>
			<button
				type="button"
				class="linkbtn comments-btn"
				aria-expanded={desk.paneOpen && desk.pane.startsWith('margin')}
				aria-controls={(docReviews[currentDoc ?? 0] ?? docReviews[0]).margin}
				onclick={(e) => openComments(e.currentTarget)}>Comments <span class="ncount">{cardCount}</span></button
			>
		</span>
	</div>
{/snippet}

<svelte:document onclick={closeToc} />

<Frame
	margin={docReviews.length > 0}
	where={data.meta.headline ?? data.meta.title}
	paneLabel={data.kind === 'packet'
		? 'Outline and parts'
		: data.kind === 'blueprint' || data.kind === 'page'
			? 'Outline and calls'
			: data.kind === 'change'
				? 'Calls and documents'
				: 'Calls and outline'}
>
	{#snippet header()}
		{#if packet}
			<!-- A packet stored before titles can carry a long one-sentence headline. -->
			<FrameHeader long={packet.headline.length > 90}>
				{#snippet crumb()}
					<a href="/">Board</a><span aria-hidden="true">/</span><span>Packet</span>
					{#if packet.meta.initiativeTitle}<span aria-hidden="true">/</span><span>{packet.meta.initiativeTitle}</span>{/if}
					{#if packet.irreversible}
						<span class="badge badge-sm badge-outline rule-badge tone-error gap-1"><PacketIcon name="lock" class="size-3.5" />Irreversible</span>
					{/if}
				{/snippet}
				{#snippet headline()}<Prose text={packet.headline} />{/snippet}
				{#snippet description()}
					{#each [packet.background, ...packet.summary] as paragraph, i (i)}<p><Prose text={paragraph} /></p>{/each}
				{/snippet}
			</FrameHeader>
		{:else if blueprint && review}
			<FrameHeader>
				{#snippet crumb()}
					<a href="/">Board</a><span aria-hidden="true">/</span><span>{blueprint.kind === 'page' ? 'Page' : 'Blueprint'}</span><span aria-hidden="true">/</span><span>{blueprint.meta.repo}</span>
				{/snippet}
				{#snippet headline()}
					{blueprint.kind === 'page'
						? `Approving this draft clears “${blueprint.page}” to merge.`
						: `Approving this blueprint lets drafter write “${blueprint.page}” from it.`}
				{/snippet}
				{#snippet lede()}{docLede}{/snippet}
			</FrameHeader>
		{:else if change}
			<FrameHeader>
				{#snippet crumb()}
					<a href="/">Board</a><span aria-hidden="true">/</span><span>Change</span><span aria-hidden="true">/</span><span>{change.ref}</span>
				{/snippet}
				{#snippet headline()}
					Approving this change clears its pull request to merge.
				{/snippet}
				{#snippet lede()}{changeLede}{/snippet}
			</FrameHeader>
		{:else if data.kind === 'pr' || data.kind === 'design' || data.kind === 'triage'}
			{@const item = data}
			<FrameHeader long={item.headlineHtml.length > 90}>
				{#snippet crumb()}
					<a href="/">Board</a><span aria-hidden="true">/</span>
					{#if item.kind === 'pr'}
						<span>Pull request</span><span aria-hidden="true">/</span><span>{subject()}</span>
						{#if item.link}
							<span aria-hidden="true">/</span><span>{item.link.head} → {item.link.base}</span>
							<a href={item.link.url} target="_blank" rel="noopener noreferrer">GitHub</a>
						{/if}
					{:else if item.kind === 'design'}
						<span>Design</span><span aria-hidden="true">/</span><span>{item.meta.repo.split('/').pop()}</span>
						{#if item.meta.file}<span aria-hidden="true">/</span><span>{item.meta.file}</span>{/if}
						<span aria-hidden="true">·</span><span>{item.minutes} min read</span>
					{:else}
						<span>Triage</span><span aria-hidden="true">/</span><span>{item.meta.title}</span>
					{/if}
				{/snippet}
				{#snippet headline()}{@html item.headlineHtml}{/snippet}
				{#snippet lede()}{@html item.ledeHtml}{/snippet}
			</FrameHeader>
		{/if}
	{/snippet}


	{#if packet}
		<PacketBrief data={packet} bind:verdicts decided={packet.decided} />
		<PacketAsks asks={packet.asks} bind:answers decided={packet.decided} />
		<PacketRoutine routine={packet.routine} parts={packet.parts} bind:verdicts decided={packet.decided} />
	{:else if blueprint && review}
		{#if blueprint.missing}
			<p class="bg bg-first bg-flat">The queue can no longer read <code>{blueprint.file}</code> from the worktree’s latest commit. The editor shows the copy that was queued, and you can’t edit it.</p>
		{/if}
		{#if blueprint.kind === 'page'}
			<PageView {review} file={blueprint.file} pr={blueprint.pr} place={docPlace} />
		{:else}
			<BlueprintView {review} file={blueprint.file} place={docPlace} />
		{/if}
	{:else if change}
		<ChangeView data={change} reviews={changeReviews} place={docPlace} />
	{:else if data.kind === 'pr'}
		<PrView {data} bind:picks />
	{:else if data.kind === 'design'}
		<BriefBlock whatChanges={data.whatChanges} ifYouApprove={data.ifYouApprove} worthKnowing={data.worthKnowing} />
		<DecideCards cards={data.cards} bind:picks decided={data.decided} />
		<DetailRows details={data.details} />
		<div class="mt-10"><DesignView docHtml={data.docHtml} /></div>
	{:else if data.kind === 'triage'}
		<TriageView bind:rows html={data.html} />
	{/if}

	{#snippet pane()}
		{#if packet}
			<PaneSection title="Calls for you"><PaneList items={callItems} empty="No asks in this packet." /></PaneSection>
			{#if partItems.length}<PaneSection title="Parts"><PaneList items={partItems} /></PaneSection>{/if}
			{#if yourSteps.length}<PaneSection title="Steps you run"><PaneList items={yourSteps} /></PaneSection>{/if}
			<PaneSection title="Contents" contents><PaneList numbered items={outline} /></PaneSection>
		{:else if data.kind === 'triage'}
			{@const html = data.html}
			<PaneSection title="Calls for you">
				<PaneList
					empty="Nothing proposed."
					items={rows.map((row, i) => ({
						href: `#item-${i}`,
						label: row.action,
						labelHtml: html[i]?.label,
						what: row.disposition === row.proposed ? `${TRIAGE_WORD[row.disposition]}, as proposed` : `${TRIAGE_WORD[row.disposition]}, your change`,
						dot: 'call'
					}))}
				/>
			</PaneSection>
			<PaneSection title="Contents" contents><PaneList numbered items={outline} /></PaneSection>
		{:else}
			<PaneSection title="Calls for you"><PaneList items={callItems} empty="Nothing to decide first." /></PaneSection>
			<PaneSection title="Contents" contents><PaneList numbered items={outline} /></PaneSection>
		{/if}
	{/snippet}

	{#snippet bar()}
		{#if data.decided}
			<DecisionBar>
				{#snippet status()}<p class="s1" role="status">Decided</p>{/snippet}
			</DecisionBar>
		{:else}
			<form
				id="decision-form"
				method="post"
				action={data.kind === 'triage' ? '?/submit' : undefined}
				bind:this={form}
				use:enhance={decide}
				aria-label="Decision"
			>
				{#if packet}
					<input type="hidden" name="fingerprint" value={packet.fingerprint} />
				{:else if docReviews.length}
					{#if review}<input type="hidden" name="blob" value={review.blob} />{/if}
					{#each docReviews as docReview (docReview)}
						{#each docReview.calls as call (call.id)}
							{#if docReview.decided[call.id] !== undefined}
								<input type="hidden" name="call:{call.id}" value={call.choices?.[docReview.decided[call.id]]?.label ?? ''} />
							{/if}
						{/each}
					{/each}
				{:else if data.kind === 'triage'}
					{#each rows as row, i (i)}
						<input type="hidden" name="disposition" value={row.disposition} />
						<input type="hidden" name="note" value={row.note} />
					{/each}
				{:else}
					<input type="hidden" name="cards" value={fingerprint(cards)} />
				{/if}
				<DecisionBar>
					{#snippet note()}
						{#if desk.noteOpen}
							<div class="sendback">
								<label for="note" class="lead">What should the {docReviews.length ? 'author' : 'session'} change?</label>
								<p class="muted">
									{packet
										? 'Your verdicts go with this note.'
										: review && yourWords
											? `This note goes back with ${yours(yourWords)} and your edits and decisions. A note is optional when you’ve commented.`
											: review
												? 'Your edits and decisions go with this note.'
												: change && yourWords
													? `This note goes back with ${yours(yourWords)}. A note is optional when you’ve commented.`
													: change
														? 'The change’s author reads this note and makes the edits.'
												: 'The session reads it as the reason; leave it empty to send back without one.'}
								</p>
								<textarea
									id="note"
									name="note"
									class="textarea desk-field w-full"
									bind:this={noteField}
									bind:value={noteText}
								></textarea>
								<div class="acts">
									<button type="button" class="btn" onclick={closeNote}>Cancel <kbd>Esc</kbd></button>
									<button class="btn btn-primary" formaction="?/reject" bind:this={sendButton}>
										Send back <kbd>Ctrl</kbd><kbd>Enter</kbd>
									</button>
								</div>
							</div>
						{/if}
					{/snippet}
					{#snippet reject()}
						{#if data.kind !== 'triage' && !desk.noteOpen}
							<button
								type="button"
								class={['btn', decided.sendBack && !packet ? 'btn-primary' : 'btn-outline']}
								bind:this={rejectButton} onclick={openNote}>
								Send back with note
							</button>
						{/if}
					{/snippet}
					{#snippet status()}
						{#if packet}
							<p class="s1" role="status">{packetLock}</p>
							<p class="s2">{packetSub}</p>
						{:else if docReviews.length}
							<p class="s1" role="status">
								{openCalls.length ? `Make ${plural(openCalls.length, 'call')} to approve` : 'Ready to approve'}
							</p>
							<p class="s2">
								{capital(
									[
										decidedCount ? `${word(decidedCount)} decided` : '',
										threadCount ? (unreadCount ? `${plural(unreadCount, 'reply', 'replies')} to read` : 'every reply read') : '',
										replyCount ? `${plural(replyCount, 'reply', 'replies')} from you` : '',
										commentCount ? plural(commentCount, 'comment') : '',
										review
											? review.changedLines
												? `${plural(review.changedLines, 'line')} changed`
												: 'no edits yet'
											: ''
									]
										.filter(Boolean)
										.join(', ') || 'Nothing decided yet'
								)}
							</p>
						{:else if data.kind === 'triage'}
							<p class="s1" role="status">{rows.length} calls, {changed === 0 ? 'none' : changed} changed</p>
							<p class="s2">Submit sends your calls back to the session.</p>
						{:else if decided.sendBack}
							<p class="s1" role="status">Sending back</p>
							<p class="s2">You chose to send this back to the session.</p>
						{:else if decided.open.length}
							<p class="s1" role="status">{decided.open.length} {decided.open.length === 1 ? 'decision' : 'decisions'} left</p>
							<p class="s2">
								Decide <a class="link" href="#card-{cards.indexOf(decided.open[0])}">{decided.open[0].title}</a> to unlock Approve.
							</p>
						{:else}
							<p class="s1" role="status">Ready to approve</p>
							<p class="s2">{readySub}</p>
						{/if}
					{/snippet}
					{#snippet approve()}
						{#if packet}
							<button
								type="submit"
								class="btn btn-primary bar-approve"
								formaction="?/approve"
								bind:this={approveButton}
								aria-describedby="bar-state"
								aria-disabled={openAsks.length > 0}
								onclick={(e) => {
									e.preventDefault();
									approvePacket();
								}}
							>
								Approve the packet <kbd>Ctrl</kbd><kbd>Enter</kbd>
							</button>
						{:else if docReviews.length}
							<button
								type="submit"
								class="btn btn-primary bar-approve"
								formaction="?/approve"
								bind:this={approveButton}
								aria-describedby="bar-state"
								aria-disabled={openCalls.length > 0}
								onclick={(e) => {
									e.preventDefault();
									approveDoc();
								}}
							>
								Approve the {data.kind === 'page' ? 'page' : data.kind === 'change' ? 'change' : 'blueprint'} <kbd>Ctrl</kbd><kbd>Enter</kbd>
							</button>
						{:else if data.kind === 'triage'}
							<button class="btn btn-primary" bind:this={submitButton}>
								Submit calls <kbd>Ctrl</kbd><kbd>Enter</kbd>
							</button>
						{:else if !decided.sendBack}
							<button
								type="submit"
								class="btn btn-primary bar-approve"
								formaction="?/approve"
								bind:this={approveButton}
								aria-describedby="bar-state"
								aria-disabled={decided.locked}
								onclick={(e) => {
									e.preventDefault();
									approveCards();
								}}
							>
								{data.kind === 'pr' ? 'Approve and merge' : 'Approve the design'} <kbd>Ctrl</kbd><kbd>Enter</kbd>
							</button>
						{/if}
					{/snippet}
				</DecisionBar>
			</form>
		{/if}
	{/snippet}
</Frame>

{#if data.kind === 'packet' && data.irreversible && !data.decided}
	<dialog id="confirm" class="modal" aria-labelledby="confirm-title" bind:this={confirmDialog}>
		<div class="modal-box max-w-md rounded-box border border-base-300 p-5">
			<h2 id="confirm-title" class="desk-title flex items-center gap-2 text-xl">
				<PacketIcon name="lock" class="size-5 tone-error" />This approval cannot be undone later
			</h2>
			{#if data.irreversibleSteps.length}
				<p class="mt-2 leading-relaxed">Approving lets the session run these steps, and none of them can be reverted:</p>
				<ul class="mt-1 list-disc ps-5 leading-relaxed">
					{#each data.steps.filter((step) => data.irreversibleSteps.includes(step.n)) as step (step.n)}
						<li><Prose text={step.text} /></li>
					{/each}
				</ul>
			{:else}
				<p class="mt-2 leading-relaxed">An ask in this packet is marked irreversible.</p>
			{/if}
			<p class="mt-2 text-sm desk-muted">Undo still works for 5 seconds after you confirm.</p>
			<div class="modal-action mt-4">
				<button type="button" class="btn btn-ghost" onclick={() => confirmDialog?.close()}>Cancel</button>
				<button
					type="submit"
					class="btn btn-error"
					form="decision-form"
					formaction="?/approve"
					name="irreversible"
					value="yes"
					onclick={() => confirmDialog?.close()}
				>
					Approve and run them
				</button>
			</div>
		</div>
		<form method="dialog" class="modal-backdrop"><button>Close</button></form>
	</dialog>
{/if}
