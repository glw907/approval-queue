<!-- @component
The decision bar every screen takes its decision in: "Send back with note" at the left, the state
line, and the approval at the right, with the send-back note panel above it. It is markup only; the
screen supplies the form around it and the buttons, so each screen names its own approval
("Approve the packet", "Approve and merge") and keeps its own hold and lock rules.

While a decision is held, the screen passes `hold` (the countdown and Undo) in place of the two
buttons and sets `hideStatus`, which keeps the status line for screen readers only.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** The send-back note panel, shown above the bar while it is open. */
		note?: Snippet;
		/** The send-back button; omitted on a screen with nothing to send back. */
		reject?: Snippet;
		/** The state line: a lead sentence and an optional second line. */
		status: Snippet;
		/** The state line is read aloud only, because `hold` carries the visible text. */
		hideStatus?: boolean;
		/** The id the approval's `aria-describedby` points at. */
		statusId?: string;
		hold?: Snippet;
		approve?: Snippet;
	}

	let { note, reject, status, hideStatus = false, statusId = 'bar-state', hold, approve }: Props = $props();
</script>

{@render note?.()}
<div class="bar">
	{@render reject?.()}
	<div id={statusId} class={['state', hideStatus && 'sr-only']} role="status">{@render status()}</div>
	{@render hold?.()}
	{@render approve?.()}
</div>
