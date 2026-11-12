<script lang="ts">
	import Document from '#lib/components/Document.svelte';
	let { data } = $props();
</script>

<svelte:head><title>{data.doc.title} | Approval Queue</title></svelte:head>

{#key data.doc.id}
	<Document doc={data.doc} initial={data.state} />
{/key}
