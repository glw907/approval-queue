<!-- @component
One titled section of the review pane: "Calls for you", the parts or corrections, an outline. The
`contents` form is the outline's tighter, numbered list.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		title: string;
		/** The outline form: smaller rows with a number column. */
		contents?: boolean;
		children: Snippet;
	}

	let { title, contents = false, children }: Props = $props();
</script>

<section class={['rv-list', contents && 'rv-contents']}>
	<h2 class="rv-h">{title}</h2>
	{@render children()}
</section>
