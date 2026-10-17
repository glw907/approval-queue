<!-- @component
The page skeleton: the queue in a drawer, the open item or the empty state beside it, the
shortcut sheet, the live region, and the undo toast. One `keydown` listener on the document turns
every key into a `keyAction`; the queue and the sheet act on it here, and the open item acts on
the rest through `desk.handlers`.
-->
<script lang="ts">
	import '../app.css';
	import { afterNavigate, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, tick } from 'svelte';
	import { age, SINGLES } from '#lib/board.ts';
	import { desk } from '#lib/desk.svelte.ts';
	import { keyAction } from '#lib/keys.ts';

	let { children, data } = $props();

	const KINDS = { pr: 'PR', design: 'Design', triage: 'Triage', packet: 'Packet' };
	const OUTCOMES = { approve: 'Approved', reject: 'Rejected', submit: 'Submitted' };

	let drawerOpen = $state(false);
	let sheet: HTMLDialogElement;
	let focusedId = $state<string | null>(null);
	const currentId = $derived(page.params.id);

	/** The queue by initiative, then lead repo, with every item that is not a packet under "Single items" last. */
	const sidebar = $derived.by(() => {
		const initiativeOf = (item: (typeof data.queue)[number]) =>
			item.kind !== 'packet'
				? SINGLES
				: item.initiativeTitle || (item.initiative && item.initiative !== 'none' ? item.initiative : 'No initiative');
		const groups = new Map<string, Map<string, typeof data.queue>>();
		for (const item of data.queue) {
			const repos = groups.get(initiativeOf(item)) ?? new Map<string, typeof data.queue>();
			repos.set(item.repo, [...(repos.get(item.repo) ?? []), item]);
			groups.set(initiativeOf(item), repos);
		}
		return [...groups]
			.map(([title, repos]) => ({
				title,
				repos: [...repos].sort(([a], [b]) => a.localeCompare(b))
			}))
			.sort((a, b) => Number(a.title === SINGLES) - Number(b.title === SINGLES));
	});

	onMount(() => {
		const poll = setInterval(() => invalidate('desk:queue'), 2000);
		try {
			desk.singleKeys = localStorage.getItem('desk.singleKeys') !== 'off';
		} catch {
			// The page works without storage; the switch just stays on.
		}
		return () => clearInterval(poll);
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
		if (e.defaultPrevented) return;
		// An open confirm dialog makes the page behind it inert, and Escape closes it natively.
		// The shortcut sheet is the exception: `keyAction` lets `?` close it.
		if (document.querySelector('dialog[open]:not(#keys)')) return;
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
				noteOpen: desk.noteOpen,
				approveLocked: desk.approveLocked
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
		aria-label="Show the queue"
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
			<span class="ml-2 text-sm font-semibold">Design & PR Approvals</span>
		</header>
		{@render children()}
	</div>
	<div class="drawer-side z-30">
		<label
			for="queue-toggle"
			aria-label="Close the queue"
			class="drawer-overlay"
		></label>
		<nav id="queue-nav" aria-label="Queue" class="flex min-h-full w-72 flex-col bg-base-200">
			<div class="px-4 pt-5 pb-2">
				<a href="/" data-sveltekit-replacestate class="font-semibold hover:text-primary">Design & PR Approvals</a>
				<p class="text-sm text-(--color-muted)" aria-live="polite">{data.queue.length} waiting</p>
			</div>
			{#each sidebar as group, g (group.title)}
				<section aria-labelledby="nav-{g}" class="px-2">
					<h2 id="nav-{g}" class="px-3 pt-2.5 pb-1 text-sm font-semibold">{group.title}</h2>
					<ul class="menu menu-sm w-full gap-1 p-0">
						{#each group.repos as [repo, items] (repo)}
							<li>
								<h3 class="menu-title font-mono">{repo}</h3>
								<ul>
									{#each items as item (item.id)}
										<li>
											<a
												href="/item/{item.id}"
												data-q
												class={{
													'menu-active bg-base-300 text-base-content': item.id === currentId,
													'menu-focus': item.id === focusedId
												}}
												aria-current={item.id === currentId ? 'page' : undefined}
												onfocus={() => (focusedId = item.id)}
												onblur={() => (focusedId = null)}
											>
												<div class="w-full">
													<div class="leading-snug">{item.headline ?? item.title}</div>
													<div class={['mt-0.5 flex justify-between gap-2 text-xs', item.id === currentId ? 'text-base-content/75' : 'text-(--color-muted)']}>
														<span>{item.kind === 'packet' ? KINDS[item.kind] : `${KINDS[item.kind]} · ${label(item)}`}</span>
														<span class="tabular-nums">{age(item.created)}</span>
													</div>
												</div>
											</a>
										</li>
									{/each}
								</ul>
							</li>
						{/each}
					</ul>
				</section>
			{:else}
				<p class="px-5 py-2 text-sm text-(--color-muted)">Nothing waiting.</p>
			{/each}
			{#if data.decided.length}
				<div class="px-4 py-3">
					<h2 class="text-sm font-semibold text-(--color-muted)">Decided this session</h2>
					<ul class="mt-1 text-xs">
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
			<div class="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 text-xs text-(--color-muted)">
				{#if desk.page === 'triage'}
					<span class="desk-sk">j k next and previous</span>
				{/if}
				<button type="button" class="btn btn-sm btn-ghost -ms-2" id="open-keys" onclick={toggleSheet}>
					Keyboard shortcuts <kbd class="kbd kbd-xs desk-kbd desk-sk">?</kbd>
				</button>
			</div>
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
							<td>Send back, with the note field focused</td>
						</tr>
						<tr>
							<td class="whitespace-nowrap">
								<kbd class="kbd kbd-xs desk-kbd">Ctrl</kbd> <kbd class="kbd kbd-xs desk-kbd">Enter</kbd>
							</td>
							<td>Send back with the note</td>
						</tr>
						<tr>
							<td><kbd class="kbd kbd-xs desk-kbd desk-sk">/</kbd></td>
							<td>Filter files by path (PR only)</td>
						</tr>
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
							<td>Do now, do later, or don’t do the focused row</td>
						</tr>
						<tr>
							<td class="whitespace-nowrap">
								<kbd class="kbd kbd-xs desk-kbd">Ctrl</kbd> <kbd class="kbd kbd-xs desk-kbd">Enter</kbd>
							</td>
							<td>Submit your calls</td>
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
		<div
			class={['alert border border-base-300 text-sm', desk.toastError ? 'alert-error' : 'alert-info']}
		>
			<span>{desk.toast}</span>
			{#if desk.counting}
				<button type="button" class="btn btn-sm" id="undo" onclick={() => desk.undo?.()}>
					Undo <kbd class="kbd kbd-xs desk-kbd desk-sk">z</kbd>
				</button>
			{/if}
		</div>
	</div>
{/if}
