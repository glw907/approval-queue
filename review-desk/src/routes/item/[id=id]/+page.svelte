<!-- @component
One review item. `{#key}` rebuilds the panel for each item, since this page component stays
mounted while `load` swaps the data.
-->
<script lang="ts">
	import ItemPanel from '#lib/components/ItemPanel.svelte';

	let { data } = $props();
</script>

{#key data.meta.id}
	<ItemPanel {data} />
{/key}
