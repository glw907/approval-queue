<!-- @component
One open item in the three-pane frame: a switch on the item's kind picks its work, its review
pane, and the decision bar's labels, and the frame supplies the rest. The page renders it inside a
`{#key}` on the item's id, so per-item state here (the note, a failed post) starts fresh when the
next item loads. Triage calls are the exception: unsent ones are kept in `desk.drafts`, so
opening another item and coming back keeps them.

A decision is held in the page for five seconds before the form posts: the submit function awaits
the hold, and Undo calls `cancel()` so nothing is sent. Opening another item during the hold sends
the decision at once, while closing the tab undoes it, since a closing page cannot finish a post.
A post that fails unlocks the bar and shows why; a post that succeeds navigates to the item the
server named, replacing the history entry so the tab stays script-closable.

A packet holds the same way, with its Undo, countdown, and status in the bar so the hold can pause
while the pointer is over it. Its Approve uses `aria-disabled`, so a locked press still arrives and
moves focus to the first open ask. A packet whose steps cannot be undone asks for one confirmation
first, which posts as `irreversible=yes`. A withdrawn packet answers 410 with the board to offer.
-->
<script lang="ts">
	import { deserialize, enhance, type SubmitFunction } from '$app/forms';
	import { beforeNavigate, goto, invalidateAll } from '$app/navigation';
	import { tick } from 'svelte';
	import { fingerprint, gate } from '#lib/cards.ts';
	import { desk } from '#lib/desk.svelte.ts';
	import { startHold } from '#lib/hold.ts';
	import { nextItem } from '#lib/queue.ts';
	import { changedCount, seedRows, type Row } from '#lib/triage.ts';
	import { VERDICT_LOOK } from '#lib/packet-view.ts';
	import { DocReview, type SaveResult } from '#lib/editor/review.svelte.ts';
	import type { PageData } from '../../routes/item/[id=id]/$types';
	import BlueprintView from './BlueprintView.svelte';
	import BriefBlock from './BriefBlock.svelte';
	import ChangePane from './ChangePane.svelte';
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
	import ReviewPane from './ReviewPane.svelte';
	import TriageView from './TriageView.svelte';

	let { data }: { data: PageData } = $props();

	let form = $state<HTMLFormElement>();
	let noteField = $state<HTMLTextAreaElement>();
	let approveButton = $state<HTMLButtonElement>();
	let rejectButton = $state<HTMLButtonElement>();
	let sendButton = $state<HTMLButtonElement>();
	let submitButton = $state<HTMLButtonElement>();
	let confirmDialog = $state<HTMLDialogElement>();
	let returnTo: HTMLElement | null = null;
	let hold: ReturnType<typeof startHold> | null = null;
	// Set when a held decision is sent because another item is opening, so success must not navigate too.
	let leaving = false;

	// The page keys this component on the item id, so the rows are read once per item.
	// svelte-ignore state_referenced_locally
	let rows = $state<Row[]>(
		data.kind === 'triage' ? (data.decided ? data.rows : seedRows(data.rows, desk.drafts.get(data.meta.id))) : []
	);
	const changed = $derived(changedCount(rows));

	$effect(() => {
		if (data.kind !== 'triage' || data.decided) return;
		const edited = changedCount(rows) > 0 || rows.some((row) => row.note !== '');
		if (edited) desk.drafts.set(data.meta.id, $state.snapshot(rows));
		else desk.drafts.delete(data.meta.id);
	});

	// A card's pick is its choice's index; Approve unlocks once every card has one and none sends back.
	let picks = $state<Array<number | undefined>>([]);
	const cards = $derived(data.kind === 'pr' || data.kind === 'design' ? data.cards : []);
	const decided = $derived(gate(cards, picks));
	const approvable = $derived(!decided.locked);
	const tip = $derived(!approvable && decided.open.length ? `Decide ${decided.open[0].title} first` : undefined);
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
			: {}
	);
	// svelte-ignore state_referenced_locally
	let verdicts = $state<Record<string, string>>(
		data.kind === 'packet'
			? {
					...Object.fromEntries(data.routine.map((row) => [row.ref, row.verdict])),
					...(data.decision?.decision === 'approve' &&
						Object.fromEntries((data.decision.parts ?? []).map((part) => [part.ref, part.verdict])))
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
		if (openAsks.length) return 'to unlock Approve the packet';
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
	/** The packet's sections in page order; Asks carries a dot while any is open. */
	const outline = $derived.by((): PaneItem[] => {
		if (data.kind !== 'packet') return [];
		const sections: Array<Omit<PaneItem, 'n'>> = [
			{ href: '#background', label: 'Background' },
			{ href: '#if-you-approve', label: 'If you approve' },
			{ href: '#not-checked', label: 'Not checked' }
		];
		if (data.asks.length) sections.push({ href: '#asks', label: 'Asks', mark: openAsks.length ? 'call' : undefined });
		if (partRows.length) sections.push({ href: '#parts', label: 'Parts' });
		return sections.map((s, i) => ({ ...s, n: i + 1 }));
	});
	const packet = $derived(data.kind === 'packet' ? data : null);

	/** Posts a blueprint's text to the save action, which commits it in the worktree. */
	async function saveBlueprint(text: string, base: string): Promise<SaveResult> {
		const body = new FormData();
		body.set('text', text);
		body.set('base', base);
		const res = await fetch('?/save', { method: 'POST', body, headers: { 'x-sveltekit-action': 'true' } });
		const result = deserialize(await res.text());
		if (result.type === 'success') return { ok: true, blob: String(result.data?.blob ?? '') };
		if (result.type === 'failure') return { ok: false, message: String(result.data?.message ?? 'refused') };
		return { ok: false, message: result.type === 'error' ? result.error.message : 'unexpected answer' };
	}

	// The page keys this component on the item id, so the review is built once per item.
	// svelte-ignore state_referenced_locally
	const review =
		data.kind === 'blueprint' || data.kind === 'page'
			? new DocReview({ doc: data.doc, original: data.original, blob: data.blob, notes: data.notes, save: saveBlueprint })
			: null;
	// A change review shows each changed document read-only, with the lines the change edited marked.
	// svelte-ignore state_referenced_locally
	const changeReviews =
		data.kind === 'change'
			? data.docs.map((d) => {
					const r = new DocReview({
						doc: d.doc,
						original: d.original,
						blob: '',
						notes: d.notes,
						save: async () => ({ ok: false, message: 'a change review takes no edits' })
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
	const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
	const word = (n: number) => WORDS[n] ?? String(n);
	const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
	const plural = (n: number, one: string, many = `${one}s`) => `${word(n)} ${n === 1 ? one : many}`;
	/** The lede of a blueprint or page: what kind of page it is, then what the fact check and the author did. */
	const docLede = $derived.by(() => {
		if (!blueprint || !review) return '';
		const kind = blueprint.pageType ? `A ${blueprint.pageType} page` : 'A page';
		const first = `${kind}${blueprint.track ? ` on the ${blueprint.track} track` : ''}.`;
		const fixed = review.notes.filter((n) => n.kind === 'info').length;
		const disputed = review.notes.filter((n) => n.kind === 'decide').length;
		const asked = review.notes.filter((n) => n.kind === 'question').length;
		const did = [
			fixed ? `fixed ${plural(fixed, 'finding')} from the fact check` : '',
			disputed ? `disputed ${word(disputed)}` : '',
			asked ? `has ${asked === 1 ? 'a question' : `${word(asked)} questions`} for you` : ''
		].filter(Boolean);
		if (!did.length) return first;
		const list = did.length === 1 ? did[0] : `${did.slice(0, -1).join(', ')}, and ${did.at(-1)}`;
		return `${first} The author ${list}.`;
	});
	/** The change's lede: what it edits and what the code carries. */
	const changeLede = $derived.by(() => {
		if (!change) return '';
		const docs = `${plural(change.docs.length, 'document')}`;
		const code = change.totals.files ? `${plural(change.totals.files, 'code file')} (+${change.totals.adds} −${change.totals.dels})` : 'no code';
		return `${capital(docs)} edited, and ${code}. Read the documents with their notes, then the code.`;
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
		target?.scrollIntoView({ block: 'center' });
		(target?.querySelector<HTMLElement>('input, button, a, textarea') ?? target)?.focus();
	}
	// What the bar's status region says in place of the lock text: the hold, an undo, or a failed post.
	let barNote = $state<string | null>(null);
	let holding = $state(false);
	let holdLeft = $state(5);
	let holdPaused = $state(false);
	// Where a withdrawn packet's failed post offers to go.
	let withdrawn = $state<string | null>(null);

	/** An answer or a changed verdict makes an undo or failure note stale, so the bar goes back to its count. */
	function clearNote() {
		if (holding) return;
		barNote = null;
		withdrawn = null;
	}

	$effect(() => {
		desk.page = data.kind;
		if (!data.decided) {
			desk.handlers = {
				...desk.handlers,
				approve:
					data.kind === 'packet'
						? approvePacket
						: docReviews.length
							? approveDoc
							: () => approveButton && !approveButton.disabled && form?.requestSubmit(approveButton),
				'next-call': nextCall,
				'open-note': openNote,
				'close-note': closeNote,
				'send-rejection': () => form?.requestSubmit(sendButton),
				submit: () => form?.requestSubmit(submitButton),
				undo: () => desk.undo?.()
			};
		}
		return () => {
			desk.handlers = {};
			desk.page = 'design';
		};
	});

	// The queue poll hands the panel fresh `data` every two seconds and re-runs the effect above,
	// so the note closes only when the panel itself goes, on opening another item.
	$effect(() => () => (desk.noteOpen = false));

	// Its own effect: a pick must not re-run the handler registration, whose teardown clears every handler.
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

	beforeNavigate((navigation) => {
		if (!hold) return;
		if (navigation.willUnload) {
			desk.undo?.();
			return;
		}
		leaving = true;
		hold.flush();
	});

	/** Approve on a packet: a locked press moves to the first open ask, an irreversible packet asks once more. */
	async function approvePacket() {
		if (desk.held || confirmDialog?.open) return;
		if (openAsks.length) {
			document.querySelector<HTMLElement>(`#ask-${openAsks[0].index} input[type="radio"]`)?.focus();
			return;
		}
		if (data.kind === 'packet' && data.irreversible) confirmDialog?.showModal();
		else form?.requestSubmit(approveButton);
	}

	/** Approve on a document review: a locked press moves to the next open call; otherwise the last edit saves first. */
	async function approveDoc() {
		if (desk.held) return;
		if (openCalls.length) {
			nextCall();
			return;
		}
		if (review) {
			await review.flush();
			if (review.saveFailed) {
				desk.announce(`Not approved: ${review.saveStatus}`);
				return;
			}
		}
		form?.requestSubmit(approveButton);
	}

	async function openNote() {
		desk.noteOpen = true;
		await tick();
		noteField?.focus();
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
		if (data.kind === 'blueprint') return `the plan for ${data.page}`;
		if (data.kind === 'page') return `the page ${data.page}`;
		return data.meta.number === undefined ? name : `${name} #${data.meta.number}`;
	}

	function decisionText(action: URL) {
		if (action.search === '?/approve') return `Approved ${subject()}.`;
		if (action.search === '?/reject') {
			return noteField?.value.trim() ? `Sent ${subject()} back with a note.` : `Sent ${subject()} back.`;
		}
		return `Submitted ${rows.length} calls.`;
	}

	async function unlock(message: string, focusTo: HTMLElement | null, toast: string | null) {
		desk.held = false;
		desk.counting = false;
		desk.toast = toast;
		desk.undo = null;
		holding = false;
		holdPaused = false;
		if (data.kind === 'packet') barNote = message;
		else desk.announce(message);
		await tick();
		// The Approve button unmounts for the hold, so the captured submitter can be a detached node.
		(focusTo?.isConnected ? focusTo : approveButton)?.focus();
	}

	const decide: SubmitFunction = async ({ cancel, action, submitter }) => {
		// A send-back carries the edits too, so the last one is committed before the hold starts.
		if (review) await review.flush();
		const text = decisionText(action);
		const upNext = nextItem(data.queue, data.meta.id);
		const packet = data.kind === 'packet';
		const where = packet ? 'Returning to the board' : upNext ? `Opening ${upNext.title}` : 'Closing the queue';
		// The confirmation dialog closes as it submits, so focus returns to the button that opened it.
		returnTo = packet && submitter?.closest('dialog') ? (approveButton ?? null) : submitter;
		desk.held = true;
		desk.counting = true;
		desk.toastError = false;
		const undoNote = `${text} ${where} in 5 seconds. Press z or the Undo button to undo.`;
		if (packet) {
			// The bar carries the Undo, the countdown, and the status, so the pointer over it pauses the hold.
			barNote = undoNote;
			withdrawn = null;
			holding = true;
			holdLeft = 5;
			desk.toast = null;
		} else {
			desk.toast = `${text} ${where} in 5 s.`;
			desk.announce(undoNote);
		}
		await tick();
		document.getElementById('undo')?.focus();

		const fired = await new Promise<boolean>((resolve) => {
			hold = startHold(5000, {
				tick: (left) => {
					if (packet) holdLeft = left;
					else desk.toast = `${text} ${where} in ${left} s.`;
				},
				fire: () => resolve(true)
			});
			desk.undo = () => {
				hold?.cancel();
				resolve(false);
			};
		});
		hold = null;
		holding = false;
		holdPaused = false;
		// The next item is already opening, so its keys and rows must not wait on this post.
		if (leaving) desk.held = false;
		if (!fired) {
			cancel();
			await unlock('Undone. Nothing was sent.', returnTo, null);
			return;
		}

		const done = leaving ? text : `${text} ${where}.`;
		// The Undo button holds focus and is about to unmount, so focus moves first.
		document.getElementById('main')?.focus();
		desk.counting = false;
		desk.undo = null;
		desk.toast = done;
		if (packet) barNote = done;
		else desk.announce(done);
		return async ({ result }) => {
			if (result.type === 'success') {
				desk.drafts.delete(data.meta.id);
				if (leaving) {
					desk.toast = null;
					// Reopening the same item keeps the panel, so its decided state comes only from a reload.
					await invalidateAll();
					return;
				}
				const next = (result.data as { next: string | null }).next;
				// A packet's decision returns the tab to the board, not to the next item.
				await goto(packet ? '/' : (next ?? '/'), { replace: true, refreshAll: true });
				desk.held = false;
				// The empty state puts focus on Keep itself, so only a main that holds no focus gets it.
				const main = document.getElementById('main');
				if (main && !main.contains(document.activeElement)) main.focus();
				setTimeout(() => {
					if (desk.toast === done) desk.toast = null;
				}, 2000);
				return;
			}
			const reason =
				result.type === 'error' ? result.error.message : result.type === 'failure' ? result.data?.message : 'unknown';
			const failed = leaving ? `The decision on ${subject()} was not sent: ${reason}` : `Not sent: ${reason}`;
			desk.toastError = true;
			if (result.type === 'failure' && result.data?.board) withdrawn = String(result.data.board);
			await unlock(failed, returnTo, failed);
		};
	};
</script>

<Frame
	where={data.meta.headline ?? data.meta.title}
	paneLabel={data.kind === 'packet'
		? 'Outline and parts'
		: data.kind === 'blueprint' || data.kind === 'page'
			? 'Outline and calls'
			: data.kind === 'change'
				? 'Calls and documents'
				: 'Calls for you'}
>
	{#snippet header()}
		{#if packet}
			<FrameHeader long={packet.headline.length > 90}>
				{#snippet crumb()}
					<a href="/">Board</a><span aria-hidden="true">/</span><span>Packet</span>
					{#if packet.meta.initiativeTitle}<span aria-hidden="true">/</span><span>{packet.meta.initiativeTitle}</span>{/if}
					{#if packet.irreversible}
						<span class="badge badge-sm badge-outline rule-badge tone-error gap-1"><PacketIcon name="lock" class="size-3.5" />Irreversible</span>
					{/if}
				{/snippet}
				{#snippet headline()}<Prose text={packet.headline} />{/snippet}
				{#snippet lede()}<Prose text={packet.lede} />{/snippet}
			</FrameHeader>
		{:else if blueprint && review}
			<FrameHeader>
				{#snippet crumb()}
					<a href="/">Board</a><span aria-hidden="true">/</span><span>{blueprint.kind === 'page' ? 'Page' : 'Blueprint'}</span><span aria-hidden="true">/</span><span>{blueprint.meta.repo}</span>
				{/snippet}
				{#snippet headline()}
					{blueprint.kind === 'page' ? 'The draft of' : 'The plan for'}
					{blueprint.page} is ready to read, with {openCalls.length ? `${plural(openCalls.length, 'call')} for you` : 'nothing left for you'} along
					the way.
				{/snippet}
				{#snippet lede()}{docLede}{/snippet}
			</FrameHeader>
		{:else if change}
			<FrameHeader>
				{#snippet crumb()}
					<a href="/">Board</a><span aria-hidden="true">/</span><span>Change</span><span aria-hidden="true">/</span><span>{change.ref}</span>
				{/snippet}
				{#snippet headline()}
					{change.meta.title}, with {openCalls.length ? `${plural(openCalls.length, 'call')} for you` : 'nothing left for you'} along the way.
				{/snippet}
				{#snippet lede()}{changeLede}{/snippet}
			</FrameHeader>
		{/if}
	{/snippet}

	{#if packet}
		<div onchange={clearNote}>
			<PacketBrief data={packet} bind:verdicts decided={packet.decided} />
			<PacketAsks asks={packet.asks} bind:answers decided={packet.decided} />
			<PacketRoutine routine={packet.routine} parts={packet.parts} bind:verdicts decided={packet.decided} />
		</div>
	{:else if blueprint && review}
		{#if blueprint.missing}
			<p class="bg bg-first bg-flat">The worktree no longer holds {blueprint.file} at a commit, so this is the copy that was queued and takes no edits.</p>
		{/if}
		{#if blueprint.kind === 'page'}
			<PageView {review} file={blueprint.file} readonly={blueprint.decided || blueprint.missing || desk.held} pr={blueprint.pr} />
		{:else}
			<BlueprintView {review} file={blueprint.file} readonly={blueprint.decided || blueprint.missing || desk.held} />
		{/if}
	{:else if change}
		<ChangeView data={change} reviews={changeReviews} />
	{:else if data.kind === 'pr'}
		<PrView {data} bind:picks subject={subject() ?? ''} />
	{:else if data.kind === 'design'}
		<p class="mb-2 text-xs tracking-wide text-(--color-muted)">
			{data.meta.repo.split('/').pop()}{#if data.meta.file} · {data.meta.file}{/if} · {data.minutes} min read
		</p>
		<BriefBlock
			headlineHtml={data.headlineHtml}
			ledeHtml={data.ledeHtml}
			whatChanges={data.whatChanges}
			ifYouApprove={data.ifYouApprove}
			worthKnowing={data.worthKnowing}
		/>
		<DecideCards cards={data.cards} bind:picks decided={data.decided} />
		<DetailRows details={data.details} />
		<div class="mt-10"><DesignView docHtml={data.docHtml} /></div>
	{:else if data.kind === 'triage'}
		<TriageView
			bind:rows
			html={data.html}
			headlineHtml={data.headlineHtml}
			ledeHtml={data.ledeHtml}
			meta="Triage · {data.meta.title}"
		/>
	{/if}

	{#snippet pane()}
		{#if packet}
			<PaneSection title="Calls for you"><PaneList items={callItems} empty="No asks in this packet." /></PaneSection>
			{#if partItems.length}<PaneSection title="Parts"><PaneList items={partItems} /></PaneSection>{/if}
			{#if yourSteps.length}<PaneSection title="Steps you run"><PaneList items={yourSteps} /></PaneSection>{/if}
			<PaneSection title="Contents" contents><PaneList numbered items={outline} /></PaneSection>
		{:else if review}
			<ReviewPane {review} correctionsTitle="Corrected by the fact check" />
		{:else if change}
			<ChangePane reviews={changeReviews} paths={change.docs.map((d) => d.path)} hasCode={change.groups.length > 0} />
		{:else if data.kind === 'triage'}
			<PaneSection title="Calls">
				<PaneList
					empty="Nothing proposed."
					items={rows.map((row, i) => ({
						href: `#item-${i}`,
						label: row.action,
						what: TRIAGE_WORD[row.disposition],
						dot: row.disposition === row.proposed ? 'done' : 'call'
					}))}
				/>
			</PaneSection>
		{:else}
			<PaneSection title="Calls for you"><PaneList items={callItems} empty="Nothing to decide first." /></PaneSection>
		{/if}
	{/snippet}

	{#snippet bar()}
		{#if data.decided}
			<DecisionBar>
				{#snippet status()}<p class="s1">Decided</p>{/snippet}
			</DecisionBar>
		{:else}
			<form
				id="decision-form"
				method="post"
				action={data.kind === 'triage' ? '?/submit' : undefined}
				bind:this={form}
				use:enhance={decide}
				aria-label="Decision"
				onpointerenter={() => {
					if (!holding) return;
					hold?.pause();
					holdPaused = true;
				}}
				onpointerleave={() => {
					hold?.resume();
					holdPaused = false;
				}}
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
				<DecisionBar hideStatus={holding}>
					{#snippet note()}
						{#if desk.noteOpen}
							<div class="sendback">
								<label for="note" class="lead">What should the {docReviews.length ? 'author' : 'session'} change?</label>
								<p class="muted">
									{packet
										? 'Your verdicts go with this note.'
										: review
											? 'Your edits are already committed, and the author reads them with this note.'
											: change
												? 'The change’s author reads this note and makes the edits.'
												: 'The session reads it as the reason; leave it empty to send back without one.'}
								</p>
								<textarea
									id="note"
									name="note"
									class="textarea desk-field w-full"
									bind:this={noteField}
									disabled={desk.held}
								></textarea>
								<div class="acts">
									<button type="button" class="btn" disabled={desk.held} onclick={closeNote}>Cancel <kbd>Esc</kbd></button>
									<button class="btn btn-primary" formaction="?/reject" bind:this={sendButton} disabled={desk.held}>
										Send back <kbd>Ctrl</kbd><kbd>Enter</kbd>
									</button>
								</div>
							</div>
						{/if}
					{/snippet}
					{#snippet reject()}
						{#if data.kind !== 'triage' && !holding}
							<button
								type="button"
								class={['btn', decided.sendBack && !packet ? 'btn-primary' : 'btn-outline']}
								bind:this={rejectButton} disabled={desk.held} onclick={openNote}>
								Send back with note
							</button>
						{/if}
					{/snippet}
					{#snippet status()}
						{#if packet}
							<p class="s1">{barNote ?? packetLock}</p>
							{#if barNote === null}
								<p class="s2">{packetSub}</p>
							{:else if withdrawn}
								<p class="s2"><a class="link" href={withdrawn}>Open the board</a></p>
							{/if}
						{:else if docReviews.length}
							<p class="s1">
								{openCalls.length ? `Make ${plural(openCalls.length, 'call')} to approve` : 'Ready to approve'}
							</p>
							<p class="s2">
								{capital(
									[
										decidedCount ? `${word(decidedCount)} decided` : '',
										review
											? review.changedLines
												? `${review.changedLines} ${review.changedLines === 1 ? 'line' : 'lines'} changed`
												: 'no edits yet'
											: ''
									]
										.filter(Boolean)
										.join(', ') || 'Nothing decided yet'
								)}
							</p>
						{:else if data.kind === 'triage'}
							<p class="s1">{rows.length} calls, {changed === 0 ? 'none' : changed} changed</p>
							<p class="s2">Submit sends your calls back to the session.</p>
						{:else if decided.sendBack}
							<p class="s1">Sending back</p>
							<p class="s2">You chose to send this back to the session.</p>
						{:else if decided.open.length}
							<p class="s1">{decided.open.length} {decided.open.length === 1 ? 'decision' : 'decisions'} left</p>
							<p class="s2">
								Decide <a class="link" href="#card-{cards.indexOf(decided.open[0])}">{decided.open[0].title}</a> to unlock Approve.
							</p>
						{:else}
							<p class="s1">Ready to approve</p>
							<p class="s2">{readySub}</p>
						{/if}
					{/snippet}
					{#snippet hold()}
						{#if holding}
							<div class="holding">
								<div class="min-w-0 flex-1" aria-hidden="true">
									<p class="s1">{holdPaused ? 'Paused' : `Sending in ${holdLeft} s`}</p>
									<p class="s2">{holdPaused ? 'Move off the bar to carry on.' : 'Point at the bar to pause.'}</p>
									<progress class="progress progress-primary" value={holdLeft} max="5"></progress>
								</div>
								<button type="button" class="btn" id="undo" onclick={() => desk.undo?.()}>Undo <kbd class="desk-sk">Z</kbd></button>
							</div>
						{/if}
					{/snippet}
					{#snippet approve()}
						{#if holding}
							<!-- The hold block carries Undo; the approval is gone until the hold ends. -->
						{:else if packet}
							<button
								type="submit"
								class="btn btn-primary bar-approve"
								formaction="?/approve"
								bind:this={approveButton}
								aria-describedby="bar-state"
								aria-disabled={openAsks.length > 0}
								disabled={desk.held}
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
								disabled={desk.held}
								onclick={(e) => {
									e.preventDefault();
									approveDoc();
								}}
							>
								Approve the {data.kind === 'page' ? 'page' : data.kind === 'change' ? 'change' : 'plan'} <kbd>Ctrl</kbd><kbd>Enter</kbd>
							</button>
						{:else if data.kind === 'triage'}
							<button class="btn btn-primary" bind:this={submitButton} disabled={desk.held}>
								Submit calls <kbd>Ctrl</kbd><kbd>Enter</kbd>
							</button>
						{:else if !decided.sendBack}
							<div class={tip && 'tooltip tooltip-top'} data-tip={tip}>
								<button
									class="btn btn-primary"
									formaction="?/approve"
									bind:this={approveButton}
									aria-describedby="bar-state"
									disabled={desk.held || !approvable}
								>
									{data.kind === 'pr' ? 'Approve and merge' : 'Approve'} <kbd class="desk-sk">A</kbd>
								</button>
							</div>
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
