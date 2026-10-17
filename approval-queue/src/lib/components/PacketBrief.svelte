<!-- @component
The four parts a packet opens with, each styled for its job: the summary (headline and lede, alone in
the tinted box), Background (a muted row whose closed state is its first sentence), "If you approve"
(a vertical timeline, with the steps you run listed above it), and "Not checked" (a neutral panel
whose icon and rule carry the warning hue). A background of one sentence has nothing to open.
-->
<script lang="ts">
	import { splitLead } from '#lib/prose.ts';
	import type { PageData } from '../../routes/item/[id=id]/$types';
	import PacketIcon from './PacketIcon.svelte';
	import Prose from './Prose.svelte';

	let { data }: { data: Extract<PageData, { kind: 'packet' }> } = $props();

	const background = $derived(splitLead(data.background.text));
	const yours = $derived(data.steps.filter((s) => s.tag === 'you'));
	const STEP_LABEL = { session: 'Session step', irreversible: 'Irreversible step', you: 'Your step' };
</script>

<div class="brief-stack">
	<section aria-labelledby="packet-title" class="rounded-box bg-base-200 py-5 ps-5 pe-4 lg:-ms-7 lg:ps-7 lg:pe-6">
		<h1 id="packet-title" class="desk-title brief-title text-balance"><Prose text={data.headline} /></h1>
		<p class="prose-measure mt-3 text-[1.125rem] leading-[1.55]"><Prose text={data.lede} /></p>
	</section>

	{#if background.rest}
		<details class="collapse brief-bg mt-3 rounded-none">
			<summary class="collapse-title brief-bg-row">
				<PacketIcon name="chev" class="chev mt-[0.2rem] size-4" />
				<span><span class="layer-tag">Background</span> <Prose text={background.lead} /></span>
			</summary>
			<div class="collapse-content brief-bg-body"><p class="prose-measure"><Prose text={background.rest} /></p></div>
		</details>
	{:else}
		<p class="brief-bg-row brief-bg-flat mt-3"><span class="layer-tag">Background</span> <Prose text={background.lead} /></p>
	{/if}

	<section aria-labelledby="plan-h" class="mt-6">
		<h2 id="plan-h" class="section-h">If you approve</h2>
		{#if yours.length}
			<p class="prose-measure mt-2 flex items-start gap-2 text-[1.0625rem] leading-normal">
				<PacketIcon name="user" class="mt-[0.2rem] size-4 v-primary" />
				<span>
					<span class="font-semibold">You’ll need to</span>
					{#each yours as step, i (step.n)}{#if i}<span aria-hidden="true"> · </span><span class="sr-only">, and </span>{/if}<Prose text={step.label ?? step.text} />{/each}.
				</span>
			</p>
		{/if}
		<ol class="timeline timeline-vertical timeline-compact timeline-snap-icon plan-timeline mt-3">
			{#each data.steps as step, i (step.n)}
				<li class="plan-step step-{step.tag}">
					{#if i}<hr />{/if}
					<div class="timeline-middle step-mark">
						{#if step.tag === 'session'}
							<svg class="size-2.5 shrink-0" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="currentColor" /></svg>
						{:else}
							<PacketIcon name={step.tag === 'irreversible' ? 'lock' : 'user'} />
						{/if}
					</div>
					<div class="timeline-end step-text"><span class="sr-only">{STEP_LABEL[step.tag]}: </span><Prose text={step.text} /></div>
					{#if i < data.steps.length - 1}<hr />{/if}
				</li>
			{/each}
		</ol>
	</section>

	<aside aria-labelledby="unchecked-h" class="alert brief-unchecked mt-6 items-start">
		<PacketIcon name="eyeoff" class="mt-[0.2rem] size-5 tone-warning" />
		<div class="min-w-0">
			<h2 id="unchecked-h" class="font-semibold">Not checked</h2>
			<p class="prose-measure mt-1 leading-relaxed"><Prose text={data.notChecked} /></p>
		</div>
	</aside>
</div>
