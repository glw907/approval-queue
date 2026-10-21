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

	type SheetRow = { keys: string[]; text: string; single?: boolean };
	const CTRL_ENTER = ['Ctrl', 'Enter'];
	/** The shortcut sheet: the keys that work anywhere, then the open screen's own, as its handlers bind them. */
	const sheetSections = $derived.by(() => {
		const anywhere: SheetRow[] = [
			{ keys: ['j'], text: 'Next item in the queue', single: true },
			{ keys: ['k'], text: 'Previous item in the queue', single: true },
			{ keys: ['z'], text: 'Undo the last decision, until the next item loads', single: true },
			{ keys: ['?'], text: 'Show or hide this sheet', single: true },
			{ keys: ['Esc'], text: 'Close the sheet, a panel, or the note' }
		];
		if (!currentId) return [{ title: 'Anywhere', rows: anywhere }];
		const sendBack: SheetRow = { keys: ['r'], text: 'Send back, with the note field focused', single: true };
		const approveOr = (what: string): SheetRow => ({ keys: CTRL_ENTER, text: `${what}, or send back once the note is open` });
		const screens: Record<typeof desk.page, { title: string; rows: SheetRow[] }> = {
			packet: {
				title: 'On a packet',
				rows: [{ keys: ['F8'], text: 'Next open ask' }, approveOr('Approve the packet'), sendBack]
			},
			pr: {
				title: 'On a pull request',
				rows: [
					{ keys: ['a'], text: 'Approve and merge', single: true },
					{ keys: ['F8'], text: 'Next open decision' },
					approveOr('Approve and merge'),
					sendBack,
					{ keys: ['/'], text: 'Filter files by path', single: true }
				]
			},
			design: {
				title: 'On a design',
				rows: [
					{ keys: ['a'], text: 'Approve the design', single: true },
					{ keys: ['F8'], text: 'Next open decision' },
					approveOr('Approve the design'),
					sendBack
				]
			},
			blueprint: { title: 'On a blueprint', rows: editorRows('Approve the blueprint') },
			page: { title: 'On a page', rows: editorRows('Approve the page') },
			change: {
				title: 'On a change',
				rows: [
					{ keys: ['F8'], text: 'Next call for you' },
					approveOr('Approve the change'),
					sendBack,
					{ keys: ['/'], text: 'Filter the code files by path', single: true }
				]
			},
			triage: {
				title: 'On a triage',
				rows: [
					{ keys: ['↑', '↓'], text: 'Move between rows' },
					{ keys: ['1', '2', '3'], text: 'Do now, do later, or don’t do the focused row', single: true },
					{ keys: CTRL_ENTER, text: 'Submit your calls' }
				]
			}
		};
		return [{ title: 'Anywhere', rows: anywhere }, screens[desk.page]];

		function editorRows(approve: string): SheetRow[] {
			return [
				{ keys: ['F8'], text: 'Next call for you' },
				{ keys: ['Ctrl', 'Z'], text: 'Undo' },
				{ keys: ['Ctrl', 'Shift', 'Z'], text: 'Redo' },
				{ keys: ['Ctrl', 'S'], text: 'Save now (it also saves as you pause)' },
				approveOr(approve),
				{ keys: ['?'], text: 'This list, outside the editor', single: true },
				sendBack
			];
		}
	});

	onMount(() => {
		const poll = setInterval(() => invalidate('desk:queue'), 2000);
		try {
			desk.singleKeys = localStorage.getItem('desk.singleKeys') !== 'off';
		} catch {
			// The page works without storage; the switch just stays on.
		}
		// A drawer left open across a resize would leave the page behind it inert for no reason: the
		// pane stops being a drawer at 1260px and the rail at 1024px.
		const wide = [matchMedia('(min-width: 1260px)'), matchMedia('(min-width: 1024px)')];
		for (const m of wide) m.addEventListener('change', closeDrawers);
		return () => {
			clearInterval(poll);
			for (const m of wide) m.removeEventListener('change', closeDrawers);
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
		// Escape closes the open sheet natively; the drawer under it stays for the next Escape.
		if (e.key === 'Escape' && desk.sheetOpen) return;
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
						<span title={meta.headline ?? meta.title}>{meta.headline ?? meta.title}</span>
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
			{#each sheetSections as section (section.title)}
				<section>
					<h3 class="desk-muted mb-1 font-semibold">{section.title}</h3>
					<table class="table table-xs">
						<tbody>
							{#each section.rows as row (row.text)}
								<tr>
									<td class="whitespace-nowrap">
										{#each row.keys as key, i (i)}<kbd class={['kbd kbd-xs desk-kbd', row.single && 'desk-sk', i > 0 && 'ms-1']}>{key}</kbd>{/each}
									</td>
									<td>{row.text}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</section>
			{/each}
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
	<!-- Just above the decision bar, whose height ItemPanel publishes as the pad, so the toast never covers it. -->
	<div class="toast toast-center desk-toast z-40">
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
