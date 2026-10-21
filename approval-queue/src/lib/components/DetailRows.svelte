<!-- @component
The brief's detail sections as a "Details" section of disclosure rows: each row shows the section's
name and first sentence, and opens to the rest. A section that opens with a table shows its
name alone. Renders nothing when the brief has none.
-->
<script lang="ts">
	import Disclosure from './Disclosure.svelte';

	let {
		details
	}: { details: Array<{ label: string; summaryHtml: string; bodyHtml: string }> } = $props();
</script>

{#if details.length}
	<section class="sec" id="details" aria-labelledby="details-h">
		<h2 id="details-h">Details</h2>
		<p class="sl">{details.length} {details.length === 1 ? 'section' : 'sections'}, each opens to the rest.</p>
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
	.desk-code :global(ol),
	.desk-code :global(table) {
		margin: 0.45rem 0;
	}
	.desk-code :global(table) {
		border-collapse: collapse;
		width: 100%;
	}
	.desk-code :global(th),
	.desk-code :global(td) {
		border-bottom: 1px solid var(--color-base-300);
		padding: 4px 10px 4px 0;
		text-align: left;
		vertical-align: top;
	}
	.desk-code :global(th) {
		font-weight: 600;
		color: var(--color-muted);
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
