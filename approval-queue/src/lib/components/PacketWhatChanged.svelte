<!-- @component
What changed since Geoff sent a packet back: his earlier note behind a closed disclosure, then the
session's bullets in the open. A send-back with no note says so in a line instead of an empty
disclosure. Renders on a revising packet only; the caller passes nothing otherwise.
-->
<script lang="ts">
	import Prose from './Prose.svelte';

	interface Props {
		/** The session's bullets, one per call or point of the note it answers. */
		bullets: string[];
		/** Left out when the earlier item's decision is gone from disk. */
		note?: string;
	}

	let { bullets, note }: Props = $props();
</script>

<section class="sec" id="what-changed" aria-labelledby="what-changed-h">
	<h2 id="what-changed-h">What changed</h2>
	{#if note !== undefined}
		{#if note.trim()}
			<details class="collapse collapse-arrow mt-2 rounded-none border-t border-b border-base-300">
				<summary class="collapse-title text-sm font-semibold">Your note when you sent it back</summary>
				<div class="collapse-content text-[0.95rem]">
					{#each note.split(/\n{2,}/) as paragraph, i (i)}<p class="whitespace-pre-line"><Prose text={paragraph} /></p>{/each}
				</div>
			</details>
		{:else}
			<p class="sl">You sent it back without a note.</p>
		{/if}
	{/if}
	<ul class="mt-3 list-disc space-y-1 pl-5">
		{#each bullets as bullet, i (i)}<li><Prose text={bullet} /></li>{/each}
	</ul>
</section>
