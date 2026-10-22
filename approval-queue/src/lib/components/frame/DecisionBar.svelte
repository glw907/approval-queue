<!-- @component
The decision bar every screen takes its decision in: "Send back with note" at the left, the state
line, and the approval at the right, with the send-back note panel above it. It is markup only; the
screen supplies the form around it and the buttons, so each screen names its own approval
("Approve the packet", "Approve and merge") and keeps its own lock rules. A decision's Undo lives
in the layout's toast, not here, since the screen is gone by the time it counts down.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		/** The send-back note panel, shown above the bar while it is open. */
		note?: Snippet;
		/** The send-back button; omitted on a screen with nothing to send back. */
		reject?: Snippet;
		/**
		 * The state line: a lead sentence and an optional second line. The screen puts `role="status"`
		 * on the lead alone, so a count that changes as the reader types is not read aloud each time.
		 */
		status: Snippet;
		/** The id the approval's `aria-describedby` points at. */
		statusId?: string;
		approve?: Snippet;
	}

	let { note, reject, status, statusId = 'bar-state', approve }: Props = $props();
</script>

{@render note?.()}
<div class="bar">
	{@render reject?.()}
	<div id={statusId} class="state">{@render status()}</div>
	{@render approve?.()}
</div>
