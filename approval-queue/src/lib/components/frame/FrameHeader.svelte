<!-- @component
The Survey header every screen opens with: breadcrumb, benchmark triangle, headline, lede, and the
contour texture behind them. The screen passes its path as `crumbs`, the last of which is the page
itself, and its headline and lede as snippets, so rendered inline Markdown works. A `state` snippet
holds what is not part of the path (a badge, the wait, a link out); it sits beside the breadcrumb,
outside its `nav`. `headlineText` is the headline's source text; one over 90 characters takes the
`long` size. A packet, blueprint, or page passes `description`, its paragraphs each in a `<p>`; a
`lede` passed beside it follows as a smaller status line, and one passed alone is the one-paragraph
lede.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** The path to this page; a crumb with an `href` is a link, and the last is the current page. */
		crumbs: { text: string; href?: string }[];
		state?: Snippet;
		headline: Snippet;
		lede?: Snippet;
		description?: Snippet;
		headlineText: string;
	}

	let { crumbs, state, headline, lede, description, headlineText }: Props = $props();

	const long = $derived(headlineText.length > 90);
</script>

<header class="sheethead">
	<svg class="site-contour-texture" viewBox="0 0 1200 160" preserveAspectRatio="none" aria-hidden="true">
		<path d="M0 120 C 180 90, 320 150, 520 112 S 860 70, 1200 104" />
		<path d="M0 138 C 200 112, 340 166, 540 130 S 880 92, 1200 122" />
		<path d="M0 154 C 220 132, 360 178, 560 148 S 900 114, 1200 140" />
		<path d="M640 160 C 700 120, 820 118, 900 140 S 1060 150, 1200 128" />
	</svg>
	<div class="crumbrow">
		<nav aria-label="Breadcrumb">
			<ol class="crumb">
				{#each crumbs as c, i (i)}
					<li aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{#if c.href}<a href={c.href}>{c.text}</a>{:else}{c.text}{/if}</li>
				{/each}
			</ol>
		</nav>
		{#if state}<div class="crumbstate">{@render state()}</div>{/if}
	</div>
	<h1 class={['desk-title', long && 'long']}><span class="site-benchmark" aria-hidden="true"></span>{@render headline()}</h1>
	{#if description}
		<div class="lede">{@render description()}</div>
	{/if}
	{#if lede}
		<p class={description ? 'doc-status' : 'lede'}>{@render lede()}</p>
	{/if}
</header>

<style>
	.doc-status {
		max-width: 62ch;
		margin: 14px 0 0;
		font-size: 0.9rem;
		line-height: 1.5;
		color: var(--color-muted);
	}
</style>
