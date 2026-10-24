<!-- @component
The packet's routine parts: one row per PR or design no ask binds, each with the session's verdict
preselected in a segment and a Why that opens the detail (a PR's checks and files, or the design
doc). A failing or unchecked PR keeps that fact outside the disclosure. A plan step's verdict sits
on its step in `PacketBrief`, so steps are not listed here.

The segment's radios belong to the decision form and post as `part:<ref>`; `verdicts` is bound up so
the page can follow what changed. The server reads every routine part by ref and refuses a post that
omits one. Renders nothing for a packet with no routine parts.
-->
<script lang="ts">
	import { refKind } from '#lib/packet-view.ts';
	import type { PageData } from '../../routes/item/[id=id]/$types';
	import PacketIcon from './PacketIcon.svelte';
	import PartFiles from './PartFiles.svelte';
	import PacketSeg from './PacketSeg.svelte';
	import Prose from './Prose.svelte';

	type Packet = Extract<PageData, { kind: 'packet' }>;

	interface Props {
		routine: Packet['routine'];
		/** Every part, which carries the detail a row opens to. */
		parts: Packet['parts'];
		/** The verdict chosen for each part, by ref; starts at the session's. */
		verdicts: Record<string, string>;
		/** A decided packet shows its rows but locks every override. */
		decided: boolean;
	}

	let { routine, parts, verdicts = $bindable({}), decided }: Props = $props();

	const rows = $derived(routine.filter((row) => row.kind !== 'step'));
	const detail = (ref: string) => parts.find((p) => p.ref === ref);
	const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
	const KIND = { PR: 'Pull request', Design: 'Design' } as const;

	/** A PR with a failing check or a review that asks for a fix is failing; one with neither run is unchecked. */
	function flag(part: ReturnType<typeof detail>): 'failing' | 'unchecked' | null {
		if (part?.kind !== 'pr') return null;
		if ((part.checks?.failed ?? 0) > 0 || part.review === 'fix' || part.review === 'escalate') return 'failing';
		return (part.checks?.rows.length ?? 0) === 0 || !part.review ? 'unchecked' : null;
	}

	const changed = $derived(rows.filter((row) => verdicts[row.ref] !== row.verdict).length);
</script>

{#if rows.length}
	<section class="sec" id="parts" aria-labelledby="parts-h">
		<h2 id="parts-h">Parts</h2>
		<p class="sl">
			{rows.length} routine {plural(rows.length, 'part', 'parts')}, with the session’s verdicts preselected{changed ? `; ${changed} changed` : ''}.
		</p>
		<ul class="parts">
			{#each rows as row (row.ref)}
				{@const part = detail(row.ref)}
				{@const flagged = flag(part)}
				<li class="part" id="part-{row.ref.replace(/[^\w-]+/g, '-')}">
					<div class="st">
						<p class="pk">{KIND[refKind(row.ref) as keyof typeof KIND]}</p>
						<p class="pt">{row.ref}</p>
						{#if flagged}
							<p class="pr flag {flagged === 'failing' ? 'tone-error' : 'tone-warning'}">
								<PacketIcon name={flagged === 'failing' ? 'gate' : 'eyeoff'} class="mt-0.5 size-4" />
								<span><strong>{flagged === 'failing' ? 'Failing.' : 'Unchecked.'}</strong> <Prose text={row.fact} /></span>
							</p>
						{:else}
							<p class="sx"><Prose text={row.fact} /></p>
						{/if}
						<details class="why">
							<summary><PacketIcon name="chev" class="chev" />Why</summary>
							<div class="why-body">
								<p><Prose text={row.why} /></p>
								{#if part?.kind === 'pr'}
									{#if part.link}
										<p>
											{part.link.head} → {part.link.base} ·
											<a class="link" href={part.link.url} target="_blank" rel="noopener noreferrer">GitHub</a>
										</p>
									{/if}
									<dl class="mt-1 grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-0.5 text-[0.85rem]">
										<dt>Checks</dt>
										<dd>{part.checks?.text ?? 'None.'}</dd>
										<dt>Review</dt>
										<dd>{part.review ?? 'Not stated.'}</dd>
									</dl>
									<PartFiles groups={part.groups ?? []} since={part.since} />
								{:else if part?.kind === 'design' && part.doc}
									<!-- svelte-ignore a11y_no_noninteractive_tabindex: a sideways-scrolling excerpt needs the keyboard to reach it -->
									<pre class="evidence-code" role="region" tabindex="0" aria-label="The design, scrolls sideways"><code>{part.doc}</code></pre>
								{/if}
							</div>
						</details>
					</div>
					<div class="sc">
						<PacketSeg ref={row.ref} kind={row.kind} session={row.verdict} label="Verdict for {row.ref}" bind:verdicts {decided} />
					</div>
				</li>
			{/each}
		</ul>
	</section>
{/if}
