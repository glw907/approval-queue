<!-- @component
One closed-by-default row: a leading chevron that points right and turns down when open, the row's
name, and a one-line summary that stays visible while it is open. `quiet` sets the smaller Evidence
tier. `summaryHtml` is trusted markup the server rendered; the body is the children.
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
</script>

<details class="group collapse rounded-none border-b border-base-content/10" bind:open>
	<summary class="collapse-title flex min-h-0 items-baseline gap-x-2 px-0 max-sm:flex-wrap {quiet ? 'py-1.5' : 'py-2'}">
		<span class="self-center transition-transform group-open:rotate-90">
			<svg class="size-4 shrink-0 text-(--color-muted)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
		</span>
		<span class={['shrink-0', quiet ? 'text-sm font-medium opacity-80' : 'text-[0.95rem] font-medium']}>{name}</span>
		<span class={['ms-1 text-pretty max-sm:ms-6 max-sm:basis-full text-(--color-muted)', quiet ? 'text-xs' : 'text-sm']}>
			{@html summaryHtml}
		</span>
	</summary>
	<div class={['collapse-content ps-6 pe-0 text-sm leading-relaxed text-pretty opacity-90', !wide && 'max-w-[70ch]']}>
		{@render children?.()}
	</div>
</details>
