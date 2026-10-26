<!-- @component
One of Geoff's comments, or one of the author's replies to an earlier one, as a card in the comment
margin. A comment is a box while it is new or being edited, and once saved it says it goes to the
author with the decision. A thread leads with the author's answer (Done, Kept, or Answered), then
the reply and Geoff's own reply to it if he wrote one, and it collapses once he resolves it. A card
whose text is gone shows the quote it was made on, struck through.

Every action goes through the `DocReview`, which posts it and refuses while another box is open.
With comments read only, as on a decided item, the card shows no actions.
-->
<script lang="ts">
	import { desk } from '#lib/desk.svelte.ts';
	import { codeSpans } from '#lib/editor/inline.ts';
	import type { DocReview, MarginCard } from '#lib/editor/review.svelte.ts';

	interface Props {
		review: DocReview;
		card: Exclude<MarginCard, { kind: 'note' }>;
		/** What the document is called in the gone line, such as "page". */
		kindWord: string;
		current?: boolean;
		/** The heading level of the card's title, one under the margin's own title. */
		level: 3 | 4;
	}

	let { review, card, kindWord, current = false, level }: Props = $props();

	const STATUS = {
		done: { head: 'Done.', line: 'The author made the change.', tone: 'tone-success' },
		kept: { head: 'Kept.', line: 'The author left it as it was and gave a reason.', tone: 'tone-ink' },
		answered: { head: 'Answered.', line: 'The author answered your question.', tone: 'tone-info' }
	};

	const box = $derived(review.box);
	/** This card's own box, if the open box is one of its. */
	const open = $derived.by(() => {
		if (!box) return null;
		if (card.kind === 'draft') return box.kind === 'new' ? box : null;
		if (box.kind === 'new' || box.id !== (card.kind === 'comment' ? card.comment.id : card.thread.id)) return null;
		return box.kind === (card.kind === 'comment' ? 'edit' : 'reply') ? box : null;
	});
	const actions = $derived(review.canComment);
</script>

