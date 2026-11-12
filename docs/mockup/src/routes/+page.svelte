<script lang="ts">
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import { when } from '#lib/when';
	import { plural, toolName } from '#lib/words';
	import type { ListItem } from '#lib/types';

	let { data } = $props();
	const waiting = $derived(data.items.filter((i) => !i.decision && i.kind !== 'report'));
	const toRead = $derived(data.items.filter((i) => !i.decision && i.kind === 'report'));

	/** The small line under a row: where the document came from, when, and how much it asks. */
	function rowLine(item: ListItem): string {
		let s = `${toolName(item.repo)}, ${when(item.sent)}.`;
		if (item.returned) s += ` The session returned it with changes ${when(item.returned)}.`;
		if (item.questions) s += ` ${plural(item.questions, 'question')}.`;
		return s;
	}

</script>

<svelte:head><title>Approval Queue</title></svelte:head>

{#snippet rows(items: ListItem[])}
	<ul class="mt-5 grid gap-2">
		{#each items as item (item.id)}
			<li>
				<a href="/d/{item.id}" class="front-row">
					<span class="display text-lg leading-snug">{item.title}</span>
					<span class="mt-1 block clamp-2 text-(length:--text-step-10) muted">{item.summary}</span>
					<span class="mt-2 block text-(length:--text-step-5) muted">{rowLine(item)}</span>
				</a>
			</li>
		{/each}
	</ul>
{/snippet}

<div class="page">
	<div class="page-main">
		<h1 class="doc-title"><span class="site-benchmark"></span>Outstanding decisions</h1>
		{#if waiting.length}
			{@render rows(waiting)}
		{:else}
			<p class="prose-doc mt-4">No decisions are outstanding. A document appears here when a session sends one.</p>
		{/if}

		{#if toRead.length}
			<section class="mt-12">
				<h2 class="display text-2xl">Reports</h2>
				{@render rows(toRead)}
			</section>
		{/if}

		<section id="merged" class="mt-12">
			<h2 class="display text-2xl">Recently merged PRs</h2>
			<p class="mt-1 text-(length:--text-step-10) muted">
				A session merges a pull request itself when the pull request leaves you nothing to decide and its checks and review have passed.
			</p>
			{#each data.merged as group (group.tool)}
				<h3 class="mt-7 font-semibold">{group.tool}</h3>
				<div class="site-contour-rule mt-1"></div>
				<ul class="mt-3 grid gap-3">
					{#each group.lines as line (line.pr)}
						<li class="prose-doc">
							{@html line.html}
							<a
								href="https://github.com/{group.repo}/pull/{line.pr}"
								target="_blank"
								rel="noreferrer"
								class="mt-0.5 block w-fit font-body text-(length:--text-step-9)"
							>
								#{line.pr}, {when(line.time)} <ExternalLink size={13} aria-hidden="true" class="inline-block align-baseline" />
							</a>
						</li>
					{/each}
				</ul>
			{/each}
		</section>
	</div>
</div>

<style>
	.front-row {
		display: block;
		padding: var(--spacing-14px) var(--spacing-16px);
		border: var(--border) solid var(--color-base-300);
		border-radius: var(--radius-box);
	}
	.front-row:hover {
		background-color: var(--color-base-200);
	}
</style>
