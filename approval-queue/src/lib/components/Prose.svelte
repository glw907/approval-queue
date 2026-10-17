<!-- @component
A packet's plain text as inline markup: backtick spans become code, quotes curl, and an ISO date stays
on one line. It renders spans, never HTML, so a packet's text cannot inject markup.
-->
<script lang="ts">
	import { proseSpans } from '#lib/prose.ts';

	let { text }: { text: string } = $props();
</script>

{#each proseSpans(text) as span, i (i)}{#if span.kind === 'code'}<code>{span.text}</code>{:else if span.kind === 'date'}<span class="whitespace-nowrap">{span.text}</span>{:else}{span.text}{/if}{/each}
