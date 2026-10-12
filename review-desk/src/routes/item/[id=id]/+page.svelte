<!-- @component
One review item. A PR shows its body and diff, a design its document, a triage item an editable
row per entry; a decided item shows "Decided" in place of the form.
-->
<script lang="ts">
	let { data } = $props();
	let rejecting = $state(false);

	const diffClass = {
		added: 'text-success',
		removed: 'text-error',
		hunk: 'text-info',
		file: 'font-bold',
		context: ''
	};
</script>

<main class="mx-auto max-w-[72ch] p-6">
	<a class="link" href="/">All items</a>
	<h1 class="mt-2 font-display text-2xl">{data.meta.title}</h1>
	<p class="mb-4 text-base-content/70">
		<span class="badge badge-outline">{data.meta.kind}</span>
		{data.meta.repo}
	</p>

	{#if data.kind === 'pr'}
		<section class="md">{@html data.bodyHtml}</section>
		<pre class="my-4 overflow-x-auto bg-base-200 p-3 font-mono text-sm">{#each data.diff as line, i (i)}<span
					class="block {diffClass[line.kind]}">{line.text}</span
				>{/each}</pre>
	{:else if data.kind === 'design'}
		<section class="md">{@html data.docHtml}</section>
	{/if}

	{#if data.decided}
		<div class="alert mt-4"><span>Decided</span></div>
	{:else if data.kind === 'triage'}
		<form method="post" action="?/submit" class="mt-4 space-y-3">
			{#each data.rows as row, i (i)}
				<div class="space-y-1 border-b border-base-300 pb-3">
					<p>{row.item}</p>
					<div class="flex gap-2">
						<select name="disposition" class="select select-sm w-28" value={row.disposition}>
							<option value="now">now</option>
							<option value="defer">defer</option>
							<option value="drop">drop</option>
						</select>
						<input name="reason" class="input input-sm grow" value={row.reason} />
					</div>
				</div>
			{/each}
			<button class="btn btn-primary">Submit</button>
		</form>
	{:else}
		{#if data.kind === 'pr' && data.beforeMergeHtml !== null}
			<div role="alert" class="alert alert-warning alert-vertical mt-4 items-start">
				<strong>Before merge</strong>
				<div class="md">{@html data.beforeMergeHtml}</div>
			</div>
		{/if}
		<form method="post" class="mt-4 space-y-3">
			{#if rejecting}
				<textarea name="note" class="textarea w-full" rows="3" placeholder="Note (optional)"></textarea>
				<button class="btn btn-error" formaction="?/reject">Send rejection</button>
				<button class="btn btn-ghost" type="button" onclick={() => (rejecting = false)}>Cancel</button>
			{:else}
				<button class="btn btn-primary" formaction="?/approve">Approve</button>
				<button class="btn" type="button" onclick={() => (rejecting = true)}>Reject</button>
			{/if}
		</form>
	{/if}
</main>

<style>
	.md :global(h1),
	.md :global(h2),
	.md :global(h3) {
		font-weight: 700;
		margin: 1.2em 0 0.4em;
	}
	.md :global(p),
	.md :global(ul),
	.md :global(ol),
	.md :global(pre) {
		margin: 0.7em 0;
	}
	.md :global(ul) {
		list-style: disc;
		padding-left: 1.5em;
	}
	.md :global(ol) {
		list-style: decimal;
		padding-left: 1.5em;
	}
	.md :global(pre) {
		overflow-x: auto;
	}
	.md :global(a) {
		text-decoration: underline;
	}
</style>
