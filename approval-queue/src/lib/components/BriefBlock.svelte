<!-- @component
What a PR or a design opens its work with, under the Survey header: the brief's "What changes" and
"If you approve" sections and its one footnote. All text arrives as HTML the server rendered from
the brief. The header itself is the frame's, so below 1260px the place bar follows it, as on every
screen.
-->
<script lang="ts">
	import PacketIcon from './PacketIcon.svelte';

	interface Props {
		whatChanges?: string[];
		ifYouApprove?: string[];
		worthKnowing?: string | null;
	}

	let { whatChanges = [], ifYouApprove = [], worthKnowing = null }: Props = $props();
</script>

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
