<!-- @component
A round report: the conductor's Markdown, the packets still waiting in its round, and the pull
requests that landed in it. It asks nothing, so the page carries one "Mark read" button, which
posts `?/read` and is gone once the report is read. Decision keys do nothing here; the page tells
`desk` it is a report so they stay quiet.
-->
<script lang="ts">
	import { decisionWord, longDay } from '#lib/board.ts';
	import { desk } from '#lib/desk.svelte.ts';

	interface Props {
		data: {
			meta: { title: string; created: string };
			read: boolean;
			/** The report's Markdown as rendered HTML, its heading already dropped. */
			html: string;
			waiting: Array<{ id: string; title: string }>;
			landed: Array<{ ref: string; claim: string; url: string }>;
		};
	}

	let { data }: Props = $props();

	$effect(() => {
		desk.page = 'report';
		return () => (desk.page = 'design');
	});
</script>

<main id="main" tabindex="-1" class="mx-auto w-full max-w-3xl p-8">
	<h1 class="desk-title text-2xl">{data.meta.title}</h1>
	<p class="desk-muted">
		{data.read ? decisionWord('read') : 'Round report'}, {longDay(data.meta.created)}
	</p>

	<div class="prose mt-4 max-w-none">{@html data.html}</div>

	<h2 class="mt-8 text-lg font-semibold">Waiting in this round</h2>
	{#if data.waiting.length}
		<ul class="mt-2 list-disc pl-5">
			{#each data.waiting as packet (packet.id)}
				<li><a class="link" href="/item/{packet.id}">{packet.title}</a></li>
			{/each}
		</ul>
	{:else}
		<p class="desk-muted mt-2">No packet from this round is waiting.</p>
	{/if}

	<h2 class="mt-8 text-lg font-semibold">Landed in this round</h2>
	{#if data.landed.length}
		<ul class="mt-2 list-disc pl-5">
			{#each data.landed as pr (pr.ref)}
				<li><a class="link" href={pr.url}>{pr.ref}</a>, {pr.claim}</li>
			{/each}
		</ul>
	{:else}
		<p class="desk-muted mt-2">No pull request has landed in this round.</p>
	{/if}

	{#if !data.read}
		<form method="post" action="?/read" class="mt-8">
			<button class="btn btn-primary" type="submit">Mark read</button>
		</form>
	{/if}
</main>
