<script lang="ts">
	let { data } = $props();
</script>

<main class="mx-auto max-w-[72ch] p-6">
	<h1 class="mb-4 font-display text-2xl">Waiting for review</h1>
	{#if data.items.length === 0}
		<p class="text-base-content/70">Nothing is waiting.</p>
	{:else}
		<ul class="menu w-full p-0">
			{#each data.items as item (item.id)}
				<li>
					<a href="/item/{item.id}">
						<span class="badge badge-outline">{item.kind}</span>
						<span class="text-base-content/70">{item.repo}</span>
						<span class="font-bold">{item.title}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</main>
