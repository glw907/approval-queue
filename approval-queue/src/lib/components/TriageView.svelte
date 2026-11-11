<!-- @component
A triage item: the session's calls in three groups (Do now, Do later, Don't do), each row with a
verdict segment (amber once it differs from the session's proposal) and a Technical detail
disclosure. Choosing moves the row to the group it names, and keys `1`, `2`, `3` do the same for the focused row. The rows are bound to `ItemPanel`,
which submits them; nothing here posts. A row's number is its position in the file and never changes.
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { desk } from '#lib/desk.svelte.ts';
	import { groupRows, moveRow, type Disposition, type Row } from '#lib/triage.ts';
	import PacketIcon from './PacketIcon.svelte';

	interface Props {
		rows: Row[];
		/** Each row's action, reason, and technical detail as rendered HTML, in the file's order. */
		html: Array<{ action: string; why: string; detail: string | null }>;
	}

	let { rows = $bindable(), html }: Props = $props();

	const SECTIONS = [
		{ key: 'now', label: 'Do now' },
		{ key: 'defer', label: 'Do later' },
		{ key: 'drop', label: 'Don’t do' }
	] as const;
	const LABEL: Record<Disposition, string> = { now: 'Do now', defer: 'Do later', drop: 'Don’t do' };

	const groups = $derived(groupRows(rows));
	/** The row that holds the roving tabindex. */
	let current = $state(0);

	$effect(() =>
		desk.register({
			'row-next': () => stepRow(1),
			'row-prev': () => stepRow(-1),
			'move-now': () => moveFocused('now'),
			'move-defer': () => moveFocused('defer'),
			'move-drop': () => moveFocused('drop')
		})
	);

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
</script>

{#each SECTIONS as section (section.key)}
	<section class="sec" id="group-{section.key}" data-group={section.key} aria-labelledby="g-{section.key}">
		<h2 id="g-{section.key}">{section.label}</h2>
		<p class="sl">
			{#if groups[section.key].length === 0}Nothing here.{:else}{groups[section.key].length} {groups[section.key].length === 1 ? 'item' : 'items'}.{/if}
		</p>
		{#if groups[section.key].length}
			<ul class="parts">
				{#each groups[section.key] as { row, index } (index)}
					<!-- svelte-ignore a11y_no_noninteractive_tabindex: the list takes one tab stop and the arrows move within it, so each row is focusable -->
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
							</p>
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