{#snippet inline(text: string)}
	{#each codeSpans(text) as span, i (i)}{#if span.code}<code>{span.text}</code>{:else}{span.text}{/if}{/each}
{/snippet}

{#snippet gone(quote: string)}
	<p class="quote gone"><span class="sr-only">Removed text: </span>{quote}</p>
	<p class="gone-line">The text you commented on is gone from the {kindWord}.</p>
{/snippet}

{#snippet editor(label: string, placeholder: string, save: string)}
	{#if open}
		<!-- Focus anywhere in the box, its Save and Cancel included, gives Ctrl+Enter and Escape to the comment. -->
		<div
			onfocusin={() => (desk.commentOpen = true)}
			onfocusout={(e) => {
				if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) desk.commentOpen = false;
			}}
		>
			<label class="sr-only" for="comment-box">{label}</label>
			<textarea id="comment-box" class="textarea desk-field" {placeholder} bind:value={open.text}></textarea>
			<div class="dacts">
				<button type="button" class="btn btn-primary btn-sm" onclick={() => void review.saveBox()}>{save}</button>
				<button type="button" class="btn btn-ghost btn-sm" onclick={() => void review.cancelBox()}>Cancel</button>
				<span class="hint"><kbd class="kbd kbd-xs desk-kbd">Ctrl</kbd><kbd class="kbd kbd-xs desk-kbd">Enter</kbd> saves</span>
			</div>
		</div>
	{/if}
{/snippet}

{#if card.kind === 'draft'}
	<div role="group" class="note cmt cur" id="comment-draft" tabindex="-1" aria-label="Your comment">
		<svelte:element this={'h' + level} class="nh"><span class="kind">Your comment.</span></svelte:element>
		{@render editor('Comment on the selected text', 'Ask the author for a change, or ask a question', 'Save')}
	</div>
{:else if card.kind === 'comment'}
	{@const c = card.comment}
	<div role="group" class={['note', 'cmt', current && 'cur']} id="comment-{c.id}" tabindex="-1" aria-label="Your comment">
		<svelte:element this={'h' + level} class="nh"><span class="kind">Your comment.</span>{#if !open}<span class="sub">Goes to the author with your decision</span>{/if}</svelte:element>
		{#if card.gone}{@render gone(c.quote)}{/if}
		{#if open}
			{@render editor('Your comment', 'Ask the author for a change, or ask a question', 'Save')}
		{:else}
			<p class="ctext">{c.text}</p>
			{#if actions}
				<div class="cacts">
					<button type="button" class="btn btn-ghost btn-sm" onclick={() => void review.editComment(c.id)}>Edit</button>
					<button type="button" class="btn btn-ghost btn-sm" onclick={() => void review.deleteComment(c.id)}>Delete</button>
				</div>
			{/if}
		{/if}
	</div>
{:else}
	{@const t = card.thread}
	{@const s = STATUS[t.status]}
	{#if t.resolved}
		<div role="group" class="note done collapsed" id="thread-{t.id}" tabindex="-1" aria-label="Resolved comment">
			<svelte:element this={'h' + level} class="nh"><span class="kind">Resolved.</span><span class="outcome">{t.quote}</span></svelte:element>
			{#if actions}<button type="button" class="btn btn-link btn-sm linkbtn reopen" onclick={() => void review.resolveThread(t.id, false)}>Reopen</button>{/if}
		</div>
	{:else}
		<div role="group" class={['note', 'cmt', current && 'cur']} id="thread-{t.id}" tabindex="-1" aria-label="{s.head} {s.line}">
			<svelte:element this={'h' + level} class="nh"><span class={['kind', s.tone]}>{s.head}</span><span class="outcome">{s.line}</span></svelte:element>
			{#if card.gone}{@render gone(t.quote)}{:else}<p class="quote">You commented on: {t.quote}</p>{/if}
			<div class="side"><b>The author:</b> {@render inline(t.text)}</div>
			{#if open}
				{@render editor('Reply to the author', 'Reply to the author', 'Reply')}
			{:else if t.reply}
				<div class="side">
					<b>You:</b> {t.reply} <span class="sub">(goes to the author with your decision)</span>
					{#if actions}
						<div class="cacts">
							<button type="button" class="btn btn-ghost btn-sm" onclick={() => void review.replyTo(t.id)}>Edit</button>
							<button type="button" class="btn btn-ghost btn-sm" onclick={() => void review.deleteReply(t.id)}>Delete</button>
						</div>
					{/if}
				</div>
			{:else if actions}
				<div class="cacts">
					<button type="button" class="btn btn-ghost btn-sm" onclick={() => void review.resolveThread(t.id, true)}>Resolve</button>
					<button type="button" class="btn btn-ghost btn-sm" onclick={() => void review.replyTo(t.id)}>Reply</button>
				</div>
			{/if}
		</div>
	{/if}
{/if}

<style>
	.note {
		font-family: var(--font-body);
		line-height: 1.5;
		white-space: normal;
		cursor: default;
	}
	.note:focus {
		outline: none;
	}
	.nh {
		margin: 0 0 4px;
	}
	.collapsed .nh {
		margin: 0;
	}
	.sub,
	.outcome {
		font-weight: 400;
	}
	.sub {
		color: var(--color-muted);
	}
	.side .sub {
		font-size: 0.85rem;
	}
	.reopen {
		margin-left: 8px;
		font-weight: 400;
		font-size: 0.82rem;
	}
	.ctext {
		white-space: pre-wrap;
		margin: 0 0 4px;
	}
	.quote {
		margin: 0 0 4px;
		padding-left: 8px;
		border-left: 2px solid color-mix(in oklab, var(--color-primary) 45%, transparent);
		color: var(--color-muted);
		font-size: 0.85rem;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.quote.gone {
		text-decoration: line-through;
	}
	.gone-line {
		color: var(--color-muted);
		font-size: 0.85rem;
	}
	textarea {
		display: block;
		width: 100%;
		min-height: 4.5rem;
		font: inherit;
		font-size: 0.95rem;
		line-height: 1.5;
		padding: 6px 8px;
		resize: vertical;
	}
	.dacts {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-top: 8px;
	}
	.hint {
		margin-left: auto;
		font-size: 0.8rem;
		color: var(--color-muted);
		white-space: nowrap;
	}
	code {
		font-family: var(--font-mono);
		font-size: 0.86em;
	}
	@media (max-width: 1023.98px) {
		.hint {
			display: none;
		}
	}
</style>
