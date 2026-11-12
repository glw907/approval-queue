<!-- @component
One review item. `{#key}` rebuilds the panel for each item, since this page component stays
mounted while `load` swaps the data. A packet has its own page. A decided item the queue can no
longer show in full opens read-only: a packet stored before the fact file shows its stored text, and
an item of a retired kind (or a packet whose files no longer check) shows only its title, kind,
decision, and date.
-->
<script lang="ts">
	import { decisionWord, longDay } from '#lib/board.ts';
	import ItemPanel from '#lib/components/ItemPanel.svelte';
	import PacketPage from '#lib/components/PacketPage.svelte';
	import ReportPage from '#lib/components/ReportPage.svelte';

	let { data } = $props();

	const title = $derived(data.kind === 'retired' ? data.title : data.meta.title);
	const id = $derived(data.kind === 'retired' ? data.id : data.meta.id);
</script>

<svelte:head><title>{title} · Approval Queue</title></svelte:head>

{#key id}
	{#if data.kind === 'packet'}
		<PacketPage {data} />
	{:else if data.kind === 'report'}
		<ReportPage {data} />
	{:else if data.kind === 'retired'}
		<main id="main" tabindex="-1" class="mx-auto w-full max-w-3xl p-8">
			<h1 class="desk-title text-2xl">{data.title}</h1>
			<p class="desk-muted">
				{(data.itemKind || 'item').charAt(0).toUpperCase() + (data.itemKind || 'item').slice(1)}, {decisionWord(data.decision).toLowerCase()}, {longDay(data.date)}. The queue no longer shows this kind in full, so this is the record it kept.
			</p>
		</main>
	{:else if data.kind === 'legacy'}
		<main id="main" tabindex="-1" class="mx-auto w-full max-w-3xl p-8">
			<h1 class="desk-title text-2xl">{data.meta.title}</h1>
			<p class="desk-muted">
				Packet, {data.decision ? decisionWord(data.decision.decision).toLowerCase() : 'undecided'}{data.date ? `, ${longDay(data.date)}` : ''}. Stored before the fact file, so it opens as text only.
			</p>
			<pre class="mt-4 overflow-x-auto whitespace-pre-wrap text-sm">{data.text}</pre>
		</main>
	{:else}
		<ItemPanel {data} />
	{/if}
{/key}
