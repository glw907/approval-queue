<!-- @component
The "Decide first" cards a PR or a design raises, each a note on the frame's status rule (amber
while open, red for a failed check or a review that asks for a fix, green once picked) holding a
radio group with nothing preselected. Renders nothing when there are no cards.

The radios belong to the decision form in `ItemPanel` (`form="decision-form"`), so a pick posts
with Approve as `c<card>`, and `picks` is bound up to the panel so its bar can unlock Approve. The
server rebuilds the same list and refuses a post whose picks don't cover it.
-->
<script lang="ts">
	import { gate, type Card } from '#lib/cards.ts';
	import PacketIcon from './PacketIcon.svelte';
	import Prose from './Prose.svelte';

	interface Props {
		/** Each card with the HTML the server rendered from its text. */
		cards: Array<Card & { html: string }>;
		/** The chosen choice index for each card, or undefined while it has none. */
		picks: Array<number | undefined>;
		/** A decided item shows its cards but locks every choice. */
		decided: boolean;
	}

	let { cards, picks = $bindable([]), decided }: Props = $props();

	const KIND = { check: 'Failing.', review: 'Review.', 'before-merge': 'Before merge.', decide: 'Decide.' } as const;
	const left = $derived(gate(cards, picks).open.length);

	/** A source line ends in a full stop; a session's own text may already carry one. */
	const stop = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);
</script>

{#if cards.length}
	<section class="sec" id="decide-first" aria-labelledby="decide-h">
		<h2 id="decide-h">Decide first</h2>
		<p class="sl">{left} of {cards.length} left. Pick one choice in each.</p>
		<div class="grid gap-3">
			{#each cards as card, i (i)}
				{@const error = card.kind === 'check' || card.kind === 'review'}
				<section
					id="card-{i}"
					aria-labelledby="card-{i}-title"
					class={['note ask', picks[i] !== undefined ? 'done' : error ? 'error' : 'decide']}
				>
					<h3 id="card-{i}-title" class="nh">
						<span class="kind">{KIND[card.kind]}</span>
						{card.title}
					</h3>
					{#if card.kind === 'before-merge'}
						<div class="desk-md summary">{@html card.html}</div>
						<p class="ask-part">{stop(card.source)}</p>
					{:else}
						<p class="summary">
							{@html card.html}
							<span class="desk-src">{stop(card.source)}</span>
						</p>
					{/if}
					<fieldset class="choices">
						<legend class="sr-only">{card.title}</legend>
						<p class="choices-h" aria-hidden="true">Choose one</p>
						{#each card.choices as choice, j (j)}
							<label class="ask-option">
								<input
									type="radio"
									class="radio radio-sm mt-0.5"
									name="c{i}"
									value={j}
									form="decision-form"
									disabled={decided}
									bind:group={picks[i]}
								/>
								<span class="flex-1 leading-snug font-semibold"><Prose text={choice.label} /></span>
								{#if choice.recommended}
									<span class="badge badge-sm badge-outline rule-badge tone-info gap-1">
										<PacketIcon name="bulb" class="size-3.5" />Recommended
									</span>
								{/if}
							</label>
						{/each}
					</fieldset>
				</section>
			{/each}
		</div>
	</section>
{/if}

<style>
	.desk-src {
		color: var(--color-muted);
	}
	.desk-md :global(ol),
	.desk-md :global(ul) {
		margin: 0.3rem 0;
		padding-inline-start: 1.25rem;
	}
	.desk-md :global(ol) {
		list-style: decimal;
	}
	.desk-md :global(ul) {
		list-style: disc;
	}
	.desk-md :global(p) {
		margin: 0 0 4px;
	}
	.desk-md :global(code) {
		font-family: var(--font-mono);
		font-size: 0.86em;
	}
</style>
