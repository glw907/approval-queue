<!-- @component
One review item. `{#key}` rebuilds the panel for each item, since this page component stays
mounted while `load` swaps the data.
-->
<script lang="ts">
	import ItemPanel from '#lib/components/ItemPanel.svelte';

	let { data } = $props();
</script>

<svelte:head><title>{data.meta.title} · Design & PR Approvals</title></svelte:head>

{#key data.meta.id}
	<ItemPanel {data} />
{/key}
