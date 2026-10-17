<!-- @component
One open item: its header, its view, and the sticky decision bar. The page renders it inside a
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
	import { enhance, type SubmitFunction } from '$app/forms';
	import { beforeNavigate, goto, invalidateAll } from '$app/navigation';
	import { tick } from 'svelte';
	import { fingerprint, gate } from '#lib/cards.ts';
	import { desk } from '#lib/desk.svelte.ts';
	import { startHold } from '#lib/hold.ts';
	import { nextItem } from '#lib/queue.ts';
	import { changedCount, seedRows, type Row } from '#lib/triage.ts';
	import type { PageData } from '../../routes/item/[id=id]/$types';
	import BriefBlock from './BriefBlock.svelte';
	import DecideCards from './DecideCards.svelte';
	import DesignView from './DesignView.svelte';
	import DetailRows from './DetailRows.svelte';
	import PacketAsks from './PacketAsks.svelte';
	import PacketBrief from './PacketBrief.svelte';
	import PacketIcon from './PacketIcon.svelte';
	import PacketRoutine from './PacketRoutine.svelte';
	import PrView from './PrView.svelte';
	import Prose from './Prose.svelte';
	import TriageView from './TriageView.svelte';

	let { data }: { data: PageData } = $props();

	const BAR =
		'flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-3 rounded-box border border-base-300 bg-base-100 px-5 py-3.5 shadow-[0_8px_28px_-6px_rgb(0_0_0/0.22),0_2px_6px_-2px_rgb(0_0_0/0.10)]';
	const PACKET_BAR =
		'bar flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-3 rounded-box border border-base-300 bg-base-100 px-5 py-3.5';
	const KEY = 'kbd kbd-xs border-current/25 bg-transparent text-current opacity-85';

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
		if (openAsks.length) return 'to unlock Approve packet';
		if (data.kind !== 'packet') return '';
		const n = data.routine.length;
		return `${n} routine ${n === 1 ? 'part' : 'parts'}, ${packetChanged === 0 ? 'none' : packetChanged} changed`;
	});
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
				approve: data.kind === 'packet' ? approvePacket : () => approveButton && !approveButton.disabled && form?.requestSubmit(approveButton),
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
		desk.approveLocked = data.kind === 'packet' ? openAsks.length > 0 : decided.locked;
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

