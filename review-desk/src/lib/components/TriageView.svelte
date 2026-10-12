<!-- @component
A triage item: Now, Defer, and Drop sections whose rows move by key (`1`, `2`, `3`) or by a "Move to"
menu, with focus following the moved row. A reason edits in place. The rows are bound to
`ItemPanel`, which submits them; nothing here posts.

The rows' order never changes, so an item number is its position. A section lists its rows in
that order, and a moved row shows "was X" until it returns to the proposal.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { desk } from '#lib/desk.svelte.ts';
	import { groupRows, moveRow, type Disposition, type Row } from '#lib/triage.ts';

	let { rows = $bindable() }: { rows: Row[] } = $props();

	const SECTIONS = [
		{ key: 'now', label: 'Now' },
		{ key: 'defer', label: 'Defer' },
		{ key: 'drop', label: 'Drop' }
	] as const;
	const LABEL: Record<Disposition, string> = { now: 'Now', defer: 'Defer', drop: 'Drop' };

	const groups = $derived(groupRows(rows));
	/** The row that holds the roving tabindex. */
	let current = $state(0);
	let menuOpen = $state<number | null>(null);
	let editing = $state<number | null>(null);
	let original = '';

	$effect(() => {
		desk.handlers = {
			...desk.handlers,
			'row-next': () => stepRow(1),
			'row-prev': () => stepRow(-1),
			'move-now': () => moveFocused('now'),
			'move-defer': () => moveFocused('defer'),
			'move-drop': () => moveFocused('drop')
		};
	});

	const rowEl = (index: number) => document.querySelector<HTMLElement>(`[data-row="${index}"]`);

	function focusRow(el: HTMLElement | null | undefined) {
		if (!el) return;
		current = Number(el.dataset.row);
		el.focus();
		el.scrollIntoView({ block: 'nearest' });
	}

	/** Steps through the rows in the order they sit on the page: Now, then Defer, then Drop. */
	function stepRow(step: number) {
		const els = [...document.querySelectorAll<HTMLElement>('[data-row]')];
		const at = els.findIndex((el) => el.contains(document.activeElement));
		focusRow(els[at < 0 ? 0 : Math.min(els.length - 1, Math.max(0, at + step))]);
	}

	function moveFocused(disposition: Disposition) {
		const el = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-row]');
		if (el) moveTo(Number(el.dataset.row), disposition);
	}

	async function moveTo(index: number, disposition: Disposition) {
		if (rows[index].disposition !== disposition) {
			rows = moveRow(rows, index, disposition);
			desk.announce(
				`Item ${index + 1} moved to ${LABEL[disposition]}. ${LABEL[disposition]} has ${groups[disposition].length} items.`
			);
		}
		await tick();
		focusRow(rowEl(index));
	}

	async function startEdit(index: number) {
		original = rows[index].reason;
		editing = index;
		await tick();
		const input = document.querySelector<HTMLInputElement>(`[data-reason-input="${index}"]`);
		input?.focus();
		input?.select();
	}

	/** Ends the edit, keeping what was typed; the input is bound, so the text is already in the row. */
	async function endEdit(index: number, refocus: boolean) {
		if (editing !== index) return;
		editing = null;
		if (!refocus) return;
		await tick();
		document.querySelector<HTMLElement>(`[data-edit="${index}"]`)?.focus();
	}

	function onReasonKey(e: KeyboardEvent, index: number) {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			endEdit(index, false);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			endEdit(index, true);
		} else if (e.key === 'Escape') {
			e.stopPropagation();
			rows[index].reason = original;
			endEdit(index, true);
		}
	}

	/** Places the menu under its trigger, flipped above it near the decision bar, and focuses the checked item. */
	async function onMenuToggle(e: ToggleEvent, index: number) {
		const menu = e.currentTarget as HTMLElement;
		if (e.newState !== 'open') {
			if (menuOpen === index) menuOpen = null;
			return;
		}
		menuOpen = index;
		const trigger = document.querySelector<HTMLElement>(`[data-trigger="${index}"]`)!.getBoundingClientRect();
		const box = menu.getBoundingClientRect();
		const bar = document.getElementById('decision')?.getBoundingClientRect().top ?? innerHeight;
		let top = trigger.bottom + 4;
		if (top + box.height > bar - 8) top = trigger.top - box.height - 4;
		const left = Math.min(innerWidth - box.width - 8, Math.max(8, trigger.right - box.width));
		menu.style.top = `${Math.max(8, top)}px`;
		menu.style.left = `${left}px`;
		menu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
	}

	function closeMenu(index: number, focusTrigger: boolean) {
		document.getElementById(`mc-${index}`)?.hidePopover();
		if (focusTrigger) document.querySelector<HTMLElement>(`[data-trigger="${index}"]`)?.focus();
	}

	function onMenuKey(e: KeyboardEvent, index: number) {
		const items = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role=menuitemradio]')];
		const at = items.indexOf(document.activeElement as HTMLElement);
		const pick = { '1': 'now', '2': 'defer', '3': 'drop' }[e.key] as Disposition | undefined;
		if (e.key === 'Escape' || e.key === 'Tab') {
			e.preventDefault();
			closeMenu(index, true);
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			items[(at + 1) % items.length].focus();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			items[(at - 1 + items.length) % items.length].focus();
		} else if (e.key === 'Home') {
			e.preventDefault();
			items[0].focus();
		} else if (e.key === 'End') {
			e.preventDefault();
			items[items.length - 1].focus();
		} else if (pick && desk.singleKeys) {
			e.preventDefault();
			e.stopPropagation();
			closeMenu(index, false);
			moveTo(index, pick);
		}
	}

	function pickItem(index: number, disposition: Disposition) {
		closeMenu(index, false);
		moveTo(index, disposition);
	}
