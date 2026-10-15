<!-- @component
One closed-by-default row: a leading chevron that points right and turns down when open, the row's
name, and under the name a summary that stays visible while it is open. An empty summary
leaves the name alone on the row. The chevron sits on the name's line, however many lines the
summary wraps to. `quiet` sets the smaller Evidence tier. `summaryHtml` is trusted markup the server rendered; the body is the children.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		name: string;
		summaryHtml: string;
		quiet?: boolean;
		/** Lifts the 70-character cap, for a body that is a table or a diff. */
		wide?: boolean;
		open?: boolean;
		children?: Snippet;
	}

	let { name, summaryHtml, quiet = false, wide = false, open = $bindable(false), children }: Props = $props();

	// The chevron takes the name's text size, so its box is one name line tall and centres on that line.
	const nameSize = $derived(quiet ? 'text-sm' : 'text-[0.95rem]');
</script>

<details class="group collapse rounded-none border-b border-base-content/10" bind:open>
	<summary class="collapse-title grid min-h-0 grid-cols-[1rem_minmax(0,1fr)] gap-x-2 px-0 {quiet ? 'py-1.5' : 'py-2'}">
		<span class={['flex h-lh items-center transition-transform group-open:rotate-90', nameSize]}>
			<svg class="size-4 shrink-0 text-(--color-muted)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
		</span>
		<span class={['font-medium', nameSize, quiet && 'opacity-80']}>{name}</span>
		{#if summaryHtml}
			<span class={['col-start-2 text-pretty text-(--color-muted)', quiet ? 'text-xs' : 'text-sm']}>
				{@html summaryHtml}
			</span>
		{/if}
	</summary>
	<div class={['collapse-content ps-6 pe-0 text-sm leading-relaxed text-pretty opacity-90', !wide && 'max-w-[70ch]']}>
		{@render children?.()}
	</div>
</details>

<style>
	summary :global(code) {
		font-family: var(--font-mono);
		font-size: var(--text-step-inline-code);
	}
</style>
