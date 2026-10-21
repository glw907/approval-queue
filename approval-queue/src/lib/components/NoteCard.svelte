<!-- @component
One review note as it sits under its line in the document editor: a correction ("Corrected.") with
what changed, or a call ("Your call.") with its sides and one button per choice. A decided call
collapses to its outcome and a Reopen link. The editor mounts it inside a block widget, so it takes
callbacks rather than binding state, and it is rebuilt whenever its decided or disabled state
changes. The note itself takes programmatic focus, so a screen can land focus on it after a change.
-->
<script lang="ts">
	import { codeSpans, wordDiff } from '#lib/editor/inline.ts';
	import type { Note } from '#lib/editor/notes.ts';

	interface Props {
		note: Note;
		/** The index of the chosen choice; undefined while the call is open. */
		choice?: number;
		/** The calls are frozen, as while a decision is held or once the item is decided. */
		disabled?: boolean;
		onchoose: (index: number) => void;
		onreopen: () => void;
	}

	let { note, choice, disabled = false, onchoose, onreopen }: Props = $props();

	const head = $derived(note.kind === 'info' ? 'Corrected.' : 'Your call.');
	const outcome = $derived(choice === undefined ? null : (note.choices?.[choice]?.done ?? 'Settled'));
</script>

{#snippet inline(text: string)}
	{#each codeSpans(text) as span, i (i)}{#if span.code}<code>{span.text}</code>{:else}{span.text}{/if}{/each}
{/snippet}

{#if outcome !== null}
	<div role="group" class="note done collapsed" id="note-{note.id}" tabindex="-1" aria-label="Decided. {note.title}">
		<p class="nh">
			<span class="kind">Decided.</span><span class="outcome">{outcome}</span>
			<button type="button" class="linkbtn reopen" {disabled} onclick={onreopen}>Reopen</button>
		</p>
	</div>
{:else}
	<div role="group" class={['note', note.kind === 'info' ? 'info' : 'decide']} id="note-{note.id}" tabindex="-1" aria-label="{head} {note.title}">
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
					<button type="button" class="choice" {disabled} onclick={() => onchoose(i)}>{c.label}</button>
				{/each}
			</div>
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
	.note p,
	.note .side {
		max-width: 64ch;
	}
	.nh {
		margin: 0 0 4px;
	}
	.collapsed {
		padding-block: 6px;
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
		gap: 6px;
		margin-top: 8px;
	}
	.choice {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 6px;
		text-align: left;
		font: 600 0.82rem/1.2 var(--font-body);
		border-radius: var(--radius-field);
		border: 1px solid var(--color-base-300);
		background: var(--color-base-100);
		color: var(--color-base-content);
		padding: 6px 10px;
		cursor: pointer;
	}
	.choice:hover:not(:disabled) {
		background: var(--color-base-200);
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
