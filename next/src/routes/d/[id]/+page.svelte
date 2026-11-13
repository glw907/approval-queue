<script lang="ts">
	import Document from '#lib/components/Document.svelte';
	import { DOC } from '#lib/strings.ts';

	let { data } = $props();
</script>

<svelte:head><title>{DOC.pageTitle(data.doc.title)}</title></svelte:head>

{#key data.doc.id}
	<Document doc={data.doc} />
{/key}
