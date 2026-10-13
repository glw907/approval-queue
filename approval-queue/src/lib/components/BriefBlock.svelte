<!-- @component
The headline block every item opens with: a filled panel with a primary rail hanging in the margin,
the headline, the lede, and, for a PR or a design, the two-column "What changes" and "If you approve"
panel with its one footnote. All text arrives as HTML the server rendered from the brief; a triage
passes only the headline and the lede.
-->
<script lang="ts">
	interface Props {
		headlineHtml: string;
		ledeHtml?: string;
		whatChanges?: string[];
		ifYouApprove?: string[];
		worthKnowing?: string | null;
	}

	let { headlineHtml, ledeHtml = '', whatChanges = [], ifYouApprove = [], worthKnowing = null }: Props = $props();
</script>

<div class="rounded-box border-s-4 border-primary bg-base-200 py-6 ps-4 pe-4 lg:-ms-7 lg:ps-6 lg:pe-6">
	<h1 class="desk-title text-[1.75rem] leading-tight text-balance">{@html headlineHtml}</h1>
	{#if ledeHtml}
		<p class="mt-3 max-w-[70ch] text-[1.05rem] leading-relaxed text-pretty opacity-85">{@html ledeHtml}</p>
	{/if}
	{#if whatChanges.length || ifYouApprove.length}
		<div class="mt-6 border-t border-base-content/10 pt-5 text-[0.95rem] leading-snug">
			<div class="grid gap-6 sm:grid-cols-2">
				<div>
					<h2 class="mb-2.5 text-[0.95rem] font-semibold">What changes</h2>
					<ul class="space-y-2">
						{#each whatChanges as item, i (i)}
							<li class="flex gap-1">
								<span class="w-3.5 shrink-0 text-(--color-muted)" aria-hidden="true">•</span>
								<span class="text-pretty opacity-80">{@html item}</span>
							</li>
						{/each}
					</ul>
				</div>
				<div>
					<h2 class="mb-2.5 text-[0.95rem] font-semibold">If you approve</h2>
					<ol class="space-y-2">
						{#each ifYouApprove as item, i (i)}
							<li class="flex gap-1">
								<span class="w-3.5 shrink-0 tabular-nums text-(--color-muted)">{i + 1}.</span>
								<span class="text-pretty opacity-80">{@html item}</span>
							</li>
						{/each}
					</ol>
				</div>
			</div>
			{#if worthKnowing}
				<p class="mt-5 flex max-w-[70ch] items-start gap-2 text-sm text-(--color-muted)">
					<svg class="mt-px size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
					<span>{@html worthKnowing}</span>
				</p>
			{/if}
		</div>
	{/if}
</div>
