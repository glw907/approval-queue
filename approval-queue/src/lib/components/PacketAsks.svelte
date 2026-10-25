<!-- @component
A packet's asks. Each is a note on the frame's status rule, amber while open and green once
answered (red for a failed gate or a contradicted ruling), holding a radio group with nothing
preselected: its question, its summary, and its choices with their consequences sit in the open,
while Background, Facts, and Evidence sit in disclosures whose summary lines state their point.
Choosing an option reveals the session's recommendation and its reason.

The radios belong to the decision form (`form="decision-form"`) and post as `ask:<n>`, the choice's
label; `answers` is bound up so the bar can count what is left. The server rebuilds the asks itself
and refuses a post that leaves one unanswered. Renders nothing for a packet with no asks.
-->
<script lang="ts">
	import { RULE_LOOK, refKind } from '#lib/packet-view.ts';
	import { splitLead } from '#lib/prose.ts';
	import type { PageData } from '../../routes/item/[id=id]/$types';
	import PacketIcon from './PacketIcon.svelte';
	import PartFiles from './PartFiles.svelte';
	import Prose from './Prose.svelte';

	type Ask = Extract<PageData, { kind: 'packet' }>['asks'][number];

	interface Props {
		asks: Ask[];
		/** Every part, which carries the files an ask's bound part changed since the send-back. */
		parts: Extract<PageData, { kind: 'packet' }>['parts'];
		/** The label picked for each ask, by the ask's number counting from 1. */
		answers: Record<number, string | undefined>;
		/** A decided packet shows its asks but locks every choice. */
		decided: boolean;
	}

	let { asks, parts, answers = $bindable({}), decided }: Props = $props();

	const answered = $derived(asks.filter((a) => answers[a.index] !== undefined).length);
</script>

{#if asks.length}
	<section class="sec" id="asks" aria-labelledby="asks-h">
		<h2 id="asks-h">Asks</h2>
		<p class="sl">{answered} of {asks.length} answered. Pick one choice in each; the session’s recommendation shows after you pick.</p>
		<div class="grid gap-3">
			{#each asks as ask (ask.index)}
				{@const look = RULE_LOOK[ask.rule]}
				{@const picked = answers[ask.index]}
				{@const recommended = ask.choices[ask.recommended - 1]}
				{@const background = splitLead(ask.background)}
				<section
					id="ask-{ask.index}"
					aria-labelledby="ask-{ask.index}-title"
					class={['note ask', picked !== undefined ? 'done' : look.tone === 'error' ? 'error' : 'decide']}
				>
					<h3 id="ask-{ask.index}-title" class="nh">
						<span class="kind">{look.label}.</span>
						<Prose text={ask.question} />
					</h3>
					{#if ask.part}
						<p class="ask-part">{refKind(ask.part)} · <code>{ask.part}</code></p>
						{@const bound = parts.find((p) => p.ref === ask.part)}
						{#if bound?.kind === 'pr' && bound.since}
							<PartFiles groups={bound.groups ?? []} since={bound.since} />
						{/if}
					{/if}
					<p class="summary"><Prose text={ask.summary} /></p>

					<div class="layers">
						{#if background.rest}
							<details class="collapse bg">
								<summary class="collapse-title">
									<PacketIcon name="chev" class="chev" />
									<span><span class="lead">Background.</span> <Prose text={background.lead} /></span>
								</summary>
								<div class="collapse-content body"><p><Prose text={background.rest} /></p></div>
							</details>
						{:else}
							<p class="bg bg-flat"><span class="lead">Background.</span> <Prose text={background.lead} /></p>
						{/if}
						{#if ask.facts.length}
							<details class="collapse bg">
								<summary class="collapse-title">
									<PacketIcon name="chev" class="chev" />
									<span><span class="lead">Facts.</span> <Prose text={ask.factsLead} /></span>
								</summary>
								<div class="collapse-content body">
									<ul class="fact-list">
										{#each ask.facts as fact, i (i)}
											<li><Prose text={fact.text} />{#if fact.source} <span class="fact-src">(<Prose text={fact.source} />)</span>{/if}</li>
										{/each}
									</ul>
								</div>
							</details>
						{/if}
						{#if ask.evidence}
							<details class="collapse bg">
								<summary class="collapse-title">
									<PacketIcon name="chev" class="chev" />
									<span><span class="lead">Evidence.</span> <Prose text={ask.evidence.lead} /></span>
								</summary>
								<div class="collapse-content body">
									<!-- svelte-ignore a11y_no_noninteractive_tabindex: a sideways-scrolling excerpt needs the keyboard to reach it -->
									<pre class="evidence-code" role="region" tabindex="0" aria-label="Evidence excerpt, scrolls sideways"><code>{ask.evidence.excerpt}</code></pre>
								</div>
							</details>
						{/if}
					</div>

					<fieldset class="choices">
						<legend class="sr-only"><Prose text={ask.question} /></legend>
						<p class="choices-h" aria-hidden="true">Choose one</p>
						{#each ask.choices as choice, j (j)}
							<label class="ask-option">
								<input
									type="radio"
									class="radio radio-sm mt-0.5"
									name="ask:{ask.index}"
									value={choice.label}
									form="decision-form"
									aria-labelledby="ask-{ask.index}-l{j}"
									aria-describedby={choice.consequence ? `ask-${ask.index}-c${j}` : undefined}
									disabled={decided}
									bind:group={answers[ask.index]}
								/>
								<span class="flex-1 leading-snug">
									<span id="ask-{ask.index}-l{j}" class="block font-semibold"><Prose text={choice.label} /></span>
									{#if choice.consequence}
										<span id="ask-{ask.index}-c{j}" class="consequence"><Prose text={choice.consequence} /></span>
									{/if}
								</span>
								{#if picked !== undefined && j === ask.recommended - 1}
									<span class="badge badge-sm badge-outline rule-badge tone-info gap-1" aria-hidden="true">
										<PacketIcon name="bulb" class="size-3.5" />Session’s pick
									</span>
								{/if}
								{#if j < 3}<kbd class="kbd kbd-sm desk-kbd desk-sk" aria-hidden="true">{j + 1}</kbd>{/if}
							</label>
						{/each}
					</fieldset>

					<div role="status">
						{#if picked !== undefined}
							<div class="side">
								<p>
									<b>{picked === recommended.label ? 'You picked the session’s recommendation.' : 'The session recommended:'}</b>
									{#if picked !== recommended.label}<Prose text={recommended.label} />{/if}
								</p>
								<p><Prose text={ask.reason} /></p>
							</div>
						{/if}
					</div>
				</section>
			{/each}
		</div>
	</section>
{/if}
