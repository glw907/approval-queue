<!-- @component
A triage item: the session's calls in three groups (Do now, Do later, Don't do), each row with a
choice join, a Note button, and a Technical detail disclosure. Choosing moves the row to the group
it names, and keys `1`, `2`, `3` do the same for the focused row. The rows are bound to `ItemPanel`,
which submits them; nothing here posts. A row's number is its position in the file and never changes.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { desk } from '#lib/desk.svelte.ts';
	import { groupRows, moveRow, type Disposition, type Row } from '#lib/triage.ts';
	import BriefBlock from './BriefBlock.svelte';

	interface Props {
		rows: Row[];
		/** Each row's action, reason, and technical detail as rendered HTML, in the file's order. */
		html: Array<{ action: string; why: string; detail: string | null }>;
		headlineHtml: string;
		ledeHtml: string;
		/** The meta line above the block, such as "Triage · drafter Pass 0". */
		meta: string;
	}

	let { rows = $bindable(), html, headlineHtml, ledeHtml, meta }: Props = $props();

	const SECTIONS = [
		{ key: 'now', label: 'Do now', dot: 'bg-warning', pick: 'checked:bg-warning/25' },
		{ key: 'defer', label: 'Do later', dot: 'bg-base-content/40', pick: 'checked:bg-base-300' },
		{ key: 'drop', label: 'Don’t do', dot: 'bg-base-content/20', pick: 'checked:bg-base-300' }
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

<p class="mb-2 text-xs tracking-wide text-(--color-muted)">{meta}</p>
<BriefBlock {headlineHtml} {ledeHtml} />

{#each SECTIONS as section (section.key)}
	<section data-group={section.key} aria-labelledby="g-{section.key}">
		<h2 id="g-{section.key}" class="mt-9 mb-0 flex items-center gap-2 text-base font-semibold">
			<span class="size-2 rounded-full {section.dot}" aria-hidden="true"></span>
			{section.label}
			<span class="text-sm font-normal text-(--color-muted)">{groups[section.key].length}</span>
		</h2>
		{#if groups[section.key].length === 0}
			<p class="py-3 text-sm text-(--color-muted)">Nothing here.</p>
		{:else}
			<ul class="list">
				{#each groups[section.key] as { row, index } (index)}
					<!-- The list takes one tab stop and the arrows move within it, so each row is focusable. -->
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<li
						data-row={index}
						class="list-row items-start px-0 py-3 after:border-base-content/10"
						tabindex={current === index ? 0 : -1}
						aria-labelledby="item-{index}"
						onfocusin={() => (current = index)}
					>
						<div class="min-w-0 list-col-grow">
							<p
								id="item-{index}"
								class={[
									'max-w-[70ch] text-base leading-snug font-semibold text-pretty',
									section.key === 'drop' && 'text-(--color-muted)'
								]}
							>
								{@html html[index].action}
							</p>
							<p class="mt-0.5 max-w-[70ch] text-[0.95rem] leading-relaxed text-pretty text-(--color-muted)">
								{@html html[index].why}
								{#if row.note}<span class="italic">Your note: {row.note}</span>{/if}
							</p>
							<div class="mt-2 flex flex-wrap items-center gap-x-1 gap-y-2">
								<div class="join rounded-field border border-base-300" role="radiogroup" aria-label="Call for item {index + 1}">
									{#each SECTIONS as target (target.key)}
										<input
											class="join-item btn btn-xs btn-ghost font-normal checked:border-base-content/55 checked:font-semibold checked:text-base-content {target.pick}"
											type="radio"
											name="r{index}"
											aria-label={target.label}
											checked={row.disposition === target.key}
											disabled={desk.held}
											onchange={() => moveTo(index, target.key)}
										/>
									{/each}
								</div>
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
								<details class="group mt-0">
									<summary class="flex w-fit cursor-pointer list-none items-center gap-1 py-1 text-xs text-(--color-muted) hover:text-base-content">
										<span class="transition-transform group-open:rotate-90">
											<svg class="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
										</span>
										Technical detail
									</summary>
									<div class="desk-code mt-1 max-w-[70ch] text-xs leading-relaxed text-pretty opacity-90">{@html html[index].detail}</div>
								</details>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/each}

<style>
	.desk-code :global(code) {
		font-family: var(--font-mono);
		font-size: var(--text-step-inline-code);
		background: var(--color-base-200);
		padding: 1px 4px;
		border-radius: 3px;
		overflow-wrap: anywhere;
	}
</style>
