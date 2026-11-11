<!-- @component
One review item. `{#key}` rebuilds the panel for each item, since this page component stays
mounted while `load` swaps the data. A packet has its own page; a packet stored before the fact
file shows only what it stored, read-only, until the history route opens it.
-->
<script lang="ts">
	import ItemPanel from '#lib/components/ItemPanel.svelte';
	import PacketPage from '#lib/components/PacketPage.svelte';

	let { data } = $props();
</script>

<svelte:head><title>{data.meta.title} · Approval Queue</title></svelte:head>

{#key data.meta.id}
	{#if data.kind === 'packet'}
		<PacketPage {data} />
	{:else if data.kind === 'legacy'}
		<main id="main" tabindex="-1" class="mx-auto w-full max-w-3xl p-8">
			<h1 class="desk-title text-2xl">{data.meta.title}</h1>
			<p class="desk-muted">Packet, {data.decision ? data.decision.decision : 'undecided'}. Stored before the fact file, so it opens as text only.</p>
			<pre class="mt-4 overflow-x-auto whitespace-pre-wrap text-sm">{data.text}</pre>
		</main>
	{:else}
		<ItemPanel {data} />
	{/if}
{/key}
