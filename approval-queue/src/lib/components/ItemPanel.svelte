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
	import { age, spokenAge } from '#lib/board.ts';
	import { fingerprint, gate } from '#lib/cards.ts';
	import { setDrawer } from '#lib/components/frame/drawers.ts';
	import { desk, type OutlineEntry } from '#lib/desk.svelte.ts';
	import { COUNTING, held, RESTORE_BLOCKED, seedFrom, UNDONE } from '#lib/held.svelte.ts';
	import { nextItem } from '#lib/queue.ts';
	import { changedCount, seedRows, type Row } from '#lib/triage.ts';
	import { VERDICT_LOOK } from '#lib/packet-view.ts';
	import type { PlacedNote } from '#lib/editor/notes.ts';
	import { boxes, DocReview, heldBySave, noteStart, refuseOpenBox, restoredDrafted, sendBackDraft, type CommentAnswer, type SaveResult } from '#lib/editor/review.svelte.ts';
	import type { PageData } from '../../routes/item/[id=id]/$types';
	import BriefBlock from './BriefBlock.svelte';
	import DecideCards from './DecideCards.svelte';
	import DesignView from './DesignView.svelte';
	import DetailRows from './DetailRows.svelte';
	import DocsView from './DocsView.svelte';
	import DecisionBar from './frame/DecisionBar.svelte';
	import Frame from './frame/Frame.svelte';
	import FrameHeader from './frame/FrameHeader.svelte';
	import PaneList, { type PaneItem } from './frame/PaneList.svelte';
	import PaneSection from './frame/PaneSection.svelte';
	import PacketAsks from './PacketAsks.svelte';
	import PacketBrief from './PacketBrief.svelte';
	import PacketIcon from './PacketIcon.svelte';
	import PacketRoutine from './PacketRoutine.svelte';
	import PacketWhatChanged from './PacketWhatChanged.svelte';
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
			if (data.whatChanged || data.sentBack) sections.push({ href: '#what-changed', label: 'What changed' });
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
	/** The repos the packet's PR and design parts live in, by name, in order of first appearance. */
	const packetRepos = $derived(
		packet ? [...new Set(packet.parts.filter((p) => p.kind !== 'step').map((p) => p.ref.split(/[#:]/)[0].split('/').pop()))].join(', ') : ''
	);
	// svelte-ignore state_referenced_locally
	const saveUrl = `/item/${encodeURIComponent(data.meta.id)}?/save`;
	// svelte-ignore state_referenced_locally
	const commentUrl = `/item/${encodeURIComponent(data.meta.id)}?/comment`;

	/** Posts one page's text to the save action, which commits that page alone in the worktree. */
	async function savePage(file: string, text: string, blob: string): Promise<SaveResult> {
		const body = new FormData();
		body.set('file', file);
		body.set('blob', blob);
		body.set('text', text);
		const res = await fetch(saveUrl, { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
		const result = deserialize(await res.text());
		if (result.type === 'success') return { ok: true, blob: String(result.data?.blob ?? '') };
		if (result.type === 'failure') return { ok: false, message: String(result.data?.message ?? 'refused') };
		return { ok: false, message: result.type === 'error' ? result.error.message : 'unexpected answer' };
	}

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
			if (!('id' in call)) continue;
			const at = notes.find((n) => n.id === call.id)?.choices?.findIndex((c) => c.label === call.choice) ?? -1;
			if (at >= 0) out[call.id] = at;
		}
		return out;
	}
	// The page keys this component on the item id, so each page's review is built once per item.
	// svelte-ignore state_referenced_locally
	const remember = data.decided ? undefined : `desk.calls.${data.meta.id}`;
	// svelte-ignore state_referenced_locally
	const docReviews: DocReview[] =
		data.kind === 'docs'
			? data.pages.map(
					(page) =>
						new DocReview({
							doc: page.doc,
							original: page.doc,
							blob: page.blob,
							notes: page.notes,
							save: (text, blob) => savePage(page.path, text, blob),
							decided: data.decided ? answeredCalls(page.notes) : undefined,
							remember: remember && `${remember}.${page.path}`,
							// A page gone from the worktree shows its queued copy and takes no edits or comments.
							readonly: page.missing,
							comments: page.comments,
							threads: page.threads,
							comment: data.decided ? undefined : postComment,
							file: page.path,
							margin: `margin-${page.path}`
						})
				)
			: [];
	const docs = $derived(data.kind === 'docs' ? data : null);
	const openCalls = $derived(docReviews.flatMap((r) => r.openCalls));
	const decidedCount = $derived(docReviews.reduce((n, r) => n + Object.keys(r.decided).length, 0));
	const changedLines = $derived(docReviews.reduce((n, r) => n + r.changedLines, 0));
	const frozen = $derived(isDecided);

	// A held or decided review takes no choices and no text edits.
	$effect(() => {
		for (const r of docReviews) {
			r.locked = frozen;
			r.commentable = !frozen && r.editable;
			r.setReadonly(frozen);
		}
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
	/** The header's status line: how the author answered the comments, then the calls still open. */
	const docLede = $derived([repliesLine, callsLine].filter(Boolean).join(' '));
	/** Moves focus to the next open call after the one holding focus, wrapping to the first. */
	let lastDoc = -1;
	function nextCall() {
		if (docReviews.length) {
			// One page at a time, starting after the last one visited.
			for (let step = 1; step <= docReviews.length; step++) {
				const at = (lastDoc + step) % docReviews.length;
				if (docReviews[at].openCalls.length) {
					lastDoc = at;
					docReviews[at].nextCall();
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

	/** Moves to the next or previous comment; a docs review walks on through its pages, wrapping at the ends. */
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
			if (restored.outcome === 'reject') {
				// Only matters when openNote refuses: the restored note is the reader's own text unless it is still the draft.
				drafted = restoredDrafted(noteText, sendBackDraft(openCalls, changedLines, 'page'));
				void openNote();
			}
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

	/** The page the reader has scrolled to: its index, or null above the first. */
	let currentDoc = $state<number | null>(null);
	$effect(() => {
		if (!docReviews.length) return;
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

	/** Scrolls a page into view, as the outline's links do. */
	function goSection(id: string) {
		const el = document.getElementById(id);
		el?.scrollIntoView({ block: 'start', behavior: jump() });
		const h = el?.querySelector<HTMLElement>('h2');
		if (h) {
			h.tabIndex = -1;
			h.focus({ preventScroll: true });
		}
	}

	/** The open item's outline, which the rail shows under the item: the pages, each marked when it holds an open call. */
	const outlineEntries = $derived.by((): OutlineEntry[] =>
		docReviews.map((r, i) => ({
			key: r.file,
			n: String(i + 1),
			text: r.file.split('/').pop() ?? r.file,
			level: 2,
			href: `#doc-${i}`,
			cur: currentDoc === i,
			mark: r.openCalls.length ? 'call' : null,
			go: () => goSection(`doc-${i}`)
		}))
	);
	$effect(() => {
		desk.outline = docReviews.length ? outlineEntries : null;
	});
	$effect(() => () => (desk.outline = null));

	/** What the place bar names: the page the reader is in, else the item. */
	const placeWhere = $derived(
		currentDoc === null ? (data.meta.headline ?? data.meta.title) : (docReviews[currentDoc].file?.split('/').pop() ?? '')
	);
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

	/** Whether an open comment box holds text that leaving would drop. */
	const holdsText = () => !!boxes.open && docReviews.includes(boxes.open) && !!boxes.open.box?.text.trim();

	// Undo's navigation was cancelled by the box above; once the box is saved or cancelled, it goes ahead.
	$effect(() => {
		if (held.restoreBlocked && !(boxes.open && docReviews.includes(boxes.open))) untrack(() => void held.resumeRestore());
	});

	beforeNavigate((navigation) => {
		// A comment box holding text would be dropped unsaved, so leaving waits until it is saved or cancelled.
		if (holdsText()) {
			navigation.cancel();
			if (!navigation.willUnload) {
				// Undo's own navigation is the one the reader needs told about: it resumes once the box closes.
				if (navigation.to && held.blockRestore(navigation.to.url.pathname)) {
					desk.flash(RESTORE_BLOCKED);
					// Undo's toast is gone by now, so focus goes to the box the reader has to finish.
					void boxes.open?.focusBox();
				} else refuseOpenBox();
			}
			return;
		}
		const unsaved = docReviews.filter((r) => r.pending);
		if (!unsaved.length) return;
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
		void Promise.all(unsaved.map((r) => r.flush())).then(() => {
			clearTimeout(stalled);
			if (desk.toast === STILL_SAVING) desk.toast = null;
			const leave = leaveAfterSave;
			leaveAfterSave = null;
			const failed = unsaved.find((r) => r.saveFailed);
			if (failed) desk.announce(`${failed.saveStatus}. You are still on this item.`);
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

	/** Approve on a docs review: a locked press moves to the next open call; otherwise the last edit saves first. */
	async function approveDoc() {
		if (refuseOpenBox()) return;
		if (docReviews.some((r) => !r.editable)) {
			desk.announce('Not approved: a page is no longer committed in its worktree. Send the review back instead.');
			return;
		}
		if (openCalls.length) {
			nextCall();
			return;
		}
		for (const r of docReviews) await r.settled();
		for (const r of docReviews) {
			await r.flush();
			const refusal = heldBySave(r, 'approve');
			if (refusal) {
				desk.announce(refusal);
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
			const fresh = sendBackDraft(openCalls, changedLines, 'page');
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
		// The opener sits in the sticky bar, inside the scroll padding, so a plain focus() scrolls the document.
		rejectButton?.focus({ preventScroll: true });
	}

	/** The repo's name with the item's number when it has one; a design reads as its title. */
	function subject() {
		const name = data.meta.repo.split('/').pop();
		if (data.kind === 'design') return `the design ${data.meta.title}`;
		if (data.kind === 'packet') return 'the packet';
		return data.meta.number === undefined ? name : `${name} #${data.meta.number}`;
	}

	/** "your comment" or "your three comments": Geoff's comments and replies, which go to the author. */
	const yours = (n: number) => (n === 1 ? 'your comment' : `your ${word(n)} comments`);

	function decisionText(action: URL) {
		const n = yourWords;
		if (action.search === '?/approve') {
			if (!n) return `Approved ${subject()}.`;
			return `Approved. ${capital(yours(n))} ${n === 1 ? 'goes' : 'go'} to the author with your approval.`;
		}
		if (action.search === '?/reject') {
			if (n) return `Sent back with ${plural(n, 'comment')}. The author will answer ${n === 1 ? 'it' : 'them'} and queue it again.`;
			return noteText.trim() ? `Sent ${subject()} back with a note.` : `Sent ${subject()} back.`;
		}
		if (action.search === '?/defer') return `Deferred ${subject()}. It waits under Deferred.`;
		return `Submitted ${rows.length} calls.`;
	}

	// Set from a decision until the next item opens, so a second press during the flush or the
	// navigation can't hold the same item twice.
	let deciding = false;

	// The custom enhance cancels the post and never calls `applyAction`: the held store posts the
	// decision later, and the form's own result would reload or redirect the item the reader has left.
	const decide: SubmitFunction = async ({ cancel, action, formData }) => {
		cancel();
		if (deciding || refuseOpenBox()) return;
		if (held.ids.has(data.meta.id)) {
			desk.announce(COUNTING);
			return;
		}
		deciding = true;
		try {
			// A comment op on its way lands before the decision, so the decision reads it.
			for (const r of docReviews) await r.settled();
			// A send-back carries the edits too, so the last one is committed first, and the post names
			// the blob that save returned rather than the one the form rendered with.
			for (const r of docReviews) {
				await r.flush();
				const refusal = heldBySave(r, action.search === '?/reject' ? 'reject' : action.search === '?/defer' ? 'defer' : 'approve');
				if (refusal) {
					desk.announce(refusal);
					return;
				}
				if (action.search !== '?/defer') formData.set(`blob:${r.file}`, r.blob);
			}
			const outcome =
				action.search === '?/approve'
					? 'approve'
					: action.search === '?/reject'
						? 'reject'
						: action.search === '?/defer'
							? 'defer'
							: 'submit';
			// Every held item is left out, so the next one is never an item whose decision is still counting.
			const waiting = data.queue.filter((item) => item.id === data.meta.id || !held.ids.has(item.id));
			const upNext = nextItem(waiting, data.meta.id);
			const text = decisionText(action);
			const accepted = held.hold({
				id: data.meta.id,
				title: data.meta.headline ?? data.meta.title,
				kind: data.kind,
				subject: subject() ?? data.meta.repo,
				href: action.href,
				form: formData,
				outcome,
				toast: text
			});
			if (!accepted) {
				desk.announce(COUNTING);
				return;
			}
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

{#snippet itemState()}
	{#if data.meta.deferred}
		<span class="badge badge-sm badge-outline rule-badge tone-warning">Deferred</span>
	{/if}
	{#if data.meta.orphaned}
		<span class="badge badge-sm badge-outline rule-badge tone-warning">No session is waiting for this.</span>
	{/if}
{/snippet}

{#snippet docPlace()}
	<div class="place">
		<span class="where"><b>{placeWhere}</b></span>
		{#if openCalls.length}
			<span class="open"><button type="button" class="btn btn-link btn-sm linkbtn next-call" aria-keyshortcuts="F8" onclick={nextCall}>Next call for you <kbd aria-hidden="true">F8</kbd></button></span>
		{:else if hasCalls}
			<span class="open"><span class="nothing-open">Every call made</span></span>
		{/if}
		<span class="tools">
			<span class="toc-wrap">
				<button type="button" class="btn btn-link btn-sm linkbtn" bind:this={tocButton} aria-expanded={tocOpen} aria-controls="toc" onclick={toggleToc}>Contents</button>
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
				class="btn btn-link btn-sm linkbtn comments-btn"
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
	paneLabel={data.kind === 'packet' ? 'Outline and parts' : 'Calls and outline'}
>
	{#snippet header()}
		{#if packet}
			<!-- A packet stored before titles can carry a long one-sentence headline. -->
			<FrameHeader
				headlineText={packet.headline}
				crumbs={[
					{ text: 'Board', href: '/' },
					{ text: 'Packet' },
					...(packet.meta.initiativeTitle ? [{ text: packet.meta.initiativeTitle }] : []),
					...(packetRepos ? [{ text: packetRepos }] : [])
				]}
			>
				{#snippet state()}
					<span>Waiting <time datetime={packet.meta.created}><span aria-hidden="true">{age(packet.meta.created)}</span><span class="sr-only">{spokenAge(packet.meta.created)}</span></time></span>
					{#if packet.revision}<span class="badge badge-sm badge-outline rule-badge tone-info">Revision {packet.revision}</span>{/if}
					{#if packet.irreversible}
						<span class="badge badge-sm badge-outline rule-badge tone-error gap-1"><PacketIcon name="lock" class="size-3.5" />Irreversible</span>
					{/if}
					{@render itemState()}
				{/snippet}
				{#snippet headline()}<Prose text={packet.headline} />{/snippet}
				{#snippet description()}
					{#each [packet.background, ...packet.summary] as paragraph, i (i)}<p><Prose text={paragraph} /></p>{/each}
				{/snippet}
			</FrameHeader>
		{:else if docs}
			{#snippet paragraphs()}
				{#each docs.description as paragraph, i (i)}<p><Prose text={paragraph} /></p>{/each}
			{/snippet}
			<FrameHeader
				headlineText={docs.meta.title}
				description={docs.description.length ? paragraphs : undefined}
				crumbs={[{ text: 'Board', href: '/' }, { text: 'Docs review' }, { text: docs.ref }]}
			>
				{#snippet state()}
					{#if docs.revision}<span class="badge badge-sm badge-outline rule-badge tone-info">Revision {docs.revision}</span>{/if}
					{#if docs.approved}<span class="badge badge-sm badge-outline rule-badge tone-info">Amends the approved version</span>{/if}
					{@render itemState()}
				{/snippet}
				{#snippet headline()}{docs.meta.title}{/snippet}
				{#snippet lede()}{docLede}{/snippet}
			</FrameHeader>
		{:else if data.kind === 'pr' || data.kind === 'design' || data.kind === 'triage'}
			{@const item = data}
			<FrameHeader
				headlineText={item.headlineHtml.replace(/<[^>]*>/g, '')}
				crumbs={[
					{ text: 'Board', href: '/' },
					...(item.kind === 'pr'
						? [{ text: 'Pull request' }, { text: subject() ?? '' }]
						: item.kind === 'design'
							? [{ text: 'Design' }, { text: item.meta.repo.split('/').pop() ?? '' }, ...(item.meta.file ? [{ text: item.meta.file }] : [])]
							: [{ text: 'Triage' }, { text: item.meta.title }])
				]}
			>
				{#snippet state()}
					{#if item.kind === 'pr' && item.link}
						<span>{item.link.head} → {item.link.base}</span>
						<a href={item.link.url} target="_blank" rel="noopener noreferrer">GitHub<span class="sr-only"> (opens in a new tab)</span></a>
					{:else if item.kind === 'design'}
						<span>{item.minutes} min read</span>
					{/if}
					{@render itemState()}
				{/snippet}
				{#snippet headline()}{@html item.headlineHtml}{/snippet}
				{#snippet lede()}{@html item.ledeHtml}{/snippet}
			</FrameHeader>
		{/if}
	{/snippet}


	{#if packet}
		{#if packet.whatChanged || packet.sentBack}<PacketWhatChanged bullets={packet.whatChanged ?? []} note={packet.sentBack?.note} />{/if}
		<PacketBrief data={packet} bind:verdicts decided={packet.decided} />
		<PacketAsks asks={packet.asks} parts={packet.parts} bind:answers decided={packet.decided} />
		<PacketRoutine routine={packet.routine} parts={packet.parts} bind:verdicts decided={packet.decided} />
	{:else if docs}
		<DocsView data={docs} reviews={docReviews} place={docPlace} />
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
					{#each docReviews as docReview (docReview)}<input type="hidden" name="blob:{docReview.file}" value={docReview.blob} />{/each}
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
							<fieldset class="sendback fieldset">
								<legend class="fieldset-legend lead">What should the {docReviews.length ? 'author' : 'session'} change?</legend>
								<p class="muted" id="note-hint">
									{packet
										? 'Your verdicts go with this note.'
										: docReviews.length && yourWords
											? `This note goes back with ${yours(yourWords)} and your edits and decisions. A note is optional when you’ve commented.`
											: docReviews.length
												? 'Your edits and decisions go with this note.'
												: 'The session reads it as the reason; leave it empty to send back without one.'}
								</p>
								<textarea
									id="note"
									name="note"
									class="textarea desk-field w-full"
									aria-label="Your note"
									aria-describedby="note-hint"
									bind:this={noteField}
									bind:value={noteText}
								></textarea>
								<div class="acts">
									<button type="button" class="btn" aria-keyshortcuts="Escape" onclick={closeNote}>Cancel <kbd aria-hidden="true">Esc</kbd></button>
									<button class="btn btn-primary" formaction="?/reject" aria-keyshortcuts="Control+Enter Meta+Enter" bind:this={sendButton}>
										Send back <kbd aria-hidden="true">Ctrl</kbd><kbd aria-hidden="true">Enter</kbd>
									</button>
								</div>
							</fieldset>
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
					{#snippet defer()}
						{#if data.canDefer && !desk.noteOpen}
							<button type="submit" class="btn btn-outline" formaction="?/defer">Defer</button>
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
										changedLines ? `${plural(changedLines, 'line')} changed` : 'no edits yet'
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
								aria-keyshortcuts="Control+Enter Meta+Enter"
								formaction="?/approve"
								bind:this={approveButton}
								aria-describedby="bar-state"
								aria-disabled={openAsks.length > 0}
								onclick={(e) => {
									e.preventDefault();
									approvePacket();
								}}
							>
								Approve the packet <kbd aria-hidden="true">Ctrl</kbd><kbd aria-hidden="true">Enter</kbd>
							</button>
						{:else if docReviews.length}
							<button
								type="submit"
								class="btn btn-primary bar-approve"
								aria-keyshortcuts="Control+Enter Meta+Enter"
								formaction="?/approve"
								bind:this={approveButton}
								aria-describedby="bar-state"
								aria-disabled={openCalls.length > 0}
								onclick={(e) => {
									e.preventDefault();
									approveDoc();
								}}
							>
								Approve the pages <kbd aria-hidden="true">Ctrl</kbd><kbd aria-hidden="true">Enter</kbd>
							</button>
						{:else if data.kind === 'triage'}
							<button class="btn btn-primary" aria-keyshortcuts="Control+Enter Meta+Enter" bind:this={submitButton}>
								Submit calls <kbd aria-hidden="true">Ctrl</kbd><kbd aria-hidden="true">Enter</kbd>
							</button>
						{:else if !decided.sendBack}
							<button
								type="submit"
								class="btn btn-primary bar-approve"
								aria-keyshortcuts={desk.singleKeys ? 'Control+Enter Meta+Enter a' : 'Control+Enter Meta+Enter'}
								formaction="?/approve"
								bind:this={approveButton}
								aria-describedby="bar-state"
								aria-disabled={decided.locked}
								onclick={(e) => {
									e.preventDefault();
									approveCards();
								}}
							>
								{data.kind === 'pr' ? 'Approve and merge' : 'Approve the design'} <kbd aria-hidden="true">Ctrl</kbd><kbd aria-hidden="true">Enter</kbd>
							</button>
						{/if}
					{/snippet}
				</DecisionBar>
			</form>
		{/if}
	{/snippet}
</Frame>

{#if data.kind === 'packet' && data.irreversible && !data.decided}
	<dialog id="confirm" class="modal" aria-labelledby="confirm-title" aria-describedby="confirm-body" bind:this={confirmDialog}>
		<div class="modal-box max-w-md rounded-box border border-base-300 p-5">
			<h2 id="confirm-title" class="desk-title flex items-center gap-2 text-xl">
				<PacketIcon name="lock" class="size-5 tone-error" />This approval cannot be undone later
			</h2>
			<div id="confirm-body">
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
			</div>
			<div class="modal-action mt-4">
				<!-- svelte-ignore a11y_autofocus: the safe choice takes focus when the dialog opens, so Enter never confirms an irreversible approval -->
				<button type="button" class="btn btn-ghost" autofocus onclick={() => confirmDialog?.close()}>Cancel</button>
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
