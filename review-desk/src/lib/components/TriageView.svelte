<!-- @component
A triage item's rows. A stub until the triage view lands: each row takes a disposition and a
reason, bound to the rows `ItemPanel` submits.
-->
<script lang="ts">
	import type { Row } from '#lib/triage.ts';

	let { rows = $bindable() }: { rows: Row[] } = $props();
</script>

<div class="max-w-[72ch] space-y-3">
	{#each rows as row, i (i)}
		<div class="space-y-1 border-b border-base-300 pb-3">
			<p>{row.item}</p>
			<div class="flex gap-2">
				<select class="select select-sm w-28" aria-label="Disposition for item {i + 1}" bind:value={row.disposition}>
					<option value="now">now</option>
					<option value="defer">defer</option>
					<option value="drop">drop</option>
				</select>
				<input class="input input-sm grow" aria-label="Reason for item {i + 1}" bind:value={row.reason} />
			</div>
		</div>
	{/each}
</div>
