<!-- @component
The "Decide first" cards a PR or a design raises, each a soft alert with a join of radio choices.
Renders nothing when there are no cards.

The radios belong to the decision form in `ItemPanel` (`form="decision-form"`), so a pick posts
with Approve as `c<card>`, and `picks` is bound up to the panel so its bar can unlock Approve. The
server rebuilds the same list and refuses a post whose picks don't cover it.
-->
<script lang="ts">
	import { gate, type Card } from '#lib/cards.ts';
	import { desk } from '#lib/desk.svelte.ts';

	interface Props {
		/** Each card with the HTML the server rendered from its text. */
		cards: Array<Card & { html: string }>;
		/** The chosen choice index for each card, or undefined while it has none. */
		picks: Array<number | undefined>;
		/** A decided item shows its cards but locks every choice. */
		decided: boolean;
	}

	let { cards, picks = $bindable([]), decided }: Props = $props();

	const left = $derived(gate(cards, picks).open.length);

	/** A source line ends in a full stop; a session's own text may already carry one. */
	const stop = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`);
</script>

{#if cards.length}
	<section class="mt-8 space-y-3" aria-labelledby="decide-h">
		<h2 id="decide-h" class="mb-3 flex items-baseline gap-3 text-base font-semibold">
			Decide first
			<span class="text-sm font-normal text-(--color-muted)">{left} of {cards.length} left</span>
		</h2>
		{#each cards as card, i (i)}
			{@const error = card.kind === 'check' || card.kind === 'review'}
			<section
				id="card-{i}"
				aria-labelledby="card-{i}-title"
				class={['alert alert-soft items-start', error ? 'alert-error bg-error/7' : 'alert-warning bg-warning/10']}
			>
				{#if error}
					<svg class="mt-0.5 size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2 20h20L12 3zM12 10v4M12 17h.01" /></svg>
				{:else}
					<svg class="mt-0.5 size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
				{/if}
				<div class="text-base-content">
					<div class="flex items-center gap-2">
						<h3 id="card-{i}-title" class="text-base font-semibold">{card.title}</h3>
						{#if picks[i] !== undefined}
							<span class="badge badge-ghost badge-sm">
								<svg class="size-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg>
								Decided
							</span>
						{/if}
					</div>
					{#if card.kind === 'before-merge'}
						<div class="desk-md desk-card mt-1 max-w-[70ch] text-pretty">{@html card.html}</div>
						<p class="mt-1 text-[0.95rem] text-(--color-muted)">{card.source}.</p>
					{:else}
						<p class="mt-1 max-w-[70ch] text-[0.95rem] leading-relaxed text-pretty">
							{@html card.html}
							<span class="text-(--color-muted)">{stop(card.source)}</span>
						</p>
					{/if}
					<div
						class="join mt-3 rounded-field border border-base-300 bg-base-100 max-sm:join-vertical"
						role="radiogroup"
						aria-labelledby="card-{i}-title"
					>
						{#each card.choices as choice, j (j)}
							<input
								class="join-item btn btn-sm checked:border-base-content checked:bg-base-content checked:text-base-100"
								type="radio"
								name="c{i}"
								value={j}
								form="decision-form"
								aria-label={choice.recommended ? `${choice.label} (recommended)` : choice.label}
								disabled={desk.held || decided}
								bind:group={picks[i]}
							/>
						{/each}
					</div>
				</div>
			</section>
		{/each}
	</section>
{/if}
