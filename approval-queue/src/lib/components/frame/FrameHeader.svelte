<!-- @component
The Survey header every screen opens with: crumb, benchmark triangle, headline, lede, and the
contour texture behind them. The screen passes its own crumb, headline, and lede as snippets, so
rendered inline Markdown works. A headline over about 120 characters takes the `long` size. A
packet passes `description`, its paragraphs each in a `<p>`, in place of the one-paragraph lede.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		crumb: Snippet;
		headline: Snippet;
		lede?: Snippet;
		description?: Snippet;
		long?: boolean;
	}

	let { crumb, headline, lede, description, long = false }: Props = $props();
</script>

<header class="sheethead">
	<svg class="site-contour-texture" viewBox="0 0 1200 160" preserveAspectRatio="none" aria-hidden="true">
		<path d="M0 120 C 180 90, 320 150, 520 112 S 860 70, 1200 104" />
		<path d="M0 138 C 200 112, 340 166, 540 130 S 880 92, 1200 122" />
		<path d="M0 154 C 220 132, 360 178, 560 148 S 900 114, 1200 140" />
		<path d="M640 160 C 700 120, 820 118, 900 140 S 1060 150, 1200 128" />
	</svg>
	<p class="crumb">{@render crumb()}</p>
	<h1 class={['desk-title', long && 'long']}><span class="site-benchmark" aria-hidden="true"></span>{@render headline()}</h1>
	{#if description}
		<div class="lede">{@render description()}</div>
	{:else if lede}
		<p class="lede">{@render lede()}</p>
	{/if}
</header>
