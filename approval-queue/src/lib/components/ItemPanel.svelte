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
	import PrView from './PrView.svelte';
	import TriageView from './TriageView.svelte';

	let { data }: { data: PageData } = $props();

	const BAR =
		'flex max-w-3xl flex-wrap items-center gap-x-4 gap-y-3 rounded-box border border-base-300 bg-base-100 px-5 py-3.5 shadow-[0_8px_28px_-6px_rgb(0_0_0/0.22),0_2px_6px_-2px_rgb(0_0_0/0.10)]';
	const KEY = 'kbd kbd-xs border-current/25 bg-transparent text-current opacity-85';

	let form = $state<HTMLFormElement>();
	let noteField = $state<HTMLTextAreaElement>();
	let approveButton = $state<HTMLButtonElement>();
	let rejectButton = $state<HTMLButtonElement>();
	let sendButton = $state<HTMLButtonElement>();
	let submitButton = $state<HTMLButtonElement>();
	let returnTo: HTMLElement | null = null;
	let hold: { cancel: () => void; flush: () => void } | null = null;
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
	const cards = $derived(data.kind === 'triage' ? [] : data.cards);
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

	$effect(() => {
		desk.page = data.kind;
		if (!data.decided) {
			desk.handlers = {
				...desk.handlers,
				approve: () => approveButton && !approveButton.disabled && form?.requestSubmit(approveButton),
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
		desk.approveLocked = decided.locked;
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
		desk.announce(message);
		await tick();
		focusTo?.focus();
	}

	const decide: SubmitFunction = async ({ cancel, action, submitter }) => {
		const text = decisionText(action);
		const upNext = nextItem(data.queue, data.meta.id);
		const where = upNext ? `Opening ${upNext.title}` : 'Closing the queue';
		returnTo = submitter;
		desk.held = true;
		desk.counting = true;
		desk.toastError = false;
		desk.toast = `${text} ${where} in 5 s.`;
		desk.announce(`${text} ${where} in 5 seconds. Press z or the Undo button to undo.`);
		await tick();
		document.getElementById('undo')?.focus();

		const fired = await new Promise<boolean>((resolve) => {
			hold = startHold(5000, {
				tick: (left) => (desk.toast = `${text} ${where} in ${left} s.`),
				fire: () => resolve(true)
			});
			desk.undo = () => {
				hold?.cancel();
				resolve(false);
			};
		});
		hold = null;
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
		desk.announce(done);
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
				await goto(next ?? '/', { replace: true, refreshAll: true });
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
			await unlock(failed, returnTo, failed);
		};
	};
</script>

<main id="main" tabindex="-1" class="flex-1 px-5 pt-4 pb-8 lg:px-12">
	<div class="max-w-3xl">
		{#if data.kind === 'pr'}
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
		{:else}
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
