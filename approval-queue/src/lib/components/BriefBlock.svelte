<!-- @component
What every item opens with: the Survey header (crumb, headline, lede) and, for a PR or a design,
the "What changes" and "If you approve" sections with the brief's one footnote. All text arrives
as HTML the server rendered from the brief; a triage passes only the headline and the lede.

The screen supplies its own crumb as `trail`. A caller that passes none gets "Board / Design", the one
screen that does not yet hand this block its item. The header sits inside the work rather than
above the place bar, so below 1260px the sticky place bar comes first.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import FrameHeader from './frame/FrameHeader.svelte';
	import PacketIcon from './PacketIcon.svelte';

	interface Props {
		headlineHtml: string;
		ledeHtml?: string;
		whatChanges?: string[];
		ifYouApprove?: string[];
		worthKnowing?: string | null;
		/** The whole crumb, Board link included, as links and spans. */
		trail?: Snippet;
	}

	let { headlineHtml, ledeHtml = '', whatChanges = [], ifYouApprove = [], worthKnowing = null, trail }: Props = $props();
</script>

<FrameHeader long={headlineHtml.length > 90}>
	{#snippet crumb()}
		{#if trail}{@render trail()}{:else}<a href="/">Board</a><span aria-hidden="true">/</span><span>Design</span>{/if}
	{/snippet}
	{#snippet headline()}{@html headlineHtml}{/snippet}
	{#snippet lede()}{@html ledeHtml}{/snippet}
</FrameHeader>

{#if whatChanges.length}
	<section class="sec" id="what-changes" aria-labelledby="changes-h">
		<h2 id="changes-h">What changes</h2>
		<ul class="changes">
			{#each whatChanges as item, i (i)}
				<li>{@html item}</li>
			{/each}
		</ul>
	</section>
{/if}

{#if ifYouApprove.length}
	<section class="sec" id="if-you-approve" aria-labelledby="approve-h">
		<h2 id="approve-h">If you approve</h2>
		<p class="sl">{ifYouApprove.length} {ifYouApprove.length === 1 ? 'step' : 'steps'}, in order.</p>
		<ol class="psteps">
			{#each ifYouApprove as item, i (i)}
				<li class="pstep">
					<span class="num">{i + 1}</span>
					<div class="st"><p class="sx">{@html item}</p></div>
				</li>
			{/each}
		</ol>
	</section>
{/if}

{#if worthKnowing}
	<div class="note info" id="worth-knowing">
		<p class="nh"><span class="kind"><PacketIcon name="info" class="size-4 align-text-bottom" /> Worth knowing.</span></p>
		<p>{@html worthKnowing}</p>
	</div>
{/if}

<style>
	.changes {
		margin: 8px 0 0;
		padding-inline-start: 1.1rem;
		list-style: disc;
		max-width: 64ch;
		line-height: 1.5;
	}
	.changes li + li {
		margin-top: 6px;
	}
	#worth-knowing {
		margin-top: 26px;
		max-width: 64ch;
	}
</style>
