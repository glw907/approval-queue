<!-- @component
A design document as the last section of the screen, set in the frame's own body type with its
headings one step under the section's, as the packet and page screens read. The document's own `h1`
is hidden because the Survey header already carries the title. `embedded` drops the section id and
its "The design" heading, for a packet part's detail where several designs repeat them.
-->
<script lang="ts">
	let { docHtml, embedded = false }: { docHtml: string; embedded?: boolean } = $props();
</script>

{#if embedded}
	<article class="desk-read">{@html docHtml}</article>
{:else}
	<section class="sec" id="design" aria-labelledby="design-h">
		<h2 id="design-h">The design</h2>
		<article class="desk-read">{@html docHtml}</article>
	</section>
{/if}

<style>
	.desk-read {
		font-size: 1rem;
		line-height: 1.6;
		max-width: 56ch;
		margin-top: 10px;
		overflow-wrap: anywhere;
	}
	.desk-read :global(h1) {
		display: none;
	}
	.desk-read :global(h2) {
		font-weight: 600;
		font-size: 1.1rem;
		line-height: 1.3;
		margin: 1.6rem 0 0.3rem;
	}
	.desk-read :global(h3) {
		font-weight: 600;
		font-size: 1rem;
		line-height: 1.3;
		margin: 1.2rem 0 0.25rem;
	}
	.desk-read :global(h4) {
		font-weight: 600;
		font-size: 0.95rem;
		margin: 1rem 0 0.2rem;
		color: var(--color-muted);
	}
	.desk-read :global(p),
	.desk-read :global(ul),
	.desk-read :global(ol) {
		margin: 0.55rem 0;
	}
	.desk-read :global(ul) {
		list-style: disc;
		padding-inline-start: 1.3rem;
	}
	.desk-read :global(ol) {
		list-style: decimal;
		padding-inline-start: 1.3rem;
	}
	.desk-read :global(ul ul) {
		margin: 0.25rem 0;
		list-style: circle;
	}
	.desk-read :global(li + li) {
		margin-top: 0.3rem;
	}
	.desk-read :global(strong) {
		font-weight: 600;
	}
	.desk-read :global(a) {
		color: var(--color-primary);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.desk-read :global(code) {
		font-family: var(--font-mono);
		font-size: var(--text-step-inline-code);
		background: var(--color-base-200);
		padding: 1px 4px;
		border-radius: 3px;
	}
	.desk-read :global(pre) {
		overflow-x: auto;
		font-size: 0.85rem;
	}
</style>
