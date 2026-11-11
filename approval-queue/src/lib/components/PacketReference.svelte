<!-- @component
"Reference": three folds that need no decision. Reviews and checks lists what the session read and the
state of each pull request's checks. All files lists every pull request with its body and its files in
the stored `rank` order (held paths, workflows, and configuration first, tests and generated files
last); a file's diff loads when its row is opened. The steps are a numbered list with no controls.
-->
<script lang="ts">
	import type { DiffFile } from '#lib/diff.ts';
	import { render } from '#lib/markdown.ts';
	import type { FactPacket } from '#lib/server/items.ts';
	import { plural, prLabel } from '#lib/packet-view.ts';
	import DiffView from './DiffView.svelte';
	import PacketFold from './PacketFold.svelte';
	import Prose from './Prose.svelte';

	interface Props {
		packet: FactPacket;
		diffs: (ref: string) => Map<string, DiffFile>;
	}

	let { packet, diffs }: Props = $props();

	const { facts, prs } = $derived(packet);
	const sum = (n: number[]) => n.reduce((a, b) => a + b, 0);
	const files = $derived(sum(prs.map((p) => p.files.length)));

	/** The checks of one pull request in a phrase: `all 3 pass`, or the failing and pending counts. */
	function checksLine(checks: Array<{ name: string; bucket: string }>): string {
		if (checks.length === 0) return 'no checks';
		const count = (bucket: string) => checks.filter((c) => c.bucket === bucket).length;
		const bad = [count('fail') && `${count('fail')} failing`, count('pending') && `${count('pending')} pending`, count('cancel') && `${count('cancel')} cancelled`].filter(Boolean);
		return bad.length ? bad.join(', ') : `all ${checks.length} pass`;
	}
	const ordered = (list: FactPacket['prs'][number]['files']) => list.toSorted((a, b) => a.rank - b.rank || a.path.localeCompare(b.path));
	const yours = $derived(facts.steps.filter((s) => s.who === 'you').length);
</script>

<section aria-labelledby="reference-h" id="reference">
	<h2 class="sec" id="reference-h">Reference</h2>
	<p class="secnote">Nothing here needs a decision.</p>

	<PacketFold name="Reviews and checks" eager>
		{#snippet title()}Reviews and checks{/snippet}
		{#snippet sub()}{plural(facts.reviews.length, 'review')} read, and the checks on {plural(prs.length, 'pull request')}.{/snippet}
		{#snippet children()}
			{#if facts.reviews.length}
				<ul class="plain">
					{#each facts.reviews as review (review.text)}
						<li><Prose text={review.text} /> <span class="src"><code>{review.source}</code></span></li>
					{/each}
				</ul>
			{/if}
			<ul class="plain">
				{#each prs as pr (pr.ref)}
					<li><b>{prLabel(pr.ref)}</b>: {checksLine(pr.checks)}</li>
				{/each}
			</ul>
		{/snippet}
	</PacketFold>

	<PacketFold name="All files">
		{#snippet title()}All files{/snippet}
		{#snippet sub()}{plural(prs.length, 'pull request')} and {plural(files, 'file')}, with the ones worth a look first and tests last.{/snippet}
		{#snippet children()}
			{#each prs as pr (pr.ref)}
				<PacketFold name="Pull request {pr.ref}">
					{#snippet title()}<b>{prLabel(pr.ref)}</b>, {pr.title}{/snippet}
					{#snippet sub()}{plural(pr.files.length, 'file')}, +{sum(pr.files.map((f) => f.additions))} −{sum(pr.files.map((f) => f.deletions))}{/snippet}
					{#snippet children()}
						{#if pr.body.trim()}<div class="body">{@html render(pr.body)}</div>{/if}
						{#each ordered(pr.files) as file (file.path)}
							{@const diff = diffs(pr.ref).get(file.path)}
							<PacketFold name="File {pr.ref} {file.path}">
								{#snippet title()}<code>{file.path}</code>{/snippet}
								{#snippet sub()}+{file.additions} −{file.deletions}{#if file.rank === 0}, a held path{/if}{/snippet}
								{#snippet children()}<DiffView file={diff} pr={pr.ref} path={file.path} all />{/snippet}
							</PacketFold>
						{/each}
					{/snippet}
				</PacketFold>
			{/each}
		{/snippet}
	</PacketFold>

	<PacketFold name="If you approve" eager>
		{#snippet title()}If you approve{/snippet}
		{#snippet sub()}{plural(facts.steps.length, 'step')}. {yours ? `The session runs ${facts.steps.length - yours} of them and you run ${yours}.` : 'The session runs all of them.'}{/snippet}
		{#snippet children()}
			<ol class="step-list">
				{#each facts.steps as step, i (i)}
					<li><Prose text={step.text} />{#if step.who === 'you'} <b>You run this step.</b>{/if}</li>
				{/each}
			</ol>
		{/snippet}
	</PacketFold>
</section>
