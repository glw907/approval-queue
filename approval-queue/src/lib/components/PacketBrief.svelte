<!-- @component
The packet's opening sections, the header aside: "If you approve" (the numbered steps, each with
who runs it and, where the packet routes the step, a verdict segment) and "Not checked" (a note with
a warning rule).

A step's verdict is a routine row on `step:<n>`; `verdicts` is bound up so the page can follow what
changed. A step the packet does not route shows no segment.
-->
<script lang="ts">
	import type { PageData } from '../../routes/item/[id=id]/$types';
	import PacketIcon from './PacketIcon.svelte';
	import PacketSeg from './PacketSeg.svelte';
	import Prose from './Prose.svelte';

	interface Props {
		data: Extract<PageData, { kind: 'packet' }>;
		/** The verdict chosen for each part, by ref. */
		verdicts: Record<string, string>;
		decided: boolean;
	}

	let { data, verdicts = $bindable({}), decided }: Props = $props();

	const yours = $derived(data.steps.filter((s) => s.tag === 'you').length);
	const row = (n: number) => data.routine.find((r) => r.ref === `step:${n}`);
	const WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
	const word = (n: number) => WORDS[n] ?? String(n);
	const sentence = (w: string) => w[0].toUpperCase() + w.slice(1);
	const WHO = {
		session: { icon: 'play', text: 'The session runs it.', tail: '' },
		irreversible: { icon: 'lock', text: 'The session runs it.', tail: ' It cannot be undone.' },
		you: { icon: 'user', text: 'You run it.', tail: '' }
	} as const;
</script>

<section class="sec" id="if-you-approve" aria-labelledby="plan-h">
	<h2 id="plan-h">If you approve</h2>
	<p class="sl">
		{sentence(word(data.steps.length))} {data.steps.length === 1 ? 'step' : 'steps'}, in order.
		{yours === 0 ? 'None are yours.' : yours === 1 ? 'One is yours.' : `${sentence(word(yours))} are yours.`}
	</p>
	<ol class="psteps">
		{#each data.steps as step (step.n)}
			{@const who = WHO[step.tag]}
			{@const routed = row(step.n)}
			<li class="pstep {step.tag}" id="step-{step.n}">
				<span class="num">{step.n}</span>
				<div class="st">
					<p class="sx"><Prose text={step.text} /></p>
					<p class="sw">
						<PacketIcon name={who.icon} class="who" /><span class="by">{who.text}</span>{who.tail}
						{#if routed}<Prose text={routed.fact} />{/if}
					</p>
					{#if routed}
						<details class="why">
							<summary><PacketIcon name="chev" class="chev" />Why</summary>
							<div class="why-body"><p><Prose text={routed.why} /></p></div>
						</details>
					{/if}
				</div>
				{#if routed}
					<div class="sc">
						<PacketSeg ref={routed.ref} kind={routed.kind} session={routed.verdict} label="Step {step.n}" bind:verdicts {decided} />
					</div>
				{/if}
			</li>
		{/each}
	</ol>
</section>

<div class="note decide" id="not-checked">
	<p class="nh"><span class="kind">Not checked.</span></p>
	<p><Prose text={data.notChecked} /></p>
</div>
