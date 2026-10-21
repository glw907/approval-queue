<!-- @component
One closed-by-default row on the frame's Background pattern: a chevron that turns down when open,
the row's name in bold, and its first sentence beside it, which stays visible while the body is
open. An empty summary leaves the name alone. `summaryHtml` is trusted markup the server rendered;
the body is the children.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import PacketIcon from './PacketIcon.svelte';

	interface Props {
		name: string;
		summaryHtml: string;
		/** Lifts the reading-width cap, for a body that is a table or a diff. */
		wide?: boolean;
		open?: boolean;
		children?: Snippet;
	}

	let { name, summaryHtml, wide = false, open = $bindable(false), children }: Props = $props();
</script>

<details class={['bg', wide && 'wide']} bind:open>
	<summary>
		<PacketIcon name="chev" class="chev" />
		<span><span class="lead">{name}.</span>{#if summaryHtml}{" "}{@html summaryHtml}{/if}</span>
	</summary>
	<div class="body">
		{@render children?.()}
	</div>
</details>

<style>
	.bg.wide {
		max-width: none;
	}
	summary :global(code) {
		font-family: var(--font-mono);
		font-size: var(--text-step-inline-code);
	}
</style>
