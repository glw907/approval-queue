<!-- @component
The desk's page skeleton: the queue in a drawer, the open item or the empty state beside it, the
shortcut sheet, the live region, and the undo toast. One `keydown` listener on the document turns
every key into a `keyAction`; the queue and the sheet act on it here, and the open item acts on
the rest through `desk.handlers`.
-->
<script lang="ts">
	import '../app.css';
	import { afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, tick } from 'svelte';
	import { desk } from '#lib/desk.svelte.ts';
	import { keyAction } from '#lib/keys.ts';

	let { children, data } = $props();

	const KINDS = { pr: 'PR', design: 'Design', triage: 'Triage' };
	const OUTCOMES = { approve: 'Approved', reject: 'Rejected', submit: 'Submitted' };

	let drawerOpen = $state(false);
	let sheet: HTMLDialogElement;
	let focusedId = $state<string | null>(null);
	const currentId = $derived(page.params.id);

	onMount(() => {
		try {
			desk.singleKeys = localStorage.getItem('desk.singleKeys') !== 'off';
		} catch {
			// The page works without storage; the switch just stays on.
		}
	});

	$effect(() => {
		document.documentElement.classList.toggle('desk-no-sk', !desk.singleKeys);
	});

	afterNavigate(() => {
		drawerOpen = false;
	});

	function saveSingleKeys() {
		try {
			localStorage.setItem('desk.singleKeys', desk.singleKeys ? 'on' : 'off');
		} catch {
			// Storage is a convenience; the switch still holds for this page.
		}
	}

	/** "owner/repo" and an optional number, as the queue and the toast print an item. */
	function label(item: { repo: string; number?: number }) {
		const name = item.repo.split('/').pop();
		return item.number === undefined ? name : `${name} #${item.number}`;
	}

	function age(created: string) {
		const minutes = Math.max(0, Math.round((Date.now() - Date.parse(created)) / 60000));
		if (minutes < 60) return `${minutes} min`;
		if (minutes < 1440) return `${Math.round(minutes / 60)} h`;
		return `${Math.round(minutes / 1440)} d`;
	}

	function toggleSheet() {
		if (sheet.open) sheet.close();
		else {
			sheet.showModal();
			desk.sheetOpen = true;
		}
	}

	async function setDrawer(open: boolean) {
		drawerOpen = open;
		await tick();
		if (!open) {
			document.getElementById('queue-open')?.focus();
			return;
		}
		// The panel is visible only part way through DaisyUI's transition, so focus retries each frame.
		const target = () => document.querySelector<HTMLElement>('[data-q]') ?? document.getElementById('open-keys');
		const focusIn = (tries = 0) => {
			target()?.focus();
			if (document.activeElement !== target() && tries < 60) requestAnimationFrame(() => focusIn(tries + 1));
		};
		focusIn();
	}

	function moveQueue(step: number) {
		const links = [...document.querySelectorAll<HTMLAnchorElement>('[data-q]')];
		if (!links.length) return;
		const at = links.indexOf(document.activeElement as HTMLAnchorElement);
		const from = at >= 0 ? at : Math.max(links.findIndex((a) => a.hasAttribute('aria-current')), 0);
		links[Math.min(links.length - 1, Math.max(0, from + step))].focus();
	}

	function isTyping(el: HTMLElement | null) {
		if (!el) return false;
		if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
		return el instanceof HTMLInputElement && !['radio', 'checkbox', 'button', 'submit'].includes(el.type);
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && drawerOpen) {
			setDrawer(false);
			return;
		}
		const action = keyAction(
			e.key,
			{ ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey, shift: e.shiftKey },
			{
				page: desk.page,
				typing: isTyping(e.target as HTMLElement | null),
				singleKeys: desk.singleKeys,
				sheetOpen: desk.sheetOpen,
				held: desk.held,
				noteOpen: desk.noteOpen
			}
		);
		if (!action) return;
		const run =
			action === 'toggle-sheet'
				? toggleSheet
				: action === 'queue-next'
					? () => moveQueue(1)
					: action === 'queue-prev'
						? () => moveQueue(-1)
						: desk.handlers[action];
		if (!run) return;
		e.preventDefault();
		run();
	}
</script>

<svelte:document onkeydown={onKeydown} />