</script>

<p class="desk-muted mb-2 text-sm leading-7">
	Each item starts at the session's proposal. ↑↓ move between items,
	<span class="desk-sk">1 2 3 set now, defer, or drop;</span> menus take arrows and Esc.
</p>

{#each SECTIONS as section (section.key)}
	<section class="desk-group" data-group={section.key} aria-labelledby="g-{section.key}">
		<h2 id="g-{section.key}">
			<span class="desk-dot" aria-hidden="true"></span>
			{section.label}
			<span class="desk-count">{groups[section.key].length}</span>
		</h2>
		{#if groups[section.key].length === 0}
			<p class="desk-empty">Nothing here.</p>
		{:else}
			<ol class="desk-v" aria-labelledby="g-{section.key}">
				{#each groups[section.key] as { row, index } (index)}
					<!-- The list takes one tab stop and the arrows move within it, so each row is focusable. -->
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<li
						data-row={index}
						class:is-moved={row.disposition !== row.proposed}
						tabindex={current === index ? 0 : -1}
						aria-labelledby="item-{index}"
						aria-describedby="was-{index}"
						onfocusin={() => (current = index)}
					>
						<span class="tb-n" aria-hidden="true">{index + 1}</span>
						<div class="min-w-0">
							<p class="tb-text" id="item-{index}">{row.item}</p>
							<div class="tb-reason">
								{#if editing === index}
									<input
										class="input input-sm w-full max-w-[80ch]"
										data-reason-input={index}
										placeholder="Why this disposition"
										aria-label="Reason for item {index + 1}"
										bind:value={rows[index].reason}
										disabled={desk.held}
										onkeydown={(e) => onReasonKey(e, index)}
										onblur={() => endEdit(index, false)}
									/>
								{:else}
									<span>{#if row.reason}{row.reason}{:else}<span class="italic">No reason given.</span>{/if}</span>
									<button
										type="button"
										class="link link-hover min-h-6 text-[0.8rem]"
										data-edit={index}
										aria-label="{row.reason ? 'Edit reason' : 'Add a reason'} for item {index + 1}"
										disabled={desk.held}
										onclick={() => startEdit(index)}
									>
										{row.reason ? 'Edit reason' : 'Add a reason'}
									</button>
									<button
										type="button"
										class="link link-hover min-h-6 text-[0.8rem]"
										data-trigger={index}
										popovertarget="mc-{index}"
										aria-haspopup="menu"
										aria-expanded={menuOpen === index}
										aria-label="Move item {index + 1} to another disposition"
										disabled={desk.held}
									>
										Move to
									</button>
								{/if}
								<span class="tb-was" id="was-{index}">
									{row.disposition !== row.proposed ? `was ${LABEL[row.proposed]}` : ''}
								</span>
							</div>
						</div>
						<ul
							id="mc-{index}"
							class="dropdown desk-menu menu menu-sm w-48 rounded-box border border-base-300 bg-base-100 p-1"
							popover
							role="menu"
							aria-label="Move item {index + 1} to"
							ontoggle={(e) => onMenuToggle(e, index)}
							onkeydown={(e) => onMenuKey(e, index)}
						>
							{#each SECTIONS as target, n (target.key)}
								<li role="none">
									<button
										type="button"
										role="menuitemradio"
										aria-checked={row.disposition === target.key}
										class={{ 'menu-active': row.disposition === target.key }}
										onclick={() => pickItem(index, target.key)}
									>
										<span>
											{target.label}
											{#if row.proposed === target.key}<span class="desk-prop">proposed</span>{/if}
										</span>
										<kbd class="kbd kbd-xs desk-kbd desk-sk">{n + 1}</kbd>
									</button>
								</li>
							{/each}
						</ul>
					</li>
				{/each}
			</ol>
		{/if}
	</section>
{/each}

<style>
	.desk-group + .desk-group {
		margin-top: 18px;
	}
	.desk-group h2 {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding-inline-start: 8px;
		padding-bottom: 4px;
		font-weight: 700;
		font-size: 0.95rem;
		border-bottom: 1px dashed var(--site-rule-color);
	}
	.desk-group h2 .desk-count {
		font-weight: 400;
		color: var(--color-muted);
	}
	.desk-group .desk-empty {
		padding-inline-start: 48px;
		padding-block: 8px;
		font-size: 0.84rem;
		color: var(--color-muted);
	}
	.desk-group[data-group='now'] {
		--desk-hue: var(--cairn-warning-ink);
	}
	.desk-group[data-group='defer'] {
		--desk-hue: var(--color-info);
	}
	.desk-group[data-group='drop'] {
		--desk-hue: var(--color-muted);
	}
	.desk-dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--desk-hue);
		align-self: center;
	}

	.desk-v {
		list-style: none;
	}
	.desk-v > li {
		position: relative;
		display: grid;
		grid-template-columns: 2rem minmax(0, 1fr);
		column-gap: 16px;
		padding: 10px 12px 10px 8px;
		border-radius: var(--radius-box);
	}
	.desk-v > li + li {
		margin-top: 2px;
	}
	.desk-v > li:focus-within {
		background-color: var(--color-base-200);
	}
	.tb-n {
		color: var(--color-muted);
		font-variant-numeric: tabular-nums;
		text-align: right;
		line-height: 1.45;
	}
	.tb-text {
		line-height: 1.45;
		max-width: 80ch;
	}
	.tb-reason {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 2px 10px;
		font-size: 0.84rem;
		color: var(--color-muted);
	}
	.tb-was {
		font-size: 0.78rem;
		color: var(--color-muted);
	}
	.desk-v > li.is-moved .tb-n {
		position: relative;
	}
	.desk-v > li.is-moved .tb-n::before {
		content: '';
		position: absolute;
		left: -2px;
		top: 0.72em;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--desk-hue);
	}

	.desk-menu {
		position: fixed;
		inset: auto;
		margin: 0;
		position-area: none;
	}
	.desk-menu [role='menuitemradio'] {
		justify-content: space-between;
	}
	.desk-menu .desk-prop {
		font-size: 0.72rem;
		color: inherit;
		opacity: 0.8;
	}
</style>
