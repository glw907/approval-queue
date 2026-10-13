<!-- @component
The brief's detail sections as chevron rows under a "Details" eyebrow: each row shows the section's
name and first sentence, and opens to the rest. Renders nothing when the brief has none.
-->
<script lang="ts">
	import Disclosure from './Disclosure.svelte';

	let {
		details
	}: { details: Array<{ label: string; summaryHtml: string; bodyHtml: string }> } = $props();
</script>

{#if details.length}
	<section class="mt-10" aria-labelledby="details-h">
		<h2 id="details-h" class="mb-1 text-[0.7rem] font-semibold tracking-[0.08em] text-(--color-muted) uppercase">Details</h2>
		{#each details as detail, i (i)}
			<Disclosure name={detail.label} summaryHtml={detail.summaryHtml}>
				<div class="desk-code">{@html detail.bodyHtml}</div>
			</Disclosure>
		{/each}
	</section>
{/if}

<style>
	.desk-code :global(code) {
		font-family: var(--font-mono);
		font-size: var(--text-step-inline-code);
		background: var(--color-base-200);
		padding: 1px 4px;
		border-radius: 3px;
		overflow-wrap: anywhere;
	}
	.desk-code :global(p),
	.desk-code :global(ul),
	.desk-code :global(ol) {
		margin: 0.45rem 0;
	}
	.desk-code > :global(:first-child) {
		margin-top: 0;
	}
	.desk-code :global(ul) {
		list-style: disc;
		padding-inline-start: 1.25rem;
	}
	.desk-code :global(ol) {
		list-style: decimal;
		padding-inline-start: 1.25rem;
	}
</style>
