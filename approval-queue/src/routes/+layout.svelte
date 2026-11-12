<!-- @component
The page skeleton: the queue rail pinned left and the open screen beside it, then the shortcut
sheet, the live region, and the toast. The rail lists what waits for the reader (each waiting
packet, design, and triage list; a round's items sit under their initiative and a round heading below the rest), then the digest and history, which need no decision; it shows no
badge or count, and below 1180px it is hidden. One `keydown` listener on the document turns every
key into a `keyAction`; the rail, the drawers, the sheet, and Undo act on it here, and the open
screen acts on the rest through `desk.handlers`.

The toast shows the decision `held` is counting down, with Undo, and its clock stops once the
pointer moves over it or while focus is on it. A held or posting item leaves the waiting list at once.
-->
<script lang="ts">
	import '../app.css';
	import { afterNavigate, goto, invalidate } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { digestLine, railLine, railRounds } from '#lib/board.ts';
	import { closeDrawers } from '#lib/components/frame/drawers.ts';
	import { desk } from '#lib/desk.svelte.ts';
	import { held } from '#lib/held.svelte.ts';
	import { keyAction } from '#lib/keys.ts';

	let { children, data } = $props();

	let sheet: HTMLDialogElement;
	const currentId = $derived(page.params.id);
	const waiting = $derived(data.queue.filter((item) => !held.ids.has(item.id)));
	const rail = $derived(railRounds(waiting));
	const onPath = (path: string) => page.url.pathname === path || page.url.pathname.startsWith(`${path}/`);

	type SheetRow = { keys: string[]; text: string; single?: boolean };
	const CTRL_ENTER = ['Ctrl', 'Enter'];
	/** The shortcut sheet: the keys that work anywhere, then the open screen's own, as its handlers bind them. */
	const sheetSections = $derived.by(() => {
		const anywhere: SheetRow[] = [
			{ keys: ['j'], text: 'Next item in the queue', single: true },
			{ keys: ['k'], text: 'Previous item in the queue', single: true },
			{ keys: ['b'], text: 'Go to the board', single: true },
			{ keys: ['z'], text: 'Undo the last decision, within five seconds of it', single: true },
			{ keys: ['?'], text: 'Show or hide this sheet', single: true },
			{ keys: ['Esc'], text: 'Close the sheet, a panel, or the note' }
		];
		if (!currentId) return [{ title: 'Anywhere', rows: anywhere }];
		const sendBack: SheetRow = { keys: ['r'], text: 'Send back, with the note field focused', single: true };
		const approveOr = (what: string): SheetRow => ({ keys: CTRL_ENTER, text: `${what}, or send back once the note is open` });
		const screens: Record<typeof desk.page, { title: string; rows: SheetRow[] }> = {
			packet: {
				title: 'On a packet',
				rows: [
						{ keys: ['F8'], text: 'Next open ask' },
						{ keys: ['1', '2', '3'], text: 'Pick that option of the ask in focus', single: true },
						approveOr('Approve the packet'),
						sendBack
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
	});

	onMount(() => {
		const poll = setInterval(() => invalidate('desk:queue'), 2000);
		try {
			desk.singleKeys = localStorage.getItem('desk.singleKeys') !== 'off';
		} catch {
			// The page works without storage; the switch just stays on.
		}
		// A drawer left open across a resize would leave the page behind it inert for no reason: the
		// pane stops being a drawer at 1260px.
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

	function toggleSheet() {
		if (sheet.open) sheet.close();
		else {
			sheet.showModal();
			desk.sheetOpen = true;
		}
	}

	/**
	 * Moves focus to the next or previous queue link. On the board the rows are the list, as the
	 * prototype's `moveList` scopes it; on any other page it is the rail's entries.
	 */
	function moveQueue(step: number) {
		const links = [...document.querySelectorAll<HTMLAnchorElement>(page.url.pathname === '/' ? '#main [data-q]' : '#rail [data-q]')];
		if (!links.length) return;
		const at = links.indexOf(document.activeElement as HTMLAnchorElement);
		const from = at >= 0 ? at : links.findIndex((a) => a.hasAttribute('aria-current'));
		links[Math.min(links.length - 1, Math.max(0, from + step))].focus();
	}

	/** Picks the n-th option of the ask that holds focus; false when focus is outside an ask or it has no such option. */
	function pickChoice(n: number) {
		const radio = document.activeElement?.closest('.ask')?.querySelectorAll<HTMLInputElement>('input[type=radio]')[n - 1];
		if (!radio || radio.disabled) return false;
		radio.click();
		radio.focus();
		return true;
	}

	/** Motion rule 4: a toast that leaves on its timer fades out; one Undo ends, or any under reduced motion, goes at once. */
	const toastOut = (timed: boolean) => ({
		duration: timed && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 150 : 0
	});

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
		if (e.key === 'Escape' && desk.paneOpen) {
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
				held: held.current !== null,
				noteOpen: desk.noteOpen,
				approveLocked: desk.approveLocked
			}
		);
		if (!action) return;
		if (action.startsWith('pick-')) {
			if (pickChoice(Number(action.slice(5)))) e.preventDefault();
			return;
		}
		const run =
			action === 'toggle-sheet'
				? toggleSheet
				: action === 'queue-next'
					? () => moveQueue(1)
					: action === 'queue-prev'
						? () => moveQueue(-1)
						: action === 'board'
							? () => void goto('/', { replaceState: true })
							: action === 'undo'
								? () => void held.undo()
								: desk.handlers[action];
		if (!run) return;
		e.preventDefault();
		run();
	}
</script>

<svelte:document onkeydown={onKeydown} />
<svelte:window onpagehide={() => held.leave()} />

{#snippet entry(item: (typeof waiting)[number])}
	<li>
		<a
			href="/item/{item.id}"
			data-q
			class={[item.id === currentId && 'menu-active']}
			aria-current={item.id === currentId ? 'page' : undefined}
		>
			{item.headline ?? item.title}
			<small>{railLine(item)}</small>
			{#if item.orphaned}<small class="orphan">No session is waiting for this.</small>{/if}
		</a>
	</li>
{/snippet}

<div class="shell">
	<nav id="rail" class="rail" aria-label="Queue">
		<div class="wordmark"><i class="benchmark"></i>Approval Queue</div>
		<ul class="menu w-full">
			<li class="menu-title">Waiting for you</li>
			{#each rail.loose as item (item.id)}
				{@render entry(item)}
			{/each}
			{#each rail.groups as group, gi (group.title)}
				<li>
					<h2 class="menu-title" id="rail-group-{gi}">{group.title}</h2>
					<ul aria-labelledby="rail-group-{gi}">
						{#each group.rounds as round, ri (round.round)}
							<li>
								<h3 class="menu-title" id="rail-round-{gi}-{ri}">Round {round.round}</h3>
								<ul aria-labelledby="rail-round-{gi}-{ri}">
									{#each round.items as item (item.id)}
										{@render entry(item)}
									{/each}
								</ul>
							</li>
						{/each}
					</ul>
				</li>
			{/each}
			{#if waiting.length === 0}
				<li class="menu-disabled"><span>Nothing waiting</span></li>
			{/if}
			<li class="menu-title">No decision needed</li>
			<li>
				<a href="/digest" class={[onPath('/digest') && 'menu-active']} aria-current={onPath('/digest') ? 'page' : undefined}>
					Merged without you<small>{digestLine(data.digest)}</small>
				</a>
			</li>
			<li>
				<a href="/history" class={[onPath('/history') && 'menu-active']} aria-current={onPath('/history') ? 'page' : undefined}>
					History<small>Decided packets, with search</small>
				</a>
			</li>
		</ul>
		<button type="button" class="rail-keys btn btn-ghost btn-sm" id="open-keys" aria-keyshortcuts={desk.singleKeys ? '?' : undefined} onclick={toggleSheet}>
			Keyboard shortcuts <kbd class="desk-sk" aria-hidden="true">?</kbd>
		</button>
	</nav>

	<div class="content">
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
									<th scope="row" class="whitespace-nowrap font-normal">
										<!-- A "/" after the first key separates two chords that share their modifiers. -->
										{#each row.keys as key, i (i)}{#if key === '/' && i > 0}<span class="ms-1">/</span>{:else}<kbd class={['kbd kbd-xs desk-kbd', row.single && 'desk-sk', i > 0 && 'ms-1']}>{key}</kbd>{/if}{/each}
									</th>
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
				<button class="btn btn-sm" aria-keyshortcuts="Escape">Close <kbd class="kbd kbd-xs desk-kbd" aria-hidden="true">Esc</kbd></button>
			</form>
		</div>
	</div>
	<form method="dialog" class="modal-backdrop"><button>Close</button></form>
</dialog>

<div class="sr-only" role="status" aria-live="polite" id="sr-status">{desk.status}</div>

<!-- Just above the decision bar, whose height ItemPanel publishes as the pad, so the toast never covers it. -->
{#if held.current}
	<div
		class="toast toast-center desk-toast z-40"
		role="group"
		aria-label="Decision held"
		out:fade={toastOut(held.ended === 'sent')}
		onoutrostart={(e) => (e.currentTarget.inert = true)}
		onpointermove={(e) => {
			// Only a pointer that moves over the toast stops its clock: one that rests where an earlier
			// toast's Undo was pressed sends the toast a pointerenter without moving, and the decision
			// would never post.
			if (e.movementX || e.movementY) held.pause('pointer');
		}}
		onpointerleave={() => held.resume('pointer')}
		onfocusin={() => held.pause('focus')}
		onfocusout={() => held.resume('focus')}
	>
		<div class="alert alert-info border border-base-300 text-sm">
			<span>{held.current.toast}</span>
			<button type="button" class="btn btn-sm" id="undo" aria-keyshortcuts={desk.singleKeys ? 'z' : undefined} onclick={() => void held.undo()}>
				Undo <kbd class="kbd kbd-xs desk-kbd desk-sk" aria-hidden="true">z</kbd>
			</button>
		</div>
	</div>
{:else if held.failure}
	<div class="toast toast-center desk-toast z-40">
		<div class="alert alert-error border border-base-300 text-sm">
			<span>{held.failure.text}</span>
			<a class="link" href={held.failure.href} data-sveltekit-replacestate onclick={() => (held.failure = null)}>{held.failure.link}</a>
		</div>
	</div>
{:else if desk.toast !== null}
	<div
		class="toast toast-center desk-toast z-40"
		role="group"
		aria-label="Notice"
		{@attach () => () => desk.releaseFlash()}
		out:fade={toastOut(true)}
		onoutrostart={(e) => (e.currentTarget.inert = true)}
		onpointermove={(e) => {
			if (e.movementX || e.movementY) desk.pauseFlash('pointer');
		}}
		onpointerleave={() => desk.resumeFlash('pointer')}
		onfocusin={() => desk.pauseFlash('focus')}
		onfocusout={() => desk.resumeFlash('focus')}
	>
		<div class="alert alert-info border border-base-300 text-sm">
			<span>{desk.toast}</span>
			{#if desk.toastUndo}
				<button
					type="button"
					class="btn btn-sm"
					onclick={() => {
						// Clearing the toast drops its Undo, so the function is taken first.
						const undo = desk.toastUndo;
						desk.toast = null;
						undo?.();
					}}>Undo</button
				>
			{/if}
		</div>
	</div>
{/if}