<main id="main" tabindex="-1" class="flex-1 px-5 pt-4 pb-8 lg:px-12">
	<div class={data.kind === 'packet' ? 'max-w-4xl' : 'max-w-3xl'}>
		{#if data.kind === 'packet'}
			<p class="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs tracking-wide desk-muted">
				<a class="link link-hover" href="/">Board</a><span aria-hidden="true">/</span>
				<span>{data.asks.length} {data.asks.length === 1 ? 'ask' : 'asks'}</span>
				{#if data.irreversible}
					<span class="badge badge-sm badge-outline rule-badge tone-error gap-1"><PacketIcon name="lock" class="size-3.5" />Irreversible</span>
				{/if}
			</p>
			<PacketBrief {data} />
			<div onchange={clearNote}>
				<PacketAsks asks={data.asks} bind:answers decided={data.decided} />
				<PacketRoutine routine={data.routine} parts={data.parts} bind:verdicts decided={data.decided} />
			</div>
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
	</div>
</main>

<div id="decision" class="sticky bottom-0 z-10 bg-linear-to-t from-base-100 from-60% to-transparent px-5 pt-8 pb-4 lg:px-12">
	{#if data.decided}
		<p class="max-w-3xl rounded-box border border-base-300 bg-base-100 px-5 py-3.5 text-sm">Decided</p>
	{:else if data.kind === 'triage'}
		<form
			id="decision-form"
			method="post"
			action="?/submit"
			bind:this={form}
			use:enhance={decide}
			aria-label="Decision"
			class={BAR}
		>
			{#each rows as row, i (i)}
				<input type="hidden" name="disposition" value={row.disposition} />
				<input type="hidden" name="note" value={row.note} />
			{/each}
			<div class="mr-auto flex min-w-0 items-start gap-3">
				<span class="status mt-2 bg-base-content/50" aria-hidden="true"></span>
				<div class="min-w-0" role="status">
					<p class="leading-tight font-semibold">
						{rows.length} calls, {changed === 0 ? 'none' : changed} changed
					</p>
					<p class="mt-0.5 text-sm leading-snug text-(--color-muted)">Submit sends your calls back to the session.</p>
				</div>
			</div>
			<button class="btn btn-primary" bind:this={submitButton} disabled={desk.held}>
				<svg class="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
				Submit calls <kbd class={KEY}>Ctrl</kbd><kbd class={KEY}>Enter</kbd>
			</button>
		</form>
	{:else if data.kind === 'packet'}
		<form
			id="decision-form"
			method="post"
			bind:this={form}
			use:enhance={decide}
			aria-label="Decision"
			class={PACKET_BAR}
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
			<input type="hidden" name="fingerprint" value={data.fingerprint} />
			{#if desk.noteOpen}
				<div class="basis-full">
					<label for="note" class="text-sm font-semibold">
						Note for the session
						<span class="font-normal desk-muted">(the session reads it as the reason)</span>
					</label>
					<textarea
						id="note"
						name="note"
						class="textarea desk-field mt-1 w-full max-w-[88ch] text-sm"
						rows="2"
						placeholder="What has to change before you approve"
						bind:this={noteField}
						disabled={desk.held}
					></textarea>
				</div>
			{/if}
			<div class="bar-main flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-3">
				{#if !holding && !desk.noteOpen}
					<button type="button" class="bar-reject btn btn-outline" bind:this={rejectButton} disabled={desk.held} onclick={openNote}>
						<PacketIcon name="undo" />Reject with note <kbd class={[KEY, 'desk-sk']}>R</kbd>
					</button>
				{/if}
				<div class="ms-auto flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-2">
					<div id="bar-state" role="status" class={['bar-state min-w-0 text-right', holding && 'sr-only']}>
						<p class="leading-tight font-semibold">{barNote ?? packetLock}</p>
						{#if barNote === null}
							<p class="mt-0.5 text-sm leading-snug desk-muted max-sm:hidden">{packetSub}</p>
						{:else if withdrawn}
							<p class="mt-0.5 text-sm leading-snug"><a class="link" href={withdrawn}>Open the board</a></p>
						{/if}
					</div>
					{#if desk.noteOpen}
						<button type="button" class="btn btn-ghost" disabled={desk.held} onclick={closeNote}>
							Cancel <kbd class={KEY}>Esc</kbd>
						</button>
						<button class="btn btn-primary" formaction="?/reject" bind:this={sendButton} disabled={desk.held}>
							<PacketIcon name="undo" />Send rejection <kbd class={KEY}>Ctrl</kbd><kbd class={KEY}>Enter</kbd>
						</button>
					{:else if !holding}
						<button
							type="submit"
							class="bar-approve btn btn-primary"
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
							<PacketIcon name={openAsks.length ? 'lock' : 'check'} />Approve packet
							<span class="max-sm:hidden"><kbd class={KEY}>Ctrl</kbd><kbd class={KEY}>Enter</kbd></span>
						</button>
					{/if}
				</div>
			</div>
			{#if holding}
				<div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
					<div class="min-w-0 flex-1" aria-hidden="true">
						<p class="leading-tight font-semibold">{holdPaused ? 'Paused' : `Sending in ${holdLeft} s`}</p>
						<p class="mt-0.5 text-sm desk-muted">{holdPaused ? 'Move off the bar to carry on.' : 'Point at the bar to pause.'}</p>
						<progress class="progress progress-primary mt-1.5 h-1.5 w-full max-w-sm" value={holdLeft} max="5"></progress>
					</div>
					<button type="button" class="btn" id="undo" onclick={() => desk.undo?.()}>
						<PacketIcon name="undo" />Undo <kbd class={[KEY, 'desk-sk']}>Z</kbd>
					</button>
				</div>
			{/if}
		</form>
	{:else}
		<form id="decision-form" method="post" bind:this={form} use:enhance={decide} aria-label="Decision" class={BAR}>
			<input type="hidden" name="cards" value={fingerprint(cards)} />
			{#if desk.noteOpen}
				<div class="basis-full">
					<label for="note" class="text-sm font-semibold">
						Note for the session
						<span class="font-normal text-(--color-muted)">(optional; the session reads it as the reason)</span>
					</label>
					<textarea
						id="note"
						name="note"
						class="textarea desk-field mt-1 w-full max-w-[88ch] text-sm"
						rows="3"
						placeholder="What needs to change before this can be approved"
						bind:this={noteField}
						disabled={desk.held}
					></textarea>
				</div>
			{/if}
			<div class="mr-auto flex min-w-0 items-start gap-3">
				<span class={['status mt-2', decided.locked ? 'status-warning' : 'status-success']} aria-hidden="true"></span>
				<div class="min-w-0" id="bar-state" role="status">
					{#if decided.sendBack}
						<p class="leading-tight font-semibold">Sending back</p>
						<p class="mt-0.5 text-sm leading-snug text-(--color-muted)">You chose to send this back to the session.</p>
					{:else if decided.open.length}
						<p class="leading-tight font-semibold">
							{decided.open.length} {decided.open.length === 1 ? 'decision' : 'decisions'} left
						</p>
						<p class="mt-0.5 text-sm leading-snug text-(--color-muted)">
							Decide <a class="link" href="#card-{cards.indexOf(decided.open[0])}">{decided.open[0].title}</a> to unlock Approve.
						</p>
					{:else}
						<p class="leading-tight font-semibold">Ready to approve</p>
						<p class="mt-0.5 text-sm leading-snug text-(--color-muted)">{readySub}</p>
					{/if}
				</div>
			</div>
			<div class="ms-auto flex flex-wrap gap-3">
				{#if desk.noteOpen}
					<button type="button" class="btn btn-ghost" disabled={desk.held} onclick={closeNote}>
						Cancel <kbd class={KEY}>Esc</kbd>
					</button>
					<button class="btn btn-primary" formaction="?/reject" bind:this={sendButton} disabled={desk.held}>
						{@render undoIcon()}Send back <kbd class={KEY}>Ctrl</kbd><kbd class={KEY}>Enter</kbd>
					</button>
				{:else}
					<button
						type="button"
						class={['btn', decided.sendBack ? 'btn-primary' : 'btn-outline']}
						bind:this={rejectButton}
						disabled={desk.held}
						onclick={openNote}
					>
						{@render undoIcon()}Send back <kbd class={[KEY, 'desk-sk']}>R</kbd>
					</button>
					{#if !decided.sendBack}
						<div
							class={tip && 'tooltip tooltip-top'}
							data-tip={tip}
						>
							<button
								class="btn btn-primary"
								formaction="?/approve"
								bind:this={approveButton}
								aria-describedby="bar-state"
								disabled={desk.held || !approvable}
							>
								<svg class="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
								{data.kind === 'pr' ? 'Approve and merge' : 'Approve'} <kbd class={[KEY, 'desk-sk']}>A</kbd>
							</button>
						</div>
					{/if}
				{/if}
			</div>
		</form>
	{/if}
</div>

{#snippet undoIcon()}
	<svg class="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" /></svg>
{/snippet}


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
