<!-- @component
One note in the margin: the quoted passage, a labelled textarea Geoff writes in (or the stored text,
read-only), the reply that answered it, and a delete button. A note whose passage no longer occurs
shows its original quote and "This passage changed". `readonly` serves a decided packet and the notes
carried from the item this one revises.
-->
<script lang="ts">
	import type { Note, Reply } from '#lib/server/items.ts';
	import { isDiff } from '#lib/note-dom.ts';

	interface Props {
		note: Note;
		readonly: boolean;
		reply?: Reply;
		/** The note's passage no longer occurs on the page. */
		lost: boolean;
		ontext: (text: string) => void;
		ondelete: () => void;
	}

	let { note, readonly, reply, lost, ontext, ondelete }: Props = $props();

	const quote = $derived(note.anchor ? (isDiff(note.anchor) ? note.anchor.text : note.anchor.quote) : 'The whole packet');
	const shown = $derived((quote.length > 96 ? `${quote.slice(0, 96)}…` : quote).replace(/\s+/g, ' '));

	/** Grows the textarea to its text, so a long note never scrolls inside its card. */
	function autosize(el: HTMLTextAreaElement) {
		const fit = () => {
			el.style.height = 'auto';
			el.style.height = `${el.scrollHeight + 2}px`;
		};
		fit();
		el.addEventListener('input', fit);
		return () => el.removeEventListener('input', fit);
	}
</script>

{#if !readonly}
	<button type="button" class="btn btn-ghost btn-xs btn-square x" aria-label="Delete note on: {shown}" onclick={ondelete}>×</button>
{/if}
<q>{shown}</q>
{#if lost}<span class="badge badge-outline badge-sm t-warn">This passage changed</span>{/if}
{#if readonly}
	<p class="said">{note.text}</p>
{:else}
	<textarea
		class="textarea"
		aria-label="Note on: {shown}"
		placeholder="Your note"
		value={note.text}
		oninput={(e) => ontext(e.currentTarget.value)}
		{@attach autosize}
	></textarea>
{/if}
{#if reply}
	<p class="reply"><b>{reply.outcome[0].toUpperCase()}{reply.outcome.slice(1)}.</b> {reply.text}{#if reply.ref} <code>{reply.ref}</code>{/if}</p>
{/if}
