<!-- @component
A design document. A stub until the design view lands: it renders the document.
-->
<script lang="ts">
	let { docHtml }: { docHtml: string } = $props();
</script>

<section class="md max-w-[72ch]">{@html docHtml}</section>
