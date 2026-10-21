<!-- @component
A design document at a reading measure, as the last section of the screen. The document's own `h1`
is hidden because the Survey header already carries the title.
-->
<script lang="ts">
	let { docHtml }: { docHtml: string } = $props();
</script>

<section class="sec" id="design" aria-labelledby="design-h">
	<h2 id="design-h">The design</h2>
	<article class="desk-read">{@html docHtml}</article>
</section>

<style>
	.desk-read {
		font-family: var(--font-display);
		font-size: 1.06rem;
		line-height: 1.72;
		max-width: 68ch;
		margin-top: 10px;
		overflow-wrap: anywhere;
	}
	.desk-read :global(h1) {
		display: none;
	}
	.desk-read :global(h2) {
		font-weight: 500;
		font-size: 1.3rem;
		line-height: 1.25;
		margin: 1.6rem 0 0.4rem;
		padding-bottom: 4px;
		border-bottom: 1px dashed var(--site-rule-color);
	}
	.desk-read :global(p),
	.desk-read :global(ul) {
		margin: 0.6rem 0;
	}
	.desk-read :global(ul) {
		list-style: disc;
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
	.desk-read :global(code) {
		font-family: var(--font-mono);
		font-size: var(--text-step-inline-code);
		background: var(--color-base-200);
		padding: 1px 4px;
		border-radius: 3px;
	}
</style>
