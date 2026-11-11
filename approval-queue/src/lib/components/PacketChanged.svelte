<!-- @component
"What changed": the writer's lead paragraph, then one fold per claim. A claim's closed line is its
sentence and a second line naming the pull request, the file, the line counts, and whether the plan
holds the path for the reader. Opened, it shows the hunks of the snapshot that hold its cited lines,
or a GitHub link for a file over `MAX_CHANGED` lines. `open` is bindable so a call's evidence link can
open a claim.
-->
<script lang="ts">
	import type { DiffFile } from '#lib/diff.ts';
	import type { FactPacket } from '#lib/server/items.ts';
	import { changedLines, claimHunks, MAX_CHANGED, prLabel } from '#lib/packet-view.ts';
	import DiffView from './DiffView.svelte';
	import PacketFold from './PacketFold.svelte';
	import Prose from './Prose.svelte';

	interface Props {
		packet: FactPacket;
		/** The snapshot's files for a pull request, by path. */
		diffs: (ref: string) => Map<string, DiffFile>;
		open: boolean[];
	}

	let { packet, diffs, open = $bindable() }: Props = $props();

	const file = (ref: string, path: string) => packet.prs.find((p) => p.ref === ref)?.files.find((f) => f.path === path);
</script>

<section aria-labelledby="changed-h" id="changed">
	<h2 class="sec" id="changed-h">What changed</h2>
	{#each packet.text.changedLead.split('\n\n') as paragraph, i (i)}<p class="prose lead"><Prose text={paragraph} /></p>{/each}
	{#each packet.text.claims as claim, i (i)}
		{@const stored = file(claim.pr, claim.path)}
		{@const diff = diffs(claim.pr).get(claim.path)}
		<PacketFold name="Claim {i + 1}: {claim.path}" id="claim-{i}" titleClass="claim" bind:open={open[i]}>
			{#snippet title()}<span data-para><Prose text={claim.text} /></span>{/snippet}
			{#snippet sub()}
				{prLabel(claim.pr)}, <code>{claim.path}</code>{#if stored}, +{stored.additions} −{stored.deletions}{#if stored.rank === 0}, a held path{/if}{/if}
			{/snippet}
			{#snippet children()}
				<DiffView file={diff && changedLines(diff) <= MAX_CHANGED ? claimHunks(diff, claim.from, claim.to) : diff} pr={claim.pr} path={claim.path} />
			{/snippet}
		</PacketFold>
	{/each}
</section>