<div class="drawer lg:drawer-open">
	<input
		id="queue-toggle"
		type="checkbox"
		class="drawer-toggle"
		aria-label="Queue"
		tabindex="-1"
		bind:checked={drawerOpen}
		onchange={() => !drawerOpen && document.getElementById('queue-open')?.focus()}
	/>
	<div class="drawer-content flex min-h-dvh min-w-0 flex-col">
		<header class="navbar min-h-12 border-b border-base-300 bg-base-200 px-3 lg:hidden">
			<button
				type="button"
				class="btn btn-sm btn-ghost"
				id="queue-open"
				aria-controls="queue-nav"
				aria-expanded={drawerOpen}
				onclick={() => setDrawer(true)}
			>
				Queue ({data.queue.length})
			</button>
			<span class="ml-2 text-sm font-bold"><i class="site-benchmark"></i>Review desk</span>
		</header>
		{@render children()}
	</div>
	<div class="drawer-side z-30">
		<label
			for="queue-toggle"
			aria-label="Close the queue"
			class="drawer-overlay"
		></label>
		<nav
			id="queue-nav"
			aria-label="Review queue"
			class="flex min-h-full w-[19rem] flex-col border-r border-base-300 bg-base-200"
		>
			<div class="relative isolate border-b border-base-300 px-4 pt-4 pb-3">
				<svg class="site-contour-texture" viewBox="0 0 400 60" preserveAspectRatio="none" aria-hidden="true">
					<path d="M160 58c40-18 70-6 110-20s80-22 130-6" />
					<path d="M160 48c40-18 70-6 110-20s80-22 130-6" />
					<path d="M160 38c40-18 70-6 110-20s80-22 130-6" />
				</svg>
				<p class="text-[1.05rem] font-bold"><i class="site-benchmark"></i>Review desk</p>
				<p class="desk-muted mt-0.5 text-sm" aria-live="polite">
					{data.queue.length} waiting{data.queue.length ? ', oldest first' : ''}
				</p>
			</div>
			<ul class="menu desk-queue w-full gap-0.5 px-2 py-2 text-sm">
				{#each data.queue as item (item.id)}
					<li>
						<a
							href="/item/{item.id}"
							data-q
							class={{ 'menu-active': item.id === currentId, 'menu-focus': item.id === focusedId }}
							aria-current={item.id === currentId ? 'page' : undefined}
							onfocus={() => (focusedId = item.id)}
							onblur={() => (focusedId = null)}
						>
							<span class="desk-q-meta"><span class="mr-1">{KINDS[item.kind]}</span>{label(item)}</span>
							<span class="desk-q-meta tabular-nums">{age(item.created)}</span>
							<span class="desk-q-title">{item.title}</span>
						</a>
					</li>
				{:else}
					<li class="menu-disabled desk-muted px-3 py-2 text-sm">Nothing waiting.</li>
				{/each}
			</ul>
			{#if data.decided.length}
				<div class="border-t border-dashed border-(--site-rule-color) px-4 py-3">
					<h2 class="desk-muted text-sm font-semibold">Decided this session</h2>
					<ul class="mt-1 text-[0.8rem]">
						{#each data.decided as { meta, decision } (meta.id)}
							<li class="flex items-baseline justify-between gap-3 py-1">
								<span class="truncate">{KINDS[meta.kind]} {label(meta)}</span>
								<span class="shrink-0">{OUTCOMES[decision]}</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
			<div class="grow"></div>
			<div class="desk-muted flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 text-[0.8rem]">
				{#if desk.page === 'triage'}
					<span class="desk-sk">j k next and previous</span>
				{/if}
				<button type="button" class="btn btn-sm btn-ghost ml-auto" id="open-keys" onclick={toggleSheet}>
					Keyboard shortcuts <kbd class="kbd kbd-xs desk-kbd desk-sk">?</kbd>
				</button>
			</div>
			<footer class="site-collar"><span>127.0.0.1:7907</span><span>Survey</span></footer>
		</nav>
	</div>
</div>

<dialog
	id="keys"
	class="modal"
	aria-labelledby="keys-title"
	bind:this={sheet}
	onclose={() => (desk.sheetOpen = false)}
>
	<div class="modal-box max-w-xl rounded-box border border-base-300 p-5">
		<h2 id="keys-title" class="desk-title text-xl">Keyboard shortcuts</h2>
		<label
			class="mt-2 flex cursor-pointer items-center gap-3 rounded-box border border-base-300 px-3 py-2 text-sm"
		>
			<input
				type="checkbox"
				class="toggle toggle-sm toggle-primary"
				id="single-keys"
				aria-describedby="single-keys-desc"
				bind:checked={desk.singleKeys}
				onchange={saveSingleKeys}
			/>
			<span>
				<span class="font-semibold">Single-key shortcuts</span><br />
				<span class="desk-muted" id="single-keys-desc">
					Letter, number, and symbol keys act on their own. Turn off if you use speech input or type stray
					keys. Esc, arrows, and Ctrl+Enter stay on.
				</span>
			</span>
		</label>
		<div class="mt-3 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">
			<section>
				<h3 class="desk-muted mb-1 font-semibold">Anywhere</h3>
				<table class="table table-xs">
					<tbody>
						<tr><td><kbd class="kbd kbd-xs desk-kbd desk-sk">j</kbd></td><td>Next item in the queue</td></tr>
						<tr><td><kbd class="kbd kbd-xs desk-kbd desk-sk">k</kbd></td><td>Previous item in the queue</td></tr>
						<tr>
							<td><kbd class="kbd kbd-xs desk-kbd desk-sk">z</kbd></td>
							<td>Undo the last decision, until the next item loads</td>
						</tr>
						<tr><td><kbd class="kbd kbd-xs desk-kbd desk-sk">?</kbd></td><td>Show or hide this sheet</td></tr>
						<tr><td><kbd class="kbd kbd-xs desk-kbd">Esc</kbd></td><td>Close the sheet or the note</td></tr>
					</tbody>
				</table>
			</section>
			<section>
				<h3 class="desk-muted mb-1 font-semibold">PR and design</h3>
				<table class="table table-xs">
					<tbody>
						<tr><td><kbd class="kbd kbd-xs desk-kbd desk-sk">a</kbd></td><td>Approve</td></tr>
						<tr>
							<td><kbd class="kbd kbd-xs desk-kbd desk-sk">r</kbd></td>
							<td>Reject, with the note field focused</td>
						</tr>
						<tr>
							<td class="whitespace-nowrap">
								<kbd class="kbd kbd-xs desk-kbd">Ctrl</kbd> <kbd class="kbd kbd-xs desk-kbd">Enter</kbd>
							</td>
							<td>Send the rejection</td>
						</tr>
						<tr><td><kbd class="kbd kbd-xs desk-kbd desk-sk">/</kbd></td><td>Filter files by path</td></tr>
					</tbody>
				</table>
			</section>
			<section>
				<h3 class="desk-muted mb-1 font-semibold">Triage</h3>
				<table class="table table-xs">
					<tbody>
						<tr>
							<td class="whitespace-nowrap">
								<kbd class="kbd kbd-xs desk-kbd">↑</kbd> <kbd class="kbd kbd-xs desk-kbd">↓</kbd>
							</td>
							<td>Move between rows</td>
						</tr>
						<tr>
							<td class="whitespace-nowrap">
								<kbd class="kbd kbd-xs desk-kbd desk-sk">1</kbd>
								<kbd class="kbd kbd-xs desk-kbd desk-sk">2</kbd>
								<kbd class="kbd kbd-xs desk-kbd desk-sk">3</kbd>
							</td>
							<td>Now, defer, or drop the focused row</td>
						</tr>
						<tr>
							<td class="whitespace-nowrap">
								<kbd class="kbd kbd-xs desk-kbd">Ctrl</kbd> <kbd class="kbd kbd-xs desk-kbd">Enter</kbd>
							</td>
							<td>Submit every row</td>
						</tr>
					</tbody>
				</table>
			</section>
		</div>
		<div class="modal-action mt-4">
			<form method="dialog">
				<button class="btn btn-sm">Close <kbd class="kbd kbd-xs desk-kbd">Esc</kbd></button>
			</form>
		</div>
	</div>
	<form method="dialog" class="modal-backdrop"><button>Close</button></form>
</dialog>

<div class="sr-only" role="status" aria-live="polite" id="sr-status">{desk.status}</div>

{#if desk.toast !== null}
	<div class="toast toast-center bottom-24 z-40">
		<div class="alert alert-info border border-base-300 text-sm">
			<span>{desk.toast}</span>
			{#if desk.counting}
				<button type="button" class="btn btn-sm" id="undo" onclick={() => desk.undo?.()}>
					Undo <kbd class="kbd kbd-xs desk-kbd desk-sk">z</kbd>
				</button>
			{/if}
		</div>
	</div>
{/if}
