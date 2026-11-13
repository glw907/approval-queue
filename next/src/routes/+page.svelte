<!--
@component
The front page: the outstanding decisions, the reports, and the pull requests merged in the last
week, grouped by tool.
-->
<script lang="ts">
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import { FRONT, LAYOUT, rowLine } from '#lib/strings.ts';
	import type { Row } from '#lib/components/types.ts';

	let { data } = $props();
	const waiting = $derived(data.rows.filter((r) => r.kind !== 'report'));
	const toRead = $derived(data.rows.filter((r) => r.kind === 'report'));
</script>

<svelte:head><title>{FRONT.title}</title></svelte:head>

{#snippet rows(items: Row[])}
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
		<h1 class="doc-title"><span class="site-benchmark"></span>{LAYOUT.outstanding}</h1>
		{#if waiting.length}
			{@render rows(waiting)}
		{:else}
			<p class="prose-doc mt-4">{FRONT.noneOutstanding}</p>
		{/if}

		{#if toRead.length}
			<section class="mt-12">
				<h2 class="display text-2xl">{FRONT.reports}</h2>
				{@render rows(toRead)}
			</section>
		{/if}

		<section id="merged" class="mt-12">
			<h2 class="display text-2xl">{FRONT.merged}</h2>
			<p class="mt-1 text-(length:--text-step-10) muted">{FRONT.mergedNote}</p>
			{#each data.merged as group (group.repo)}
				<h3 class="mt-7 font-semibold">{group.tool}</h3>
				<div class="site-contour-rule mt-1"></div>
				<ul class="mt-3 grid gap-3">
					{#each group.lines as line (line.number)}
						<li class="prose-doc">
							{@html line.html}
							<a
								href="https://github.com/{group.repo}/pull/{line.number}"
								target="_blank"
								rel="noreferrer"
								class="mt-0.5 block w-fit font-body text-(length:--text-step-9)"
							>
								{FRONT.mergedLink(line.number, line.at)} <ExternalLink size={13} aria-hidden="true" class="inline-block align-baseline" />
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
