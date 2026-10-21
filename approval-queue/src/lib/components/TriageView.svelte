<!-- @component
A triage item: the session's calls in three groups (Do now, Do later, Don't do), each row with a
verdict segment (amber once it differs from the session's proposal), a Note button, and a Technical
detail disclosure. Choosing moves the row to the group
it names, and keys `1`, `2`, `3` do the same for the focused row. The rows are bound to `ItemPanel`,
which submits them; nothing here posts. A row's number is its position in the file and never changes.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { desk } from '#lib/desk.svelte.ts';
	import { groupRows, moveRow, type Disposition, type Row } from '#lib/triage.ts';
	import BriefBlock from './BriefBlock.svelte';
	import PacketIcon from './PacketIcon.svelte';

	interface Props {
		rows: Row[];
		/** Each row's action, reason, and technical detail as rendered HTML, in the file's order. */
		html: Array<{ action: string; why: string; detail: string | null }>;
		headlineHtml: string;
		ledeHtml: string;
		/** The crumb after "Board", such as "Triage · drafter Pass 0". */
		meta: string;
	}

	let { rows = $bindable(), html, headlineHtml, ledeHtml, meta }: Props = $props();

	const SECTIONS = [
		{ key: 'now', label: 'Do now' },
		{ key: 'defer', label: 'Do later' },
		{ key: 'drop', label: 'Don’t do' }
	] as const;
	const LABEL: Record<Disposition, string> = { now: 'Do now', defer: 'Do later', drop: 'Don’t do' };

	const groups = $derived(groupRows(rows));
	/** The row that holds the roving tabindex. */
	let current = $state(0);
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

	/** Steps through the rows in the order they sit on the page: Do now, then Do later, then Don't do. */
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
		original = rows[index].note;
		editing = index;
		await tick();
		const input = document.querySelector<HTMLInputElement>(`[data-note-input="${index}"]`);
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

	function onNoteKey(e: KeyboardEvent, index: number) {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			endEdit(index, false);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			endEdit(index, true);
		} else if (e.key === 'Escape') {
			e.stopPropagation();
			rows[index].note = original;
			endEdit(index, true);
		}
	}
</script>

<BriefBlock {headlineHtml} {ledeHtml}>
	{#snippet trail()}
		<a href="/">Board</a><span aria-hidden="true">/</span><span>{meta}</span>
	{/snippet}
</BriefBlock>

{#each SECTIONS as section (section.key)}
	<section class="sec" data-group={section.key} aria-labelledby="g-{section.key}">
		<h2 id="g-{section.key}">{section.label}</h2>
		<p class="sl">
			{#if groups[section.key].length === 0}Nothing here.{:else}{groups[section.key].length} {groups[section.key].length === 1 ? 'item' : 'items'}.{/if}
		</p>
		{#if groups[section.key].length}
			<ul class="parts">
				{#each groups[section.key] as { row, index } (index)}
					<!-- The list takes one tab stop and the arrows move within it, so each row is focusable. -->
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<li
						data-row={index}
						class="part"
						tabindex={current === index ? 0 : -1}
						aria-labelledby="item-{index}"
						onfocusin={() => (current = index)}
					>
						<div class="st">
							<p id="item-{index}" class={['pt', 'action', section.key === 'drop' && 'dropped']}>
								{@html html[index].action}
							</p>
							<p class="sx why-text">
								{@html html[index].why}
								{#if row.note}<span class="italic">Your note: {row.note}</span>{/if}
							</p>
							<div class="flex flex-wrap items-center gap-x-1 gap-y-2">
								{#if editing === index}
									<input
										class="input input-sm w-full max-w-[60ch]"
										data-note-input={index}
										placeholder="Your note on this item"
										aria-label="Note for item {index + 1}"
										bind:value={rows[index].note}
										disabled={desk.held}
										onkeydown={(e) => onNoteKey(e, index)}
										onblur={() => endEdit(index, false)}
									/>
								{:else}
									<button
										type="button"
										class="btn btn-xs btn-ghost font-normal text-(--color-muted)"
										data-edit={index}
										aria-label="{row.note ? 'Edit note' : 'Add a note'} for item {index + 1}"
										disabled={desk.held}
										onclick={() => startEdit(index)}
									>
										<svg class="size-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 20 4-1 11-11-3-3L5 16l-1 4zM14 6l3 3" /></svg>
										Note
									</button>
								{/if}
							</div>
							{#if html[index].detail}
								<details class="why">
									<summary><PacketIcon name="chev" class="chev" />Technical detail</summary>
									<div class="why-body desk-code">{@html html[index].detail}</div>
								</details>
							{/if}
						</div>
						<div class="sc">
							<div class={['join seg', row.disposition !== row.proposed && 'changed']} role="radiogroup" aria-label="Call for item {index + 1}">
								{#each SECTIONS as target (target.key)}
									<input
										class="join-item btn btn-sm"
										type="radio"
										name="r{index}"
										aria-label={target.label}
										checked={row.disposition === target.key}
										disabled={desk.held}
										onchange={() => moveTo(index, target.key)}
									/>
								{/each}
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/each}

<style>
	.action {
		font-weight: 600;
	}
	.action.dropped,
	.why-text {
		color: var(--color-muted);
	}
	.why-text {
		font-size: 0.95rem;
	}
	.desk-code :global(code) {
		font-family: var(--font-mono);
		font-size: var(--text-step-inline-code);
		background: var(--color-base-200);
		padding: 1px 4px;
		border-radius: 3px;
		overflow-wrap: anywhere;
	}
</style>
