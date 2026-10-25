<!-- @component
One review note as a card in the comment margin, level with the text it is about: a correction
("Corrected.") with what changed and a Resolve button, or a call ("Your call.") with its sides and
one button per choice. A decided call collapses to its outcome and a resolved correction to its
title, each with a Reopen link. Resolving a correction changes no decision. The card takes
programmatic focus, so a screen can land focus on it after a change.
-->
<script lang="ts">
	import { codeSpans, wordDiff } from '#lib/editor/inline.ts';
	import type { Note } from '#lib/editor/notes.ts';

	interface Props {
		note: Note;
		/** The index of the chosen choice; undefined while the call is open. */
		choice?: number;
		/** A correction collapsed in the margin. */
		resolved?: boolean;
		/** The calls are frozen, as once the item is decided. */
		disabled?: boolean;
		/** The card is current, so it takes the tint and its highlight deepens. */
		current?: boolean;
		onchoose: (index: number) => void;
		/** Opens a decided call or a resolved correction again. */
		onreopen: () => void;
		onresolve: () => void;
	}

	let { note, choice, resolved = false, disabled = false, current = false, onchoose, onreopen, onresolve }: Props = $props();

	const head = $derived(note.kind === 'info' ? 'Corrected.' : 'Your call.');
	const outcome = $derived(
		choice !== undefined ? { head: 'Decided.', text: note.choices?.[choice]?.done ?? 'Settled' } : resolved ? { head: 'Resolved.', text: note.title } : null
	);
</script>

{#snippet inline(text: string)}
	{#each codeSpans(text) as span, i (i)}{#if span.code}<code>{span.text}</code>{:else}{span.text}{/if}{/each}
{/snippet}

{#if outcome !== null}
	<div role="group" class="note done collapsed" id="note-{note.id}" tabindex="-1" aria-label="{outcome.head} {note.title}">
		<p class="nh">
			<span class="kind">{outcome.head}</span><span class="outcome">{outcome.text}</span>
			<button type="button" class="btn btn-link btn-sm linkbtn reopen" {disabled} onclick={onreopen}>Reopen</button>
		</p>
	</div>
{:else}
	<div
		role="group"
		class={['note', note.kind === 'info' ? 'info' : 'decide', current && 'cur']}
		id="note-{note.id}"
		tabindex="-1"
		aria-label="{head} {note.title}"
	>
		<p class="nh"><span class="kind">{head}</span><span>{note.title}</span></p>
		{#each note.body as para, i (i)}<p>{@render inline(para)}</p>{/each}
		{#each note.sides ?? [] as side, i (i)}<div class="side"><b>{side.who}:</b> {@render inline(side.text)}</div>{/each}
		{#if note.was !== undefined && note.now !== undefined}
			<details>
				<summary>What changed</summary>
				<!-- One line, so the template adds no whitespace between the diff's runs. -->
				<span class="was">{#each wordDiff(note.was, note.now) as run, i (i)}{#if run.op === 'del'}<del><span class="sr-only">removed: </span>{@render inline(run.text)}</del>{:else if run.op === 'ins'}<ins><span class="sr-only">added: </span>{@render inline(run.text)}</ins>{:else}{@render inline(run.text)}{/if}{/each}</span>
			</details>
		{/if}
		{#if note.choices?.length}
			<div class="choices">
				{#each note.choices as c, i (i)}
					<button type="button" class="choice btn btn-sm" {disabled} onclick={() => onchoose(i)}>{c.label}</button>
				{/each}
			</div>
		{:else if !disabled}
			<div class="cacts"><button type="button" class="btn btn-ghost btn-sm" onclick={onresolve}>Resolve</button></div>
		{/if}
	</div>
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
	.outcome {
		font-weight: 400;
	}
	.reopen {
		margin-left: 8px;
		font-weight: 400;
		font-size: 0.82rem;
	}
	details summary {
		list-style: none;
		cursor: pointer;
		color: var(--color-primary);
		font-size: 0.85rem;
		padding: 2px 0;
	}
	details summary::-webkit-details-marker {
		display: none;
	}
	.was {
		display: block;
		margin-top: 4px;
		font-size: 0.85rem;
	}
	.choices {
		display: grid;
		gap: 4px 8px;
		margin-top: 8px;
	}
	/* The stock small button, set as a full-width choice: a long label wraps and reads from the left. */
	.choice {
		--btn-color: var(--color-base-100);
		--btn-fg: var(--color-base-content);
		--btn-border: var(--color-base-300);
		width: 100%;
		height: auto;
		justify-content: flex-start;
		text-align: left;
		font-weight: 600;
		padding-block: 6px;
	}
	.choice:hover:not(:disabled) {
		--btn-color: var(--color-base-200);
	}
	.choice:disabled,
	.reopen:disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}
	code {
		font-family: var(--font-mono);
		font-size: 0.86em;
	}
</style>
