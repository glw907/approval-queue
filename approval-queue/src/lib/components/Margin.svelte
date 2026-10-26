<!-- @component
The comment margin beside one document's editor: every note, comment, and thread as a card level
with the text it is about, under a "Comments" heading with the count still asking for attention.
From 1260px the cards are laid out in the document's own coordinates and stacked so none overlaps,
with the current card held level with its text and the rest gliding around it; a keyboard
selection shows a Comment button level with it. Below 1260px the margin is a drawer that lists the
same cards in text order, opened from the place bar or by tapping a highlight.

Layout reads the editor's line positions, so the cards move whenever the editor's geometry, the
card list, a card's height, or the current card changes. Before the editor is built the cards wait
unplaced and hidden.
-->
<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { closeDrawers } from '#lib/components/frame/drawers.ts';
	import { desk } from '#lib/desk.svelte.ts';
	import { stack, WIDE_MARGIN } from '#lib/editor/margin.ts';
	import type { DocReview } from '#lib/editor/review.svelte.ts';
	import CommentCard from './CommentCard.svelte';
	import NoteCard from './NoteCard.svelte';

	interface Props {
		review: DocReview;
		/** What the empty margin and a gone comment call the document, such as "page". */
		kindWord: string;
		/** The level of the cards' headings; the margin's own title sits one above. Three under a page's h1, four under a section's h2 and the Comments h3. */
		level?: 3 | 4;
	}

	let { review, kindWord, level = 3 }: Props = $props();

	let layer = $state<HTMLDivElement>();
	let wide = $state(true);
	let tops = $state<Record<string, number>>({});
	let height = $state(0);
	let addTop = $state<number | null>(null);
	/** The cards shown at the last layout; one not among them is new, and enters. */
	let shown: Set<string> | null = null;
	let entering = $state<Set<string>>(new Set());

	const open = $derived(desk.paneOpen && desk.pane === review.margin);
	const showAdd = $derived(wide && review.canComment && !review.selectionEmpty && !review.box && !review.dragging);

	let frame = 0;
	function schedule() {
		cancelAnimationFrame(frame);
		frame = requestAnimationFrame(layout);
	}

	function layout() {
		if (!layer || !wide) return;
		const origin = layer.getBoundingClientRect().top;
		const boxes = [...layer.querySelectorAll<HTMLElement>(':scope > .mcard')].map((el) => {
			const key = el.dataset.mc ?? '';
			const top = review.topOf(key);
			// A card sits a little above its line, so its first line of text reads level with the line's.
			return { key, y: top === null ? 0 : top - origin - 6, h: el.offsetHeight };
		});
		tops = stack(boxes, review.currentCard);
		height = Math.max(0, ...boxes.map((b) => (tops[b.key] ?? 0) + b.h));
		const sel = showAdd ? review.selectionTop() : null;
		addTop = sel === null ? null : sel - origin;
	}

	// A card that was not shown at the last render enters; the first render, at page load, has none.
	$effect.pre(() => {
		const keys = review.cards.map((c) => c.key);
		if (shown) {
			const fresh = keys.filter((k) => !shown?.has(k));
			if (fresh.length) entering = new Set([...untrack(() => entering), ...fresh]);
		}
		shown = new Set(keys);
	});

	$effect(() => {
		// Every read here is a reason the cards may move.
		void [review.cards, review.currentCard, review.geometry, review.box, wide, showAdd, review.selectionFrom];
		void tick().then(schedule);
	});

	onMount(() => {
		const query = matchMedia(WIDE_MARGIN);
		const set = () => (wide = query.matches);
		set();
		query.addEventListener('change', set);
		// A card grows when its "What changed" opens or its box takes more text.
		const sizes = new ResizeObserver(schedule);
		const watch = new MutationObserver(() => {
			for (const el of layer?.children ?? []) sizes.observe(el);
		});
		if (layer) {
			watch.observe(layer, { childList: true });
			for (const el of layer.children) sizes.observe(el);
		}
		window.addEventListener('resize', schedule);
		return () => {
			query.removeEventListener('change', set);
			sizes.disconnect();
			watch.disconnect();
			window.removeEventListener('resize', schedule);
			cancelAnimationFrame(frame);
		};
	});

	/** A press on a card's body makes it current; its controls act on their own. */
	function select(e: MouseEvent, key: string) {
		if (e.target instanceof Element && e.target.closest('button, a, textarea, summary, input')) return;
		if (review.currentCard !== key) review.setCurrentCard(key);
	}
</script>

<aside
	id={review.margin}
	class={['review', 'margin', open && 'open']}
	aria-label={review.file ? `Comments on ${review.file}` : 'Comments'}
	role={open ? 'dialog' : undefined}
	aria-modal={open ? 'true' : undefined}
>
	<button type="button" class="drawer-x btn btn-ghost btn-sm btn-square" aria-label="Close comments" onclick={closeDrawers}>
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
	</button>
	<div class="mtitle"><svelte:element this={'h' + (level - 1)} class="mhead">Comments</svelte:element><span class="ncount">{review.cardCount}</span></div>
	<div class="mcards" bind:this={layer} style:min-height={wide && height ? `${height}px` : undefined}>
		{#each review.cards as card (card.key)}
			{@const current = review.currentCard === card.key}
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions: a press on the card's body only makes it current; its buttons carry every action, and the keyboard moves through cards with Ctrl+Alt+N and P -->
			<div
				class={['mcard', current && 'cur', entering.has(card.key) && 'enter', wide && tops[card.key] === undefined && 'unplaced']}
				data-mc={card.key}
				style:top={wide && tops[card.key] !== undefined ? `${tops[card.key]}px` : undefined}
				onclick={(e) => select(e, card.key)}
			>
				{#if card.kind === 'note'}
					{@const note = card.note}
					<NoteCard
						{note}
						{level}
						{current}
						choice={review.decided[note.id]}
						resolved={review.resolved.includes(note.id)}
						disabled={review.locked}
						onchoose={(i) => review.choose(note.id, i)}
						onreopen={() => (review.decided[note.id] !== undefined ? review.reopen(note.id) : review.resolveNote(note.id, false))}
						onresolve={() => review.resolveNote(note.id, true)}
					/>
				{:else}
					<CommentCard {review} {card} {kindWord} {current} {level} />
				{/if}
			</div>
		{:else}
			<p class="mempty">Select text in the {kindWord} to comment on it. Your comments appear here, beside the text they’re about.</p>
		{/each}
		{#if showAdd && addTop !== null}
			<button
				type="button"
				class="btn btn-sm madd"
				style:top="{addTop}px"
				onpointerdown={(e) => {
					e.preventDefault();
					void review.openBox();
				}}
				onclick={(e) => e.detail === 0 && void review.openBox()}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v10H10l-4 4v-4H5z" /><path d="M12 7.5v5M9.5 10h5" /></svg>Comment
			</button>
		{/if}
	</div>
</aside>
