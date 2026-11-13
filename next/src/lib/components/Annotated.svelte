<!--
@component
The reading column with its notes margin. At 86rem and wider the margin sits beside the text and
shows the hint for writing a note; narrower, the notes open in a sheet from the bottom of the
window. This pass draws no threads, so the margin holds only the hint.
-->
<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import { NOTES } from '#lib/strings.ts';

	let { children }: { children: Snippet } = $props();

	let sheet = $state<HTMLDialogElement>();
	let wide = $state(true);

	onMount(() => {
		const mq = matchMedia('(min-width: 86rem)');
		const sync = () => {
			wide = mq.matches;
			if (wide && sheet?.open) sheet.close();
		};
		sync();
		mq.addEventListener('change', sync);
		return () => mq.removeEventListener('change', sync);
	});
</script>

<div class="page">
	<div class="page-main">
		{@render children()}
	</div>

	<aside class="page-margin" aria-label={NOTES.margin}>
		{#if wide}
			<p class="muted" style:font-size="var(--text-step-9)">{NOTES.hint}</p>
		{/if}
	</aside>
</div>

<dialog class="modal modal-bottom" bind:this={sheet}>
	<div class="modal-box max-h-[75dvh]">
		<div class="mb-3 flex items-center justify-between">
			<h2 class="display text-lg">{NOTES.heading}</h2>
			<button class="btn btn-ghost btn-sm btn-square" aria-label={NOTES.close} onclick={() => sheet?.close()}>
				<X size={18} aria-hidden="true" />
			</button>
		</div>
		{#if !wide}
			<p class="muted">{NOTES.hint}</p>
		{/if}
	</div>
	<form method="dialog" class="modal-backdrop"><button>{NOTES.closeSheet}</button></form>
</dialog>
