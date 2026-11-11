<!-- @component
One call of "Your calls": the question as the heading, its rule badge, the writer's context, risk, and
recommendation, the options as radios with the session's pick selected, and an evidence fold. Picking
another option marks the card changed and offers "Say why", which `onsaywhy` turns into a note. The
digits `1` to `3` pick an option through the layout, which finds the card by its `ask` class.
`locked` shows a decided card's pick read-only. Each piece of evidence that a claim covers links to
that claim through `onjump`, so no diff appears twice on the page.
-->
<script lang="ts">
	import type { CallText, Claim, Call } from '#lib/facts.ts';
	import { claimFor, ruleLabel } from '#lib/packet-view.ts';
	import PacketFold from './PacketFold.svelte';
	import Prose from './Prose.svelte';

	interface Props {
		call: Call;
		text: CallText;
		/** The call's place in the packet, counting from 0. */
		index: number;
		/** The picked option's number, counting from 1. */
		pick: number;
		locked?: boolean;
		claims: Claim[];
		onsaywhy: (heading: string) => void;
		onjump: (claim: number) => void;
	}

	let { call, text, index, pick = $bindable(), locked = false, claims, onsaywhy, onjump }: Props = $props();

	const changed = $derived(pick !== call.recommended);
	const sources = $derived([...new Set(call.evidence.map((e) => e.source))]);
</script>

<div class={['call ask', changed && 'changed']} role="group" aria-labelledby="call-h{index}" id="call-{index}">
	<h3 id="call-h{index}">
		<span>{text.heading}</span>
		<span class="badge badge-outline badge-sm t-warn">{ruleLabel(call.rule)}</span>
	</h3>
	<p class="ctx"><b>Context.</b> <Prose text={text.context} /></p>
	{#if text.risk}<p class="ctx"><b>Risk.</b> <Prose text={text.risk} /></p>{/if}
	{#if text.recommendation}<p class="ctx last"><b>Recommendation.</b> <Prose text={text.recommendation} /></p>{/if}
	{#each call.options as option, i (option.label)}
		<label class="choice">
			<input type="radio" name="call-{index}" class="radio radio-primary" value={i + 1} checked={pick === i + 1} disabled={locked} onchange={() => (pick = i + 1)} />
			<span class="ct"><b>{option.label}</b><small>{option.consequence}</small></span>
			{#if call.recommended === i + 1}<span class="badge badge-outline badge-sm t-pick">Session’s pick</span>{/if}
		</label>
	{/each}
	{#if changed}
		<div class="changed-row">
			<span>You changed this call.</span>
			{#if !locked}<button type="button" class="btn btn-ghost btn-xs" onclick={() => onsaywhy(text.heading)}>Say why</button>{/if}
		</div>
	{/if}
	<PacketFold name="Evidence: {text.heading}">
		{#snippet title()}Evidence{/snippet}
		{#snippet sub()}{call.evidence.length === 1 ? 'One fact' : `${call.evidence.length} facts`}, from {sources.join(', ')}.{/snippet}
		{#snippet children()}
			{#each call.evidence as item (item.text)}
				{@const claim = claimFor(item.source, claims)}
				<p>
					<Prose text={item.text} />
					<span class="src"><code>{item.source}</code></span>
					{#if claim >= 0}<a class="jump" href="#claim-{claim}" onclick={(e) => { e.preventDefault(); onjump(claim); }}>See the lines</a>{/if}
				</p>
			{/each}
		{/snippet}
	</PacketFold>
</div>
