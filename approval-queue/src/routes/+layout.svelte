<!-- @component
The page skeleton: the queue rail pinned left and the open screen beside it, then the shortcut
sheet, the live region, and the undo toast. Below 1024px the rail is a modal drawer opened from the
app bar. One `keydown` listener on the document turns every key into a `keyAction`; the rail, the
drawers, and the sheet act on it here, and the open screen acts on the rest through `desk.handlers`.
-->
<script lang="ts">
	import '../app.css';
	import { afterNavigate, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { age, SINGLES } from '#lib/board.ts';
	import { closeDrawers, setDrawer } from '#lib/components/frame/drawers.ts';
	import { desk } from '#lib/desk.svelte.ts';
	import { keyAction } from '#lib/keys.ts';

	let { children, data } = $props();

	const KINDS = { pr: 'PR', design: 'Design', triage: 'Triage', packet: 'Packet', blueprint: 'Blueprint', page: 'Page', change: 'Change' };
	const OUTCOMES = { approve: 'Approved', reject: 'Sent back', submit: 'Submitted' };

	let sheet: HTMLDialogElement;
	let railButton = $state<HTMLButtonElement>();
	const currentId = $derived(page.params.id);

	/** The queue by initiative, with every item that is not a packet under "Single items" last. */
	const sidebar = $derived.by(() => {
		const initiativeOf = (item: (typeof data.queue)[number]) =>
			item.kind !== 'packet'
				? SINGLES
				: item.initiativeTitle || (item.initiative && item.initiative !== 'none' ? item.initiative : 'No initiative');
		const groups = new Map<string, typeof data.queue>();
		for (const item of data.queue) groups.set(initiativeOf(item), [...(groups.get(initiativeOf(item)) ?? []), item]);
		return [...groups]
			.map(([title, items]) => ({ title, items }))
			.sort((a, b) => Number(a.title === SINGLES) - Number(b.title === SINGLES));
	});

	onMount(() => {
		const poll = setInterval(() => invalidate('desk:queue'), 2000);
		try {
			desk.singleKeys = localStorage.getItem('desk.singleKeys') !== 'off';
		} catch {
			// The page works without storage; the switch just stays on.
		}
		// A drawer left open across a resize would leave the page behind it inert for no reason.
		const wide = matchMedia('(min-width: 1260px)');
		wide.addEventListener('change', closeDrawers);
		return () => {
			clearInterval(poll);
			wide.removeEventListener('change', closeDrawers);
		};
	});

	$effect(() => {
		document.documentElement.classList.toggle('desk-no-sk', !desk.singleKeys);
	});

	afterNavigate(closeDrawers);

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
		if (e.key === 'Escape' && (desk.railOpen || desk.paneOpen)) {
			closeDrawers();
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

<div class="shell">
	<nav
		id="rail"
		class={['rail', desk.railOpen && 'open']}
		aria-label="Queue"
		role={desk.railOpen ? 'dialog' : undefined}
		aria-modal={desk.railOpen ? 'true' : undefined}
	>
		<button type="button" class="drawer-x" aria-label="Close the queue" onclick={closeDrawers}>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
		</button>
		<div class="title"><a href="/" data-sveltekit-replacestate>Design &amp; PR Approvals</a></div>
		<div class="sub" aria-live="polite">{data.queue.length} waiting</div>
		{#each sidebar as group, g (group.title)}
			<h2 class="group" id="nav-{g}">{group.title}</h2>
			<ul class="rail-list" aria-labelledby="nav-{g}">
				{#each group.items as item (item.id)}
					<li>
						<a
							href="/item/{item.id}"
							data-q
							class={['q', item.id === currentId && 'on']}
							aria-current={item.id === currentId ? 'page' : undefined}
						>
							<span>{item.headline ?? item.title}</span>
							<span class="meta">
								<span>{item.kind === 'packet' ? KINDS[item.kind] : `${KINDS[item.kind]} · ${label(item)}`}</span>
								<span class="tabular-nums">{age(item.created)}</span>
							</span>
						</a>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="dq">Nothing waiting.</p>
		{/each}
		{#if data.decided.length}
			<h2 class="group">Decided this session</h2>
			<ul class="rail-list">
				{#each data.decided as { meta, decision } (meta.id)}
					<li class="dq">
						<span title={meta.headline ?? meta.title}>{meta.headline ?? `${KINDS[meta.kind]} ${label(meta)}`}</span>
						<span>{OUTCOMES[decision]}</span>
					</li>
				{/each}
			</ul>
		{/if}
		{#if desk.page === 'triage'}
			<p class="dq desk-sk">j k next and previous</p>
		{/if}
		<button type="button" class="rail-keys" id="open-keys" onclick={toggleSheet}>
			Keyboard shortcuts <kbd class="desk-sk">?</kbd>
		</button>
	</nav>

	<div class="content">
		<div class="appbar">
			<button
				type="button"
				class="appbtn"
				id="queue-open"
				bind:this={railButton}
				aria-controls="rail"
				aria-expanded={desk.railOpen}
				onclick={() => setDrawer('rail', true, railButton)}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
				<span>Queue</span><span class="count">{data.queue.length}</span>
			</button>
			<span class="appname">Design &amp; PR Approvals</span>
		</div>
		{@render children()}
	</div>
</div>

<div class="scrim" hidden={!desk.railOpen && !desk.paneOpen} role="presentation" onclick={closeDrawers}></div>

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
						<tr><td><kbd class="kbd kbd-xs desk-kbd">F8</kbd></td><td>Next open call</td></tr>
						<tr><td><kbd class="kbd kbd-xs desk-kbd">Esc</kbd></td><td>Close the sheet, a panel, or the note</td></tr>
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
