<!-- @component
One open item: its header, its view, and the sticky decision bar. The page renders it inside a
`{#key}` on the item's id, so every per-item state here (the note, the triage rows, a failed post)
starts fresh when the next item loads.

A decision is held in the page for five seconds before the form posts: the submit function awaits
the hold, and Undo calls `cancel()` so nothing is sent. A post that fails unlocks the bar and
shows why; a post that succeeds navigates to the item the server named, replacing the history
entry so the tab stays script-closable.
-->
<script lang="ts">
	import { enhance, type SubmitFunction } from '$app/forms';
	import { beforeNavigate, goto } from '$app/navigation';
	import { tick } from 'svelte';
	import { desk } from '#lib/desk.svelte.ts';
	import { startHold } from '#lib/hold.ts';
	import { nextItem } from '#lib/queue.ts';
	import { changedCount, type Row } from '#lib/triage.ts';
	import type { PageData } from '../../routes/item/[id=id]/$types';
	import DesignView from './DesignView.svelte';
	import PrView from './PrView.svelte';
	import TriageView from './TriageView.svelte';

	let { data }: { data: PageData } = $props();

	let form = $state<HTMLFormElement>();
	let noteField = $state<HTMLTextAreaElement>();
	let approveButton = $state<HTMLButtonElement>();
	let rejectButton = $state<HTMLButtonElement>();
	let sendButton = $state<HTMLButtonElement>();
	let submitButton = $state<HTMLButtonElement>();
	let returnTo: HTMLElement | null = null;
	let hold: { cancel: () => void } | null = null;

	// The page keys this component on the item id, so the rows are read once per item.
	// svelte-ignore state_referenced_locally
	let rows = $state<Row[]>(data.kind === 'triage' ? data.rows : []);
	const changed = $derived(changedCount(rows));

	$effect(() => {
		desk.page = data.kind;
		if (!data.decided) {
			desk.handlers = {
				...desk.handlers,
				approve: () => approveButton && form?.requestSubmit(approveButton),
				'open-note': openNote,
				'close-note': closeNote,
				'send-rejection': () => form?.requestSubmit(sendButton),
				submit: () => form?.requestSubmit(submitButton),
				undo: () => desk.undo?.()
			};
		}
		return () => {
			desk.handlers = {};
			desk.noteOpen = false;
			desk.page = 'design';
		};
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

	beforeNavigate(() => {
		if (hold) desk.undo?.();
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
			return noteField?.value.trim() ? `Rejected ${subject()} with a note.` : `Rejected ${subject()}.`;
		}
		return `Submitted ${rows.length} items.`;
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
		if (!fired) {
			cancel();
			await unlock('Undone. Nothing was sent.', returnTo, null);
			return;
		}

		const done = `${text} ${where}.`;
		// The Undo button holds focus and is about to unmount, so focus moves first.
		document.getElementById('main')?.focus();
		desk.counting = false;
		desk.undo = null;
		desk.toast = done;
		desk.announce(done);
		return async ({ result }) => {
			if (result.type === 'success') {
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
			const failed = `Not sent: ${reason}`;
			desk.toastError = true;
			await unlock(failed, returnTo, failed);
		};
	};
</script>

<main id="main" tabindex="-1" class="flex-1 px-5 pt-5 pb-8 lg:px-8">
	<header class="relative isolate pb-4">
		<svg class="site-contour-texture" viewBox="0 0 400 60" preserveAspectRatio="none" aria-hidden="true">
			<path d="M160 58c40-18 70-6 110-20s80-22 130-6" />
			<path d="M160 48c40-18 70-6 110-20s80-22 130-6" />
			<path d="M160 38c40-18 70-6 110-20s80-22 130-6" />
		</svg>
		<p class="desk-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
			{#if data.kind === 'pr'}
				<span>{subject()}</span>
				{#if data.link}
					<span>{data.link.branches}</span>
					<a class="link" href={data.link.url} target="_blank" rel="noopener noreferrer">GitHub</a>
				{/if}
			{:else if data.kind === 'design'}
				<span>{data.meta.repo.split('/').pop()}</span>
				{#if data.meta.file}<span>{data.meta.file}</span>{/if}
				<span>{data.minutes} min read</span>
			{:else}
				<span class="badge badge-sm badge-outline">Triage</span>
				<span>{subject()}</span>
				<span>{rows.length} items, each with a proposed disposition</span>
			{/if}
		</p>
		<h1 class="desk-title mt-1 text-[1.6rem] leading-tight"><i class="site-benchmark"></i>{data.meta.title}</h1>
	</header>

	{#if data.kind === 'pr'}
		<PrView {data} />
	{:else if data.kind === 'design'}
		<DesignView docHtml={data.docHtml} />
	{:else}
		<TriageView bind:rows />
	{/if}
</main>

<div id="decision" class="sticky bottom-0 z-20 border-t border-base-300 bg-base-200">
	{#if data.decided}
		<p class="px-5 py-3 text-sm lg:px-8">Decided</p>
	{:else if data.kind === 'triage'}
		<form
			method="post"
			action="?/submit"
			bind:this={form}
			use:enhance={decide}
			aria-label="Decision"
			class="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 lg:px-8"
		>
			{#each rows as row, i (i)}
				<input type="hidden" name="disposition" value={row.disposition} />
				<input type="hidden" name="reason" value={row.reason} />
			{/each}
			<p class="mr-auto text-sm" role="status">
				{rows.length} items, {changed === 0 ? 'none' : changed} changed from proposed
			</p>
			<button class="btn btn-primary min-w-32" bind:this={submitButton} disabled={desk.held}>
				Submit <kbd class="kbd kbd-xs desk-kbd">Ctrl</kbd><kbd class="kbd kbd-xs desk-kbd">Enter</kbd>
			</button>
		</form>
	{:else}
		<form
			method="post"
			bind:this={form}
			use:enhance={decide}
			aria-label="Decision"
			class="px-5 py-3 lg:px-8"
		>
			{#if desk.noteOpen}
				<div class="mb-3">
					<label for="note" class="text-sm font-semibold">
						Rejection note
						<span class="desk-muted font-normal">(optional; the session reads it as the reason)</span>
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
			<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
				<div class="mr-auto min-w-0 text-sm">
					{#if data.kind === 'pr' && data.beforeMergeHtml !== null}
						<div role="alert" class="alert alert-warning alert-vertical items-start">
							<strong>Before merge</strong>
							<!-- A scrolling region takes focus so the keyboard can reach its overflow. -->
							<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
							<div class="md max-h-40 overflow-y-auto" tabindex="0" role="region" aria-label="Before merge steps">
								{@html data.beforeMergeHtml}
							</div>
						</div>
					{/if}
				</div>
				{#if desk.noteOpen}
					<div class="flex items-center gap-2">
						<button type="button" class="btn btn-ghost" disabled={desk.held} onclick={closeNote}>
							Cancel <kbd class="kbd kbd-xs desk-kbd">Esc</kbd>
						</button>
						<button
							class="btn btn-error"
							formaction="?/reject"
							bind:this={sendButton}
							disabled={desk.held}
						>
							Send rejection <kbd class="kbd kbd-xs desk-kbd">Ctrl</kbd><kbd class="kbd kbd-xs desk-kbd">Enter</kbd>
						</button>
					</div>
				{:else}
					<div class="flex items-center gap-2">
						<button
							type="button"
							class="btn btn-outline btn-error"
							bind:this={rejectButton}
							disabled={desk.held}
							onclick={openNote}
						>
							Reject <kbd class="kbd kbd-xs desk-kbd desk-sk">r</kbd>
						</button>
						<button
							class="btn btn-primary min-w-32"
							formaction="?/approve"
							bind:this={approveButton}
							disabled={desk.held}
						>
							Approve <kbd class="kbd kbd-xs desk-kbd desk-sk">a</kbd>
						</button>
					</div>
				{/if}
			</div>
		</form>
	{/if}
</div>
