<!-- @component
A packet's asks. Each is a tinted alert holding a radio group with nothing preselected: its question,
its summary, and its choices with their consequences sit in the open, while Background, Facts, and
Evidence sit in collapses whose summary lines state their point. Choosing an option reveals the
session's recommendation and its reason.

The radios belong to the decision form (`form="decision-form"`) and post as `ask:<n>`, the choice's
label; `answers` is bound up so the bar can count what is left. The server rebuilds the asks itself
and refuses a post that leaves one unanswered. Renders nothing for a packet with no asks.
-->
<script lang="ts">
	import { desk } from '#lib/desk.svelte.ts';
	import { RULE_LOOK, refKind } from '#lib/packet-view.ts';
	import { splitLead } from '#lib/prose.ts';
	import type { PageData } from '../../routes/item/[id=id]/$types';
	import PacketIcon from './PacketIcon.svelte';
	import Prose from './Prose.svelte';

	type Ask = Extract<PageData, { kind: 'packet' }>['asks'][number];

	interface Props {
		asks: Ask[];
		/** The label picked for each ask, by the ask's number counting from 1. */
		answers: Record<number, string | undefined>;
		/** A decided packet shows its asks but locks every choice. */
		decided: boolean;
	}

	let { asks, answers = $bindable({}), decided }: Props = $props();

	const answered = $derived(asks.filter((a) => answers[a.index] !== undefined).length);
</script>

{#if asks.length}
	<section id="asks" aria-labelledby="asks-h" class="mt-8">
		<div class="flex flex-wrap items-baseline gap-x-3">
			<h2 id="asks-h" class="section-h">Asks</h2>
			<span class="text-sm desk-muted">{answered} of {asks.length} answered</span>
		</div>
		<p class="mt-0.5 mb-3 text-sm desk-muted">Pick one choice in each. The session’s recommendation shows after you pick.</p>
		<div class="space-y-4">
			{#each asks as ask (ask.index)}
				{@const look = RULE_LOOK[ask.rule]}
				{@const error = look.tone === 'error'}
				{@const picked = answers[ask.index]}
				{@const recommended = ask.choices[ask.recommended - 1]}
				{@const background = splitLead(ask.background)}
				<section
					id="ask-{ask.index}"
					aria-labelledby="ask-{ask.index}-title"
					class={['ask alert alert-soft items-start', error ? 'alert-error bg-error/7' : 'alert-warning bg-warning/10']}
				>
					<PacketIcon name={error ? 'warn' : 'info'} class="mt-1 size-5" />
					<div class="min-w-0 text-base-content">
						<div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
							<h3 id="ask-{ask.index}-title" class="text-[1.1rem] font-semibold"><Prose text={ask.question} /></h3>
							<span class="badge badge-sm badge-outline rule-badge tone-{look.tone} gap-1">
								<PacketIcon name={look.icon} class="size-3.5" />{look.label}
							</span>
							{#if picked !== undefined}
								<span class="badge badge-sm badge-ghost gap-1"><PacketIcon name="check" class="size-3" />Answered</span>
							{/if}
						</div>
						{#if ask.part}
							<p class="mt-0.5 text-sm desk-muted">{refKind(ask.part)} · <span class="font-mono text-[0.8rem]">{ask.part}</span></p>
						{/if}
						<p class="prose-measure mt-2 text-[1.05rem] leading-relaxed"><Prose text={ask.summary} /></p>

						<div class="ask-layers prose-measure mt-2">
							{#if background.rest}
								<details class="layer">
									<summary class="layer-summary">
										<PacketIcon name="chev" class="chev mt-[0.2rem] size-4" />
										<span><span class="layer-tag">Background</span> <Prose text={background.lead} /></span>
									</summary>
									<div class="layer-body"><p><Prose text={background.rest} /></p></div>
								</details>
							{:else}
								<p class="layer-open"><span class="layer-tag">Background</span> <Prose text={background.lead} /></p>
							{/if}
							{#if ask.facts.length}
								<details class="layer">
									<summary class="layer-summary">
										<PacketIcon name="chev" class="chev mt-[0.2rem] size-4" />
										<span><span class="layer-tag">Facts</span> <Prose text={ask.factsLead} /></span>
									</summary>
									<div class="layer-body">
										<ul class="fact-list">
											{#each ask.facts as fact, i (i)}
												<li><Prose text={fact.text} />{#if fact.source} <span class="fact-src">(<Prose text={fact.source} />)</span>{/if}</li>
											{/each}
										</ul>
									</div>
								</details>
							{/if}
							{#if ask.evidence}
								<details class="layer">
									<summary class="layer-summary">
										<PacketIcon name="chev" class="chev mt-[0.2rem] size-4" />
										<span><span class="layer-tag">Evidence</span> <Prose text={ask.evidence.lead} /></span>
									</summary>
									<div class="layer-body">
										<!-- svelte-ignore a11y_no_noninteractive_tabindex: a sideways-scrolling excerpt needs the keyboard to reach it -->
										<pre class="evidence-code" role="region" tabindex="0" aria-label="Evidence excerpt, scrolls sideways"><code>{ask.evidence.excerpt}</code></pre>
									</div>
								</details>
							{/if}
						</div>

						<fieldset class="prose-wide mt-3 grid gap-2">
							<legend class="sr-only"><Prose text={ask.question} /></legend>
							<p class="text-sm font-semibold desk-muted" aria-hidden="true">Choose one</p>
							{#each ask.choices as choice, j (j)}
								<label class="ask-option flex min-h-11 cursor-pointer items-start gap-3 rounded-field border bg-base-100 px-3 py-2.5">
									<input
										type="radio"
										class="radio radio-sm mt-0.5"
										name="ask:{ask.index}"
										value={choice.label}
										form="decision-form"
										aria-labelledby="ask-{ask.index}-l{j}"
										aria-describedby={choice.consequence ? `ask-${ask.index}-c${j}` : undefined}
										disabled={desk.held || decided}
										bind:group={answers[ask.index]}
									/>
									<span class="flex-1 leading-snug">
										<span id="ask-{ask.index}-l{j}" class="block font-medium"><Prose text={choice.label} /></span>
										{#if choice.consequence}
											<span id="ask-{ask.index}-c{j}" class="mt-0.5 block text-[0.92rem] desk-muted"><Prose text={choice.consequence} /></span>
										{/if}
									</span>
									{#if picked !== undefined && j === ask.recommended - 1}
										<span class="badge badge-sm badge-outline rule-badge tone-info gap-1" aria-hidden="true">
											<PacketIcon name="bulb" class="size-3.5" />Session’s pick
										</span>
									{/if}
								</label>
							{/each}
						</fieldset>

						<div class="prose-wide" role="status">
							{#if picked !== undefined}
								<div class="alert mt-3 alert-info items-start border border-base-300 bg-base-100">
									<PacketIcon name="bulb" class="mt-0.5 size-4 tone-info" />
									<div>
										<p class="font-semibold">
											{picked === recommended.label ? 'You picked the session’s recommendation.' : 'The session recommended:'}
											{#if picked !== recommended.label}<Prose text={recommended.label} />{/if}
										</p>
										<p class="mt-0.5"><Prose text={ask.reason} /></p>
									</div>
								</div>
							{/if}
						</div>
					</div>
				</section>
			{/each}
		</div>
	</section>
{/if}
